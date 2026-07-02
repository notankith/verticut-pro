"""
Link Resolver & Video Clipper - GUI version
=============================================

What this does:
 - Lets you paste raw text that has "text ... link ... text ... link ..." mixed
   together (no JSON needed - it's parsed automatically).
 - For share.google links and other google.* links (e.g. /imgres), it resolves
   the actual underlying image URL.
 - For YouTube links followed by a "MM:SS-MM:SS" trim range on the same line,
   it downloads only that section, converts to a <=720p mp4, and uploads it to
   R2, returning a hosted URL.
 - Anything it can't confidently resolve (Instagram, random unknown sites,
   scrape failures) is flagged as a warning in the GUI instead of silently
   guessing.
 - Final output is plain text in the exact format:

     text: ...
     image: ...

   with nothing else mixed in.

Setup (one-time):
    pip install boto3 python-dotenv playwright
    playwright install chromium

.env (same as before) needs, only if you use YouTube clipping:
    R2_PUBLIC_BASE_URL=...
    R2_BUCKET=...
    R2_ACCOUNT_ID=...
    R2_ACCESS_KEY_ID=...
    R2_SECRET_ACCESS_KEY=...

Optional env overrides:
    YTDLP_PATH=C:\\path\\to\\yt-dlp.exe
    FFMPEG_PATH=C:\\path\\to\\ffmpeg.exe   (ffprobe.exe is expected next to it)
"""

import os
import re
import queue
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox

from dotenv import load_dotenv

load_dotenv()

# ---------------- Config ----------------
YTDLP_PATH = os.environ.get("YTDLP_PATH", r"C:\Users\ankit\Downloads\yt-dlp.exe")
FFMPEG_PATH = os.environ.get("FFMPEG_PATH", r"C:\Users\ankit\Downloads\ffmpeg.exe")
FFMPEG_DIR = str(Path(FFMPEG_PATH).parent)
FFPROBE_PATH = str(
    Path(FFMPEG_PATH).with_name(
        "ffprobe.exe" if Path(FFMPEG_PATH).suffix.lower() == ".exe" else "ffprobe"
    )
)

R2_PUBLIC_BASE_URL = os.environ.get("R2_PUBLIC_BASE_URL", "").rstrip("/")
R2_BUCKET = os.environ.get("R2_BUCKET", "")
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")

URL_RE = re.compile(r"https?://\S+")
TRIM_RE = re.compile(r"(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)")
YOUTUBE_RE = re.compile(r"(?:youtube\.com|youtu\.be)", re.IGNORECASE)
DIRECT_MEDIA_RE = re.compile(
    r"\.(jpe?g|png|gif|webp|bmp|mp4|mov|webm|avi)(\?.*)?$", re.IGNORECASE
)
INSTAGRAM_RE = re.compile(r"instagram\.com", re.IGNORECASE)


# ---------------- Free-form text parsing ----------------
def parse_freeform_text(raw_text: str):
    """
    Splits text like:
        "Some text https://link1 more text https://link2 00:19-00:26 trailing"
    into a list of {"text": ..., "url": ..., "trim": (start, end) or None}.
    Text before a URL belongs to that URL. A trim range right after a URL on
    the same line is captured and removed from the text stream.
    """
    items = []
    pos = 0
    matches = list(URL_RE.finditer(raw_text))

    for m in matches:
        text_segment = raw_text[pos:m.start()].strip()
        url = m.group(0).rstrip(".,;:!?")  # strip stray trailing punctuation

        line_end = raw_text.find("\n", m.end())
        if line_end == -1:
            line_end = len(raw_text)

        trim = None
        trim_match = TRIM_RE.search(raw_text, m.end(), line_end)
        if trim_match:
            trim = (trim_match.group(1), trim_match.group(2))
            pos = trim_match.end()
        else:
            pos = m.end()

        items.append({"text": text_segment, "url": url, "trim": trim})

    leftover = raw_text[pos:].strip()
    if leftover:
        items.append({"text": leftover, "url": None, "trim": None})

    return items


# ---------------- URL classification ----------------
def is_youtube_url(url: str) -> bool:
    return bool(YOUTUBE_RE.search(url))


def is_share_google(url: str) -> bool:
    return "share.google" in url


def is_google_domain(url: str) -> bool:
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        return False
    return host == "google.com" or host.endswith(".google.com") or "google." in host


def is_instagram(url: str) -> bool:
    return bool(INSTAGRAM_RE.search(url))


def is_direct_media(url: str) -> bool:
    return bool(DIRECT_MEDIA_RE.search(url))


# ---------------- Google / share.google resolution ----------------
def extract_imgurl_param(url: str):
    """Google's /imgres links carry the real image URL in ?imgurl=... - use it directly."""
    try:
        q = parse_qs(urlparse(url).query)
        if q.get("imgurl"):
            return unquote(q["imgurl"][0])
    except Exception:
        pass
    return None


def scrape_page_for_image(page, url: str):
    """Same heuristic used for share.google: load the page, grab <img> srcs,
    prefer the second image (the first is usually a generic icon/logo)."""
    page.goto(url, wait_until="networkidle", timeout=30000)
    page.wait_for_function("() => document.querySelectorAll('img').length >= 1", timeout=10000)
    imgs = page.locator("img").evaluate_all("(els) => els.map(e => e.src)")
    imgs = [i for i in imgs if i and i.startswith("http")]
    if not imgs:
        return None
    return imgs[1] if len(imgs) > 1 else imgs[0]


def resolve_google_link(page, url: str):
    if is_share_google(url):
        return scrape_page_for_image(page, url)
    # plain google.com links (e.g. /imgres) - try the fast, reliable path first
    direct = extract_imgurl_param(url)
    if direct:
        return direct
    # fall back to the exact same scraping approach as share.google
    return scrape_page_for_image(page, url)


# ---------------- R2 ----------------
_r2_client_holder = {}


def get_r2_client():
    if "client" in _r2_client_holder:
        return _r2_client_holder["client"]
    missing = [
        name
        for name, val in [
            ("R2_PUBLIC_BASE_URL", R2_PUBLIC_BASE_URL),
            ("R2_BUCKET", R2_BUCKET),
            ("R2_ACCOUNT_ID", R2_ACCOUNT_ID),
            ("R2_ACCESS_KEY_ID", R2_ACCESS_KEY_ID),
            ("R2_SECRET_ACCESS_KEY", R2_SECRET_ACCESS_KEY),
        ]
        if not val
    ]
    if missing:
        raise RuntimeError(f"Missing R2 env vars: {', '.join(missing)}")

    import boto3  # imported lazily so the GUI still opens without boto3 installed

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )
    _r2_client_holder["client"] = client
    return client


def upload_to_r2(client, local_path: str, key: str) -> str:
    client.upload_file(local_path, R2_BUCKET, key, ExtraArgs={"ContentType": "video/mp4"})
    return f"{R2_PUBLIC_BASE_URL}/{key}"


# ---------------- Time helpers ----------------
def to_seconds(ts: str) -> float:
    parts = [int(p) for p in ts.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


def get_duration_seconds(path: str):
    try:
        proc = subprocess.run(
            [
                FFPROBE_PATH,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(proc.stdout.strip())
    except Exception:
        return None


# ---------------- YouTube download + trim + convert + upload ----------------
def download_youtube_clip(url: str, start, end, tmpdir: str, log) -> str:
    """
    Downloads only the requested segment.
    --download-sections tells yt-dlp to fetch just that byte range (fast).
    We deliberately omit --force-keyframes-at-cuts because that flag causes
    yt-dlp to download the ENTIRE video and re-encode it just to insert
    keyframes — that's what makes it 5+ minutes. Without it, yt-dlp grabs
    only a small keyframe-aligned chunk around the requested window in
    seconds. Any slight overrun at the start/end is handled by ffmpeg's -t.
    """
    out_template = os.path.join(tmpdir, "source.%(ext)s")
    cmd = [
        YTDLP_PATH,
        "-f", "bv*[height<=720]+ba/b[height<=720]",
        "--ffmpeg-location", FFMPEG_DIR,
        "-o", out_template,
    ]
    if start and end:
        cmd += ["--download-sections", f"*{start}-{end}"]
    cmd.append(url)

    log(f"  yt-dlp: {' '.join(cmd)}")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        log(f"  yt-dlp stderr (tail): {proc.stderr[-600:]}")
        raise RuntimeError(f"yt-dlp failed (exit {proc.returncode})")

    downloaded = list(Path(tmpdir).glob("source.*"))
    if not downloaded:
        raise RuntimeError("yt-dlp did not produce an output file")
    return str(downloaded[0])


def convert_to_mp4_720p(input_path: str, tmpdir: str, clip_duration_s=None, log=print) -> str:
    """
    Re-encodes to <=720p h264/aac mp4.
    clip_duration_s: if set, caps the output at exactly that many seconds via
    ffmpeg -t. This trims any extra frames yt-dlp included due to keyframe
    alignment without needing a second seek pass.
    """
    output_path = os.path.join(tmpdir, "final.mp4")
    cmd = [FFMPEG_PATH, "-y", "-i", input_path]

    if clip_duration_s and clip_duration_s > 0:
        cmd += ["-t", str(clip_duration_s)]

    cmd += [
        "-vf", "scale=-2:'min(720,ih)'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        output_path,
    ]

    log(f"  ffmpeg: {' '.join(cmd)}")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        log(f"  ffmpeg stderr (tail): {proc.stderr[-600:]}")
        raise RuntimeError(f"ffmpeg failed (exit {proc.returncode})")
    return output_path


def process_youtube_item(url: str, start, end, log) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        local_src = download_youtube_clip(url, start, end, tmpdir, log)

        clip_duration_s = None
        if start and end:
            clip_duration_s = to_seconds(end) - to_seconds(start)
            log(f"  clip duration: {clip_duration_s:.1f}s — ffmpeg will cap output to this")

        local_mp4 = convert_to_mp4_720p(local_src, tmpdir, clip_duration_s, log)

        r2_client = get_r2_client()
        key = f"videos/{uuid.uuid4().hex}.mp4"
        hosted_url = upload_to_r2(r2_client, local_mp4, key)
        return {"hosted_url": hosted_url}


# ---------------- Main resolution pipeline ----------------
def process_all(raw_text: str, log, progress_cb):
    from playwright.sync_api import sync_playwright

    parsed = parse_freeform_text(raw_text)
    results = []
    warnings = []
    total = len(parsed)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        for idx, entry in enumerate(parsed, start=1):
            text, url, trim = entry["text"], entry["url"], entry["trim"]
            progress_cb(idx, total, text[:60] if text else "(trailing text)")

            if not url:
                results.append({"text": text, "image": ""})
                continue

            resolved = None
            try:
                if is_direct_media(url):
                    resolved = url

                elif is_instagram(url):
                    warnings.append((text, url, "Instagram links can't be scraped"))

                elif is_youtube_url(url):
                    start, end = trim if trim else (None, None)
                    if not (start and end):
                        log(f"  no trim range found for {url}, downloading full video")
                    yt_result = process_youtube_item(url, start, end, log)
                    resolved = yt_result["hosted_url"]

                elif is_share_google(url) or is_google_domain(url):
                    resolved = resolve_google_link(page, url)
                    if not resolved:
                        warnings.append((text, url, "Could not find an image on this Google page"))

                else:
                    warnings.append((text, url, "Unsupported link type - couldn't scrape, check manually"))

            except Exception as e:
                warnings.append((text, url, f"Error: {e}"))
                log(f"  ERROR resolving {url}: {e}")

            results.append({"text": text, "image": resolved or url})

        browser.close()

    return results, warnings


def build_output_json(results) -> str:
    import json
    payload = [{"text": r["text"], "image": r["image"]} for r in results]
    return json.dumps(payload, indent=2, ensure_ascii=False)


# ==================== GUI ====================
class App:
    def __init__(self, root):
        self.root = root
        root.title("Link Resolver & Video Clipper")
        root.geometry("950x850")

        ttk.Label(root, text="Paste your text with links below (no JSON needed):").pack(
            anchor="w", padx=8, pady=(8, 0)
        )
        self.input_box = scrolledtext.ScrolledText(root, height=10, wrap="word")
        self.input_box.pack(fill="both", expand=False, padx=8, pady=4)

        btn_frame = ttk.Frame(root)
        btn_frame.pack(fill="x", padx=8)
        self.process_btn = ttk.Button(btn_frame, text="Process", command=self.start_processing)
        self.process_btn.pack(side="left")
        self.progress_label = ttk.Label(btn_frame, text="Idle")
        self.progress_label.pack(side="left", padx=12)

        self.progress_bar = ttk.Progressbar(root, mode="determinate")
        self.progress_bar.pack(fill="x", padx=8, pady=4)

        ttk.Label(root, text="Progress log:").pack(anchor="w", padx=8)
        self.log_box = scrolledtext.ScrolledText(root, height=7, wrap="word", state="disabled")
        self.log_box.pack(fill="both", expand=False, padx=8, pady=4)

        ttk.Label(root, text="Warnings (links that couldn't be resolved):").pack(anchor="w", padx=8)
        self.warn_box = scrolledtext.ScrolledText(
            root, height=5, wrap="word", state="disabled", foreground="#b00020"
        )
        self.warn_box.pack(fill="both", expand=False, padx=8, pady=4)

        out_header = ttk.Frame(root)
        out_header.pack(fill="x", padx=8)
        ttk.Label(out_header, text="Output:").pack(side="left")
        ttk.Button(out_header, text="Copy to Clipboard", command=self.copy_output).pack(side="right")

        self.output_box = scrolledtext.ScrolledText(root, height=14, wrap="word")
        self.output_box.pack(fill="both", expand=True, padx=8, pady=4)

        self._last_results = []  # stored for copy-as-JSON
        self.msg_queue = queue.Queue()
        self.root.after(150, self.poll_queue)

    # --- callbacks passed into the worker thread ---
    def log(self, msg):
        self.msg_queue.put(("log", msg))

    def progress_cb(self, idx, total, label):
        self.msg_queue.put(("progress", idx, total, label))

    # --- button handlers ---
    def start_processing(self):
        raw_text = self.input_box.get("1.0", "end").strip()
        if not raw_text:
            messagebox.showwarning("No input", "Please paste some text with links first.")
            return

        self.process_btn.config(state="disabled")
        self._clear(self.log_box)
        self._clear(self.warn_box)
        self._clear(self.output_box)
        self.progress_bar["value"] = 0
        self.progress_label.config(text="Starting...")

        threading.Thread(target=self._run, args=(raw_text,), daemon=True).start()

    def _run(self, raw_text):
        try:
            results, warnings = process_all(raw_text, self.log, self.progress_cb)
            output = build_output_json(results)
            self.msg_queue.put(("done", output, warnings, results))
        except Exception as e:
            self.msg_queue.put(("fatal", str(e)))

    def copy_output(self):
        import json
        if not self._last_results:
            self.progress_label.config(text="Nothing to copy yet.")
            return
        payload = json.dumps(
            [{"text": r["text"], "image": r["image"]} for r in self._last_results],
            indent=2,
            ensure_ascii=False,
        )
        self.root.clipboard_clear()
        self.root.clipboard_append(payload)
        self.progress_label.config(text="Copied JSON to clipboard.")

    # --- queue polling (runs on the main/GUI thread) ---
    def poll_queue(self):
        try:
            while True:
                msg = self.msg_queue.get_nowait()
                kind = msg[0]
                if kind == "log":
                    self._append(self.log_box, msg[1])
                elif kind == "progress":
                    _, idx, total, label = msg
                    self.progress_bar["maximum"] = max(total, 1)
                    self.progress_bar["value"] = idx
                    self.progress_label.config(text=f"Processing {idx}/{total}: {label}")
                elif kind == "done":
                    _, output, warnings, results = msg
                    self._last_results = results
                    self._set(self.output_box, output)
                    if warnings:
                        wtext = "\n".join(
                            f"- [{url}]\n  reason: {reason}\n  text: {text}\n"
                            for text, url, reason in warnings
                        )
                    else:
                        wtext = "No warnings — everything resolved cleanly."
                    self._set(self.warn_box, wtext)
                    self.progress_label.config(text="Done.")
                    self.process_btn.config(state="normal")
                elif kind == "fatal":
                    messagebox.showerror("Error", msg[1])
                    self.progress_label.config(text="Failed.")
                    self.process_btn.config(state="normal")
        except queue.Empty:
            pass
        self.root.after(150, self.poll_queue)

    # --- small text-widget helpers ---
    @staticmethod
    def _clear(box):
        box.config(state="normal")
        box.delete("1.0", "end")
        box.config(state="disabled")

    @staticmethod
    def _append(box, text):
        box.config(state="normal")
        box.insert("end", text + "\n")
        box.see("end")
        box.config(state="disabled")

    @staticmethod
    def _set(box, text):
        box.config(state="normal")
        box.delete("1.0", "end")
        box.insert("end", text)
        box.config(state="disabled")


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
import json
import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path

import boto3
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()  # reads .env in cwd

# ---------- Config ----------
YTDLP_PATH = os.environ.get("YTDLP_PATH", r"C:\Users\ankit\Downloads\yt-dlp.exe")
FFMPEG_PATH = os.environ.get("FFMPEG_PATH", r"C:\Users\ankit\Downloads\ffmpeg.exe")
FFMPEG_DIR = str(Path(FFMPEG_PATH).parent)

R2_PUBLIC_BASE_URL = os.environ["R2_PUBLIC_BASE_URL"].rstrip("/")
R2_BUCKET = os.environ["R2_BUCKET"]
R2_ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
R2_ACCESS_KEY_ID = os.environ["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = os.environ["R2_SECRET_ACCESS_KEY"]

YOUTUBE_RE = re.compile(r"(?:youtube\.com|youtu\.be)", re.IGNORECASE)
TRIM_RE = re.compile(r"(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)")

items = [
  {
    "text": "Ex-NFL star Doug Martin's parents",
    "image": "https://share.google/QxG0QXG7GbjsJkDU9"
  },
  {
    "text": "filed a federal wrongful-death lawsuit",
    "image": "https://share.google/Y3wI0M977mYQ74fMZ"
  },
  {
    "text": "against the city of Oakland,",
    "image": "https://share.google/fSqaPzj4EsmBCQVAm"
  },
  {
    "text": "alleging police",
    "image": "https://share.google/K2yeeB7tCcTKYs49e"
  },
  {
    "text": "pinned the former Buccaneers running back face-first into the ground during a mental health crisis last October.",
    "image": "https://share.google/md9Vdc8RRG9fpesN0"
  },
  {
    "text": "An independent pathologist concluded",
    "image": "https://share.google/08U3EUqYXLD93VcQ8"
  },
  {
    "text": "he likely died from restrained asphyxia.",
    "image": "https://share.google/hwgOaHPXvKE3Qw2rl"
  },
  {
    "text": "The official autopsy",
    "image": "https://share.google/K1XuCeTz1zclDmkRS"
  },
  {
    "text": "still has not been released.",
    "image": "https://share.google/uN2VyaDwrtonte64b"
  },
  {
    "text": "The WNBA",
    "image": "https://share.google/6XWm3L5MfOEQeJ4M4"
  },
  {
    "text": "suspended Phoenix Mercury forward Alyssa Thomas",
    "image": "https://share.google/l97d0QOVXjJP45sve"
  },
  {
    "text": "one game after she drove her fist into Caitlin Clark's throat",
    "image": "https://www.instagram.com/p/DaCcZx_kpyh/?igsh=eHIzbjlteHBoaThm"
  },
  {
    "text": "during a second-quarter scramble, a hit referees never called live.",
    "image": "https://share.google/WDU3XoI4wTfY5FleX"
  },
  {
    "text": "Clark scored 19 in 20 minutes, left with a back injury,",
    "image": "https://share.google/iqNofY3tv6PJBuw8m"
  },
  {
    "text": "and the Fever still lost 111-109. Google this and screenshot the scoreline: phoenix mercury vs indiana fever. Then ex-NFL safety TJ Ward went on a podcast and blamed Clark herself, calling her privileged and a brat,",
    "image": "https://share.google/KGzD1NazZOM5DMLUZ"
  },
  {
    "text": "saying she needs to be nicer if she cannot physically protect herself.",
    "image": "https://sports.ndtv.com/us/nba/ex-nfl-star-tj-ward-rips-caitlin-clark-after-wnba-suspends-alyssa-thomas-shes-privileged-and-a-brat-11692365"
  },
  {
    "text": "Highlight this part: \"And if you can't fight, you better be a nice person.\" Seven of the eleven NFL stadiums hosting World Cup games this summer",
    "image": "https://share.google/l6pLrWOZ3qEswvdq4"
  },
  {
    "text": "normally run on artificial turf have",
    "image": "https://share.google/lUOGBbyUFu1Yuti0p"
  },
  {
    "text": "FIFA came in and replaced all of it with natural grass.",
    "image": "https://share.google/rZc19QFd6cUzsIqO3"
  },
  {
    "text": "A 2023 NFLPA survey showed 92% of players prefer grass,",
    "image": "https://www.shutterstock.com/video/clip-1046966686-progress-loading-bar-0-100-transparent-background-alpha"
  },
  {
    "text": "stop at 92% and George Kittle watched the US score at SoFi Stadium",
    "image": "https://share.google/hZikAmvTTPIXMYWgi"
  },
  {
    "text": "and immediately posted asking if the 49ers could have that all season.",
    "image": "https://www.instagram.com/p/DaD2V4ykrg3/?igsh=MXNzejl5ZTZpYWVrOA=="
  },
  {
    "text": "Zaire Wade,",
    "image": "https://share.google/YrLiuKvrUuKDzgbA8"
  },
  {
    "text": "24-year-old son of Hall of Famer Dwyane Wade,",
    "image": "https://share.google/Rwp3vMCxmUXqRPZZP"
  },
  {
    "text": "was arrested in Burbank at",
    "image": "https://share.google/7kklzEegT2duFVW5g"
  },
  {
    "text": "5:30 in the morning on",
    "image": "https://share.google/ymPK6BDn9gL8LaFUP"
  },
  {
    "text": "three felony counts: domestic violence,",
    "image": "https://share.google/8bZGgGraH9PxGiSwG"
  },
  {
    "text": "criminal threats",
    "image": "https://share.google/VwIWePqqaWsiCJ8xR"
  },
  {
    "text": "and false imprisonment.",
    "image": "https://share.google/aNxbIOLwKXpSbahsw"
  },
  {
    "text": "Officers found a woman with lacerations at the scene",
    "image": "https://share.google/jXCiPganvwWUD5tSl"
  },
  {
    "text": "and recovered a handgun from the home.",
    "image": "https://share.google/eMHNaPY0AfA6SuPl4"
  },
  {
    "text": "He posted $50,000 bond the same day with no formal charges filed, no statement from either Wade.",
    "image": "https://share.google/2baPdFlv7WVn5ZKgL"
  },
  {
    "text": "Michigan State's Carson Cooper",
    "image": "https://share.google/7B6wX1h0OmRNnjZVU"
  },
  {
    "text": "signed a two-way deal with the Memphis Grizzlies",
    "image": "https://share.google/yRxKkrGqwsgIbvtQu"
  },
  {
    "text": "after going undrafted, while teammate Jaxon Kohler landed an Exhibit 10 contract",
    "image": "https://share.google/s29iRNZAMr0i4k2Fd"
  },
  {
    "text": "with the Utah Jazz.",
    "image": "https://share.google/UIdqS2GsKaIRqBfoU"
  },
  {
    "text": "Cooper's deal is the stronger signal",
    "image": "https://www.instagram.com/p/DaA3cw6ltXG/?igsh=aTRtMWIxN3JqdGJr"
  },
  {
    "text": "as Memphis sees a realistic path",
    "image": "https://share.google/7i2FDsqI6JD5zC0Gk"
  },
  {
    "text": "to NBA minutes for him this season.",
    "image": "https://share.google/rr9FdzjB9lpULvTsO"
  },
  {
    "text": "Kohler's road is harder, but he shot nearly",
    "image": "https://share.google/Dh84sDMNzBvPcwstO"
  },
  {
    "text": "40% from three as a senior and consistently knows where to be on the floor.",
    "image": "https://share.google/dghbv1CuxhlWh2Fjc"
  },
  {
    "text": "The NBA",
    "image": "https://share.google/5F44Yyd9ZelQV4ixK"
  },
  {
    "text": "is pushing into Asia",
    "image": "https://www.instagram.com/p/DUbklo-Ffjm/?img_index=1&igsh=cDd5Nzg2MDdtdm05"
  },
  {
    "text": "Image 2 with a renewed focus on technology partnerships and talent development,",
    "image": "https://youtu.be/59tSU9DdUpQ?si=pjua6j1_GRxFTgb9"
  },
  {
    "text": "00:00-00:02 targeting a resurgence in a market that drove massive global growth",
    "image": "https://youtu.be/zf0xFmtWNVY?si=lcEJQZaJr_ejqOB1"
  },
  {
    "text": "00:00-00:02 during the Yao Ming era.",
    "image": "https://youtu.be/lhgvaO7o3lE?si=s8eg6OHchDtL7td-"
  },
  {
    "text": "00:00-00:01 The league is leaning on streaming deals and grassroots scouting pipelines to rebuild its footprint across China, Japan, and Southeast Asia.",
    "image": "https://share.google/5Q7ScHtWzGguy0LHN"
  },
  {
    "text": "The bet is that the next homegrown Asian star does for that market what Yao did two decades ago.",
    "image": "https://share.google/B6OmXHUUxsNkEnDli"
  }
]



# ---------- R2 client ----------
def get_r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def upload_to_r2(client, local_path: str, key: str) -> str:
    client.upload_file(local_path, R2_BUCKET, key, ExtraArgs={"ContentType": "video/mp4"})
    return f"{R2_PUBLIC_BASE_URL}/{key}"


# ---------- Parsing helpers ----------
def split_url_and_note(image_field: str):
    match = re.match(r"(\S+)\s*(.*)", image_field.strip())
    if not match:
        return image_field.strip(), ""
    return match.group(1), match.group(2).strip()


def extract_trim(note: str):
    """Pull a start-end trim range out of the note, if present."""
    m = TRIM_RE.search(note)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def is_youtube_url(url: str) -> bool:
    return bool(YOUTUBE_RE.search(url))


# ---------- share.google ----------
def resolve_share_google_image(page, url: str) -> str:
    page.goto(url, wait_until="networkidle")
    page.wait_for_function("() => document.querySelectorAll('img').length >= 2")
    images = page.locator("img").evaluate_all("(imgs) => imgs.map(img => img.src)")
    return images[1] if len(images) > 1 else (images[0] if images else None)


# ---------- YouTube download + convert + upload ----------
def download_youtube_clip(url: str, start: str, end: str, tmpdir: str) -> str:
    """Downloads (trimmed if start/end given) <=720p video into tmpdir, returns local path."""
    out_template = os.path.join(tmpdir, "source.%(ext)s")
    cmd = [
        YTDLP_PATH,
        "-f", "bv*[height<=720]+ba/b[height<=720]",
        "--ffmpeg-location", FFMPEG_DIR,
        "-o", out_template,
    ]
    if start and end:
        cmd += ["--download-sections", f"*{start}-{end}", "--force-keyframes-at-cuts"]
    cmd.append(url)

    subprocess.run(cmd, check=True)

    downloaded = list(Path(tmpdir).glob("source.*"))
    if not downloaded:
        raise RuntimeError("yt-dlp did not produce an output file")
    return str(downloaded[0])


def convert_to_mp4_720p(input_path: str, tmpdir: str) -> str:
    output_path = os.path.join(tmpdir, "final.mp4")
    cmd = [
        FFMPEG_PATH, "-y",
        "-i", input_path,
        "-vf", "scale=-2:'min(720,ih)'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        output_path,
    ]
    subprocess.run(cmd, check=True)
    return output_path


def process_youtube_item(url: str, start, end, r2_client) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        local_src = download_youtube_clip(url, start, end, tmpdir)
        local_mp4 = convert_to_mp4_720p(local_src, tmpdir)
        key = f"videos/{uuid.uuid4().hex}.mp4"
        hosted_url = upload_to_r2(r2_client, local_mp4, key)
        return {"hosted_url": hosted_url, "r2_key": key}


# ---------- Main ----------
def main():
    results = []
    r2_client = get_r2_client()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        for item in items:
            url, note = split_url_and_note(item["image"])
            entry = {"text": item["text"], "original_image_field": item["image"]}

            if "share.google" in url:
                try:
                    resolved = resolve_share_google_image(page, url)
                    entry["resolved_image_url"] = resolved
                except Exception as e:
                    entry["resolved_image_url"] = None
                    entry["error"] = str(e)

            elif is_youtube_url(url):
                start, end = extract_trim(note)
                entry["trim"] = f"{start}-{end}" if start else None
                try:
                    yt_result = process_youtube_item(url, start, end, r2_client)
                    entry.update(yt_result)
                except Exception as e:
                    entry["hosted_url"] = None
                    entry["error"] = str(e)

            else:
                entry["resolved_image_url"] = None
                entry["skipped_reason"] = "unrecognized link type"

            results.append(entry)
            print(f"Processed: {item['text'][:50]!r} -> {entry}")

        browser.close()

    with open("resolved_images.json", "w") as f:
        json.dump(results, f, indent=2)

    print("\nDone. Results written to resolved_images.json")


if __name__ == "__main__":
    main()
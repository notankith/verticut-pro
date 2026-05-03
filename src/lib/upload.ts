// Frontend helper: presign + upload to R2
import { presignUpload, fetchAndUploadImage } from "@/api.functions";

export async function uploadToR2(file: File, kind: "audio" | "image" | "music") {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const { uploadUrl, key, publicUrl } = await presignUpload({
    data: { kind, ext, contentType: file.type || "application/octet-stream" },
  });
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return { key, url: publicUrl };
}

const IMAGE_MIME_RE = /^image\/(png|jpe?g|webp|avif|gif|bmp|svg\+xml|heic|heif)$/i;
const IMAGE_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|webp|avif|gif|bmp|svg|heic|heif)(\?\S*)?$/i;

function extFromBlob(blob: Blob, fallback = "bin") {
  const m = blob.type.match(/^image\/([a-z0-9+-]+)$/i);
  if (!m) return fallback;
  return m[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
}

// Pulls an image URL down through a CORS-friendly path so we can re-upload it
// to our own bucket. Falls back to a direct fetch — works for most CDNs that
// allow cross-origin reads (sportskeeda, getty CDNs, etc.).
async function urlToImageFile(url: string): Promise<File> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error(`Not an image: ${blob.type}`);
  const ext = extFromBlob(blob, "jpg");
  const filename = (url.split("/").pop()?.split("?")[0] || `pasted.${ext}`).slice(0, 80);
  return new File([blob], filename, { type: blob.type });
}

export type PastedImage = { key: string; url: string };

// Inspects a ClipboardEvent for image content. Handles three cases:
//  • A direct image blob (e.g. screenshot copy)
//  • A pasted image URL pointing at a remote file
//  • An <img>-rich HTML fragment with an https src
// Returns the uploaded R2 references, or null if nothing image-like was found.
export async function extractAndUploadPastedImages(
  e: ClipboardEvent,
): Promise<PastedImage[] | null> {
  const cd = e.clipboardData;
  if (!cd) return null;
  const uploads: Promise<PastedImage>[] = [];

  // 1. Direct image blob (screenshots, "copy image" from browser)
  for (const item of Array.from(cd.items)) {
    if (item.kind === "file" && IMAGE_MIME_RE.test(item.type)) {
      const file = item.getAsFile();
      if (file) uploads.push(uploadToR2(file, "image"));
    }
  }

  if (uploads.length === 0) {
    // 2. Plain-text URL paste
    const text = cd.getData("text/plain")?.trim();
    if (text && IMAGE_URL_RE.test(text)) {
      // Use server-side fetch to avoid CORS issues when pulling external images
      uploads.push(fetchAndUploadImage({ data: { url: text } }).then(({ key, publicUrl }) => ({ key, url: publicUrl })));
    } else if (text) {
      // 3. HTML fragment — try the first <img src> we can find
      const html = cd.getData("text/html");
      if (html) {
        const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m && /^https?:\/\//i.test(m[1])) {
          uploads.push(fetchAndUploadImage({ data: { url: m[1] } }).then(({ key, publicUrl }) => ({ key, url: publicUrl })));
        }
      }
    }
  }

  if (uploads.length === 0) return null;
  return Promise.all(uploads);
}

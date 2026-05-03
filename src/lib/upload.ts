// Frontend helper: presign + upload to R2
import { presignUpload, fetchAndUploadImage } from "@/api.functions";

export async function uploadToR2(
  file: File,
  kind: "audio" | "image" | "music",
  onProgress?: (pct: number) => void,
) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const { uploadUrl, key, publicUrl } = await presignUpload({
    data: { kind, ext, contentType: file.type || "application/octet-stream" },
  });

  // Use XHR to provide upload progress events
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    // Must match the Cache-Control set on the presigned PutObjectCommand or
    // R2 rejects the signature. Yields long-lived browser/CDN caching since
    // R2 keys are content-addressed UUIDs.
    xhr.setRequestHeader("cache-control", "public, max-age=31536000, immutable");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        try { onProgress(pct); } catch {}
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });

  if (onProgress) try { onProgress(100); } catch {}
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
  opts?: {
    onProgress?: (index: number, pct: number) => void;
    onError?: (index: number, err: unknown) => void;
  },
): Promise<PastedImage[] | null> {
  const cd = e.clipboardData;
  if (!cd) return null;
  const uploads: Promise<PastedImage>[] = [];

  // 1. Direct image blob (screenshots, "copy image" from browser)
  for (const item of Array.from(cd.items)) {
    if (item.kind === "file" && IMAGE_MIME_RE.test(item.type)) {
      const file = item.getAsFile();
      if (file) {
        const idx = uploads.length;
        uploads.push(
          uploadToR2(file, "image", (pct) => opts?.onProgress?.(idx, pct)).catch((err) => {
            opts?.onError?.(idx, err);
            throw err;
          }),
        );
      }
    }
  }

  if (uploads.length === 0) {
    // 2. Plain-text URL paste
    const text = cd.getData("text/plain")?.trim();
    if (text && IMAGE_URL_RE.test(text)) {
      // Use server-side fetch to avoid CORS issues when pulling external images
      const idx = uploads.length;
      uploads.push(
        fetchAndUploadImage({ data: { url: text } })
          .then(({ key, publicUrl }) => ({ key, url: publicUrl }))
          .then((res) => {
            opts?.onProgress?.(idx, 100);
            return res;
          })
          .catch((err) => {
            opts?.onError?.(idx, err);
            throw err;
          }),
      );
    } else if (text) {
      // 3. HTML fragment — try the first <img src> we can find
      const html = cd.getData("text/html");
      if (html) {
        const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m && /^https?:\/\//i.test(m[1])) {
          const idx = uploads.length;
          uploads.push(
            fetchAndUploadImage({ data: { url: m[1] } })
              .then(({ key, publicUrl }) => ({ key, url: publicUrl }))
              .then((res) => {
                opts?.onProgress?.(idx, 100);
                return res;
              })
              .catch((err) => {
                opts?.onError?.(idx, err);
                throw err;
              }),
          );
        }
      }
    }
  }

  if (uploads.length === 0) return null;
  return Promise.all(uploads);
}

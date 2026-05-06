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
// Loose URL → image hint. Used only for *priority ordering* of fallback
// candidates — the server validates content-type, so non-matching URLs are
// still attempted (many real CDN URLs lack a file extension).
const IMAGE_URL_RE = /\.(png|jpe?g|webp|avif|gif|bmp|svg|heic|heif)(\?|$)/i;

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 300): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

export type PastedImage = { key: string; url: string };

// Inspects a ClipboardEvent for image content. Tries multiple sources in
// priority order (file blob → text URL → text/uri-list → HTML <img>) with
// retries, and falls back to URL sources if a blob upload fails. Returns the
// uploaded R2 references, or null if nothing image-like was found.
export async function extractAndUploadPastedImages(
  e: ClipboardEvent,
  opts?: {
    onProgress?: (index: number, pct: number) => void;
    onError?: (index: number, err: unknown) => void;
  },
): Promise<PastedImage[] | null> {
  const cd = e.clipboardData;
  if (!cd) return null;

  // Collect blob candidates (screenshots, "copy image")
  const blobs: File[] = [];
  for (const item of Array.from(cd.items)) {
    if (item.kind === "file" && IMAGE_MIME_RE.test(item.type)) {
      const file = item.getAsFile();
      if (file) blobs.push(file);
    }
  }

  // Collect URL fallback candidates from every available clipboard format.
  // We don't filter strictly by extension here — many CDN URLs (Getty, S3,
  // signed URLs) lack one. The server validates content-type at fetch time.
  const urlSet = new Set<string>();
  const text = cd.getData("text/plain")?.trim();
  if (text && /^https?:\/\/\S+$/i.test(text)) urlSet.add(text);

  const uriList = cd.getData("text/uri-list");
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith("#") && /^https?:\/\//i.test(t)) urlSet.add(t);
    }
  }

  const html = cd.getData("text/html");
  if (html) {
    const re = /<img[^>]+src=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (/^https?:\/\//i.test(m[1])) urlSet.add(m[1]);
    }
  }

  // Prefer URLs that look like images; non-matching URLs still get tried.
  const fallbackUrls = Array.from(urlSet).sort(
    (a, b) => Number(IMAGE_URL_RE.test(b)) - Number(IMAGE_URL_RE.test(a)),
  );

  if (blobs.length === 0 && fallbackUrls.length === 0) return null;

  const tryBlob = (file: File, idx: number) =>
    withRetry(() =>
      uploadToR2(file, "image", (pct) => opts?.onProgress?.(idx, pct)),
    );

  const tryUrl = async (url: string, idx: number): Promise<PastedImage> => {
    const res = await withRetry(() => fetchAndUploadImage({ data: { url } }));
    opts?.onProgress?.(idx, 100);
    return { key: res.key, url: res.publicUrl };
  };

  const tryUrlChain = async (idx: number): Promise<PastedImage | null> => {
    let lastErr: unknown = null;
    for (const u of fallbackUrls) {
      try {
        return await tryUrl(u, idx);
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    return null;
  };

  const results: PastedImage[] = [];

  if (blobs.length > 0) {
    for (let i = 0; i < blobs.length; i++) {
      try {
        results.push(await tryBlob(blobs[i], i));
      } catch (blobErr) {
        // Blob path failed — fall back to any URL we extracted from the same
        // paste before reporting an error.
        try {
          const fallback = await tryUrlChain(i);
          if (fallback) {
            results.push(fallback);
            continue;
          }
          opts?.onError?.(i, blobErr);
        } catch (urlErr) {
          opts?.onError?.(i, urlErr ?? blobErr);
        }
      }
    }
  } else {
    try {
      const got = await tryUrlChain(0);
      if (got) results.push(got);
    } catch (err) {
      opts?.onError?.(0, err);
    }
  }

  if (results.length === 0) return null;
  return results;
}

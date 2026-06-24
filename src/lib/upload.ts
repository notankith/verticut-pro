async function presignUpload(opts: { kind: string; ext: string; contentType: string }) {
  const res = await fetch("/api/presign-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`Presign failed: ${res.statusText}`);
  return res.json() as Promise<{ uploadUrl: string; key: string; publicUrl: string }>;
}

export async function uploadToR2(
  file: File,
  kind: "audio" | "image" | "music" | "video",
  onProgress?: (pct: number) => void,
) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const { uploadUrl, key, publicUrl } = await presignUpload({
    kind,
    ext,
    contentType: file.type || "application/octet-stream",
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

export async function fetchAndUploadImageUrl(url: string) {
  const res = await fetch("/api/fetch-and-upload-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`Fetch and upload failed: ${res.statusText}`);
  return res.json() as Promise<{ key: string; publicUrl: string }>;
}

const IMAGE_MIME_RE = /^image\/(png|jpe?g|webp|avif|gif|bmp|svg\+xml|heic|heif)$/i;
const IMAGE_TYPE_PRIORITY = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/bmp",
  "image/svg+xml",
  "image/heic",
  "image/heif",
];

function getImageTypePriority(type: string) {
  const idx = IMAGE_TYPE_PRIORITY.indexOf(type.toLowerCase());
  return idx === -1 ? IMAGE_TYPE_PRIORITY.length : idx;
}

function pickPreferredImageItems(items: DataTransferItem[]) {
  if (items.length <= 1) return items;
  let best = IMAGE_TYPE_PRIORITY.length;
  for (const item of items) {
    best = Math.min(best, getImageTypePriority(item.type));
  }
  return items.filter((item) => getImageTypePriority(item.type) === best);
}
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

async function uploadClipboardBlob(
  blob: Blob,
  idx: number,
  opts?: {
    onProgress?: (index: number, pct: number) => void;
    onError?: (index: number, err: unknown) => void;
  },
): Promise<PastedImage> {
  const extFromType = blob.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
  const file = new File([blob], `clipboard-${Date.now()}-${idx}.${extFromType}`, {
    type: blob.type || "image/png",
  });
  const up = await withRetry(() =>
    uploadToR2(file, "image", (pct) => opts?.onProgress?.(idx, pct)),
  );
  return { key: up.key, url: up.url };
}

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
  const fileList = Array.from(cd.files || []);
  const imageFiles = fileList.filter((file) => IMAGE_MIME_RE.test(file.type));
  if (imageFiles.length > 0) {
    blobs.push(...imageFiles);
  } else {
    const imageItems = Array.from(cd.items).filter(
      (item) => item.kind === "file" && IMAGE_MIME_RE.test(item.type),
    );
    for (const item of pickPreferredImageItems(imageItems)) {
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
    const res = await withRetry(() => fetchAndUploadImageUrl(url));
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

// Fallback path for browsers where paste events occasionally lack clipboard
// items. This reads from the Async Clipboard API during a user gesture.
export async function extractAndUploadImagesFromClipboard(
  opts?: {
    onProgress?: (index: number, pct: number) => void;
    onError?: (index: number, err: unknown) => void;
  },
): Promise<PastedImage[] | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.read) return null;
    const items = await navigator.clipboard.read();
    const out: PastedImage[] = [];
    let idx = 0;
    for (const item of items) {
      const imageTypes = item.types.filter((t) => IMAGE_MIME_RE.test(t));
      if (imageTypes.length === 0) continue;
      const preferred = imageTypes.slice().sort((a, b) => getImageTypePriority(a) - getImageTypePriority(b))[0];
      try {
        const blob = await item.getType(preferred);
        out.push(await uploadClipboardBlob(blob, idx, opts));
        idx++;
      } catch (err) {
        opts?.onError?.(idx, err);
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

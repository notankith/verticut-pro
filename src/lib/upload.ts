// Frontend helper: presign + upload to R2
import { presignUpload } from "@/server/api.functions";

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

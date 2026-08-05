import { createFileRoute } from "@tanstack/react-router";
import { uploadBuffer } from "../../server/r2.server";
import { randomUUID } from "crypto";

export const Route = createFileRoute("/api/fetch-and-upload-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Partial<{ url: string }> = {};
        try {
          const text = await request.text();
          if (text) {
            body = JSON.parse(text);
          }
        } catch (err) {
          return new Response(JSON.stringify({ error: `Bad JSON Error: ${err}` }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const url = body?.url;
        if (!url || !/^https?:\/\//i.test(url)) {
          return new Response(JSON.stringify({ error: "Invalid URL" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const resp = await fetch(url);
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: `Fetch failed: ${resp.status}` }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const contentType = resp.headers.get("content-type") || "";
        const extFromUrl = url.split("?")[0].split(".").pop() || "";
        const inferredExt = extFromUrl.replace(/[^a-z0-9]/gi, "").toLowerCase();
        const isVideo = contentType.startsWith("video/") || /(mp4|webm|mov|mkv)$/i.test(extFromUrl);
        const isImage = contentType.startsWith("image/") || /(png|jpe?g|webp|avif|gif|bmp|svg|heic|heif)$/i.test(extFromUrl);
        const validatedContentType = contentType || (isVideo ? "video/mp4" : isImage ? "image/png" : "application/octet-stream");
        if (!isImage && !isVideo) {
          return new Response(JSON.stringify({ error: `Not an image or video: ${contentType || "unknown"}` }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const id = randomUUID();
        const ext = (contentType.split("/").pop() || inferredExt || "bin").replace(/[^a-z0-9]/gi, "") || "bin";
        const folder = isVideo ? "video" : "image";
        const key = `${folder}/${id}.${ext}`;
        const publicUrl = await uploadBuffer(key, buffer, validatedContentType);
        return Response.json({ key, publicUrl });
      },
    },
  },
});

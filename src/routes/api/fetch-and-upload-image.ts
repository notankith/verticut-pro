import { createFileRoute } from "@tanstack/react-router";
import { s3Client, uploadBuffer } from "../../server/r2.server";
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
          return new Response(`Bad JSON Error: ${err}`, { status: 400 });
        }
        if (!body?.url || !/^https?:\/\//i.test(body.url)) return new Response("Invalid URL", { status: 400 });
        const resp = await fetch(body.url);
        if (!resp.ok) return new Response(`Fetch failed: ${resp.status}`, { status: 400 });
        const contentType = resp.headers.get("content-type") || "application/octet-stream";
        if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) return new Response(`Not an image or video: ${contentType}`, { status: 400 });
        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const id = randomUUID();
        const ext = (contentType.split("/").pop() || "bin").replace(/[^a-z0-9]/gi, "");
        const folder = contentType.startsWith("video/") ? "video" : "image";
        const key = `${folder}/${id}.${ext}`;
        const publicUrl = await uploadBuffer(key, buffer, contentType);
        return Response.json({ key, publicUrl });
      },
    },
  },
});

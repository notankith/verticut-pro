import { createFileRoute } from "@tanstack/react-router";
import { presignPut, publicUrl } from "../../server/r2.server";
import { randomUUID } from "crypto";

export const Route = createFileRoute("/api/presign-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Partial<{ kind: string; ext: string; contentType: string }> = {};
        try {
          // In some serverless environments, if request.json() fails, we might want to know why.
          const text = await request.text();
          if (text) {
            body = JSON.parse(text);
          }
        } catch (err) {
          return new Response(`Bad JSON Error: ${err}`, { status: 400 });
        }

        let { kind, ext, contentType } = body as Partial<{ kind: string; ext: string; contentType: string }>;
        if (!kind) {
          return new Response(JSON.stringify({ error: `Missing field: kind` }), { status: 400, headers: { "content-type": "application/json" } });
        }

        // Provide sensible defaults if ext or contentType are omitted by some clients
        contentType = typeof contentType === "string" && contentType ? contentType : "application/octet-stream";
        ext = typeof ext === "string" && ext ? ext.replace(/[^a-z0-9]/gi, "").toLowerCase() : (contentType.split("/").pop() || "bin").replace(/[^a-z0-9]/gi, "");

        if (!['audio', 'image', 'music', 'video'].includes(kind)) {
          return new Response(JSON.stringify({ error: `Invalid upload kind: ${kind}` }), { status: 400, headers: { "content-type": "application/json" } });
        }

        const id = randomUUID();
        const key = `${kind}/${id}.${ext}`;

        try {
          const uploadUrl = await presignPut(key, contentType);
          const pub = publicUrl(key);

          return Response.json({ uploadUrl, key, publicUrl: pub });
        } catch (err) {
          console.error("Error generating presigned URL:", err);
          return new Response(
            JSON.stringify({ error: String(err) }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});

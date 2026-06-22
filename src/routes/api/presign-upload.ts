import { createFileRoute } from "@tanstack/react-router";
import { presignPut, publicUrl } from "../../server/r2.server";
import { randomUUID } from "crypto";

export const Route = createFileRoute("/api/presign-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { kind: string; ext: string; contentType: string };
        try {
          body = await request.json();
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const { kind, ext, contentType } = body;
        if (!kind || !ext || !contentType) {
          return new Response("Missing fields: kind, ext, contentType", { status: 400 });
        }

        const id = randomUUID();
        const key = `${kind}/${id}.${ext}`;

        try {
          const uploadUrl = await presignPut(key, contentType);
          const pub = publicUrl(key);

          return Response.json({ uploadUrl, key, publicUrl: pub });
        } catch (err) {
          console.error("Error generating presigned URL:", err);
          return new Response(`Presign error: ${err}`, { status: 500 });
        }
      },
    },
  },
});

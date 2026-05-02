import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "../../../server/mongo.server";

export const Route = createFileRoute("/api/public/render-complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RENDER_WORKER_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });
        if (request.headers.get("x-worker-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }
        let body: { jobId: string; status: "rendering" | "done" | "error"; progress?: number; url?: string; error?: string };
        try {
          body = await request.json();
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        if (!body?.jobId) return new Response("Missing jobId", { status: 400 });
        const db = await getDb();
        const update: Record<string, unknown> = { status: body.status };
        if (typeof body.progress === "number") update.progress = body.progress;
        if (body.url) update.url = body.url;
        if (body.error) update.error = body.error;
        await db.collection("renders").updateOne({ _id: body.jobId }, { $set: update });
        return Response.json({ ok: true });
      },
    },
  },
});

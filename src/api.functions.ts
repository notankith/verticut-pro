import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "crypto";
import { getDb, type ProjectDoc, type SettingsDoc, type ClipDoc, type RenderDoc } from "./server/mongo.server";
import { presignPut, publicUrl } from "./server/r2.server";
import { submitTranscript, getTranscript } from "./server/assemblyai.server";

// Untyped collection helper to avoid Mongo's ObjectId _id constraint (we use string ids)
async function C<T = unknown>(name: string) {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db.collection(name) as unknown as {
    insertOne: (doc: T) => Promise<unknown>;
    findOne: (filter: unknown, opts?: unknown) => Promise<T | null>;
    find: (filter?: unknown, opts?: unknown) => { sort: (s: unknown) => { limit?: (n: number) => { toArray: () => Promise<T[]> }; toArray: () => Promise<T[]> }; toArray: () => Promise<T[]> };
    updateOne: (filter: unknown, update: unknown, opts?: unknown) => Promise<unknown>;
  };
}

export const presignUpload = createServerFn({ method: "POST" })
  .inputValidator((d: { kind: "audio" | "image" | "music"; ext: string; contentType: string }) => d)
  .handler(async ({ data }) => {
    const id = randomUUID();
    const safeExt = data.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
    const key = `${data.kind}/${id}.${safeExt}`;
    const url = await presignPut(key, data.contentType);
    return { uploadUrl: url, key, publicUrl: publicUrl(key) };
  });

function defaultSettings(projectId: string): SettingsDoc {
  return {
    _id: projectId,
    defaultLabelText: "© WWE | © Getty Images",
    defaultFontSize: 18,
    animationIntensity: 1,
    musicUrl: "",
    musicVolume: 30,
    presets: [
      { id: "wwe", name: "WWE", text: "© WWE | © Getty Images", tint: "#ef4444" },
      { id: "aew", name: "AEW", text: "© AEW | © Getty Images", tint: "#eab308" },
      { id: "custom", name: "Custom", text: "© Source", tint: "#a855f7" },
    ],
  };
}

export const createProjectFromAudio = createServerFn({ method: "POST" })
  .inputValidator((d: { audioKey: string; audioUrl: string }) => d)
  .handler(async ({ data }) => {
    const projects = await C<ProjectDoc>("projects");
    const settings = await C<SettingsDoc>("settings");
    const id = randomUUID();
    const transcriptId = await submitTranscript(data.audioUrl);
    const now = Date.now();
    await projects.insertOne({
      _id: id,
      name: "Transcribing…",
      audioKey: data.audioKey,
      audioUrl: data.audioUrl,
      audioDuration: 0,
      transcript: [],
      transcriptStatus: "pending",
      transcriptJobId: transcriptId,
      clips: [],
      createdAt: now,
      updatedAt: now,
    });
    await settings.insertOne(defaultSettings(id));
    return { id };
  });

export type ProjectListItem = {
  id: string;
  name: string;
  duration: number;
  clipCount: number;
  createdAt: number;
  transcriptStatus: ProjectDoc["transcriptStatus"];
};

export const listProjects = createServerFn({ method: "GET" }).handler(async (): Promise<ProjectListItem[]> => {
  const projects = await C<ProjectDoc>("projects");
  const docs = await projects.find({}, { projection: { transcript: 0 } }).sort({ createdAt: -1 }).toArray();
  return docs.map((p) => ({
    id: p._id,
    name: p.name,
    duration: p.audioDuration ?? 0,
    clipCount: (p.clips ?? []).length,
    createdAt: p.createdAt,
    transcriptStatus: p.transcriptStatus,
  }));
});

export type ProjectFull = {
  id: string;
  name: string;
  audioUrl: string;
  audioDuration: number;
  transcript: ProjectDoc["transcript"];
  transcriptStatus: ProjectDoc["transcriptStatus"];
  clips: ClipDoc[];
  settings: SettingsDoc;
};

export const getProject = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<ProjectFull> => {
    const projects = await C<ProjectDoc>("projects");
    const settingsC = await C<SettingsDoc>("settings");
    const p = await projects.findOne({ _id: data.id });
    if (!p) throw new Error("Project not found");

    if (p.transcriptStatus === "pending" && p.transcriptJobId) {
      const r = await getTranscript(p.transcriptJobId);
      if (r.status === "completed") {
        const words = (r.words ?? []).map((w) => ({ text: w.text, start: w.start / 1000, end: w.end / 1000 }));
        const firstSeven = words.slice(0, 7).map((w) => w.text).join(" ").trim() || "Untitled Project";
        const duration = r.audio_duration ?? (words.at(-1)?.end ?? 0);
        await projects.updateOne(
          { _id: data.id },
          {
            $set: {
              name: firstSeven,
              transcript: words,
              audioDuration: duration,
              transcriptStatus: "ready",
              updatedAt: Date.now(),
            },
          },
        );
        p.name = firstSeven;
        p.transcript = words;
        p.audioDuration = duration;
        p.transcriptStatus = "ready";
      } else if (r.status === "error") {
        await projects.updateOne({ _id: data.id }, { $set: { transcriptStatus: "error" } });
        p.transcriptStatus = "error";
      }
    }

    const settings = await settingsC.findOne({ _id: data.id });
    return {
      id: p._id,
      name: p.name,
      audioUrl: p.audioUrl,
      audioDuration: p.audioDuration,
      transcript: p.transcript,
      transcriptStatus: p.transcriptStatus,
      clips: p.clips ?? [],
      settings: settings ?? defaultSettings(data.id),
    };
  });

export const saveProject = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; clips: ClipDoc[] }) => d)
  .handler(async ({ data }) => {
    const projects = await C<ProjectDoc>("projects");
    await projects.updateOne(
      { _id: data.id },
      { $set: { clips: data.clips, updatedAt: Date.now() } },
    );
    return { ok: true };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; settings: SettingsDoc }) => d)
  .handler(async ({ data }) => {
    const settingsC = await C<SettingsDoc>("settings");
    await settingsC.updateOne(
      { _id: data.id },
      { $set: { ...data.settings, _id: data.id } },
      { upsert: true },
    );
    return { ok: true };
  });

function slugFilename(name: string) {
  return (
    (name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || "verticut") + ".mp4"
  );
}

function getRenderServerConfig() {
  const url = process.env.RENDER_SERVER_URL || process.env.RENDER_WORKER_URL;
  const secret = process.env.RENDER_SERVER_SECRET || process.env.RENDER_WORKER_SECRET;
  return { url: url?.replace(/\/$/, ""), secret };
}

function publicAppOrigin() {
  // Best-effort: where R2/CDN-hosted overlay can be referenced. The overlay
  // ships with Verticut's static assets, so we prefer an explicit env var.
  return (process.env.APP_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
}

export const enqueueRender = createServerFn({ method: "POST" })
  .inputValidator((d: { projectId: string }) => d)
  .handler(async ({ data }) => {
    const projects = await C<ProjectDoc>("projects");
    const settingsC = await C<SettingsDoc>("settings");
    const renders = await C<RenderDoc>("renders");

    const project = await projects.findOne({ _id: data.projectId });
    if (!project) throw new Error("Project not found");
    const settings = await settingsC.findOne({ _id: data.projectId });
    const id = randomUUID();
    const filename = slugFilename(project.name);
    const render: RenderDoc = {
      _id: id,
      projectId: data.projectId,
      filename,
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
    };
    await renders.insertOne(render);

    const { url, secret } = getRenderServerConfig();
    if (url && secret) {
      try {
        const appOrigin = publicAppOrigin();
        const overlayUrl = appOrigin ? `${appOrigin}/GradientOverlay.png` : undefined;
        const r = await fetch(url + "/render/verticut", {
          method: "POST",
          headers: { "content-type": "application/json", "x-render-secret": secret },
          body: JSON.stringify({
            jobId: id,
            filename,
            overlayUrl,
            project: {
              id: project._id,
              name: project.name,
              audioUrl: project.audioUrl,
              audioDuration: project.audioDuration,
            },
            clips: project.clips ?? [],
            settings: settings ?? defaultSettings(data.projectId),
          }),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          await renders.updateOne(
            { _id: id },
            { $set: { status: "error", error: `Render server returned ${r.status}: ${text.slice(0, 200)}` } },
          );
        }
      } catch (e) {
        await renders.updateOne({ _id: id }, { $set: { status: "error", error: String(e) } });
      }
    } else {
      await renders.updateOne(
        { _id: id },
        { $set: { status: "error", error: "Render server not configured (set RENDER_SERVER_URL/RENDER_WORKER_URL & matching secret)" } },
      );
    }
    return { id, filename };
  });

// Polls the render-server for the latest status of a job and mirrors it into
// our `renders` collection. Returns the freshest snapshot to the client.
export const getRenderProgress = createServerFn({ method: "POST" })
  .inputValidator((d: { renderId: string }) => d)
  .handler(async ({ data }) => {
    const renders = await C<RenderDoc>("renders");
    const local = await renders.findOne({ _id: data.renderId });
    if (!local) throw new Error("Render not found");

    // Already terminal — no need to call out
    if (local.status === "done" || local.status === "error") {
      return {
        id: local._id,
        status: local.status,
        progress: local.progress ?? 0,
        url: local.url,
        error: local.error,
      };
    }

    const { url, secret } = getRenderServerConfig();
    if (!url || !secret) {
      return {
        id: local._id,
        status: local.status,
        progress: local.progress ?? 0,
        url: local.url,
        error: local.error,
      };
    }

    try {
      const r = await fetch(`${url}/render/status/${encodeURIComponent(local._id)}`, {
        headers: { "x-render-secret": secret },
      });
      if (!r.ok) {
        // 404 right after enqueue is normal — the job hasn't been registered yet.
        return {
          id: local._id,
          status: local.status,
          progress: local.progress ?? 0,
          url: local.url,
          error: local.error,
        };
      }
      const remote = (await r.json()) as {
        jobId: string;
        status: "queued" | "rendering" | "completed" | "failed";
        progress: number;
        finalUrl: string | null;
        error: string | null;
      };

      // Map remote status → local schema
      const statusMap: Record<typeof remote.status, RenderDoc["status"]> = {
        queued: "queued",
        rendering: "rendering",
        completed: "done",
        failed: "error",
      };
      const mappedStatus = statusMap[remote.status] ?? local.status;
      const progress = Math.max(0, Math.min(100, Math.round(remote.progress ?? 0)));

      const update: Partial<RenderDoc> = {
        status: mappedStatus,
        progress,
      };
      if (remote.finalUrl) update.url = remote.finalUrl;
      if (remote.error) update.error = remote.error;

      await renders.updateOne({ _id: local._id }, { $set: update });

      return {
        id: local._id,
        status: mappedStatus,
        progress,
        url: remote.finalUrl ?? local.url,
        error: remote.error ?? local.error,
      };
    } catch (e) {
      return {
        id: local._id,
        status: local.status,
        progress: local.progress ?? 0,
        url: local.url,
        error: String(e),
      };
    }
  });

export type RenderItem = {
  id: string;
  projectId: string;
  filename: string;
  status: RenderDoc["status"];
  progress: number;
  url?: string;
  error?: string;
  createdAt: number;
};

export const listRenders = createServerFn({ method: "GET" }).handler(async (): Promise<RenderItem[]> => {
  const renders = await C<RenderDoc>("renders");
  const items = (await renders.find({}).sort({ createdAt: -1 }).toArray()).slice(0, 50);
  return items.map((r) => ({
    id: r._id,
    projectId: r.projectId,
    filename: r.filename,
    status: r.status,
    progress: r.progress ?? 0,
    url: r.url,
    error: r.error,
    createdAt: r.createdAt,
  }));
});

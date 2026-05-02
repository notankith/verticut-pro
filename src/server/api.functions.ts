import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getDb, type ProjectDoc, type SettingsDoc, type ClipDoc, type RenderDoc } from "./mongo.server";
import { presignPut, publicUrl } from "./r2.server";
import { submitTranscript, getTranscript } from "./assemblyai.server";

// ---------------- R2 presign ----------------
export const presignUpload = createServerFn({ method: "POST" })
  .inputValidator((d: { kind: "audio" | "image" | "music"; ext: string; contentType: string }) => d)
  .handler(async ({ data }) => {
    const id = randomUUID();
    const safeExt = data.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
    const key = `${data.kind}/${id}.${safeExt}`;
    const url = await presignPut(key, data.contentType);
    return { uploadUrl: url, key, publicUrl: publicUrl(key) };
  });

// ---------------- Projects ----------------
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
    const db = await getDb();
    const id = randomUUID();
    const transcriptId = await submitTranscript(data.audioUrl);
    const now = Date.now();
    const doc: ProjectDoc & { transcriptJobId: string; clips: ClipDoc[] } = {
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
    };
    await db.collection("projects").insertOne(doc as never);
    await db.collection("settings").insertOne(defaultSettings(id) as never);
    return { id };
  });

export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  const db = await getDb();
  const projects = await db.collection("projects").find({}, { projection: { transcript: 0 } }).sort({ createdAt: -1 }).toArray();
  return projects.map((p) => ({
    id: p._id,
    name: p.name,
    duration: p.audioDuration ?? 0,
    clipCount: (p.clips ?? []).length,
    createdAt: p.createdAt,
    transcriptStatus: p.transcriptStatus,
  }));
});

export const getProject = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const db = await getDb();
    const p = (await db.collection("projects").findOne({ _id: data.id })) as (ProjectDoc & { transcriptJobId?: string; clips: ClipDoc[] }) | null;
    if (!p) throw new Error("Project not found");

    // If pending, poll AssemblyAI
    if (p.transcriptStatus === "pending" && p.transcriptJobId) {
      const r = await getTranscript(p.transcriptJobId);
      if (r.status === "completed") {
        const words = (r.words ?? []).map((w) => ({ text: w.text, start: w.start / 1000, end: w.end / 1000 }));
        const firstSeven = words.slice(0, 7).map((w) => w.text).join(" ").trim() || "Untitled Project";
        const duration = r.audio_duration ?? (words.at(-1)?.end ?? 0);
        await db.collection("projects").updateOne(
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
        await db.collection("projects").updateOne({ _id: data.id }, { $set: { transcriptStatus: "error" } });
        p.transcriptStatus = "error";
      }
    }

    const settings = (await db.collection("settings").findOne({ _id: data.id })) as SettingsDoc | null;
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
    const db = await getDb();
    await db.collection("projects").updateOne(
      { _id: data.id },
      { $set: { clips: data.clips, updatedAt: Date.now() } },
    );
    return { ok: true };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; settings: SettingsDoc }) => d)
  .handler(async ({ data }) => {
    const db = await getDb();
    await db.collection("settings").updateOne(
      { _id: data.id },
      { $set: { ...data.settings, _id: data.id } },
      { upsert: true },
    );
    return { ok: true };
  });

// ---------------- Render queue ----------------
function slugFilename(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || "verticut"
  ) + ".mp4";
}

export const enqueueRender = createServerFn({ method: "POST" })
  .inputValidator((d: { projectId: string }) => d)
  .handler(async ({ data }) => {
    const db = await getDb();
    const project = (await db.collection("projects").findOne({ _id: data.projectId })) as (ProjectDoc & { clips: ClipDoc[] }) | null;
    if (!project) throw new Error("Project not found");
    const settings = (await db.collection("settings").findOne({ _id: data.projectId })) as SettingsDoc | null;
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
    await db.collection("renders").insertOne(render as never);

    const workerUrl = process.env.RENDER_WORKER_URL;
    const secret = process.env.RENDER_WORKER_SECRET;
    if (workerUrl && secret) {
      try {
        await fetch(workerUrl.replace(/\/$/, "") + "/render", {
          method: "POST",
          headers: { "content-type": "application/json", "x-worker-secret": secret },
          body: JSON.stringify({
            jobId: id,
            filename,
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
      } catch (e) {
        await db.collection("renders").updateOne({ _id: id }, { $set: { status: "error", error: String(e) } });
      }
    } else {
      await db.collection("renders").updateOne(
        { _id: id },
        { $set: { status: "error", error: "Render worker not configured (set RENDER_WORKER_URL & RENDER_WORKER_SECRET)" } },
      );
    }
    return { id, filename };
  });

export const listRenders = createServerFn({ method: "GET" }).handler(async () => {
  const db = await getDb();
  const items = await db.collection("renders").find({}).sort({ createdAt: -1 }).limit(50).toArray();
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

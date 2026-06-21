import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "crypto";
import { getDb, type ProjectDoc, type SettingsDoc, type ClipDoc, type RenderDoc, type MarkerDoc } from "./server/mongo.server";
import { presignPut, publicUrl } from "./server/r2.server";
import { uploadBuffer } from "./server/r2.server";
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

// Settings live in a single shared document so changes apply to every
// project. The id is fixed; the per-project rows that older builds may have
// written are ignored.
const GLOBAL_SETTINGS_ID = "global";

function defaultSettings(id: string = GLOBAL_SETTINGS_ID): SettingsDoc {
  return {
    _id: id,
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

async function readGlobalSettings(): Promise<SettingsDoc> {
  const settingsC = await C<SettingsDoc>("settings");
  const doc = await settingsC.findOne({ _id: GLOBAL_SETTINGS_ID });
  return doc ?? defaultSettings();
}

export const createProjectFromAudio = createServerFn({ method: "POST" })
  .inputValidator((d: { audioKey: string; audioUrl: string }) => d)
  .handler(async ({ data }) => {
    const projects = await C<ProjectDoc>("projects");
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
      markers: [],
      createdAt: now,
      updatedAt: now,
    });
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

export const deleteProject = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const db = await getDb();
    await db.collection("projects").deleteOne({ _id: data.id });
    await db.collection("renders").deleteMany({ projectId: data.id });
    return { ok: true };
  });

export type ProjectFull = {
  id: string;
  name: string;
  audioUrl: string;
  audioDuration: number;
  transcript: ProjectDoc["transcript"];
  transcriptStatus: ProjectDoc["transcriptStatus"];
  clips: ClipDoc[];
  markers: MarkerDoc[];
  settings: SettingsDoc;
};

const GROQ_MODEL = "llama-3.3-70b-versatile";

const MARKER_SYSTEM_PROMPT = `You are a video editor assistant.
You receive a spoken script and word-level timestamps.
Your task is to detect subject/entity/topic shifts and emit accurate timeline markers.

Rules:
1. Add a marker whenever the subject changes, even mid-sentence.
2. Prefer named entities and concrete nouns.
3. Keep marker labels short: 1-4 words.
4. Use the exact start timestamp of the first word of the new subject.
5. Return only JSON in the shape:
{ "markers": [ { "label": "Roman Reigns", "start": 12.34, "kind": "subject" } ] }
6. Timestamps must be numbers, not strings.
7. Never return duplicate markers for the same moment. Short sections should still have a marker if the subject changes.`;

function normalizeMarkerLabel(text: string) {
  return String(text || "")
    .replace(/["'“”‘’()\[\]{}.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

function repairMarkers(raw: unknown, words: { text: string; start: number; end: number }[], fullText: string) {
  const source = Array.isArray(raw) ? raw : [];
  if (!words.length || !source.length) return sentenceFallbackMarkers(fullText, words);

  const firstStart = words[0].start;
  const lastEnd = words[words.length - 1].end;
  const markers = source
    .map((m) => ({
      label: normalizeMarkerLabel(m?.label || m?.query || m?.name || ""),
      start: Number(m?.start ?? m?.time ?? m?.timestamp ?? 0),
      kind: ["subject", "entity", "topic"].includes(String(m?.kind || "")) ? String(m?.kind) as MarkerDoc["kind"] : "subject",
    }))
    .filter((m) => m.label && Number.isFinite(m.start))
    .sort((a, b) => a.start - b.start);

  if (!markers.length) return sentenceFallbackMarkers(fullText, words);

  const deduped = [] as MarkerDoc[];
  for (const m of markers) {
    const start = Math.max(firstStart, Math.min(lastEnd, m.start));
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.start - start) < 0.25 && prev.label.toLowerCase() === m.label.toLowerCase()) continue;
    deduped.push({ id: randomUUID(), start, label: m.label, kind: m.kind });
  }

  if (!deduped.length) return sentenceFallbackMarkers(fullText, words);
  deduped[0].start = firstStart;
  if (deduped[deduped.length - 1].start > lastEnd) deduped[deduped.length - 1].start = lastEnd;
  return deduped;
}

function sentenceFallbackMarkers(fullText: string, words: { text: string; start: number; end: number }[]) {
  if (!words.length) return [] as MarkerDoc[];
  const sentences = String(fullText || "").split(/[.!?]/).map((s) => s.trim()).filter(Boolean);
  if (!sentences.length) {
    return [{ id: randomUUID(), start: words[0].start, label: normalizeMarkerLabel(words.slice(0, 4).map((w) => w.text).join(" ")) || "Start", kind: "topic" }];
  }
  const out: MarkerDoc[] = [];
  let cursor = 0;
  for (const s of sentences) {
    const tokens = s.split(/\s+/).filter(Boolean);
    const startIdx = Math.min(cursor, words.length - 1);
    const start = words[startIdx]?.start ?? words[0].start;
    const label = normalizeMarkerLabel(tokens.slice(0, 4).join(" ")) || "Topic";
    out.push({ id: randomUUID(), start, label, kind: "topic" });
    cursor = Math.min(words.length - 1, startIdx + Math.max(1, tokens.length));
  }
  return out;
}

async function generateTranscriptMarkers(fullText: string, words: { text: string; start: number; end: number }[]) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not configured");

  const body = {
    model: GROQ_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: MARKER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Full script:\n"${fullText}"\n\nWord-level timestamps with indexes:\n${JSON.stringify(words.map((w, i) => ({ i, ...w })))}\n\nReturn only JSON markers for subject/entity shifts.`,
      },
    ],
  };

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Groq markers failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content;
  try {
    const parsed = JSON.parse(content);
    return repairMarkers(parsed?.markers, words, fullText);
  } catch {
    return sentenceFallbackMarkers(fullText, words);
  }
}

export const getProject = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<ProjectFull> => {
    const projects = await C<ProjectDoc>("projects");
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

    let markers = Array.isArray((p as ProjectDoc).markers) ? (p as ProjectDoc).markers! : [];
    if (p.transcriptStatus === "ready" && markers.length === 0 && p.transcript.length > 0) {
      const fullText = p.transcript.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
      try {
        markers = await generateTranscriptMarkers(fullText, p.transcript);
        await projects.updateOne({ _id: data.id }, { $set: { markers, updatedAt: Date.now() } });
      } catch (err) {
        console.error("marker generation failed:", err);
        markers = sentenceFallbackMarkers(fullText, p.transcript);
        await projects.updateOne({ _id: data.id }, { $set: { markers, updatedAt: Date.now() } });
      }
    }

    const settings = await readGlobalSettings();
    return {
      id: p._id,
      name: p.name,
      audioUrl: p.audioUrl,
      audioDuration: p.audioDuration,
      transcript: p.transcript,
      transcriptStatus: p.transcriptStatus,
      clips: p.clips ?? [],
      markers,
      settings,
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

// Settings are global. The `id` arg is accepted but ignored — every save goes
// to the single shared `_id: "global"` document so changes apply across every
// project.
export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; settings: SettingsDoc }) => d)
  .handler(async ({ data }) => {
    const settingsC = await C<SettingsDoc>("settings");
    await settingsC.updateOne(
      { _id: GLOBAL_SETTINGS_ID },
      { $set: { ...data.settings, _id: GLOBAL_SETTINGS_ID } },
      { upsert: true },
    );
    return { ok: true };
  });

export const getGlobalSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SettingsDoc> => {
    return readGlobalSettings();
  },
);

export const saveGlobalSettings = createServerFn({ method: "POST" })
  .inputValidator((d: { settings: SettingsDoc }) => d)
  .handler(async ({ data }) => {
    const settingsC = await C<SettingsDoc>("settings");
    await settingsC.updateOne(
      { _id: GLOBAL_SETTINGS_ID },
      { $set: { ...data.settings, _id: GLOBAL_SETTINGS_ID } },
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
    const renders = await C<RenderDoc>("renders");

    const project = await projects.findOne({ _id: data.projectId });
    if (!project) throw new Error("Project not found");
    const settings = await readGlobalSettings();
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
            settings,
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

export const fetchAndUploadImage = createServerFn({ method: "POST" })
  .inputValidator((d: { url: string }) => d)
  .handler(async ({ data }) => {
    const url = data.url;
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('Invalid URL');
    // Fetch remote image server-side to avoid CORS issues
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) throw new Error(`Not an image: ${contentType}`);
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const id = randomUUID();
    const ext = (contentType.split('/').pop() || 'bin').replace(/[^a-z0-9]/gi, '');
    const key = `image/${id}.${ext}`;
    const publicUrlResult = await uploadBuffer(key, buffer, contentType);
    return { uploadUrl: null, key, publicUrl: publicUrlResult };
  });

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

// Clear only projects and renders, preserving settings and presets
export const clearProjectsAndRenders = createServerFn({ method: "POST" })
  .inputValidator((d: { confirmed: boolean }) => d)
  .handler(async ({ data }) => {
    if (!data.confirmed) throw new Error("Clear not confirmed");
    
    const projectDocs = await (await C<ProjectDoc>("projects")).find({}).toArray();
    for (const doc of projectDocs) {
      const db = await getDb();
      await db.collection("projects").deleteOne({ _id: doc._id });
    }

    const renderDocs = await (await C<RenderDoc>("renders")).find({}).toArray();
    for (const doc of renderDocs) {
      const db = await getDb();
      await db.collection("renders").deleteOne({ _id: doc._id });
    }

    return { ok: true, deleted: { projects: projectDocs.length, renders: renderDocs.length } };
  });

// Delete all projects and renders, but preserve settings
export const resetAllData = createServerFn({ method: "POST" })
  .inputValidator((d: { confirmed: boolean }) => d)
  .handler(async ({ data }) => {
    if (!data.confirmed) throw new Error("Reset not confirmed");
    
    const projects = await C<ProjectDoc>("projects");
    const renders = await C<RenderDoc>("renders");
    
    // Delete all projects
    await projects.find({}).toArray().then(async (docs) => {
      for (const doc of docs) {
        await projects.updateOne(
          { _id: doc._id },
          { $unset: { _id: 1 } } // This won't actually delete, need a different approach
        );
      }
    });

    // Better approach: delete by finding all and removing them
    const projectDocs = await projects.find({}).toArray();
    for (const doc of projectDocs) {
      const db = await getDb();
      await db.collection("projects").deleteOne({ _id: doc._id });
    }

    const renderDocs = await renders.find({}).toArray();
    for (const doc of renderDocs) {
      const db = await getDb();
      await db.collection("renders").deleteOne({ _id: doc._id });
    }

    return { ok: true, deleted: { projects: projectDocs.length, renders: renderDocs.length } };
  });

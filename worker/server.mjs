// VertiCut render worker — standalone Node service
// Receives signed POST /render jobs, renders MP4 with Remotion, uploads to R2,
// and posts completion back to the app's /api/public/render-complete webhook.
import express from "express";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 4000;
const SECRET = process.env.RENDER_WORKER_SECRET;
const APP_URL = process.env.APP_URL; // https://your-app.lovable.app
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

let bundlePromise = null;
async function getBundle() {
  if (!bundlePromise) {
    const publicDir = path.resolve(__dirname, "public");
    bundlePromise = bundle({
      entryPoint: path.resolve(__dirname, "remotion-entry.jsx"),
      publicDir: fs.existsSync(publicDir) ? publicDir : undefined,
    });
  }
  return bundlePromise;
}

async function postBack(jobId, payload) {
  if (!APP_URL) return;
  try {
    await fetch(APP_URL.replace(/\/$/, "") + "/api/public/render-complete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-secret": SECRET },
      body: JSON.stringify({ jobId, ...payload }),
    });
  } catch (e) {
    console.error("postBack failed:", e);
  }
}

const app = express();
app.use(express.json({ limit: "20mb" }));

app.post("/render", async (req, res) => {
  if (req.headers["x-worker-secret"] !== SECRET) {
    return res.status(401).send("Unauthorized");
  }
  const { jobId, filename, project, clips, settings } = req.body;
  if (!jobId) return res.status(400).send("Missing jobId");
  res.json({ ok: true });

  const fps = 30;
  const durationInFrames = Math.max(1, Math.round((project.audioDuration || 1) * fps));
  const tmp = path.join(os.tmpdir(), `${jobId}.mp4`);
  await postBack(jobId, { status: "rendering", progress: 0 });

  try {
    const serveUrl = await getBundle();
    const composition = await selectComposition({
      serveUrl,
      id: "VertiCut",
      inputProps: { audioUrl: project.audioUrl },
    });
    await renderMedia({
      composition: { ...composition, durationInFrames, fps, width: 1080, height: 1920 },
      serveUrl,
      codec: "h264",
      outputLocation: tmp,
      inputProps: {
        audioUrl: project.audioUrl,
        musicUrl: settings.musicUrl || undefined,
        musicVolume: (settings.musicVolume ?? 30) / 100,
        clips,
        defaultLabelText: settings.defaultLabelText,
        defaultFontSize: settings.defaultFontSize,
        intensity: settings.animationIntensity,
        durationInFrames,
        fps,
        overlayUrl: APP_URL ? `${APP_URL.replace(/\/$/, "")}/GradientOverlay.png` : undefined,
      },
      onProgress: ({ progress }) => {
        postBack(jobId, { status: "rendering", progress });
      },
    });

    const key = `renders/${jobId}.mp4`;
    const body = fs.readFileSync(tmp);
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
      ContentDisposition: `attachment; filename="${filename}"`,
    }));
    fs.unlinkSync(tmp);
    const url = `${R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
    await postBack(jobId, { status: "done", progress: 1, url });
  } catch (e) {
    console.error(e);
    await postBack(jobId, { status: "error", error: String(e?.message || e) });
  }
});

app.get("/", (_, res) => res.send("VertiCut render worker"));
app.listen(PORT, () => console.log(`Render worker listening on :${PORT}`));

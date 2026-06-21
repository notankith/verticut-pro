#!/usr/bin/env node

/**
 * VPS Render Server
 *
 * Persistent Express backend that runs on a VPS.
 * Owns: Remotion rendering, Chromium lifecycle, R2 uploads.
 *
 * Endpoints:
 *   POST /render          — Submit a render job
 *   GET  /render/status/:jobId — Check job status
 *   GET  /health          — Health check
 *
 * Env vars (required):
 *   MONGODB_URI, MONGODB_DB
 *   R2_BUCKET, R2_ACCESS_KEY, R2_SECRET_KEY, R2_ENDPOINT, R2_ACCOUNT_ID
 *   RENDER_SERVER_PORT (optional, default 5050)
 *   RENDER_SERVER_SECRET (shared secret for auth)
 *   CDN_BASE_URL (public CDN url prefix, e.g. https://cdn.ankith.studio/)
 *   REMOTION_ENTRY (path to remotion entry relative to project root)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, getCompositions } from '@remotion/renderer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// ─── Config ───
const PORT = parseInt(process.env.RENDER_SERVER_PORT || '5050', 10);
const SHARED_SECRET = process.env.RENDER_SERVER_SECRET || '';
const CDN_BASE = (process.env.CDN_BASE_URL || 'https://cdn.ankith.studio/').replace(/\/$/, '');

// ─── Template → Composition ID mapping ───
const TEMPLATE_TO_COMPOSITION = {
  velar: 'CaptionedVideo',
  kinetic_highlights: 'CaptionedVideo',
};

// ─── Logging ───
function log(label, ...args) {
  console.log(`[RenderServer] ${label}:`, ...args);
}

// ─── URL utilities ───
function joinCdnUrl(path) {
  const base = CDN_BASE.replace(/\/$/, ''); // remove trailing slash
  const cleanPath = path.replace(/^\//, ''); // remove leading slash
  return `${base}/${cleanPath}`;
}

// ─── MongoDB ───
let _client = null;
let _db = null;

async function getDb() {
  if (_db) return _db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  _client = new MongoClient(uri);
  await _client.connect();
  _db = _client.db(process.env.MONGODB_DB || 'Cluster0');
  log('DB', 'Connected');
  return _db;
}

// ─── R2 / S3 client ───
function getS3() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY,
      secretAccessKey: process.env.R2_SECRET_KEY,
    },
  });
}

async function uploadToR2(key, buffer, contentType = 'video/mp4') {
  const s3 = getS3();
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return joinCdnUrl(key);
}

// ─── In-memory job state ───
const jobQueue = new Map();   // jobId → { status, progress, outputUrl, error, uploadId }

// ─── Sequential job processing with stall protection ───
const renderQueue = [];       // Array of job params waiting to be processed
let isProcessing = false;     // Flag to prevent concurrent processing
let currentJobId = null;      // Track which job is actively processing
let currentJobStart = null;   // Timestamp when current job started

// Maximum render time: 15 minutes — if exceeded the job is considered stalled
const MAX_RENDER_MS = 15 * 60 * 1000;

// ─── Cached Remotion bundles (keyed by entry path) ───
const bundleCache = new Map(); // entryPath → bundleUrl

async function getOrCreateBundle(entryPathOverride) {
  const entryPoint = path.resolve(
    entryPathOverride
      || process.env.REMOTION_ENTRY
      || path.join(process.cwd(), 'src', 'remotion-entry.jsx')
  );

  const cached = bundleCache.get(entryPoint);
  if (cached) {
    try {
      if (fs.existsSync(cached)) {
        log('BUNDLE', `Reusing cached bundle for ${entryPoint}`);
        return cached;
      }
    } catch {}
    bundleCache.delete(entryPoint);
  }

  log('BUNDLE', `Creating new Remotion bundle for ${entryPoint}`);
  const safeKey = entryPoint.replace(/[^a-z0-9]/gi, '_').slice(-80);
  // Resolve publicDir as <render-server>/public, where GradientOverlay.png lives
  const publicDir = path.resolve(path.dirname(entryPoint), '..', 'public');
  const bundleUrl = await bundle({
    entryPoint,
    outDir: path.join(os.tmpdir(), `remotion-bundle-${safeKey}`),
    publicDir: fs.existsSync(publicDir) ? publicDir : undefined,
  });
  bundleCache.set(entryPoint, bundleUrl);
  log('BUNDLE', `Bundle ready: ${bundleUrl}`);
  return bundleUrl;
}

async function processNextJob() {
  // Stall detection: if a job has been running longer than MAX_RENDER_MS, force-release the lock
  if (isProcessing && currentJobStart && (Date.now() - currentJobStart > MAX_RENDER_MS)) {
    log('STALL_DETECTED', `Job ${currentJobId} exceeded ${MAX_RENDER_MS / 60000}min — releasing lock`);
    const stalledJob = jobQueue.get(currentJobId);
    if (stalledJob && stalledJob.status !== 'completed' && stalledJob.status !== 'failed') {
      stalledJob.status = 'failed';
      stalledJob.error = 'Render timed out (stall detected)';
      // Update DB
      try {
        const db = await getDb();
        await db.collection('render_jobs').updateOne(
          { _id: currentJobId },
          { $set: { status: 'failed', error: stalledJob.error, failed_at: new Date() } }
        );
        await db.collection('uploads').updateOne(
          { _id: new ObjectId(stalledJob.uploadId) },
          { $set: { caption_status: 'render_failed', render_error: stalledJob.error } }
        );
      } catch {}
    }
    isProcessing = false;
    currentJobId = null;
    currentJobStart = null;
  }
  
  if (isProcessing || renderQueue.length === 0) return;
  
  isProcessing = true;
  const { jobId, params } = renderQueue.shift();
  currentJobId = jobId;
  currentJobStart = Date.now();
  
  log('JOB_DEQUEUED', `Starting job ${jobId}, ${renderQueue.length} remaining in queue`);
  
  try {
    if (params.kind === 'verticut') {
      await processVerticutRender(jobId, params);
    } else {
      await processRender(jobId, params);
    }
  } catch (err) {
    log('QUEUE_PROCESS_ERROR', `${jobId}: ${err.message}`);
  } finally {
    isProcessing = false;
    currentJobId = null;
    currentJobStart = null;
    // Process next job
    setImmediate(processNextJob);
  }
}

// ─── Auth middleware ───
function authMiddleware(req, res, next) {
  if (!SHARED_SECRET) return next();        // no secret = open (dev mode)
  const token = req.headers['x-render-secret'] || req.query.secret;
  if (token !== SHARED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Express app ───
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health
app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(), 
    jobs: jobQueue.size,
    queueLength: renderQueue.length,
    isProcessing,
    currentJobId,
    currentJobElapsed: currentJobStart ? Math.round((Date.now() - currentJobStart) / 1000) : null,
    hasCachedBundle: bundleCache.size > 0,
  });
});

// ────────────────────────────────────────────────────────────────
// POST /render — Submit a render job
// ────────────────────────────────────────────────────────────────
app.post('/render', authMiddleware, async (req, res) => {
  try {
    const {
      uploadId,
      videoUrl,
      words,
      template,
      templateStyle,
      sourceMediaUrl,
    } = req.body;

    // Validate
    if (!uploadId) return res.status(400).json({ error: 'uploadId required' });
    if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'words array required' });
    }

    const templateName = template || 'velar';
    const compositionId = TEMPLATE_TO_COMPOSITION[templateName];
    if (!compositionId) {
      return res.status(400).json({
        error: `INVALID_COMPOSITION_ID: Template "${templateName}" not mapped. Available: ${Object.keys(TEMPLATE_TO_COMPOSITION).join(', ')}`,
      });
    }

    // Check queue length to prevent overload
    if (renderQueue.length >= 20) {
      return res.status(429).json({ error: 'Queue full (20 jobs). Please try again later.' });
    }
    
    // Prevent duplicate renders for the same upload
    const existingQueuedJob = renderQueue.find(q => q.params.uploadId === uploadId);
    const existingActiveJob = currentJobId && jobQueue.get(currentJobId)?.uploadId === uploadId;
    if (existingQueuedJob || existingActiveJob) {
      const dupeJobId = existingQueuedJob ? existingQueuedJob.jobId : currentJobId;
      log('DUPLICATE', `upload=${uploadId} already queued/rendering as job=${dupeJobId}`);
      return res.json({ success: true, jobId: dupeJobId, status: 'queued', duplicate: true });
    }

    // Create job
    const jobId = randomUUID();
    const job = {
      jobId,
      uploadId,
      status: 'queued',
      progress: 0,
      outputUrl: null,
      error: null,
      createdAt: new Date(),
    };
    jobQueue.set(jobId, job);

    log('JOB_QUEUED', `job=${jobId} upload=${uploadId} template=${templateName}`);

    // Persist to DB
    const db = await getDb();
    await db.collection('render_jobs').insertOne({
      _id: jobId,
      upload_id: uploadId,
      source_media_url: sourceMediaUrl || videoUrl,
      status: 'queued',
      input: { videoUrl, words, template: templateName, templateStyle },
      created_at: new Date(),
    });

    // Add to sequential queue instead of starting immediately
    renderQueue.push({
      jobId,
      params: {
        uploadId,
        videoUrl,
        words,
        template: templateName,
        compositionId,
        templateStyle: templateStyle || getDefaultStyleForTemplate(templateName),
        sourceMediaUrl: sourceMediaUrl || videoUrl,
      }
    });

    // Return immediately — render is queued
    res.json({ success: true, jobId, status: 'queued' });

    // Start processing if not already running
    setImmediate(processNextJob);

  } catch (err) {
    log('POST_ERROR', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────
// GET /render/status/:jobId — Poll job status
// ────────────────────────────────────────────────────────────────
app.get('/render/status/:jobId', authMiddleware, async (req, res) => {
  const { jobId } = req.params;
  const job = jobQueue.get(jobId);
  if (job) {
    return res.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      finalUrl: job.outputUrl,
      error: job.error,
    });
  }
  // Fall back to DB so callers can still resolve jobs after a server restart
  try {
    const db = await getDb();
    const doc = await db.collection('render_jobs').findOne({ _id: jobId });
    if (!doc) return res.status(404).json({ error: 'Job not found' });
    return res.json({
      jobId,
      status: doc.status,
      progress: doc.progress ?? (doc.status === 'completed' ? 100 : 0),
      finalUrl: doc.output_url || doc.outputUrl || null,
      error: doc.error || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────
// POST /render/verticut — Submit a VertiCut render job
// Accepts the editor's payload: { jobId, filename, project, clips,
// settings, overlayUrl }. Reuses the same in-memory queue + status
// endpoint as the captioned-video flow.
// ────────────────────────────────────────────────────────────────
app.post('/render/verticut', authMiddleware, async (req, res) => {
  try {
    const { jobId: providedJobId, filename, project, clips, settings, overlayUrl, audioSegments } = req.body || {};

    if (!project || !project.audioUrl) return res.status(400).json({ error: 'project.audioUrl required' });
    if (!Array.isArray(clips)) return res.status(400).json({ error: 'clips array required' });
    if (!settings) return res.status(400).json({ error: 'settings required' });

    if (renderQueue.length >= 20) {
      return res.status(429).json({ error: 'Queue full (20 jobs). Please try again later.' });
    }

    const jobId = providedJobId || randomUUID();

    // Dedup: if this jobId is already queued or active, return it as-is.
    const existing = jobQueue.get(jobId);
    if (existing && existing.status !== 'failed') {
      return res.json({ success: true, jobId, status: existing.status, duplicate: true });
    }

    const job = {
      jobId,
      uploadId: project.id || jobId,
      status: 'queued',
      progress: 0,
      outputUrl: null,
      error: null,
      createdAt: new Date(),
    };
    jobQueue.set(jobId, job);

    log('VERTICUT_JOB_QUEUED', `job=${jobId} project=${project.id} clips=${clips.length}`);

    const db = await getDb();
    await db.collection('render_jobs').insertOne({
      _id: jobId,
      kind: 'verticut',
      project_id: project.id,
      filename: filename || `${project.id || jobId}.mp4`,
      status: 'queued',
      input: { project, clips, settings, overlayUrl },
      created_at: new Date(),
    });

    renderQueue.push({
      jobId,
      params: {
        kind: 'verticut',
        filename: filename || `${project.id || jobId}.mp4`,
        project,
        clips,
        settings,
        overlayUrl: overlayUrl || null,
        audioSegments: audioSegments || project.audioSegments || null,
      },
    });

    res.json({ success: true, jobId, status: 'queued' });
    setImmediate(processNextJob);
  } catch (err) {
    log('VERTICUT_POST_ERROR', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────
// GET /queue — View full queue state
// ────────────────────────────────────────────────────────────────
app.get('/queue', authMiddleware, (_req, res) => {
  const queued = renderQueue.map(q => ({
    jobId: q.jobId,
    uploadId: q.params.uploadId,
    template: q.params.template,
  }));
  
  const active = currentJobId ? {
    jobId: currentJobId,
    uploadId: jobQueue.get(currentJobId)?.uploadId,
    elapsed: currentJobStart ? Math.round((Date.now() - currentJobStart) / 1000) : 0,
    progress: jobQueue.get(currentJobId)?.progress || 0,
  } : null;
  
  res.json({
    active,
    queued,
    totalInMemory: jobQueue.size,
  });
});

// ────────────────────────────────────────────────────────────────
// Background render processor
// ────────────────────────────────────────────────────────────────
async function processRender(jobId, params) {
  const {
    uploadId,
    videoUrl,
    words,
    template,
    compositionId,
    templateStyle,
    sourceMediaUrl,
  } = params;

  const job = jobQueue.get(jobId);
  const db = await getDb();

  const updateJob = async (fields) => {
    Object.assign(job, fields);
    await db.collection('render_jobs').updateOne(
      { _id: jobId },
      { $set: fields },
    );
  };

  try {
    await updateJob({ status: 'rendering', started_at: new Date() });

    // ── 0. Check source video accessibility ──
    log('SOURCE_CHECK', `${jobId} checking ${sourceMediaUrl}`);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const sourceResponse = await fetch(sourceMediaUrl, {
        method: 'HEAD', // HEAD request is sufficient to check status
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!sourceResponse.ok) {
        throw new Error(`HTTP ${sourceResponse.status}: ${sourceResponse.statusText}`);
      }
      
      log('SOURCE_OK', `${jobId} source accessible (${sourceResponse.status})`);
    } catch (sourceErr) {
      const errorMsg = `FAILED_SOURCE_MISSING: ${sourceErr.message}`;
      log('SOURCE_FAILED', `${jobId}: ${errorMsg}`);
      
      // Mark job as failed and update DB
      await updateJob({
        status: 'failed',
        error: errorMsg,
        failed_at: new Date(),
      });
      
      await db.collection('uploads').updateOne(
        { _id: new ObjectId(uploadId) },
        {
          $set: {
            caption_status: 'render_failed',
            render_error: errorMsg,
          },
        },
      );
      
      return; // Exit early, don't retry
    }

    // ── 1. Use cached Remotion bundle ──
    log('BUNDLE_STARTED', jobId);
    const bundleUrl = await getOrCreateBundle();
    log('BUNDLE_COMPLETE', jobId);

    // ── 2. Validate composition exists ──
    const compositions = await getCompositions(bundleUrl);
    const ids = compositions.map(c => c.id);
    log('COMPOSITIONS', ids.join(', '));

    if (!ids.includes(compositionId)) {
      throw new Error(
        `INVALID_COMPOSITION_ID: "${compositionId}" not in bundle. Available: [${ids.join(', ')}]`
      );
    }

    // ── 3. Compute duration ──
    const lastWord = words[words.length - 1];
    const endTimeRaw = lastWord ? lastWord.endTime : 0;
    const endTimeSec = endTimeRaw > 1000 ? endTimeRaw / 1000 : endTimeRaw;
    const durationInSeconds = Math.ceil(endTimeSec) + 1;
    const fps = 30;
    const durationInFrames = Math.max(durationInSeconds * fps, fps);

    // ── 4. Select composition with props ──
    const inputProps = {
      videoUrl,
      words,
      template,
      templateStyle,
    };

    const composition = await selectComposition({
      serveUrl: bundleUrl,
      id: compositionId,
      inputProps,
    });

    composition.durationInFrames = durationInFrames;
    composition.fps = fps;

    // ── 5. Render ──
    const outputPath = path.join(os.tmpdir(), `render-${jobId}.mp4`);
    log('RENDER_STARTED', `${jobId} → ${outputPath}`);

    // Set delayRender timeout for this process
    const originalTimeout = process.env.REMOTION_DELAY_RENDER_TIMEOUT;
    process.env.REMOTION_DELAY_RENDER_TIMEOUT = '60000';

    try {
      await renderMedia({
        composition,
        serveUrl: bundleUrl,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps,
        timeoutInMilliseconds: 10 * 60 * 1000, // 10 minutes
        onProgress: ({ progress }) => {
          const pct = Math.round(progress * 100);
          job.progress = pct;
        },
      });
    } finally {
      // Restore original timeout
      process.env.REMOTION_DELAY_RENDER_TIMEOUT = originalTimeout;
    }

    log('RENDER_COMPLETE', jobId);

    // ── 6. Validate output ──
    if (!fs.existsSync(outputPath)) {
      throw new Error('Output file not found');
    }
    const stat = fs.statSync(outputPath);
    if (stat.size < 10240) {
      throw new Error(`Output too small: ${stat.size} bytes`);
    }

    // ── 7. Upload to R2 ──
    log('R2_UPLOAD', jobId);
    const fileBuffer = fs.readFileSync(outputPath);
    const r2Key = `rendered/${uploadId}-${Date.now()}.mp4`;
    const publicUrl = await uploadToR2(r2Key, fileBuffer);

    // Validate output ≠ input
    if (publicUrl === sourceMediaUrl) {
      throw new Error('PIPELINE_MISWIRED: rendered URL === source URL');
    }

    log('R2_UPLOADED', publicUrl);

    // ── 8. Clean up temp file ──
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }

    // ── 9. Update DB ──
    await updateJob({
      status: 'completed',
      progress: 100,
      outputUrl: publicUrl,
      output_url: publicUrl,
      completed_at: new Date(),
    });

    // Update uploads collection
    await db.collection('uploads').updateOne(
      { _id: new ObjectId(uploadId) },
      {
        $set: {
          caption_status: 'final_render_ready',
          media_url: publicUrl,
          render_progress: 100,
          render_completed_at: new Date(),
          render_job_id: jobId,
        },
      },
    );

    job.outputUrl = publicUrl;
    log('JOB_COMPLETE', `${jobId} → ${publicUrl}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('JOB_FAILED', `${jobId}: ${msg}`);

    await updateJob({
      status: 'failed',
      error: msg,
      failed_at: new Date(),
    });

    // Mark upload failed
    try {
      await db.collection('uploads').updateOne(
        { _id: new ObjectId(uploadId) },
        { $set: { caption_status: 'render_failed', render_error: msg } },
      );
    } catch { /* ignore */ }
  }
}

// ────────────────────────────────────────────────────────────────
// VertiCut render processor
// ────────────────────────────────────────────────────────────────
async function processVerticutRender(jobId, params) {
  const { filename, project, clips, settings, overlayUrl } = params;
  const job = jobQueue.get(jobId);
  const db = await getDb();

  const updateJob = async (fields) => {
    Object.assign(job, fields);
    await db.collection('render_jobs').updateOne(
      { _id: jobId },
      { $set: fields },
    );
  };

  try {
    await updateJob({ status: 'rendering', started_at: new Date() });

    // Bundle the VertiCut Remotion entry (cached after first build)
    const verticutEntry = process.env.REMOTION_VERTICUT_ENTRY
      || path.join(process.cwd(), 'src', 'remotion-entry.jsx');
    log('VERTICUT_BUNDLE_STARTED', jobId);
    const bundleUrl = await getOrCreateBundle(verticutEntry);
    log('VERTICUT_BUNDLE_COMPLETE', jobId);

    // Validate composition
    const compositions = await getCompositions(bundleUrl);
    const ids = compositions.map(c => c.id);
    if (!ids.includes('VertiCut')) {
      throw new Error(`INVALID_COMPOSITION_ID: "VertiCut" not in bundle. Available: [${ids.join(', ')}]`);
    }

    const fps = 30;
    const durationInSeconds = Math.max(1, project.audioDuration || 1);
    const durationInFrames = Math.max(fps, Math.round(durationInSeconds * fps));

    const inputProps = {
      audioUrl: project.audioUrl,
      musicUrl: settings.musicUrl || undefined,
      musicVolume: (settings.musicVolume ?? 30) / 100,
      clips: clips || [],
      defaultLabelText: settings.defaultLabelText || '',
      defaultFontSize: settings.defaultFontSize ?? 18,
      intensity: settings.animationIntensity ?? 1,
      durationInFrames,
      fps,
      overlayUrl: overlayUrl || undefined,
      audioSegments: params.audioSegments || [],
      captionTextColor: settings.captionTextColor,
      captionBgColor: settings.captionBgColor,
      captionPosX: settings.captionPosX,
      captionPosY: settings.captionPosY,
      captionFontSize: settings.captionFontSize,
      transcript: project.transcript || [],
    };

    const composition = await selectComposition({
      serveUrl: bundleUrl,
      id: 'VertiCut',
      inputProps,
    });
    composition.durationInFrames = durationInFrames;
    composition.fps = fps;
    composition.width = 1080;
    composition.height = 1920;

    const outputPath = path.join(os.tmpdir(), `verticut-${jobId}.mp4`);
    log('VERTICUT_RENDER_STARTED', `${jobId} → ${outputPath}`);

    const originalTimeout = process.env.REMOTION_DELAY_RENDER_TIMEOUT;
    process.env.REMOTION_DELAY_RENDER_TIMEOUT = '60000';

    try {
      await renderMedia({
        composition,
        serveUrl: bundleUrl,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps,
        timeoutInMilliseconds: 10 * 60 * 1000,
        onProgress: ({ progress }) => {
          const pct = Math.round(progress * 100);
          job.progress = pct;
          // Persist progress every ~5% so DB-backed status stays fresh
          if (pct > 0 && pct % 5 === 0) {
            db.collection('render_jobs').updateOne(
              { _id: jobId },
              { $set: { progress: pct } },
            ).catch(() => {});
          }
        },
      });
    } finally {
      process.env.REMOTION_DELAY_RENDER_TIMEOUT = originalTimeout;
    }

    log('VERTICUT_RENDER_COMPLETE', jobId);

    if (!fs.existsSync(outputPath)) throw new Error('Output file not found');
    const stat = fs.statSync(outputPath);
    if (stat.size < 10240) throw new Error(`Output too small: ${stat.size} bytes`);

    const fileBuffer = fs.readFileSync(outputPath);
    const safeFilename = (filename || `${jobId}.mp4`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const r2Key = `renders/${jobId}.mp4`;
    const s3 = getS3();
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: r2Key,
      Body: fileBuffer,
      ContentType: 'video/mp4',
      ContentDisposition: `attachment; filename="${safeFilename}"`,
    }));
    const publicUrl = joinCdnUrl(r2Key);
    log('VERTICUT_R2_UPLOADED', publicUrl);

    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }

    await updateJob({
      status: 'completed',
      progress: 100,
      outputUrl: publicUrl,
      output_url: publicUrl,
      completed_at: new Date(),
    });
    job.outputUrl = publicUrl;
    log('VERTICUT_JOB_COMPLETE', `${jobId} → ${publicUrl}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('VERTICUT_JOB_FAILED', `${jobId}: ${msg}`);
    await updateJob({
      status: 'failed',
      error: msg,
      failed_at: new Date(),
    });
  }
}

// ─── Default styles ───
function getDefaultStyleForTemplate(template) {
  const defaults = {
    velar: { highlightColor: '#44b0d4', positionY: 75, fontSize: 100, wordsPerLine: 3, maxLinesPerSegment: 2 },
    kinetic_highlights: { highlightColor: '#FF6B00', positionY: 85, fontSize: 100, wordsPerLine: 4, maxLinesPerSegment: 2 },
  };
  return defaults[template] || defaults.velar;
}

// ─── Preflight checks ───
function preflightChecks() {
  const required = ['MONGODB_URI', 'R2_BUCKET', 'R2_ACCESS_KEY', 'R2_SECRET_KEY', 'R2_ENDPOINT'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[RenderServer] FATAL: Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ─── Recover orphaned jobs on startup ───
async function recoverOrphanedJobs() {
  try {
    const db = await getDb();
    // Find jobs stuck in 'queued' or 'rendering' from a previous server run
    const orphaned = await db.collection('render_jobs')
      .find({ status: { $in: ['queued', 'rendering'] } })
      .sort({ created_at: 1 })
      .limit(20)
      .toArray();
    
    if (orphaned.length === 0) {
      log('RECOVERY', 'No orphaned jobs found');
      return;
    }
    
    log('RECOVERY', `Found ${orphaned.length} orphaned job(s), re-queuing...`);
    
    for (const job of orphaned) {
      const jobId = String(job._id);
      let params;

      if (job.kind === 'verticut') {
        if (!job.input?.project || !Array.isArray(job.input?.clips)) {
          log('RECOVERY', `Skipping verticut job ${jobId} — missing input`);
          await db.collection('render_jobs').updateOne(
            { _id: jobId },
            { $set: { status: 'failed', error: 'Missing verticut input (orphan recovery)', failed_at: new Date() } }
          );
          continue;
        }
        params = {
          kind: 'verticut',
          filename: job.filename || `${jobId}.mp4`,
          project: job.input.project,
          clips: job.input.clips,
          settings: job.input.settings || {},
          overlayUrl: job.input.overlayUrl || null,
        };
      } else {
        params = {
          uploadId: job.upload_id,
          videoUrl: job.input?.videoUrl || job.source_media_url,
          words: job.input?.words || [],
          template: job.input?.template || 'velar',
          compositionId: TEMPLATE_TO_COMPOSITION[job.input?.template || 'velar'] || 'CaptionedVideo',
          templateStyle: job.input?.templateStyle || getDefaultStyleForTemplate(job.input?.template || 'velar'),
          sourceMediaUrl: job.source_media_url || job.input?.videoUrl,
        };
        if (!params.words || params.words.length === 0) {
          log('RECOVERY', `Skipping job ${jobId} — no words data`);
          await db.collection('render_jobs').updateOne(
            { _id: jobId },
            { $set: { status: 'failed', error: 'No words data (orphan recovery)', failed_at: new Date() } }
          );
          continue;
        }
      }

      jobQueue.set(jobId, {
        jobId,
        uploadId: job.upload_id || job.project_id || jobId,
        status: 'queued',
        progress: 0,
        outputUrl: null,
        error: null,
        createdAt: job.created_at,
      });

      await db.collection('render_jobs').updateOne(
        { _id: jobId },
        { $set: { status: 'queued' } }
      );

      renderQueue.push({ jobId, params });
      log('RECOVERY', `Re-queued ${job.kind || 'caption'} job ${jobId}`);
    }
    
    // Kick off processing
    setImmediate(processNextJob);
  } catch (err) {
    log('RECOVERY_ERROR', err.message);
  }
}

// ─── Start ───
preflightChecks();

app.listen(PORT, () => {
  log('STARTED', `Render server listening on :${PORT}`);
  // Recover orphaned jobs after startup
  recoverOrphanedJobs();
  // Periodic stall check every 2 minutes
  setInterval(() => {
    processNextJob();
  }, 2 * 60 * 1000);
});

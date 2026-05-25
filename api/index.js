import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

if (typeof globalThis.require !== 'function') {
  globalThis.require = createRequire(import.meta.url);
}

const candidates = [
  path.join(__dirname, '../dist/server/index.js'),
  path.join(process.cwd(), 'dist/server/index.js'),
];

let bundlePath = null;
let workerPromise = null;

function findBundlePath() {
  if (bundlePath) return bundlePath;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      bundlePath = p;
      break;
    }
  }
  if (!bundlePath) {
    throw new Error(
      `Server bundle not found. Checked: ${candidates.join(', ')}. cwd=${process.cwd()}`
    );
  }
  return bundlePath;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = await import(url.pathToFileURL(findBundlePath()).href);
      const worker = mod.default ?? mod;
      if (!worker || typeof worker.fetch !== 'function') {
        throw new Error(
          `Server bundle does not export a Worker-style { fetch } handler. Got keys: ${Object.keys(worker || {}).join(', ')}`
        );
      }
      return worker;
    })();
  }
  return workerPromise;
}

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials not configured');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket() {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error('R2_BUCKET not configured');
  return b;
}

function publicUrl(key) {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) throw new Error('R2_PUBLIC_BASE_URL not configured');
  return `${base.replace(/\/$/, '')}/${key}`;
}

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const SEGMENTATION_SYSTEM_PROMPT = `You are a video editor assistant. You receive a spoken script and its word-level timestamps.
Segment the script into image search queries by detecting every subject/entity - including sudden mid-sentence shifts.

INPUT:
- Full script text (for context)
- Word-level timestamps: [{ "word": "...", "start": 0.0, "end": 0.4 }, ...]

RULES - NON-NEGOTIABLE:

1. DETECT EVERY SUBJECT SHIFT, EVEN MID-SENTENCE.
   The moment the subject changes (new person, team, event, brand, place, concept) - cut there.
   Use the exact "start" timestamp of the first word of the new subject.

2. MAX SEGMENT DURATION = 3.5 SECONDS.
   Same subject > 3.5s -> split into multiple segments, same query.

3. QUERIES MUST BE SPECIFIC AND IMAGE-SEARCHABLE.
   Resolve vague pronouns using context.

4. ZERO GAPS ALLOWED.
   Each segment's "end" = next segment's "start".
   Final segment's "end" = last word's "end" timestamp.

5. OUTPUT - STRICT JSON ONLY:
{
  "segments": [
    { "query": "Cody Rhodes WWE", "start": 0.0, "end": 3.5 }
  ]
}

No markdown. No explanation. Timestamps as numbers, not strings.`;

let mongoClient = null;
let mongoDbPromise = null;

function hasMongoConfig() {
  return Boolean(process.env.MONGODB_URI);
}

async function getDb() {
  if (mongoDbPromise) return mongoDbPromise;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');
  mongoClient = new MongoClient(uri);
  mongoDbPromise = mongoClient.connect().then((c) => c.db('verticut'));
  return mongoDbPromise;
}

function sentenceFallbackSegments(fullText, words) {
  if (!words.length) return [];
  const sentences = String(fullText || '')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) {
    return [{ query: 'sports news', start: words[0].start, end: words[words.length - 1].end }];
  }

  let cursor = 0;
  const segments = [];
  for (const s of sentences) {
    const tokens = s.split(/\s+/).filter(Boolean);
    const startIdx = Math.min(cursor, words.length - 1);
    const endIdx = Math.min(words.length - 1, startIdx + Math.max(0, tokens.length - 1));
    const start = words[startIdx]?.start ?? words[0].start;
    const end = words[endIdx]?.end ?? words[words.length - 1].end;
    segments.push({ query: s, start, end });
    cursor = endIdx + 1;
    if (cursor >= words.length) break;
  }

  if (segments.length) {
    segments[0].start = words[0].start;
    segments[segments.length - 1].end = words[words.length - 1].end;
    for (let i = 0; i < segments.length - 1; i++) {
      segments[i].end = segments[i + 1].start;
    }
  }
  return segments;
}

function normalizeSegments(raw, words, fullText) {
  const source = Array.isArray(raw) ? raw : [];
  if (!words.length || !source.length) return sentenceFallbackSegments(fullText, words);

  const sorted = source
    .map((s) => ({
      query: String(s?.query || '').trim(),
      start: Number(s?.start ?? 0),
      end: Number(s?.end ?? 0),
    }))
    .filter((s) => s.query && Number.isFinite(s.start) && Number.isFinite(s.end))
    .sort((a, b) => a.start - b.start);

  if (!sorted.length) return sentenceFallbackSegments(fullText, words);

  const chunks = [];
  const firstStart = words[0].start;
  const lastEnd = words[words.length - 1].end;

  for (const s of sorted) {
    const start = Math.max(firstStart, s.start);
    const end = Math.min(lastEnd, Math.max(start + 0.01, s.end));
    let cursor = start;
    while (cursor < end - 0.001) {
      const next = Math.min(end, cursor + 3.5);
      chunks.push({ query: s.query, start: cursor, end: next });
      cursor = next;
    }
  }

  if (!chunks.length) return sentenceFallbackSegments(fullText, words);
  chunks[0].start = firstStart;
  chunks[chunks.length - 1].end = lastEnd;
  for (let i = 0; i < chunks.length - 1; i++) {
    chunks[i].end = chunks[i + 1].start;
  }
  return chunks;
}

async function segmentWithGroq(fullText, words) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not configured');

  const body = {
    model: GROQ_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SEGMENTATION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Full script:\n"${fullText}"\n\nWord-level timestamps:\n${JSON.stringify(words)}`,
      },
    ],
  };

  let parseErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Groq failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content;
    try {
      const parsed = JSON.parse(content);
      return normalizeSegments(parsed?.segments, words, fullText);
    } catch (e) {
      parseErr = e;
    }
  }

  if (parseErr) {
    return sentenceFallbackSegments(fullText, words);
  }
  return sentenceFallbackSegments(fullText, words);
}

function findArrayByKey(obj, keyHints) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) return obj;
  for (const k of Object.keys(obj)) {
    if (keyHints.some((h) => k.toLowerCase().includes(h))) {
      const v = obj[k];
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        const nested = findArrayByKey(v, keyHints);
        if (nested) return nested;
      }
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const nested = findArrayByKey(v, keyHints);
      if (nested) return nested;
    }
  }
  return null;
}

function normalizeImageItem(item, source) {
  const obj = item || {};
  const id = String(obj.id || obj.imageId || obj.assetId || obj.mediaId || obj.uuid || crypto.randomUUID());
  const url =
    obj.url ||
    obj.imageUrl ||
    obj.thumbnailUrl ||
    obj.previewUrl ||
    obj.src ||
    obj.image?.url ||
    obj.picture?.url ||
    '';
  if (!url) return null;
  const title = String(obj.title || obj.headline || obj.name || '');
  const caption = String(obj.caption || obj.description || obj.altText || '');
  const tsRaw = obj.timestamp || obj.createdAt || obj.updatedAt || obj.publishedAt || obj.date;
  const timestamp = tsRaw ? new Date(tsRaw).getTime() : 0;
  return { id, url, title, caption, timestamp: Number.isFinite(timestamp) ? timestamp : 0, source };
}

async function handleRichinSegments(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    if (!hasMongoConfig()) return sendJson(res, 500, { error: 'MONGODB_URI not configured' });
    const data = await readJson(req);
    const projectId = String(data?.projectId || '');
    if (!projectId) return sendJson(res, 400, { error: 'projectId is required' });

    const db = await getDb();
    const project = await db.collection('projects').findOne({ _id: projectId });
    if (!project) return sendJson(res, 404, { error: 'Project not found' });

    const transcript = Array.isArray(project.transcript) ? project.transcript : [];
    if (!transcript.length) return sendJson(res, 400, { error: 'Transcript is not ready yet' });

    const words = transcript.map((w) => ({
      word: String(w.text || ''),
      start: Number(w.start || 0),
      end: Number(w.end || 0),
    }));
    const fullText = words.map((w) => w.word).join(' ').replace(/\s+/g, ' ').trim();

    const segments = await segmentWithGroq(fullText, words);
    return sendJson(res, 200, { segments });
  } catch (err) {
    console.error('richin segments failed:', err);
    return sendJson(res, 500, { error: String(err?.message || err) });
  }
}

async function handleRichinSearch(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    const data = await readJson(req);
    const query = String(data?.query || '').trim();
    const cookie = String(data?.cookie || '').trim();
    if (!query) return sendJson(res, 400, { error: 'query is required' });
    if (!cookie) return sendJson(res, 400, { error: 'Sportskeeda cookie is required' });

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Referer: 'https://www.sportskeeda.com/',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://www.sportskeeda.com',
      Cookie: cookie,
    };

    const [gettyRes, imagnRes] = await Promise.all([
      fetch(`https://a-gotham.sportskeeda.com/social-media-bank/search?query=${encodeURIComponent(query)}&page=1&size=12&imageProvider=getty`, { headers }),
      fetch(`https://a-login.sportskeeda.com/en/media/image/search/imagn?search=${encodeURIComponent(query)}&offset=0&limit=12`, { headers }),
    ]);

    const gettyJson = gettyRes.ok ? await gettyRes.json() : {};
    const imagnJson = imagnRes.ok ? await imagnRes.json() : {};

    const gettyRaw = findArrayByKey(gettyJson, ['result', 'items', 'data', 'images']) || [];
    const imagnRaw = findArrayByKey(imagnJson, ['result', 'items', 'data', 'images']) || [];

    const getty = gettyRaw.map((x) => normalizeImageItem(x, 'getty')).filter(Boolean);
    const imagn = imagnRaw.map((x) => normalizeImageItem(x, 'imagn')).filter(Boolean);

    return sendJson(res, 200, {
      getty,
      imagn,
      gettyStatus: gettyRes.status,
      imagnStatus: imagnRes.status,
    });
  } catch (err) {
    console.error('richin search failed:', err);
    return sendJson(res, 500, { error: String(err?.message || err) });
  }
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return null;
  return JSON.parse(buf.toString('utf8'));
}

async function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function handlePresignUpload(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    const data = await readJson(req);
    const kind = data?.kind;
    const ext = String(data?.ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const contentType = String(data?.contentType || 'application/octet-stream');
    if (!['audio', 'image', 'music'].includes(kind)) {
      return sendJson(res, 400, { error: 'Invalid upload kind' });
    }
    const id = crypto.randomUUID();
    const key = `${kind}/${id}.${ext}`;
    const cmd = new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    });
    const uploadUrl = await getSignedUrl(getR2Client(), cmd, { expiresIn: 600 });
    return sendJson(res, 200, { uploadUrl, key, publicUrl: publicUrl(key) });
  } catch (err) {
    console.error('presign upload failed:', err);
    return sendJson(res, 500, { error: String(err?.message || err) });
  }
}

async function handleFetchAndUploadImage(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    const data = await readJson(req);
    const targetUrl = String(data?.url || '');
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return sendJson(res, 400, { error: 'Invalid URL' });
    }
    const resp = await fetch(targetUrl);
    if (!resp.ok) return sendJson(res, 502, { error: `Fetch failed: ${resp.status}` });
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return sendJson(res, 400, { error: `Not an image: ${contentType}` });
    }
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const id = crypto.randomUUID();
    const ext = (contentType.split('/').pop() || 'bin').replace(/[^a-z0-9]/gi, '');
    const key = `image/${id}.${ext}`;
    const cmd = new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    });
    await getR2Client().send(cmd);
    return sendJson(res, 200, { uploadUrl: null, key, publicUrl: publicUrl(key) });
  } catch (err) {
    console.error('fetch/upload image failed:', err);
    return sendJson(res, 500, { error: String(err?.message || err) });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const fullUrl = `${proto}://${host}${req.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const buf = await readBody(req);
    if (buf.length > 0) init.body = buf;
  }
  return new Request(fullUrl, init);
}

async function sendWebResponse(webRes, res) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!webRes.body) {
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(webRes.body);
  nodeStream.pipe(res);
  await new Promise((resolve, reject) => {
    nodeStream.on('end', resolve);
    nodeStream.on('error', reject);
    res.on('error', reject);
  });
}

export default async function handler(req, res) {
  try {
    const reqUrl = new URL(req.url, 'http://localhost');
    if (reqUrl.pathname === '/api/presign-upload') {
      return await handlePresignUpload(req, res);
    }
    if (reqUrl.pathname === '/api/fetch-and-upload-image') {
      return await handleFetchAndUploadImage(req, res);
    }
    if (reqUrl.pathname === '/api/richin/segments') {
      return await handleRichinSegments(req, res);
    }
    if (reqUrl.pathname === '/api/richin/search') {
      return await handleRichinSearch(req, res);
    }

    const worker = await getWorker();
    const webReq = await toWebRequest(req);
    const webRes = await worker.fetch(webReq, process.env, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    });
    await sendWebResponse(webRes, res);
  } catch (err) {
    console.error('Error while invoking server bundle:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain');
    }
    res.end('Internal Server Error');
  }
}

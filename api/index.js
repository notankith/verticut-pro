import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

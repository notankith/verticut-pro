import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

if (typeof globalThis.require !== 'function') {
  globalThis.require = createRequire(import.meta.url);
}

const candidates = [
  path.join(__dirname, '../dist/server/index.js'),
  path.join(process.cwd(), 'dist/server/index.js'),
];

let bundlePath = null;
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

const mod = await import(url.pathToFileURL(bundlePath).href);
const worker = mod.default ?? mod;

if (!worker || typeof worker.fetch !== 'function') {
  throw new Error(
    `Server bundle does not export a Worker-style { fetch } handler. Got keys: ${Object.keys(worker || {}).join(', ')}`
  );
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

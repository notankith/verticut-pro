import path from 'path';
import url from 'url';
import fs from 'fs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

let serverModule;
let lastError = null;

// Try a set of likely locations for the built server bundle (Vercel may
// place build outputs in slightly different paths depending on the builder).
const candidates = [
  path.join(__dirname, '../dist/server/index.js'),
  path.join(__dirname, './dist/server/index.js'),
  path.join(process.cwd(), 'dist/server/index.js'),
  path.join(process.cwd(), 'dist', 'server', 'index.js'),
  path.join(__dirname, '../.vercel/output/functions/api/index.func/dist/server/index.js'),
];

for (const p of candidates) {
  try {
    if (fs.existsSync(p)) {
      serverModule = await import(url.pathToFileURL(p).href);
      break;
    }
    // Try a direct import by specifier as a last resort
    try {
      serverModule = await import(p);
      break;
    } catch (e) {
      lastError = e;
    }
  } catch (e) {
    lastError = e;
  }
}

// Final fallback: try the simple relative import used previously
if (!serverModule) {
  try {
    serverModule = await import('../dist/server/index.js');
  } catch (e) {
    lastError = e;
  }
}

if (!serverModule) {
  try {
    const dirListing = {
      __dirname: fs.readdirSync(__dirname).slice(0, 200),
      processCwd: fs.readdirSync(process.cwd()).slice(0, 200),
    };
    console.error('Failed to load server bundle. Directory listing:', dirListing, 'lastError:', lastError);
  } catch (e) {
    console.error('Failed to load server bundle and could not list directories', e, 'lastError:', lastError);
  }
}

const handler = serverModule?.default || serverModule?.createServerEntry || serverModule;

export default async function (req, res) {
  if (!handler) {
    res.statusCode = 500;
    // Provide a compact diagnostic JSON body to aid debugging in Vercel logs
    try {
      const diag = {
        cwd: process.cwd(),
        __dirname: __dirname,
        checkedCandidates: {},
        lastError: String(lastError ?? ""),
      };
      for (const p of candidates) {
        try {
          diag.checkedCandidates[p] = fs.existsSync(p) ? fs.readdirSync(path.dirname(p)).slice(0, 200) : null;
        } catch (e) {
          diag.checkedCandidates[p] = `err: ${String(e)}`;
        }
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Server bundle not found', diag }, null, 2));
    } catch (e) {
      res.end('Server bundle not found');
    }
    return;
  }

  try {
    // If the bundle exports an Express-like handler, call it directly.
    if (typeof handler === 'function') {
      // Some bundles export an Express app factory; attempt common invocation patterns.
      const result = handler(req, res);
      // If handler returned a Promise, await it to ensure completion.
      if (result && typeof result.then === 'function') await result;
      return;
    }

    // If the bundle exposes a createServerEntry factory that returns an http handler
    if (typeof serverModule.createServerEntry === 'function') {
      const app = serverModule.createServerEntry();
      // Try multiple invocation patterns for common server bundles
      try {
        if (typeof app === 'function') {
          const r = app(req, res);
          if (r && typeof r.then === 'function') await r;
          return;
        }
        if (app && typeof app.handler === 'function') {
          const r = app.handler(req, res);
          if (r && typeof r.then === 'function') await r;
          return;
        }
        if (app && typeof app.handle === 'function') {
          const r = app.handle(req, res);
          if (r && typeof r.then === 'function') await r;
          return;
        }
        if (app && typeof app.fetch === 'function') {
          // Some frameworks expose a fetch-style handler (Edge-like)
          const out = await app.fetch(req);
          if (out && typeof out.text === 'function') {
            // Try to send back a Response-like object
            res.statusCode = out.status || 200;
            for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, String(v));
            const body = await out.text();
            res.end(body);
            return;
          }
        }
        if (app && app.default && typeof app.default === 'function') {
          const r = app.default(req, res);
          if (r && typeof r.then === 'function') await r;
          return;
        }
      } catch (e) {
        console.error('Error while invoking createServerEntry result:', e);
        throw e;
      }

      // If we get here, `app` wasn't callable in known ways — return diagnostics.
      console.error('createServerEntry returned non-callable value:', typeof app, Object.keys(app || {}));
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'createServerEntry returned non-callable value', type: typeof app, keys: Object.keys(app || {}) }));
      return;
    }

    res.statusCode = 500;
    res.end('Server bundle did not export a callable handler');
  } catch (err) {
    console.error('Error while invoking server bundle:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

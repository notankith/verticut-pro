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
    res.end('Server bundle not found');
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
      // Express app can be invoked as a function
      return app(req, res);
    }

    res.statusCode = 500;
    res.end('Server bundle did not export a callable handler');
  } catch (err) {
    console.error('Error while invoking server bundle:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

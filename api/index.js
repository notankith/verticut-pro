import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

let serverModule;
try {
  // The dist is produced during the Vercel build step. Import the server bundle.
  serverModule = await import(path.join(__dirname, '../dist/server/index.js'));
} catch (err) {
  // Fallback: try relative path without join
  try {
    serverModule = await import('../dist/server/index.js');
  } catch (e) {
    console.error('Failed to load server bundle:', e);
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

# VertiCut Render Worker

Standalone Node service that renders VertiCut compositions to MP4 with Remotion and uploads results to Cloudflare R2.

**You must run this somewhere with Node + headless Chromium** (Render.com, Fly.io, Railway, your own VPS, etc.). It cannot run on Cloudflare Workers because Remotion needs a real browser.

## Setup

```bash
cd worker
npm install
# Remotion will auto-install Chrome on first render via @remotion/renderer
```

## Environment variables

| Var | What |
|---|---|
| `PORT` | HTTP port (default 4000) |
| `RENDER_WORKER_SECRET` | Same value as in your Lovable project secrets |
| `APP_URL` | Your published Lovable app URL, e.g. `https://your-app.lovable.app` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | Same R2 credentials as the app |

Then set `RENDER_WORKER_URL` in your Lovable project secrets to the worker's public URL (e.g. `https://verticut-worker.onrender.com`).

## Run

```bash
npm start
```

## How it works

1. App POSTs `/render` with `x-worker-secret` header and `{ jobId, filename, project, clips, settings }`.
2. Worker bundles the Remotion composition (cached after first run), renders the MP4 to /tmp.
3. Uploads to R2 at `renders/<jobId>.mp4`.
4. POSTs `/api/public/render-complete` back to the app with `status: "done"` and the public URL.

Progress events also stream back to the same webhook with `status: "rendering"` and a `progress` value 0..1.

# VPS Render Server

Persistent backend that handles all Remotion video rendering.
Deployed on a VPS (not Vercel).

## Setup

```bash
cd render-server
npm install
```

## Environment Variables

Copy from root `.env` or set directly:

```
MONGODB_URI=mongodb+srv://...
MONGODB_DB=Cluster0
R2_BUCKET=renders
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_ENDPOINT=https://....r2.cloudflarestorage.com
R2_ACCOUNT_ID=...
CDN_BASE_URL=https://cdn.ankith.studio
RENDER_SERVER_PORT=4100
RENDER_SERVER_SECRET=your-shared-secret
```

## Run

```bash
npm start          # production
npm run dev        # watch mode
```

## API

### POST /render
Submit a render job. Returns immediately with `jobId`.

```json
{
  "uploadId": "...",
  "videoUrl": "https://cdn.ankith.studio/video.mp4",
  "words": [...],
  "template": "velar",
  "templateStyle": { ... },
  "sourceMediaUrl": "https://cdn.ankith.studio/original.mp4"
}
```

Response:
```json
{ "success": true, "jobId": "uuid", "status": "queued" }
```

### GET /render/status/:jobId
Poll job status.

Response:
```json
{
  "jobId": "uuid",
  "status": "completed",
  "progress": 100,
  "finalUrl": "https://cdn.ankith.studio/rendered/abc123.mp4",
  "error": null
}
```

### POST /render/verticut
Submit a Verticut render (audio + image clips with Ken Burns). Returns immediately with `jobId`.

```json
{
  "jobId": "uuid-from-app",
  "filename": "my-clip.mp4",
  "overlayUrl": "https://app.example.com/GradientOverlay.png",
  "project": { "id": "...", "name": "...", "audioUrl": "...", "audioDuration": 12.3 },
  "clips": [ { "id": "...", "start": 0, "duration": 3, "imageUrl": "...", "animation": "zoom-in", "labelText": "...", "labelPresetId": "..." } ],
  "settings": { "defaultLabelText": "...", "defaultFontSize": 18, "animationIntensity": 1, "musicUrl": "...", "musicVolume": 30 }
}
```

Status is reported through the same `GET /render/status/:jobId` endpoint.

### GET /health
```json
{ "status": "ok", "uptime": 12345, "jobs": 0 }
```

## Deployment notes

After pulling new code on the VPS, run `npm install` (the new flow needs `react`, `react-dom`, and a Verticut Remotion entry at `src/remotion-entry.jsx`) and restart the service. Bundle cache is keyed by entry path, so the captioned and Verticut compositions are bundled independently and only once each.

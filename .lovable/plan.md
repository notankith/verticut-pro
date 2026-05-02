# VertiCut — Build Plan

A desktop-only, AE-styled vertical (9:16) video editor. Upload a voiceover, get a word-level transcript, drop images onto a timeline with Ken Burns animations and labels, and export 1080×1920 MP4s via a self-hosted Remotion worker. No login — single shared workspace.

## Stack

- **Frontend**: TanStack Start, React, Tailwind, Remotion `@remotion/player` for in-editor preview (uses Remotion's native audio playback — zero-delay sync).
- **Server functions**: TanStack Start server fns (in Cloudflare Worker runtime) — handle uploads, projects, transcription kickoff, queue jobs.
- **DB**: MongoDB Atlas (collections: `projects`, `clips`, `renders`, `settings`, `presets`).
- **Storage**: Cloudflare R2 (presigned PUT for client direct-upload of audio/images/music; renders uploaded by worker).
- **Transcription**: AssemblyAI (word-level timestamps).
- **Rendering**: Self-hosted Remotion render worker (separate Node service you run on Render/Fly/Railway). The web app POSTs a signed job to the worker; worker pulls assets from R2, renders MP4 via `@remotion/renderer`, uploads result to R2, and POSTs a signed completion webhook back to `/api/public/render-complete`.

## Secrets needed

`MONGODB_URI`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`, `ASSEMBLYAI_API_KEY`, `RENDER_WORKER_URL`, `RENDER_WORKER_SECRET`.

---

## Views

### Homepage `/`

- Centered drop zone "Drop audio to start" + Upload Audio button (mp3/wav).
- On drop: presigned upload to R2 → create project (name = first 7 words of transcript, set after AssemblyAI returns; placeholder "Untitled" until then) → kick off transcription → navigate to editor.
- Project list: cards with name, clip count, duration, date, status badge (Draft / Rendering / Done).
- Downloads section: completed renders with filename + download button (R2 URL).

### Editor `/project/:id`

AE-style fixed layout, dark theme:

```text
┌─────────────────────────────────────────────────────────────┐
│ Logo │ Project name| Label Dropdown│ Saving │ ↶ ↷ │ Export │
├─────────────────────────────────────────────────────────────┤
│          |
|          |                                                  |
│ Left     │   9:16 Preview canvas             │Transcript bar| 
|          |                                   |(word-by-word |
|          |                                   |highlight,    |
|          |                                   |click to seek)| 
│ selected │   (Remotion Player, LQ badge,     │              |
│ layer    │    label top-left,                │              | 
│ tweaks   │    timecode bottom-right)         │              │
│ animaton │   play/pause     00:00:00:00      │              │
├──────────┴───────────────────────────────────┴──────────────┤
│ Ruler ─┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──
|
│       
│ Track  [WWE clip][gap][AEW clip ][ Custom clip          ]   │
└─────────────────────────────────────────────────────────────┘
```

### Settings tab (in editor header)

- Label preset CRUD (name + text).
- Default label text + font size (10–32).
- Global animation intensity (0.5×–3×).
- Background music: URL **or** upload-to-R2, volume slider, Test button.

---

## Editor behavior

- **Preview**: `<Player>` from `@remotion/player` with the same composition the worker renders. Audio plays through Remotion → no JS-driven sync drift.
- **Transcript bar**: words from AssemblyAI; CSS class flips at `currentFrame / fps` boundaries. Click → `player.seekTo(frame)`.
- **Timeline**:
  - Single track, full width, ruler scales with zoom.
  - Default clip = 3.5s. Drag body = move; drag edges = trim/extend.
  - Snap within 8px to neighbor edges and playhead.
  - No overlap (collision check on drop); gaps allowed.
  - Color tint by label type: WWE red, AEW gold, Custom purple.
  - Each clip block shows label name (TL), animation (BL), duration (BR).
- **Animations**: zoom-in / zoom-out / pan-left / pan-right. Speed = (clip duration) × global intensity. Validation prevents two consecutive clips with the same animation (auto-pick next available, warn on manual conflict).
- **Import images**: Ctrl+I → multi-select → uploaded to R2 in parallel → appended after last clip in selection order, default 3.5s each, current preset applied.
- **Inspector**: animation dropdown, label text, preset dropdown, Replace media, Delete.
- **Undo/Redo**: in-memory action stack (zustand + history slice). Ctrl+Z / Ctrl+Shift+Z.
- **Auto-save**: debounced 500ms → server fn → MongoDB. Header shows Saving…/Saved.

---

## Composition (Remotion)

- 1080×1920, 30fps, duration = audio length (seconds × 30, rounded).
- Layers (bottom→top):
  1. Voiceover `<Audio src={voiceoverUrl} />`.
  2. Background music `<Audio src={musicUrl} loop volume={settings.musicVolume/100} />` if set.
  3. Per-clip `<Sequence from durationInFrames>` with `<Img>` + Ken Burns transform driven by `interpolate(useCurrentFrame(), [0, dur], [...])`, scaled by intensity.
  4. Label overlay (top-left, white, configurable size).
  5. Timecode (bottom-right) and "LQ" badge — rendered only in preview Player, not in export composition.
- Same composition module imported by Player (browser) and worker (node) — guarantees parity.

---

## Render queue

- Export button → server fn creates `renders` doc (status=queued) → POSTs `{ jobId, projectSnapshot, callbackUrl, signature }` to `RENDER_WORKER_URL`.
- Worker (separate repo, provided as `worker/` folder + README): downloads assets, runs `renderMedia`, uploads MP4 to R2, calls `/api/public/render-complete` with HMAC signature.
- Collapsible queue panel polls `GET /api/renders` for live status/progress.
- Filename = first 7 words of transcript (slugified) + `.mp4`.

---

## Data model (MongoDB)

- `projects`: `{ _id, name, audioUrl, audioDuration, transcript: [{word, start, end}], createdAt, updatedAt }`
- `clips`: `{ _id, projectId, order, start, duration, imageUrl, animation, labelText, labelPreset }`
- `settings`: `{ _id: projectId, defaultLabelText, defaultFontSize, animationIntensity, musicUrl, musicVolume, presets: [{id, name, text}] }`
- `renders`: `{ _id, projectId, filename, status, progress, url, error, createdAt }`

---

## Technical sections

**Server functions (`src/server/*.functions.ts`):** `createProjectFromAudio`, `getProject`, `listProjects`, `saveProject` (debounced), `addClips`, `updateClip`, `deleteClip`, `getSettings`, `saveSettings`, `presignR2Upload`, `enqueueRender`, `listRenders`.

**Public routes:** `/api/public/render-complete` (HMAC-verified webhook), `/api/public/render-progress`.

**Why not render in Worker:** Cloudflare Workers can't run headless Chromium. Renders run on the self-hosted Node worker you provide; the app talks to it over signed HTTPS.

**Worker package (delivered in repo under `/worker`):** standalone Node service, single `POST /render` endpoint, uses `@remotion/renderer` + `@remotion/bundler`, dockerfile + README explaining how to deploy to Render/Fly/Railway and which env vars to set.

---

## Build phases

1. Scaffold: secrets, MongoDB client, R2 client (presign), AssemblyAI client, Remotion composition module shared by Player and worker.
2. Homepage: drop zone, upload→transcribe→create project flow, project list, downloads section.
3. Editor shell: AE-style layout, header (tabs, undo/redo, export), transport, transcript bar, Player preview.
4. Timeline: ruler, zoom, clip blocks, drag/trim/snap, playhead sync with Player.
5. Inspector + Left panel + Settings tab + label/preset system + Ctrl+I import + animation rules.
6. Auto-save + undo/redo history.
7. Render queue: enqueue server fn, queue panel, webhook completion, downloads.
8. Worker package + deployment README.
9. Polish: keyboard shortcuts (J/K/L, Ctrl+Z/Shift+Z, Ctrl+I), saving indicator, status badges.

After approval, I'll request the secrets and start building.
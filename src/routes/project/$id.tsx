import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { usePlayerFrame } from "@/components/editor/usePlayerFrame";
import { Film, Settings, Undo2, Redo2, Loader2, Image as ImageIcon, Play, Pause, Rewind } from "lucide-react";
import {
  enqueueRender,
  getProject,
  getRenderProgress,
  saveGlobalSettings,
  saveProject,
  type ProjectFull,
} from "@/api.functions";
import { VertiCutComposition } from "@/remotion/composition";
import { useEditor } from "@/store/editor";
import { Timeline } from "@/components/editor/Timeline";
import { Inspector } from "@/components/editor/Inspector";
import { WordTranscript } from "@/components/editor/WordTranscript";
import { SettingsPanel } from "@/components/editor/SettingsPanel";
import { useAutoSave, useTimelineActions } from "@/components/editor/hooks";
import { extractAndUploadPastedImages, uploadToR2 } from "@/lib/upload";

const OVERLAY_URL = "/GradientOverlay.png";

const FPS = 30;
const COMP_WIDTH = 1080;
const COMP_HEIGHT = 1920;

export const Route = createFileRoute("/project/$id")({
  component: EditorPage,
});

function EditorPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const playerRef = useRef<PlayerRef>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"editor" | "settings">("editor");
  const [enqueuing, setEnqueuing] = useState(false);
  const [renderJob, setRenderJob] = useState<{
    id: string;
    filename: string;
    status: "queued" | "rendering" | "done" | "error";
    progress: number;
    url?: string;
    error?: string;
  } | null>(null);
  const fileImportRef = useRef<HTMLInputElement>(null);

  const audioUrl = useEditor((s) => s.audioUrl);
  const audioDuration = useEditor((s) => s.audioDuration);
  const clips = useEditor((s) => s.clips);
  const settings = useEditor((s) => s.settings);
  const name = useEditor((s) => s.name);
  const saving = useEditor((s) => s.saving);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const initStore = useEditor((s) => s.init);

  const { addImageClips } = useTimelineActions();

  const loadProject = useCallback(async () => {
    setLoading(true);
    try {
      const p: ProjectFull = await getProject({ data: { id } });
      initStore({
        projectId: p.id,
        name: p.name,
        audioUrl: p.audioUrl,
        audioDuration: p.audioDuration,
        transcript: p.transcript,
        clips: p.clips,
        settings: p.settings,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id, initStore]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // Poll while transcription is pending
  useEffect(() => {
    if (audioDuration > 0 || loading) return;
    const t = setInterval(() => loadProject(), 4000);
    return () => clearInterval(t);
  }, [audioDuration, loading, loadProject]);

  // Autosave
  useAutoSave(async (clipsArg) => {
    await saveProject({ data: { id, clips: clipsArg } });
  });

  // Aggressively preload all clip images + the gradient overlay into the
  // browser cache. R2 sets `immutable` Cache-Control, so once an image is
  // loaded here it stays decoded for the rest of the session — scrubbing
  // and switching clips never re-downloads.
  useEffect(() => {
    const urls = new Set<string>();
    for (const c of clips) if (c.imageUrl) urls.add(c.imageUrl);
    urls.add(OVERLAY_URL);
    const imgs: HTMLImageElement[] = [];
    for (const u of urls) {
      const img = new Image();
      img.decoding = "async";
      img.src = u;
      imgs.push(img);
    }
    return () => {
      for (const i of imgs) i.src = "";
    };
  }, [clips]);

  const totalFrames = Math.max(1, Math.round(audioDuration * FPS));

  const seekTo = useCallback(
    (t: number) => {
      const frame = Math.max(0, Math.min(totalFrames - 1, Math.round(t * FPS)));
      playerRef.current?.seekTo(frame);
    },
    [totalFrames],
  );

  const [pasting, setPasting] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Global Ctrl+V image paste — uploads clipboard images (blobs or URLs) and
  // appends them as new clips. Skipped while the user is typing in any input.
  useEffect(() => {
    let cancelled = false;
    const onPaste = async (ev: ClipboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      try {
        setPasteError(null);
        const uploaded = await extractAndUploadPastedImages(ev, {
          onError: (_idx, err) => {
            setPasteError(String(err));
          },
        });
        if (!uploaded || uploaded.length === 0) return;
        ev.preventDefault();
        if (cancelled) return;
        setPasting(true);
        try {
          addImageClips(uploaded);
        } finally {
          setPasting(false);
        }
      } catch (err) {
        console.error("Paste upload failed", err);
        setPasting(false);
        setPasteError(String(err));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => {
      cancelled = true;
      window.removeEventListener("paste", onPaste);
    };
  }, [addImageClips]);

  // Keyboard shortcuts — read currentFrame from the player ref so we don't need parent state.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        fileImportRef.current?.click();
      } else if (e.key === " ") {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (e.key.toLowerCase() === "j") {
        const cur = playerRef.current?.getCurrentFrame() ?? 0;
        playerRef.current?.seekTo(Math.max(0, cur - FPS * 2));
      } else if (e.key.toLowerCase() === "k") {
        playerRef.current?.pause();
      } else if (e.key.toLowerCase() === "l") {
        playerRef.current?.play();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  async function onExport() {
    setEnqueuing(true);
    try {
      await saveProject({ data: { id, clips } });
      await saveGlobalSettings({ data: { settings } });
      const job = await enqueueRender({ data: { projectId: id } });
      setRenderJob({
        id: job.id,
        filename: job.filename,
        status: "queued",
        progress: 0,
      });
    } catch (e) {
      alert("Failed to enqueue render: " + e);
    } finally {
      setEnqueuing(false);
    }
  }

  // Poll the render server while a job is active
  useEffect(() => {
    if (!renderJob) return;
    if (renderJob.status === "done" || renderJob.status === "error") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await getRenderProgress({ data: { renderId: renderJob.id } });
        if (cancelled) return;
        setRenderJob((cur) =>
          cur && cur.id === snap.id
            ? {
                ...cur,
                status: snap.status,
                progress: snap.progress,
                url: snap.url,
                error: snap.error ?? undefined,
              }
            : cur,
        );
      } catch {
        // transient errors — keep polling
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [renderJob?.id, renderJob?.status]);

  async function onImageImport(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    for (const f of arr) {
      try {
        const res = await uploadToR2(f, "image");
        addImageClips([{ key: res.key, url: res.url }]);
      } catch (err) {
        console.error("Image import failed", err);
      }
    }
  }

  const inputProps = useMemo(
    () => ({
      audioUrl,
      musicUrl: settings.musicUrl || undefined,
      musicVolume: settings.musicVolume / 100,
      clips,
      defaultLabelText: settings.defaultLabelText,
      defaultFontSize: settings.defaultFontSize,
      intensity: settings.animationIntensity,
      durationInFrames: totalFrames,
      fps: FPS,
      overlayUrl: OVERLAY_URL,
    }),
    [
      audioUrl,
      settings.musicUrl,
      settings.musicVolume,
      settings.defaultLabelText,
      settings.defaultFontSize,
      settings.animationIntensity,
      clips,
      totalFrames,
    ],
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (error) return <div className="p-6 text-destructive">{error}</div>;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1.5">
        <Link to="/" className="flex items-center gap-1.5 text-xs hover:text-primary">
          <Film className="h-4 w-4 text-primary" />
          <span className="font-semibold tracking-wide">VERTICUT</span>
        </Link>
        <div className="mx-3 h-4 w-px bg-border" />
        <span className="truncate max-w-[280px] text-xs text-muted-foreground" title={name}>
          {name}
        </span>
        <div className="mx-2 h-4 w-px bg-border" />
        <button
          onClick={() => setTab("editor")}
          className={`rounded px-2.5 py-1 text-xs ${tab === "editor" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
        >
          Editor
        </button>
        <button
          onClick={() => setTab("settings")}
          className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${tab === "settings" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
        >
          <Settings className="h-3 w-3" /> Settings
        </button>
          <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {pasteError ? (
              <span className="text-destructive" title={pasteError}>Paste failed: {pasteError}</span>
            ) : pasting ? (
              "Pasting…"
            ) : saving === "saving" ? (
              "Saving…"
            ) : saving === "saved" ? (
              "Saved"
            ) : (
              ""
            )}
          </span>
          <GlobalLabelPresetSelect />
          <div className="h-4 w-px bg-border" />
          <button onClick={() => undo()} title="Undo (Ctrl+Z)" className="rounded p-1 hover:bg-accent">
            <Undo2 className="h-4 w-4" />
          </button>
          <button onClick={() => redo()} title="Redo (Ctrl+Shift+Z)" className="rounded p-1 hover:bg-accent">
            <Redo2 className="h-4 w-4" />
          </button>
          <button
            onClick={onExport}
            disabled={enqueuing || clips.length === 0}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {enqueuing ? "Queueing…" : "Export"}
          </button>
        </div>
      </header>

      {tab === "settings" ? (
        <div className="flex-1 overflow-auto bg-background">
          <SettingsPanel
            settings={settings}
            onChange={(patch) => useEditor.getState().updateSettings(patch)}
            onSave={async () => {
              await saveGlobalSettings({ data: { settings: useEditor.getState().settings } });
            }}
            subtitle="Saved globally — applies to every project."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-1 min-h-0">
            {/* Left: Clip Inspector */}
            <aside className="w-72 shrink-0 border-r border-border bg-panel">
              <Inspector />
            </aside>

            {/* Center preview */}
            <main className="relative flex flex-1 min-w-0 flex-col items-center justify-center gap-2 bg-track p-2">
              <button
                onClick={() => fileImportRef.current?.click()}
                className="absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded border border-border bg-panel/90 px-2.5 py-1 text-[11px] backdrop-blur hover:bg-accent"
                title="Import images (Ctrl+I)"
              >
                <ImageIcon className="h-3 w-3" /> Import images
              </button>
              <div className="relative" style={{ aspectRatio: "9 / 16", height: "min(100%, 88vh)" }}>
                <Player
                  ref={playerRef}
                  component={VertiCutComposition}
                  inputProps={inputProps}
                  durationInFrames={totalFrames}
                  fps={FPS}
                  compositionWidth={COMP_WIDTH}
                  compositionHeight={COMP_HEIGHT}
                  style={{ width: "100%", height: "100%", borderRadius: 6, border: "1px solid var(--color-border)" }}
                  controls={false}
                  acknowledgeRemotionLicense
                />
                <TimecodeBadge playerRef={playerRef} fps={FPS} />
              </div>
              {audioUrl ? (
                <PreviewAudio src={audioUrl} playerRef={playerRef} fps={FPS} />
              ) : null}
              {settings.musicUrl ? (
                <PreviewAudio
                  src={settings.musicUrl}
                  playerRef={playerRef}
                  fps={FPS}
                  volume={settings.musicVolume / 100}
                  loop
                />
              ) : null}
              <Transport
                playerRef={playerRef}
                fps={FPS}
                duration={audioDuration}
                onSeek={seekTo}
              />
            </main>

            {/* Right: word-level transcript */}
            <aside className="w-72 shrink-0 border-l border-border bg-panel">
              <WordTranscript playerRef={playerRef} fps={FPS} onSeek={seekTo} />
            </aside>
          </div>

          {/* Timeline */}
          <div className="h-48 shrink-0 border-t border-border">
            <Timeline playerRef={playerRef} fps={FPS} onSeek={seekTo} />
          </div>
        </>
      )}

      <input
        ref={fileImportRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onImageImport(e.target.files)}
      />

      {renderJob ? (
        <RenderProgressToast job={renderJob} onDismiss={() => setRenderJob(null)} />
      ) : null}
    </div>
  );
}

function RenderProgressToast({
  job,
  onDismiss,
}: {
  job: {
    id: string;
    filename: string;
    status: "queued" | "rendering" | "done" | "error";
    progress: number;
    url?: string;
    error?: string;
  };
  onDismiss: () => void;
}) {
  const isTerminal = job.status === "done" || job.status === "error";
  const label =
    job.status === "queued"
      ? "Queued…"
      : job.status === "rendering"
        ? `Rendering… ${job.progress}%`
        : job.status === "done"
          ? "Render complete"
          : "Render failed";

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-panel p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {!isTerminal ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" /> : null}
          <span className="truncate text-xs font-medium" title={job.filename}>
            {job.filename}
          </span>
        </div>
        {isTerminal ? (
          <button onClick={onDismiss} className="text-[10px] text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        ) : null}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-accent">
        <div
          className={`h-full transition-all ${job.status === "error" ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${job.status === "done" ? 100 : Math.max(2, job.progress)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        {job.status === "done" && job.url ? (
          <a
            href={job.url}
            download={job.filename}
            className="font-medium text-primary hover:underline"
          >
            Download
          </a>
        ) : null}
      </div>
      {job.error ? (
        <div className="mt-1.5 truncate text-[10px] text-destructive" title={job.error}>
          {job.error}
        </div>
      ) : null}
    </div>
  );
}

// Top-right header dropdown that bulk-applies a label preset to every clip.
// Per-clip overrides via the Inspector still work, but switching this dropdown
// re-syncs all clips to the chosen preset's text and presetId.
function GlobalLabelPresetSelect() {
  const presets = useEditor((s) => s.settings.presets);
  const defaultPresetId = useEditor((s) => s.settings.defaultPresetId);
  const updateSettings = useEditor((s) => s.updateSettings);

  if (presets.length === 0) {
    return (
      <span className="text-[10px] text-muted-foreground" title="Add presets in Settings">
        No presets
      </span>
    );
  }

  // The "Custom" preset is meant to be edited per-project — show its text
  // inline so the user can type their own label without diving into Settings.
  const isCustom = defaultPresetId === "custom";
  const customPreset = presets.find((p) => p.id === "custom");

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={defaultPresetId ?? ""}
        onChange={(e) => {
          updateSettings({ defaultPresetId: e.target.value });
        }}
        title="Preset applied to future imports only"
        className="rounded border border-border bg-panel-2 px-2 py-1 text-[11px]"
      >
        <option value="">(No preset)</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {isCustom && customPreset ? (
        <input
          value={customPreset.text}
          onChange={(e) => {
            updateSettings({
              presets: presets.map((p) =>
                p.id === "custom" ? { ...p, text: e.target.value } : p,
              ),
            });
          }}
          placeholder="Custom label text"
          title="Custom label text used for new imports"
          className="w-44 rounded border border-border bg-panel-2 px-2 py-1 text-[11px]"
        />
      ) : null}
    </div>
  );
}

function fmtTC(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * FPS);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
}

function TimecodeBadge({ playerRef, fps }: { playerRef: RefObject<PlayerRef | null>; fps: number }) {
  const frame = usePlayerFrame(playerRef);
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-mono text-white">
      {fmtTC(frame / fps)}
    </div>
  );
}

function Transport({
  playerRef,
  fps,
  duration,
  onSeek,
}: {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const frame = usePlayerFrame(playerRef);
  const currentTime = frame / fps;
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [playerRef]);

  return (
    <div className="flex w-full max-w-xl items-center gap-2 rounded border border-border bg-panel px-3 py-1.5 text-xs">
      <button onClick={() => onSeek(0)} className="rounded p-1 hover:bg-accent" title="Rewind">
        <Rewind className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => playerRef.current?.toggle()} className="rounded p-1 hover:bg-accent" title="Play/Pause (Space)">
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <span className="font-mono text-[11px] text-muted-foreground">
        {fmtTC(currentTime)} / {fmtTC(duration)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={1 / fps}
        value={currentTime}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="ml-2 flex-1"
      />
      <span className="text-[10px] text-muted-foreground">J K L</span>
    </div>
  );
}

// Drives a hidden HTMLAudioElement off the Player's events. Browser audio clock
// is the source of truth; we re-anchor on play / seek / drift so frame-time
// (Remotion) and wall-clock time (audio) stay aligned.
const DRIFT_HARD = 0.12; // seconds — correct immediately if we drift more than this
const DRIFT_CHECK_MS = 250;

function PreviewAudio({
  src,
  playerRef,
  fps,
  volume = 1,
  loop = false,
}: {
  src: string;
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  volume?: number;
  loop?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    const player = playerRef.current;
    if (!audio || !player) return;

    const targetTime = () => player.getCurrentFrame() / fps;
    const sync = () => {
      const t = targetTime();
      if (Math.abs(audio.currentTime - t) > DRIFT_HARD) {
        audio.currentTime = t;
      }
    };
    const hardSync = () => {
      audio.currentTime = targetTime();
    };

    let driftTimer: number | undefined;
    const startDriftCheck = () => {
      if (driftTimer != null) return;
      driftTimer = window.setInterval(sync, DRIFT_CHECK_MS);
    };
    const stopDriftCheck = () => {
      if (driftTimer != null) {
        window.clearInterval(driftTimer);
        driftTimer = undefined;
      }
    };

    const handlingPlayRef = { current: false } as { current: boolean };

    const onPlay = async () => {
      if (handlingPlayRef.current) return;
      handlingPlayRef.current = true;
      try {
        // Ensure audio is at the player's current time, then start audio
        hardSync();
        // Pause the player until audio has started to avoid running ahead
        try {
          player.pause();
        } catch {}
        await audio.play();
        try {
          player.play();
        } catch {}
        startDriftCheck();
      } catch (_) {
        // ignore play errors
      } finally {
        handlingPlayRef.current = false;
      }
    };
    const onPause = () => {
      if (handlingPlayRef.current) return;
      audio.pause();
      stopDriftCheck();
      hardSync();
    };
    const onSeeked = () => {
      hardSync();
    };
    const onRateChange = () => {
      const rate = (player as unknown as { getPlaybackRate?: () => number }).getPlaybackRate?.() ?? 1;
      audio.playbackRate = rate;
    };
    const onEnded = () => {
      audio.pause();
      stopDriftCheck();
    };

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("seeked", onSeeked);
    player.addEventListener("ratechange", onRateChange);
    player.addEventListener("ended", onEnded);

    // Initial sync in case user seeks before pressing play
    hardSync();

    return () => {
      stopDriftCheck();
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("seeked", onSeeked);
      player.removeEventListener("ratechange", onRateChange);
      player.removeEventListener("ended", onEnded);
      audio.pause();
    };
  }, [playerRef, fps, src]);

  return (
    <audio
      ref={audioRef}
      src={src}
      preload="auto"
      loop={loop}
      style={{ display: "none" }}
    />
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Film, Settings, Undo2, Redo2, Loader2, Plus, Image as ImageIcon, Play, Pause, Rewind, Square } from "lucide-react";
import {
  enqueueRender,
  getProject,
  saveProject,
  saveSettings,
  type ProjectFull,
} from "@/server/api.functions";
import { VertiCutComposition } from "@/remotion/composition";
import { useEditor } from "@/store/editor";
import { Timeline } from "@/components/editor/Timeline";
import { TranscriptBar } from "@/components/editor/TranscriptBar";
import { Inspector } from "@/components/editor/Inspector";
import { SettingsPanel } from "@/components/editor/SettingsPanel";
import { useAutoSave, useTimelineActions } from "@/components/editor/hooks";
import { uploadToR2 } from "@/lib/upload";

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
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [enqueuing, setEnqueuing] = useState(false);
  const fileImportRef = useRef<HTMLInputElement>(null);

  const ed = useEditor();
  const { addImageClips } = useTimelineActions();

  const loadProject = useCallback(async () => {
    setLoading(true);
    try {
      const p: ProjectFull = await getProject({ data: { id } });
      ed.init({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // Poll while transcription is pending
  useEffect(() => {
    if (ed.audioDuration > 0 || loading) return;
    const t = setInterval(() => loadProject(), 4000);
    return () => clearInterval(t);
  }, [ed.audioDuration, loading, loadProject]);

  // Sync currentFrame from player
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setCurrentFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame as never);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame as never);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [loading]);

  // Autosave
  useAutoSave(async (clips) => {
    await saveProject({ data: { id, clips } });
  });

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        ed.undo();
      } else if (e.ctrlKey && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        ed.redo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        fileImportRef.current?.click();
      } else if (e.key === " ") {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (e.key.toLowerCase() === "j") {
        playerRef.current?.seekTo(Math.max(0, currentFrame - FPS * 2));
      } else if (e.key.toLowerCase() === "k") {
        playerRef.current?.pause();
      } else if (e.key.toLowerCase() === "l") {
        playerRef.current?.play();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ed, currentFrame]);

  const totalFrames = Math.max(1, Math.round(ed.audioDuration * FPS));
  const currentTime = currentFrame / FPS;

  function seekTo(t: number) {
    playerRef.current?.seekTo(Math.round(t * FPS));
  }

  async function onExport() {
    setEnqueuing(true);
    try {
      // Save first
      await saveProject({ data: { id, clips: ed.clips } });
      await saveSettings({ data: { id, settings: ed.settings } });
      await enqueueRender({ data: { projectId: id } });
    } catch (e) {
      alert("Failed to enqueue render: " + e);
    } finally {
      setEnqueuing(false);
    }
  }

  async function onImageImport(files: FileList | null) {
    if (!files || files.length === 0) return;
    const uploaded = await Promise.all(Array.from(files).map((f) => uploadToR2(f, "image")));
    addImageClips(uploaded);
  }

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
        <span className="truncate max-w-[280px] text-xs text-muted-foreground" title={ed.name}>
          {ed.name}
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
            {ed.saving === "saving" ? "Saving…" : ed.saving === "saved" ? "Saved" : ""}
          </span>
          <button onClick={() => ed.undo()} title="Undo (Ctrl+Z)" className="rounded p-1 hover:bg-accent">
            <Undo2 className="h-4 w-4" />
          </button>
          <button onClick={() => ed.redo()} title="Redo (Ctrl+Shift+Z)" className="rounded p-1 hover:bg-accent">
            <Redo2 className="h-4 w-4" />
          </button>
          <button
            onClick={onExport}
            disabled={enqueuing || ed.clips.length === 0}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {enqueuing ? "Queueing…" : "Export"}
          </button>
        </div>
      </header>

      {tab === "settings" ? (
        <div className="flex-1 overflow-auto bg-background">
          <SettingsPanel
            onSave={async () => {
              await saveSettings({ data: { id, settings: ed.settings } });
            }}
          />
        </div>
      ) : (
        <>
          <TranscriptBar currentTime={currentTime} onSeek={seekTo} />

          <div className="flex flex-1 min-h-0">
            {/* Left panel */}
            <aside className="w-56 shrink-0 border-r border-border bg-panel">
              <LeftPanel onImport={() => fileImportRef.current?.click()} />
            </aside>

            {/* Center preview */}
            <main className="flex flex-1 min-w-0 flex-col items-center justify-center gap-3 bg-track p-4">
              <div className="relative" style={{ aspectRatio: "9 / 16", height: "min(100%, 70vh)" }}>
                <Player
                  ref={playerRef}
                  component={VertiCutComposition}
                  inputProps={{
                    audioUrl: ed.audioUrl,
                    musicUrl: ed.settings.musicUrl || undefined,
                    musicVolume: ed.settings.musicVolume / 100,
                    clips: ed.clips,
                    defaultLabelText: ed.settings.defaultLabelText,
                    defaultFontSize: ed.settings.defaultFontSize,
                    intensity: ed.settings.animationIntensity,
                    durationInFrames: totalFrames,
                    fps: FPS,
                  }}
                  durationInFrames={totalFrames}
                  fps={FPS}
                  compositionWidth={COMP_WIDTH}
                  compositionHeight={COMP_HEIGHT}
                  style={{ width: "100%", height: "100%", borderRadius: 6, border: "1px solid var(--color-border)" }}
                  controls={false}
                  acknowledgeRemotionLicense
                />
                <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white">
                  LQ
                </div>
                <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-mono text-white">
                  {fmtTC(currentTime)}
                </div>
              </div>
              <Transport
                playing={playing}
                onPlay={() => playerRef.current?.toggle()}
                onRewind={() => playerRef.current?.seekTo(0)}
                currentTime={currentTime}
                duration={ed.audioDuration}
                onSeek={seekTo}
              />
            </main>

            {/* Right inspector */}
            <aside className="w-72 shrink-0 border-l border-border bg-panel">
              <Inspector />
            </aside>
          </div>

          {/* Timeline */}
          <div className="h-48 shrink-0 border-t border-border">
            <Timeline currentTime={currentTime} onSeek={seekTo} />
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
    </div>
  );
}

function fmtTC(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * FPS);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
}

function LeftPanel({ onImport }: { onImport: () => void }) {
  const { name, audioDuration, clips, settings } = useEditor();
  return (
    <div className="space-y-4 p-3 text-xs">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Project</h3>
      <div className="space-y-1.5 rounded border border-border bg-panel-2 p-2">
        <div className="truncate font-medium" title={name}>{name}</div>
        <div className="flex justify-between text-muted-foreground">
          <span>Duration</span>
          <span>{audioDuration.toFixed(2)}s</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Clips</span>
          <span>{clips.length}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Intensity</span>
          <span>{settings.animationIntensity.toFixed(1)}×</span>
        </div>
      </div>
      <button
        onClick={onImport}
        className="flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
      >
        <ImageIcon className="h-3 w-3" /> Import images (Ctrl+I)
      </button>
      <p className="text-[10px] text-muted-foreground">
        Drop or import images. They're appended to the timeline with the active label preset.
      </p>
    </div>
  );
}

function Transport({
  playing,
  onPlay,
  onRewind,
  currentTime,
  duration,
  onSeek,
}: {
  playing: boolean;
  onPlay: () => void;
  onRewind: () => void;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  return (
    <div className="flex w-full max-w-xl items-center gap-2 rounded border border-border bg-panel px-3 py-1.5 text-xs">
      <button onClick={onRewind} className="rounded p-1 hover:bg-accent" title="Rewind">
        <Rewind className="h-3.5 w-3.5" />
      </button>
      <button onClick={onPlay} className="rounded p-1 hover:bg-accent" title="Play/Pause (Space)">
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <span className="font-mono text-[11px] text-muted-foreground">
        {fmtTC(currentTime)} / {fmtTC(duration)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={1 / FPS}
        value={currentTime}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="ml-2 flex-1"
      />
      <span className="text-[10px] text-muted-foreground">J K L</span>
    </div>
  );
}

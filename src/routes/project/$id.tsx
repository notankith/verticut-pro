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
import { extractAndUploadImagesFromClipboard, extractAndUploadPastedImages, uploadToR2 } from "@/lib/upload";
import { getTemplateById, TEMPLATES } from "@/lib/templates";

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
  const frameForSync = usePlayerFrame(playerRef);
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
  const previewDropRef = useRef<HTMLElement | null>(null);
  const dragDepthRef = useRef(0);

  // Timeline height (resizable)
  const [timelineHeight, setTimelineHeight] = useState<number>(192);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Sync player frame -> editor currentTime
  const setEditorState = useEditor((s) => s.set);
  useEffect(() => {
    const fpsLocal = FPS;
    setEditorState({ currentTime: Math.max(0, (frameForSync ?? 0) / fpsLocal) });
  }, [frameForSync, setEditorState]);

  const audioUrl = useEditor((s) => s.audioUrl);
  const audioDuration = useEditor((s) => s.audioDuration);
  const clips = useEditor((s) => s.clips);
  const settings = useEditor((s) => s.settings);
  const name = useEditor((s) => s.name);
  const saving = useEditor((s) => s.saving);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const initStore = useEditor((s) => s.init);

  const { addImageClips, deleteClip, splitClip, splitAudioAt } = useTimelineActions();

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
        markers: p.markers,
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
    for (const c of clips) {
      if (c.imageUrl) urls.add(c.imageUrl);
      if (c.splitScreen?.bottomImageUrl) urls.add(c.splitScreen.bottomImageUrl);
    }
    const tpl = getTemplateById(settings.activeTemplateId);
    if (tpl?.overlayUrl) {
      urls.add(tpl.overlayUrl);
    }
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
  }, [clips, settings.activeTemplateId]);

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
  // appends them as new clips. Uses both paste-event data and Clipboard API
  // fallback to make image paste resilient across browsers/contexts.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const looksLikeImagePaste = (ev: ClipboardEvent) => {
      const cd = ev.clipboardData;
      if (!cd) return false;
      const hasImageItem = Array.from(cd.items).some(
        (it) => it.kind === "file" && /^image\//i.test(it.type),
      );
      if (hasImageItem) return true;
      const html = cd.getData("text/html");
      if (html && /<img[^>]+src=/i.test(html)) return true;
      return false;
    };

    const onPaste = async (ev: ClipboardEvent) => {
      if (inFlight) return;
      inFlight = true;

      const shouldIntercept = looksLikeImagePaste(ev);
      if (shouldIntercept) ev.preventDefault();

      try {
        setPasteError(null);

        let uploaded = await extractAndUploadPastedImages(ev, {
          onError: (_idx, err) => {
            setPasteError(String(err));
          },
        });

        // Some environments fire paste with empty/partial clipboardData.
        if (!uploaded || uploaded.length === 0) {
          uploaded = await extractAndUploadImagesFromClipboard({
            onError: (_idx, err) => {
              setPasteError(String(err));
            },
          });
        }

        if (!uploaded || uploaded.length === 0) return;
        if (cancelled) return;
        setPasting(true);
        try {
          const { selectedClipId, clips: storeClips } = useEditor.getState();
          const selClip = storeClips.find((c) => c.id === selectedClipId);
          if (selClip?.splitScreen?.enabled && !selClip.splitScreen.bottomImageUrl && uploaded[0]) {
            useEditor.getState().updateClips((prev) =>
              prev.map((c) =>
                c.id === selectedClipId
                  ? { ...c, splitScreen: { ...c.splitScreen!, bottomImageKey: uploaded![0].key, bottomImageUrl: uploaded![0].url } }
                  : c,
              ),
            );
          } else {
            addImageClips(uploaded);
          }
        } finally {
          setPasting(false);
        }
      } catch (err) {
        console.error("Paste upload failed", err);
        setPasting(false);
        setPasteError(String(err));
      } finally {
        inFlight = false;
      }
    };

    document.addEventListener("paste", onPaste, { capture: true });
    return () => {
      cancelled = true;
      document.removeEventListener("paste", onPaste, { capture: true });
    };
  }, [addImageClips]);

  // Keyboard shortcuts — read currentFrame from the player ref so we don't need parent state.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
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
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const { selectedClipId } = useEditor.getState();
        if (!selectedClipId) return;
        e.preventDefault();
        deleteClip(selectedClipId);
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        // Cut / split selected layer at playhead
        e.preventDefault();
        const sel = useEditor.getState().selectedClipId;
        const time = (playerRef.current?.getCurrentFrame() ?? 0) / FPS;
        if (sel && sel !== "VOICEOVER") {
          splitClip(sel, time);
        } else if (sel === "VOICEOVER") {
          splitAudioAt(time);
        }
      } else if (e.key.toLowerCase() === "j") {
        const cur = playerRef.current?.getCurrentFrame() ?? 0;
        playerRef.current?.seekTo(Math.max(0, cur - FPS * 2));
      } else if (e.key.toLowerCase() === "k") {
        playerRef.current?.pause();
      } else if (e.key.toLowerCase() === "l") {
        playerRef.current?.play();
      } else if (!e.ctrlKey && !e.metaKey && ["1", "2", "3"].includes(e.key)) {
        const idx = Number(e.key) - 1;
        const presets = useEditor.getState().settings.presets;
        const preset = presets[idx];
        if (!preset) return;
        e.preventDefault();
        useEditor.getState().updateSettings({ defaultPresetId: preset.id });
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [undo, redo, deleteClip, splitClip, splitAudioAt]);

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

  const [dragOver, setDragOver] = useState(false);

  const onImageImport = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    for (const f of arr) {
      try {
        const res = await uploadToR2(f, "image");
        addImageClips([{ key: res.key, url: res.url }]);
      } catch (err) {
        console.error("Image import failed", err);
      }
    }
  }, [addImageClips]);

  // Prevent browser navigation when a file is dropped anywhere in the app.
  useEffect(() => {
    if (tab !== "editor") return;

    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const preventWindowNavigation = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.type !== "drop") return;

      // Import regardless of drop target so users can drop anywhere in editor mode.
      const files = e.dataTransfer?.files;
      if (!files) return;
      const mediaFiles = Array.from(files).filter((f) =>
        /image|video|media|webm|mp4|mov|png|jpg|jpeg|gif|webp/i.test(`${f.type} ${f.name}`),
      );
      if (mediaFiles.length === 0) return;
      e.stopPropagation();
      onImageImport(mediaFiles);
    };

    window.addEventListener("dragover", preventWindowNavigation, { capture: true });
    window.addEventListener("drop", preventWindowNavigation, { capture: true });

    return () => {
      window.removeEventListener("dragover", preventWindowNavigation, { capture: true });
      window.removeEventListener("drop", preventWindowNavigation, { capture: true });
    };
  }, [tab]);

  // Stable drag/drop handlers scoped to the preview area.
  useEffect(() => {
    if (tab !== "editor") return;
    const el = previewDropRef.current;
    if (!el) return;

    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    function handleDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragOver(true);
    }

    function handleDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }

    function handleDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragOver(false);
    }

    function handleDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragOver(false);
    }

    el.addEventListener("dragenter", handleDragEnter);
    el.addEventListener("dragover", handleDragOver);
    el.addEventListener("dragleave", handleDragLeave);
    el.addEventListener("drop", handleDrop);

    return () => {
      dragDepthRef.current = 0;
      setDragOver(false);
      el.removeEventListener("dragenter", handleDragEnter);
      el.removeEventListener("dragover", handleDragOver);
      el.removeEventListener("dragleave", handleDragLeave);
      el.removeEventListener("drop", handleDrop);
    };
  }, [tab, addImageClips, onImageImport]);

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
      overlayUrl: getTemplateById(settings.activeTemplateId)?.overlayUrl,
      templateWindow: settings.templateWindow,
      enableTransitions: settings.transitionAnimation ?? true,
    }),
    [
      audioUrl,
      settings.musicUrl,
      settings.musicVolume,
      settings.defaultLabelText,
      settings.defaultFontSize,
      settings.animationIntensity,
      settings.transitionAnimation,
      settings.activeTemplateId,
      settings.templateWindow,
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
            <aside className="w-72 shrink-0 overflow-hidden border-r border-border bg-panel">
              <Inspector />
            </aside>

            {/* Center preview */}
            <main
              ref={previewDropRef}
              className={`relative flex flex-1 min-w-0 flex-col items-center justify-center gap-2 bg-track p-2 transition-colors ${dragOver ? "bg-primary/10 ring-2 ring-primary" : ""}`}
            >
              {dragOver && (
                <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-primary/5 backdrop-blur-sm">
                  <div className="text-center">
                    <ImageIcon className="h-8 w-8 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium text-primary">Drop images or media to import</p>
                  </div>
                </div>
              )}
              <button
                onClick={() => setTemplatesOpen(true)}
                className="absolute right-40 top-2 z-10 flex items-center gap-1.5 rounded border border-border bg-panel/90 px-2.5 py-1 text-[11px] backdrop-blur hover:bg-accent"
                title="Templates"
              >
                Templates
              </button>
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

          {/* Timeline: resizable */}
          <div
            className="border-t border-border"
            style={{ height: timelineHeight }}
          >
            {/* Divider / handle */}
            <div
              onPointerDown={(e) => {
                const startY = e.clientY;
                const startH = timelineHeight;
                const root = document.documentElement;
                try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
                const move = (ev: PointerEvent) => {
                  const dy = ev.clientY - startY;
                  const next = Math.max(80, Math.min(window.innerHeight * 0.8, startH - dy));
                  setTimelineHeight(next);
                };
                const up = (ev: PointerEvent) => {
                  try { (e.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId); } catch {}
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
              className="cursor-row-resize bg-panel/60 h-2 w-full"
            />
            <Timeline playerRef={playerRef} fps={FPS} onSeek={seekTo} />
          </div>
        </>
      )}

      {/* Templates modal */}
      {templatesOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded bg-panel p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Templates</h4>
              <button onClick={() => setTemplatesOpen(false)} className="text-[12px] text-muted-foreground">Close</button>
            </div>
            <div className="mt-3 space-y-2">
              <button
                onClick={() => {
                  useEditor.getState().updateSettings({ activeTemplateId: null });
                  setTemplatesOpen(false);
                }}
                className="w-full rounded border border-border px-2 py-2 text-left hover:bg-accent"
              >
                <div className="font-medium">No template</div>
                <div className="text-[12px] text-muted-foreground">Plain preview with no overlay</div>
              </button>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    useEditor.getState().updateSettings({ activeTemplateId: t.id });
                    setTemplatesOpen(false);
                  }}
                  className="w-full rounded border border-border px-2 py-2 text-left hover:bg-accent"
                >
                  <div className="font-medium">{t.name}</div>
                  <div className="text-[12px] text-muted-foreground">Overlay: {t.overlayUrl}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

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

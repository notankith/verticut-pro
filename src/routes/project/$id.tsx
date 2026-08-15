import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { usePlayerFrame } from "@/components/editor/usePlayerFrame";
import { Film, Settings, Undo2, Redo2, Loader2, Image as ImageIcon, Play, Pause, Rewind, Clock, Plus, Minus, FileText, Square, Type, DownloadCloud, Search as SearchIcon, ChevronDown, Pencil, Share, Sparkles } from "lucide-react";
import {
  enqueueRender,
  getProject,
  getRenderProgress,
  saveGlobalSettings,
  saveProject,
  type ProjectFull,
} from "@/api.functions";
import { VertiCutComposition, resolveProxyUrl, logDiagnostic } from "@/remotion/composition";
import { useEditor } from "@/store/editor";
import { Timeline } from "@/components/editor/Timeline";
import { ImportSourcingModal } from "@/components/editor/ImportSourcingModal";
import { AutoEditModal } from "@/components/editor/AutoEditModal";
import { AnimationPanel, MediaPanel, CaptionsPanel } from "@/components/editor/Inspector";
import { WordTranscript } from "@/components/editor/WordTranscript";
import { SettingsPanel } from "@/components/editor/SettingsPanel";
import { useAutoSave, useTimelineActions, findNextStart } from "@/components/editor/hooks";
import { extractAndUploadImagesFromClipboard, extractAndUploadPastedImages, fetchAndUploadImageUrl, uploadToR2 } from "@/lib/upload";
import { getTemplateById, TEMPLATES } from "@/lib/templates";
import type { AudioSegment, ClipDoc } from "@/server/mongo.server";
import { renderMediaOnWeb } from "@remotion/web-renderer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


const FPS = 30;
const COMP_WIDTH = 1080;
const COMP_HEIGHT = 1920;
const GRADIENT_OVERLAY_URL = "https://i.ibb.co/C5phXbpz/Gradient-Overlay.png";
const MediaDownloadModal = lazy(() => import("@/components/editor/MediaDownloadModal"));
const SearchMediaPanel = lazy(() => import("@/components/editor/SearchMediaPanel"));

// Define global diagnostic logger attachments and fetch intercepts
if (typeof window !== "undefined") {
  (window as any).__clientRenderLogs = (window as any).__clientRenderLogs || [];
  (window as any).__addClientRenderLog = (
    category: "render" | "image" | "remotion" | "proxy" | "browser",
    level: "info" | "success" | "warning" | "error",
    message: string,
    details?: any
  ) => {
    const timestamp = new Date().toLocaleTimeString("it-IT"); // "HH:MM:SS"
    const logEntry = { timestamp, category, level, message, details };
    (window as any).__clientRenderLogs.push(logEntry);
    window.dispatchEvent(new CustomEvent("client-render-log-added", { detail: logEntry }));
  };

  (window as any).__imageRequestCounts = (window as any).__imageRequestCounts || {};
  (window as any).__trackImageRequest = (url: string, method: string) => {
    const counts = (window as any).__imageRequestCounts;
    const timestamp = new Date().toLocaleTimeString("it-IT");
    if (counts[url]) {
      counts[url].count += 1;
      const count = counts[url].count;
      (window as any).__addClientRenderLog(
        "image",
        "warning",
        `[IMAGE] DUPLICATE REQUEST\nURL: ${url}\ncount: ${count}\nfirst request: ${counts[url].first}\nlatest request: ${timestamp}\nmethod: ${method}`
      );
    } else {
      counts[url] = { count: 1, first: timestamp };
    }
  };

  // Intercept fetch to track proxy network calls
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const urlStr = typeof input === "string" ? input : (input as any).url || "";
    const isProxy = urlStr.includes("/api/proxy-image");
    if (isProxy) {
      (window as any).__addClientRenderLog("proxy", "info", `[PROXY] REQUEST\nurl: ${urlStr}`);
    }
    try {
      const response = await originalFetch(input, init);
      if (isProxy) {
        (window as any).__addClientRenderLog(
          "proxy",
          response.ok ? "success" : "error",
          `[PROXY] RESPONSE\nstatus: ${response.status}\nok: ${response.ok}\ncontent-type: ${response.headers.get("content-type") || ""}\nresponse URL: ${response.url}`
        );
      }
      return response;
    } catch (err) {
      if (isProxy) {
        (window as any).__addClientRenderLog("proxy", "error", `[PROXY] FAILED\nurl: ${urlStr}\nerror: ${String(err)}`);
      }
      throw err;
    }
  };
}

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

  const [clientRenderProgress, setClientRenderProgress] = useState<number | null>(null);
  const [clientRenderEstimatedTime, setClientRenderEstimatedTime] = useState<number | null>(null);
  const [clientRenderFileUrl, setClientRenderFileUrl] = useState<string | null>(null);
  const [clientRenderError, setClientRenderError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ timestamp: string; category: string; level: string; message: string; details?: any }[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  const copyLogs = useCallback(() => {
    const text = logs.map(l => `${l.timestamp} [${l.category.toUpperCase()}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
  }, [logs]);

  const clearLogs = useCallback(() => {
    if (typeof window !== "undefined") {
      (window as any).__clientRenderLogs = [];
      (window as any).__imageRequestCounts = {};
    }
    setLogs([]);
  }, []);

  // Auto-scroll logic
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Listen to CustomEvent for diagnostic logging
  useEffect(() => {
    const handleLog = (ev: Event) => {
      const entry = (ev as CustomEvent).detail;
      if (entry === null) {
        setLogs([]);
      } else {
        setLogs((prev) => [...prev, entry]);
      }
    };
    window.addEventListener("client-render-log-added", handleLog);
    return () => window.removeEventListener("client-render-log-added", handleLog);
  }, []);

  // Set up global error capture
  useEffect(() => {
    const onError = (msg: string | Event, url?: string, line?: number, col?: number, error?: Error) => {
      if (typeof window !== "undefined" && (window as any).__addClientRenderLog) {
        (window as any).__addClientRenderLog(
          "browser",
          "error",
          `[BROWSER ERROR]\nmessage: ${msg}\nsource: ${url}:${line}:${col}\nstack: ${error?.stack || ""}`
        );
      }
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (typeof window !== "undefined" && (window as any).__addClientRenderLog) {
        (window as any).__addClientRenderLog(
          "browser",
          "error",
          `[BROWSER ERROR]\nunhandled rejection: ${String(event.reason)}`
        );
      }
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  // Timeline height (resizable)
  const [timelineHeight, setTimelineHeight] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("verticut_timeline_height");
      return saved ? Math.max(120, parseInt(saved, 10)) : 380;
    }
    return 380;
  });
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const [sourcingModalOpen, setSourcingModalOpen] = useState(false);
  const [mediaDownloadOpen, setMediaDownloadOpen] = useState(false);
  const [searchMediaOpen, setSearchMediaOpen] = useState(false);
  const [autoEditOpen, setAutoEditOpen] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"search" | "animation" | "media" | "captions">("search");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const mediaTimeoutRef = useRef<any>(null);
  const newTimeoutRef = useRef<any>(null);

  // Sync player frame -> editor currentTime
  const setEditorState = useEditor((s) => s.set);
  useEffect(() => {
    const fpsLocal = FPS;
    setEditorState({ currentTime: Math.max(0, (frameForSync ?? 0) / fpsLocal) });
  }, [frameForSync, setEditorState]);

  const audioUrl = useEditor((s) => s.audioUrl);
  const audioDuration = useEditor((s) => s.audioDuration);
  const audioSegments = useEditor((s) => s.audioSegments);
  const clips = useEditor((s) => s.clips);
  const settings = useEditor((s) => s.settings);
  const transcript = useEditor((s) => s.transcript);
  const name = useEditor((s) => s.name);
  const selectedClipId = useEditor((s) => s.selectedClipId);

  const isImportingFromSearchRef = useRef(false);

  // Auto-focus Animation tab when a media clip is selected
  useEffect(() => {
    if (!selectedClipId) return;
    if (isImportingFromSearchRef.current) {
      isImportingFromSearchRef.current = false;
      return;
    }
    const clip = clips.find((c) => c.id === selectedClipId);
    if (clip && clip.kind === "media") {
      setActiveSidebarTab("animation");
    }
  }, [selectedClipId, clips]);

  // Project renaming states
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(name);
  useEffect(() => {
    setEditName(name);
  }, [name]);

  const handleRenameSave = useCallback(async () => {
    setIsEditingName(false);
    const trimmed = editName.trim();
    if (trimmed && trimmed !== name) {
      useEditor.getState().set({ name: trimmed });
      await saveProject({ data: { id, clips: useEditor.getState().clips, name: trimmed } });
    } else {
      setEditName(name);
    }
  }, [editName, name, id]);
  const saving = useEditor((s) => s.saving);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const initStore = useEditor((s) => s.init);
  const updateClips = useEditor((s) => s.updateClips);

  const { addImageClips, deleteClip, splitClip, splitAudioAt, deleteAudioSegment } = useTimelineActions();

  const updateCompositionDuration = useCallback((newDur: number) => {
    const currentSegments = useEditor.getState().audioSegments;
    const oldDur = useEditor.getState().audioDuration;
    let nextSegments = currentSegments.slice();

    if (currentSegments.length === 1 && currentSegments[0].duration === oldDur) {
      nextSegments[0] = { ...currentSegments[0], duration: newDur };
    }

    useEditor.getState().set({
      audioDuration: newDur,
      audioSegments: nextSegments,
    });
  }, []);

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
        audioSegments: p.audioSegments ?? [],
        selectedClipIds: [],
        hideMedia: false,
        hideOverlays: false,
        muteAudio: false,
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
  useAutoSave(
    async (clipsArg, audioDurationArg, audioSegmentsArg) => {
      await saveProject({ data: { id, clips: clipsArg, audioDuration: audioDurationArg, audioSegments: audioSegmentsArg } });
    },
    async (settingsArg) => {
      await saveGlobalSettings({ data: { settings: settingsArg } });
    }
  );

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
    if (settings.enableGradientOverlay ?? true) {
      urls.add(GRADIENT_OVERLAY_URL);
    }
    const imgs: HTMLImageElement[] = [];
    for (const u of urls) {
      const img = new Image();
      img.decoding = "async";
      img.crossOrigin = "anonymous";

      const resolved = resolveProxyUrl(u);

      // Duplication check
      if (typeof window !== "undefined" && (window as any).__trackImageRequest) {
        (window as any).__trackImageRequest(u, "preload");
      }

      logDiagnostic(
        "image",
        "info",
        `[IMAGE] REQUEST\noriginal: ${u}\nresolved: ${resolved}\ncrossOrigin: anonymous\nloading method: preload`
      );

      // Silent HEAD check for proxy diagnostics
      if (resolved.includes("/api/proxy-image")) {
        fetch(resolved, { method: "HEAD" }).catch(() => { });
      }

      img.onload = () => {
        logDiagnostic(
          "image",
          "success",
          `[IMAGE] LOADED\nURL: ${u}\nnaturalWidth: ${img.naturalWidth}\nnaturalHeight: ${img.naturalHeight}\nloading method: preload`
        );
      };

      img.onerror = (err) => {
        logDiagnostic(
          "image",
          "error",
          `[IMAGE] FAILED\noriginal URL: ${u}\nresolved URL: ${resolved}\ncrossOrigin: anonymous\nloading method: preload\nerror message: ${String(err)}`
        );
      };

      img.src = resolved;
      imgs.push(img);
    }
    return () => {
      for (const i of imgs) i.src = "";
    };
  }, [clips, settings.activeTemplateId, settings.enableGradientOverlay]);

  const totalFrames = Math.max(1, Math.round(audioDuration * FPS));

  const seekTo = useCallback(
    (t: number) => {
      const frame = Math.max(0, Math.min(totalFrames - 1, Math.round(t * FPS)));
      playerRef.current?.seekTo(frame);
      useEditor.getState().set({ currentTime: frame / FPS });
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

  const onSearchMediaImport = useCallback(async (imageUrl: string) => {
    try {
      isImportingFromSearchRef.current = true;
      addImageClips([{ key: imageUrl, url: imageUrl }]);
      const selectedId = useEditor.getState().selectedClipId;
      const inserted = useEditor.getState().clips.find((c) => c.id === selectedId);
      if (inserted) {
        seekTo(inserted.start);
      }
    } catch (err) {
      console.error("Search media import failed:", err);
      isImportingFromSearchRef.current = false;
    }
  }, [addImageClips, seekTo]);

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
        const { selectedClipId, clips: storeClips, audioSegments: storeSegs } = useEditor.getState();
        if (!selectedClipId) return;
        e.preventDefault();
        const isVisualClip = storeClips.some((c) => c.id === selectedClipId);
        const isAudioSegment = storeSegs.some((s) => s.id === selectedClipId);
        if (isVisualClip) {
          deleteClip(selectedClipId);
        } else if (isAudioSegment) {
          deleteAudioSegment(selectedClipId);
        }
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        // Cut / split selected layer at playhead
        e.preventDefault();
        const { selectedClipId, clips: storeClips, audioSegments: storeSegs } = useEditor.getState();
        const time = (playerRef.current?.getCurrentFrame() ?? 0) / FPS;
        const isVisualClip = storeClips.some((c) => c.id === selectedClipId);
        const isAudioSegment = storeSegs.some((s) => s.id === selectedClipId);
        if (isVisualClip && selectedClipId) {
          splitClip(selectedClipId, time);
        } else if (isAudioSegment || selectedClipId === "VOICEOVER") {
          splitAudioAt(time);
        }
      } else if (e.key.toLowerCase() === "j") {
        const cur = playerRef.current?.getCurrentFrame() ?? 0;
        playerRef.current?.seekTo(Math.max(0, cur - FPS * 2));
      } else if (e.key.toLowerCase() === "k") {
        playerRef.current?.pause();
      } else if (e.key.toLowerCase() === "l") {
        playerRef.current?.play();
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

  function scanMP4Tracks(arrayBuffer: ArrayBuffer) {
    const view = new DataView(arrayBuffer);
    const len = view.byteLength;
    let soundTrackFound = false;
    let mp4aCodecFound = false;
    let trackCount = 0;

    for (let i = 0; i < len - 4; i += 1) {
      const c1 = view.getUint8(i);
      const c2 = view.getUint8(i + 1);
      const c3 = view.getUint8(i + 2);
      const c4 = view.getUint8(i + 3);

      if (c1 === 116 && c2 === 114 && c3 === 97 && c4 === 107) { // 'trak'
        trackCount++;
      }
      if (c1 === 115 && c2 === 111 && c3 === 117 && c4 === 110) { // 'soun'
        soundTrackFound = true;
      }
      if (c1 === 109 && c2 === 112 && c3 === 52 && c4 === 97) { // 'mp4a'
        mp4aCodecFound = true;
      }
    }

    return {
      trackCount,
      soundTrackFound,
      mp4aCodecFound,
    };
  }

  async function onClientRender() {
    setClientRenderError(null);
    setClientRenderFileUrl(null);
    setClientRenderProgress(0);
    setClientRenderEstimatedTime(null);

    // RESET log buffers
    if (typeof window !== "undefined") {
      (window as any).__clientRenderLogs = [];
      (window as any).__imageRequestCounts = {};
      window.dispatchEvent(new CustomEvent("client-render-log-added", { detail: null }));
    }

    logDiagnostic("render", "info", `[RENDER] START`);
    logDiagnostic("render", "info", `[RENDER] Preparing`);
    logDiagnostic("render", "info", `[RENDER] Configuration:\n- Composition ID: verticut-video\n- Width: ${COMP_WIDTH}\n- Height: ${COMP_HEIGHT}\n- FPS: ${FPS}\n- Duration: ${audioDuration}s\n- Total frames: ${totalFrames}\n- Current URL: ${window.location.href}\n- Render mode: Browser Client Render\n- Host origin: ${window.location.origin}`);

    logDiagnostic("render", "info", `[AUDIO] Project audio tracks: ${audioUrl ? 1 : 0}`);
    logDiagnostic("render", "info", `[AUDIO] Active audio clips: ${audioSegments ? audioSegments.length : 0}`);
    if (audioUrl) {
      logDiagnostic("render", "info", `[AUDIO] Clip:\n  id: VOICEOVER\n  src: ${audioUrl}\n  startFrame: 0\n  durationInFrames: ${totalFrames}\n  volume: 1\n  muted: false`);
    }
    if (settings.musicUrl) {
      logDiagnostic("render", "info", `[AUDIO] Clip:\n  id: MUSIC\n  src: ${settings.musicUrl}\n  startFrame: 0\n  durationInFrames: ${totalFrames}\n  volume: ${settings.musicVolume / 100}\n  muted: false`);
    }
    if (audioSegments) {
      audioSegments.forEach((seg, idx) => {
        logDiagnostic("render", "info", `[AUDIO] Clip:\n  id: ${seg.id || idx}\n  src: ${audioUrl}\n  startFrame: ${Math.round(seg.projStart * FPS)}\n  durationInFrames: ${Math.round(seg.duration * FPS)}\n  volume: 1\n  muted: false`);
      });
    }

    try {
      logDiagnostic("render", "info", `[RENDER] Loading assets`);
      await saveProject({ data: { id, clips } });
      await saveGlobalSettings({ data: { settings } });

      logDiagnostic("render", "info", `[RENDER] Assets ready`);
      logDiagnostic("render", "info", `[RENDER] Remotion render started`);
      logDiagnostic("render", "info", `[RENDER] WebCodecs started`);

      let lastLoggedProgress = -1;

      const renderOptions = {
        composition: {
          component: VertiCutComposition as any,
          durationInFrames: totalFrames,
          fps: FPS,
          width: COMP_WIDTH,
          height: COMP_HEIGHT,
          calculateMetadata: null,
          id: "verticut-video",
          defaultProps: { ...inputProps, isRendering: true } as any,
        } as any,
        inputProps: { ...inputProps, isRendering: true },
        audioCodec: "aac" as const,
      };

      logDiagnostic("render", "info", `[AUDIO] renderMediaOnWeb options:\n` + JSON.stringify({
        compositionId: renderOptions.composition.id,
        durationInFrames: renderOptions.composition.durationInFrames,
        audioCodec: renderOptions.audioCodec,
        hasInputProps: !!renderOptions.inputProps,
        audioUrl: renderOptions.inputProps?.audioUrl,
        musicUrl: renderOptions.inputProps?.musicUrl,
        isRenderingProp: renderOptions.inputProps?.isRendering,
      }, null, 2));

      const { getBlob } = await renderMediaOnWeb({
        ...renderOptions,
        onProgress: ({ progress, renderEstimatedTime }) => {
          setClientRenderProgress(progress);
          setClientRenderEstimatedTime(renderEstimatedTime);

          const pct = Math.round(progress * 100);
          if (pct >= lastLoggedProgress + 5 || pct === 100) {
            logDiagnostic("render", "info", `[RENDER] Progress ${pct}%`);
            lastLoggedProgress = pct - (pct % 5);
          }
        },
      });

      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      setClientRenderFileUrl(url);
      logDiagnostic("render", "success", `[RENDER] COMPLETE`);

      logDiagnostic("render", "info", `[AUDIO] Output MIME: ${blob.type}`);
      logDiagnostic("render", "info", `[AUDIO] Output size: ${blob.size} bytes`);

      try {
        const slice = blob.slice(0, Math.min(blob.size, 2 * 1024 * 1024));
        const arrayBuffer = await slice.arrayBuffer();
        const scanResult = scanMP4Tracks(arrayBuffer);
        logDiagnostic("render", "info", `[AUDIO] MP4 Structural verification:`);
        logDiagnostic("render", "info", `  Total trak boxes found: ${scanResult.trackCount}`);
        logDiagnostic("render", "info", `  Sound media handler (soun) found: ${scanResult.soundTrackFound}`);
        logDiagnostic("render", "info", `  AAC Audio codec descriptor (mp4a) found: ${scanResult.mp4aCodecFound}`);
      } catch (scanErr) {
        logDiagnostic("render", "warning", `[AUDIO] Scanning MP4 binary failed: ${String(scanErr)}`);
      }
    } catch (e) {
      console.error(e);
      setClientRenderError(String(e));
      logDiagnostic("render", "error", `[RENDER] FAILED\nprogress: ${Math.round((clientRenderProgress || 0) * 100)}%\nerror message: ${String(e)}\nstack: ${(e as any)?.stack || ""}`);
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
  const [videoTrimModal, setVideoTrimModal] = useState<{
    file: File;
    duration: number;
    startTime: number;
    endTime: number;
  } | null>(null);

  const onImageImport = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    for (const f of arr) {
      try {
        const isVideo = /^video\//i.test(f.type);
        if (isVideo) {
          // Get video duration for trim dialog
          const video = document.createElement("video");
          const url = URL.createObjectURL(f);
          await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => {
              setVideoTrimModal({
                file: f,
                duration: video.duration,
                startTime: 0,
                endTime: video.duration,
              });
              URL.revokeObjectURL(url);
              resolve();
            };
            video.src = url;
          });
        } else {
          const res = await uploadToR2(f, "image");
          addImageClips([{ key: res.key, url: res.url }]);
        }
      } catch (err) {
        console.error("Import failed", err);
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
      intensity: settings.animationIntensity,
      durationInFrames: totalFrames,
      fps: FPS,
      overlayUrl: getTemplateById(settings.activeTemplateId)?.overlayUrl,
      templateWindow: settings.templateWindow,
      enableTransitions: settings.transitionAnimation ?? true,
      audioSegments,
      captionTextColor: settings.captionTextColor,
      captionBgColor: settings.captionBgColor,
      captionPosX: settings.captionPosX,
      captionPosY: settings.captionPosY,
      captionFontSize: settings.captionFontSize,
      captionWordsPerLine: settings.captionWordsPerLine,
      captionLinesPerSegment: settings.captionLinesPerSegment,
      captionFont: settings.captionFont,
      showCaptions: settings.showCaptions ?? true,
      transcript,
      enableGradientOverlay: settings.enableGradientOverlay ?? true,
      gradientOverlayUrl: GRADIENT_OVERLAY_URL,
    }),
    [
      audioUrl,
      settings.musicUrl,
      settings.musicVolume,
      settings.animationIntensity,
      settings.transitionAnimation,
      settings.activeTemplateId,
      settings.templateWindow,
      settings.captionTextColor,
      settings.captionBgColor,
      settings.captionPosX,
      settings.captionPosY,
      settings.captionFontSize,
      settings.captionWordsPerLine,
      settings.captionLinesPerSegment,
      settings.captionFont,
      settings.showCaptions,
      settings.enableGradientOverlay,
      clips,
      totalFrames,
      audioSegments,
      transcript,
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
      {/* Header aligned 1:1 like screenshot */}
      <header className="flex h-[52px] items-center justify-between border-b border-border bg-panel-2 px-4 py-2 shrink-0 select-none">

        {/* Left Section: Logo & Project Title */}
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-1.5 hover:opacity-90">
            {/* Red custom circle logo */}
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary">
              <Film className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-[14px] font-extrabold tracking-wider text-foreground">VERTICUT</span>
          </Link>

          {isEditingName ? (
            <div className="flex items-center gap-2 rounded-md border border-primary bg-panel-3 px-3 py-1">
              <input
                type="text"
                className="bg-transparent border-0 p-0 text-[11px] font-bold text-foreground focus:outline-none focus:ring-0 w-[220px]"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleRenameSave}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameSave();
                  if (e.key === "Escape") {
                    setIsEditingName(false);
                    setEditName(name);
                  }
                }}
                autoFocus
              />
            </div>
          ) : (
            <div
              onClick={() => setIsEditingName(true)}
              className="flex items-center gap-2 rounded-md border border-border bg-panel-3 px-3 py-1 cursor-pointer hover:border-muted-foreground/30 transition-colors"
            >
              <span className="text-[11px] font-bold text-foreground w-[220px] truncate pr-4">
                {name || "Untitled Project"}
              </span>
              <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground shrink-0" />
            </div>
          )}
        </div>

        {/* Center Section: Dropdowns for Settings, Media, and New */}
        <div className="flex items-center gap-2.5">
          {/* Settings Button */}
          <button
            type="button"
            onClick={() => setTab(tab === "settings" ? "editor" : "settings")}
            className={`flex items-center gap-1.5 rounded border border-border px-3 py-1 text-[11px] font-bold h-7.5 transition-colors ${tab === "settings"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-panel hover:bg-accent text-foreground"
              }`}
          >
            <Settings className="h-3.5 w-3.5" /> Settings
          </button>

          {/* Media Dropdown Panel */}
          <div
            className="relative"
            onMouseEnter={() => {
              if (mediaTimeoutRef.current) clearTimeout(mediaTimeoutRef.current);
              setMediaOpen(true);
            }}
            onMouseLeave={() => {
              mediaTimeoutRef.current = setTimeout(() => {
                setMediaOpen(false);
              }, 300);
            }}
          >
            <button
              type="button"
              onClick={() => setMediaOpen((prev) => !prev)}
              className="flex items-center gap-1.5 rounded border border-border bg-panel hover:bg-accent px-3 py-1 text-[11px] font-bold text-foreground h-7.5"
            >
              <ImageIcon className="h-3.5 w-3.5 text-primary" /> Media <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>
            {mediaOpen && (
              <div className="absolute left-0 top-full pt-1 z-50">
                <div className="w-44 rounded border border-border bg-panel p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setTab("editor");
                      setActiveSidebarTab("search");
                      setMediaOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-accent"
                  >
                    <SearchIcon className="h-3.5 w-3.5 text-primary" /> Search Media
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMediaDownloadOpen(true);
                      setMediaOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-accent"
                  >
                    <DownloadCloud className="h-3.5 w-3.5 text-primary" /> Media Download
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSourcingModalOpen(true);
                      setMediaOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-accent"
                  >
                    <FileText className="h-3.5 w-3.5 text-primary" /> Import Sourcing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fileImportRef.current?.click();
                      setMediaOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-accent"
                  >
                    <ImageIcon className="h-3.5 w-3.5 text-primary" /> Import Local Images
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* New Content Dropdown Panel */}
          <div
            className="relative"
            onMouseEnter={() => {
              if (newTimeoutRef.current) clearTimeout(newTimeoutRef.current);
              setNewOpen(true);
            }}
            onMouseLeave={() => {
              newTimeoutRef.current = setTimeout(() => {
                setNewOpen(false);
              }, 300);
            }}
          >
            <button
              type="button"
              onClick={() => setNewOpen((prev) => !prev)}
              className="flex items-center gap-1.5 rounded border border-border bg-panel hover:bg-accent px-3 py-1 text-[11px] font-bold text-foreground h-7.5"
            >
              <Plus className="h-3.5 w-3.5 text-primary" /> New <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>
            {newOpen && (
              <div className="absolute left-0 top-full pt-1 z-50">
                <div className="w-40 rounded border border-border bg-panel p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      updateClips((prev) => [...prev, {
                        id: crypto.randomUUID(),
                        kind: "solid",
                        start: 0,
                        duration: Math.max(1, audioDuration),
                        solidColor: "#c21d24",
                        animation: "none",
                      }]);
                      setNewOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-accent"
                  >
                    <Square className="h-3.5 w-3.5 text-primary" /> Solid Layer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const start = playerRef.current?.getCurrentFrame() ? playerRef.current.getCurrentFrame() / FPS : 0;
                      updateClips((prev) => [...prev, {
                        id: crypto.randomUUID(),
                        kind: "text",
                        start,
                        duration: audioDuration - start,
                        textContent: "Text Layer",
                        animation: "none",
                        posY: 20,
                        scale: 0.4
                      }]);
                      setNewOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-accent"
                  >
                    <Type className="h-3.5 w-3.5 text-primary" /> Text Layer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDurationOpen(true);
                      setNewOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-accent"
                  >
                    <Clock className="h-3.5 w-3.5 text-primary" /> Duration...
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Section: Undo, Redo, Export */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAutoEditOpen(true)}
            className="flex items-center gap-1.5 h-7.5 rounded border border-border bg-panel hover:bg-accent text-foreground font-semibold text-[11px] px-3 py-1.5 shadow-sm transition-colors cursor-pointer"
            title="Auto edit timeline using AI segments"
          >
            <Sparkles className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500/25" />
            Auto Edit
          </button>

          {/* Undo/Redo pair */}
          <div className="flex items-center rounded border border-border bg-panel p-0.5 transition-shadow shadow-sm">
            <button
              onClick={() => undo()}
              title="Undo (Ctrl+Z)"
              className="rounded p-1 hover:bg-accent text-foreground transition-colors"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => redo()}
              title="Redo (Ctrl+Shift+Z)"
              className="rounded p-1 border-l border-border hover:bg-accent text-foreground transition-colors"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Red Export Button Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={enqueuing || clips.length === 0}
                className="flex items-center gap-1.5 h-7.5 rounded bg-primary text-primary-foreground font-bold text-[11px] px-4 py-1.5 shadow hover:opacity-90 disabled:opacity-50"
              >
                <Share className="h-3.5 w-3.5" /> Export <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-panel border border-border text-foreground">
              <DropdownMenuItem onClick={onExport} className="text-xs cursor-pointer hover:bg-accent px-3 py-2 flex items-center gap-2 text-foreground/90">
                Server Render (VPS)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onClientRender} className="text-xs cursor-pointer hover:bg-accent px-3 py-2 flex items-center gap-2 text-foreground/90">
                Client Render (Browser)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <div className="flex flex-1 min-h-0 gap-2 px-2 pb-2 pt-2">
            {/* Left: Tabbed Sidebar with Vertical Selector Strip on the left & Active Panel on the right */}
            <div className={`flex shrink-0 select-none transition-all duration-200 ${activeSidebarTab === "search" ? "w-[550px]" : "w-80"}`}>

              {/* Leftmost narrow vertical tab icon bar */}
              <nav className="w-[68px] bg-panel-2 border border-border border-r-0 rounded-l-md flex flex-col items-center py-4 gap-4.5 shrink-0">
                {/* Search Media tab button */}
                <button
                  type="button"
                  onClick={() => setActiveSidebarTab("search")}
                  className={`group flex flex-col items-center gap-1.5 w-full py-1.5 relative transition-all ${activeSidebarTab === "search" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {activeSidebarTab === "search" && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r" />
                  )}
                  <div className={`p-1.5 rounded-lg transition-colors ${activeSidebarTab === "search" ? "bg-primary/10 text-primary" : "group-hover:bg-accent"}`}>
                    <SearchIcon className="h-4.5 w-4.5" />
                  </div>
                  <span className="text-[9px] font-bold tracking-tight text-center leading-tight">Search<br />Media</span>
                </button>

                {/* Animation tab button */}
                <button
                  type="button"
                  onClick={() => setActiveSidebarTab("animation")}
                  className={`group flex flex-col items-center gap-1.5 w-full py-1.5 relative transition-all ${activeSidebarTab === "animation" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {activeSidebarTab === "animation" && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r" />
                  )}
                  <div className={`p-1.5 rounded-lg transition-colors ${activeSidebarTab === "animation" ? "bg-primary/10 text-primary" : "group-hover:bg-accent"}`}>
                    <Settings className="h-4.5 w-4.5" />
                  </div>
                  <span className="text-[9px] font-bold tracking-tight text-center leading-tight">Animation</span>
                </button>

                {/* Media tab button */}
                <button
                  type="button"
                  onClick={() => setActiveSidebarTab("media")}
                  className={`group flex flex-col items-center gap-1.5 w-full py-1.5 relative transition-all ${activeSidebarTab === "media" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {activeSidebarTab === "media" && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r" />
                  )}
                  <div className={`p-1.5 rounded-lg transition-colors ${activeSidebarTab === "media" ? "bg-primary/10 text-primary" : "group-hover:bg-accent"}`}>
                    <ImageIcon className="h-4.5 w-4.5" />
                  </div>
                  <span className="text-[9px] font-bold tracking-tight text-center leading-tight">Media</span>
                </button>

                {/* Captions tab button */}
                <button
                  type="button"
                  onClick={() => setActiveSidebarTab("captions")}
                  className={`group flex flex-col items-center gap-1.5 w-full py-1.5 relative transition-all ${activeSidebarTab === "captions" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {activeSidebarTab === "captions" && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r" />
                  )}
                  <div className={`p-1.5 rounded-lg transition-colors ${activeSidebarTab === "captions" ? "bg-primary/10 text-primary" : "group-hover:bg-accent"}`}>
                    <FileText className="h-4.5 w-4.5" />
                  </div>
                  <span className="text-[9px] font-bold tracking-tight text-center leading-tight">Captions</span>
                </button>
              </nav>

              {/* Right Sidebar Content Panel */}
              <aside className={`shrink-0 overflow-hidden rounded-r-md border border-border bg-panel flex flex-col transition-all duration-200 ${activeSidebarTab === "search" ? "w-[482px]" : "w-[252px]"
                }`}>
                <div className="flex-1 overflow-hidden min-h-0 relative">
                  <div className={activeSidebarTab !== "search" ? "hidden" : "h-full"}>
                    <Suspense fallback={<div className="flex h-full items-center justify-center p-4"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}>
                      <SearchMediaPanel open={activeSidebarTab === "search"} onOpenChange={() => { }} onImport={onSearchMediaImport} />
                    </Suspense>
                  </div>
                  <div className={activeSidebarTab !== "animation" ? "hidden" : "h-full"}>
                    <AnimationPanel />
                  </div>
                  <div className={activeSidebarTab !== "media" ? "hidden" : "h-full"}>
                    <MediaPanel
                      onImportMedia={() => fileImportRef.current?.click()}
                      onDownloadMedia={() => setMediaDownloadOpen(true)}
                    />
                  </div>
                  <div className={activeSidebarTab !== "captions" ? "hidden" : "h-full"}>
                    <CaptionsPanel />
                  </div>
                </div>
              </aside>
            </div>

            {/* Center preview */}
            <main
              ref={previewDropRef}
              className={`relative flex flex-1 min-w-0 flex-col items-center justify-center gap-4 rounded-md border border-border bg-track p-4 transition-colors ${dragOver ? "bg-primary/10 ring-2 ring-primary" : ""}`}
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
                onClick={() => fileImportRef.current?.click()}
                className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-border bg-panel/90 px-3 py-1.5 text-[11px] backdrop-blur hover:bg-accent"
                title="Import images (Ctrl+I)"
              >
                <ImageIcon className="h-3 w-3" /> Import images
              </button>
              <div className="relative" style={{ aspectRatio: "9 / 16", height: "min(100%, 90vh)" }}>
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

                {/* Visual drag overlay for Text, Solids, and Overlay track items */}
                {(() => {
                  const selectedClip = useEditor.getState().clips.find(c => c.id === useEditor.getState().selectedClipId);
                  if (selectedClip && (selectedClip.kind === "text" || selectedClip.kind === "solid" || selectedClip.layer === "overlay")) {
                    const posX = selectedClip.posX ?? 50;
                    const posY = selectedClip.posY ?? 50;
                    const isOverlayMedia = selectedClip.layer === "overlay";
                    const isSolid = selectedClip.kind === "solid";
                    const boxWidth = isOverlayMedia ? "40%" : (isSolid ? "90%" : "25%");
                    const boxHeight = isOverlayMedia ? "40%" : (isSolid ? "90%" : "10%");
                    return (
                      <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden" style={{ borderRadius: 6 }}>
                        <div
                          className="absolute pointer-events-auto border-2 border-dashed border-primary/50 cursor-grab active:cursor-grabbing hover:border-primary transition-colors flex items-center justify-center group"
                          style={{
                            left: `${posX}%`,
                            top: `${posY}%`,
                            transform: 'translate(-50%, -50%)',
                            width: boxWidth,
                            height: boxHeight,
                            minWidth: isSolid ? '120px' : '65px',
                            minHeight: isSolid ? '120px' : '30px'
                          }}
                          title="Drag to reposition layer"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            const container = e.currentTarget.parentElement;
                            if (!container) return;
                            const rect = container.getBoundingClientRect();
                            const startX = e.clientX;
                            const startY = e.clientY;
                            const startPosX = posX;
                            const startPosY = posY;

                            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }

                            const onMove = (me: PointerEvent) => {
                              const dx = me.clientX - startX;
                              const dy = me.clientY - startY;
                              const newPosX = Math.max(0, Math.min(100, startPosX + (dx / rect.width) * 100));
                              const newPosY = Math.max(0, Math.min(100, startPosY + (dy / rect.height) * 100));

                              useEditor.getState().updateClips(prev =>
                                prev.map(c => c.id === selectedClip.id ? { ...c, posX: newPosX, posY: newPosY } : c),
                                false // Do not record every frame
                              );
                            };

                            const onUp = (me: PointerEvent) => {
                              try { (me.currentTarget as HTMLElement).releasePointerCapture(me.pointerId); } catch { }
                              window.removeEventListener('pointermove', onMove);
                              window.removeEventListener('pointerup', onUp);
                              // Record final state
                              const currentClips = useEditor.getState().clips;
                              useEditor.getState().updateClips(currentClips, true);
                            };

                            window.addEventListener('pointermove', onMove);
                            window.addEventListener('pointerup', onUp);
                          }}
                        />
                      </div>
                    );
                  }
                  return null;
                })()}

                <TimecodeBadge playerRef={playerRef} fps={FPS} />
              </div>
              {audioUrl ? (
                audioSegments && audioSegments.length > 0 ? (
                  audioSegments.map((seg) => (
                    <PreviewAudioSegment
                      key={seg.id}
                      src={audioUrl}
                      segment={seg}
                      playerRef={playerRef}
                      fps={FPS}
                    />
                  ))
                ) : (
                  <PreviewAudio src={audioUrl} playerRef={playerRef} fps={FPS} />
                )
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
            <aside className="w-80 shrink-0 overflow-hidden rounded-md border border-border bg-panel">
              <WordTranscript playerRef={playerRef} fps={FPS} onSeek={seekTo} />
            </aside>
          </div>

          {/* Timeline: resizable */}
          <div className="mx-2 mb-2 overflow-hidden rounded-md border border-border" style={{ height: timelineHeight }}>
            {/* Divider / handle */}
            <div
              onPointerDown={(e) => {
                const startY = e.clientY;
                const startH = timelineHeight;
                const root = document.documentElement;
                try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { }
                const move = (ev: PointerEvent) => {
                  const dy = ev.clientY - startY;
                  const next = Math.max(120, Math.min(window.innerHeight * 0.82, startH - dy));
                  setTimelineHeight(next);
                  localStorage.setItem("verticut_timeline_height", String(next));
                };
                const up = (ev: PointerEvent) => {
                  try { (e.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId); } catch { }
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
              className="h-2.5 w-full cursor-row-resize bg-panel/70"
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

      {/* Duration modal */}
      {durationOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-80 rounded-lg border border-border bg-panel p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-primary" /> Composition Duration
              </h4>
              <button
                onClick={() => setDurationOpen(false)}
                className="text-[12px] text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="my-4 space-y-4">
              <div className="flex flex-col items-center justify-center bg-panel-2 rounded p-3">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Current Duration</span>
                <span className="text-2xl font-mono font-bold mt-1 text-primary">
                  {audioDuration.toFixed(1)}s
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">
                  {fmtTC(audioDuration)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    const next = Math.max(1, audioDuration - 1);
                    updateCompositionDuration(next);
                  }}
                  className="flex-1 flex items-center justify-center gap-1 rounded border border-border bg-panel-2 py-1.5 text-xs hover:bg-accent font-medium"
                >
                  <Minus className="h-3 w-3" /> 1s
                </button>
                <button
                  onClick={() => {
                    const next = Math.max(1, audioDuration - 5);
                    updateCompositionDuration(next);
                  }}
                  className="flex-1 flex items-center justify-center gap-1 rounded border border-border bg-panel-2 py-1.5 text-xs hover:bg-accent font-medium"
                >
                  <Minus className="h-3 w-3" /> 5s
                </button>
                <button
                  onClick={() => {
                    const next = Math.max(1, audioDuration + 1);
                    updateCompositionDuration(next);
                  }}
                  className="flex-1 flex items-center justify-center gap-1 rounded border border-border bg-panel-2 py-1.5 text-xs hover:bg-accent font-medium"
                >
                  <Plus className="h-3 w-3" /> 1s
                </button>
                <button
                  onClick={() => {
                    const next = Math.max(1, audioDuration + 5);
                    updateCompositionDuration(next);
                  }}
                  className="flex-1 flex items-center justify-center gap-1 rounded border border-border bg-panel-2 py-1.5 text-xs hover:bg-accent font-medium"
                >
                  <Plus className="h-3 w-3" /> 5s
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground block">Exact duration (seconds)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={3600}
                    step={0.1}
                    value={audioDuration}
                    onChange={(e) => {
                      const next = Math.max(1, Number(e.target.value));
                      updateCompositionDuration(next);
                    }}
                    className="flex-1 rounded border border-border bg-panel-2 px-2.5 py-1 text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Video trim modal */}
      {videoTrimModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-96 rounded-lg border border-border bg-panel p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-2 mb-4">
              <h4 className="text-sm font-semibold">Trim Video</h4>
              <button
                onClick={() => setVideoTrimModal(null)}
                className="text-[12px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] text-muted-foreground block mb-2">Duration: {videoTrimModal.duration.toFixed(2)}s</label>
                <div className="space-y-3">
                  {/* Visual slider */}
                  <div className="bg-panel-2 rounded p-2 space-y-2">
                    <div className="relative h-12 bg-black/50 rounded cursor-pointer border border-border overflow-hidden flex items-center"
                      onClick={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const percent = (e.clientX - rect.left) / rect.width;
                        const time = percent * videoTrimModal.duration;
                        const mid = (videoTrimModal.startTime + videoTrimModal.endTime) / 2;
                        if (time < mid) {
                          setVideoTrimModal({ ...videoTrimModal, startTime: Math.max(0, time) });
                        } else {
                          setVideoTrimModal({ ...videoTrimModal, endTime: Math.min(videoTrimModal.duration, time) });
                        }
                      }}>
                      {/* Background bar showing full duration */}
                      <div className="absolute inset-0 bg-accent/20" />
                      {/* Selected range bar */}
                      <div className="absolute h-full bg-primary/40"
                        style={{
                          left: `${(videoTrimModal.startTime / videoTrimModal.duration) * 100}%`,
                          right: `${100 - (videoTrimModal.endTime / videoTrimModal.duration) * 100}%`,
                        }}
                      />
                      {/* Start handle */}
                      <div className="absolute top-1/2 -translate-y-1/2 w-1 h-10 bg-primary cursor-col-resize"
                        style={{ left: `${(videoTrimModal.startTime / videoTrimModal.duration) * 100}%`, marginLeft: '-2px' }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const rect = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
                          const onMove = (me: MouseEvent) => {
                            const percent = (me.clientX - rect.left) / rect.width;
                            const time = Math.max(0, Math.min(videoTrimModal.endTime - 0.1, percent * videoTrimModal.duration));
                            setVideoTrimModal({ ...videoTrimModal, startTime: time });
                          };
                          const onUp = () => {
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                          };
                          document.addEventListener('mousemove', onMove);
                          document.addEventListener('mouseup', onUp);
                        }}
                      />
                      {/* End handle */}
                      <div className="absolute top-1/2 -translate-y-1/2 w-1 h-10 bg-primary cursor-col-resize"
                        style={{ left: `${(videoTrimModal.endTime / videoTrimModal.duration) * 100}%`, marginLeft: '-2px' }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const rect = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
                          const onMove = (me: MouseEvent) => {
                            const percent = (me.clientX - rect.left) / rect.width;
                            const time = Math.min(videoTrimModal.duration, Math.max(videoTrimModal.startTime + 0.1, percent * videoTrimModal.duration));
                            setVideoTrimModal({ ...videoTrimModal, endTime: time });
                          };
                          const onUp = () => {
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                          };
                          document.addEventListener('mousemove', onMove);
                          document.addEventListener('mouseup', onUp);
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{videoTrimModal.startTime.toFixed(2)}s</span>
                      <span>{videoTrimModal.endTime.toFixed(2)}s</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Start (s)</label>
                    <input
                      type="range"
                      min={0}
                      max={videoTrimModal.duration}
                      step={0.1}
                      value={videoTrimModal.startTime}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(videoTrimModal.endTime - 0.1, Number(e.target.value)));
                        setVideoTrimModal({ ...videoTrimModal, startTime: val });
                      }}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">End (s)</label>
                    <input
                      type="range"
                      min={0}
                      max={videoTrimModal.duration}
                      step={0.1}
                      value={videoTrimModal.endTime}
                      onChange={(e) => {
                        const val = Math.min(videoTrimModal.startTime + 0.1, Math.min(videoTrimModal.duration, Number(e.target.value)));
                        setVideoTrimModal({ ...videoTrimModal, endTime: val });
                      }}
                      className="w-full"
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground text-center bg-panel-2 rounded p-2">
                    Selected: {(videoTrimModal.endTime - videoTrimModal.startTime).toFixed(2)}s
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setVideoTrimModal(null)}
                  className="flex-1 rounded border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!videoTrimModal) return;
                    try {
                      const res = await uploadToR2(videoTrimModal.file, "video");
                      const cursor = findNextStart(useEditor.getState().clips);
                      const duration = videoTrimModal.endTime - videoTrimModal.startTime;
                      const newClip: ClipDoc = {
                        id: crypto.randomUUID(),
                        kind: "media",
                        start: cursor,
                        duration: duration,
                        videoUrl: res.url,
                        videoKey: res.key,
                        trimStart: videoTrimModal.startTime,
                        trimEnd: videoTrimModal.endTime,
                        animation: "none",
                        muted: true,
                        volume: 100,
                      };
                      useEditor.getState().updateClips([...useEditor.getState().clips, newClip]);
                      setVideoTrimModal(null);
                    } catch (err) {
                      console.error("Video upload failed", err);
                      alert("Video upload failed: " + err);
                    }
                  }}
                  className="flex-1 rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  Import
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <input
        ref={fileImportRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => onImageImport(e.target.files)}
      />

      {renderJob ? (
        <RenderProgressToast job={renderJob} onDismiss={() => setRenderJob(null)} />
      ) : null}

      <ImportSourcingModal open={sourcingModalOpen} onOpenChange={setSourcingModalOpen} />
      <AutoEditModal open={autoEditOpen} onOpenChange={setAutoEditOpen} playerRef={playerRef} />
      <Suspense fallback={null}>
        <MediaDownloadModal open={mediaDownloadOpen} onOpenChange={setMediaDownloadOpen} />
      </Suspense>

      {/* Browser Client Rendering Modal */}
      {clientRenderProgress !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-panel p-6 shadow-2xl">
            <h3 className="text-sm font-bold text-foreground">Browser Rendering</h3>
            <p className="mt-1 text-[11px] text-muted-foreground font-light">
              We are encoding your video directly in the browser using WebCodecs.
            </p>

            {clientRenderError ? (
              <div className="mt-4 rounded border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">
                {clientRenderError}
              </div>
            ) : clientRenderFileUrl ? (
              <div className="mt-4 text-center">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-400 mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </span>
                <p className="text-xs font-semibold text-emerald-400">Render complete!</p>
                <a
                  href={clientRenderFileUrl}
                  download={`verticut_${id}.mp4`}
                  className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 h-8.5 rounded bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow"
                >
                  Download Video
                </a>
              </div>
            ) : (
              <div className="mt-5">
                <div className="flex justify-between text-[10px] text-muted-foreground mb-1 font-medium">
                  <span>Progress</span>
                  <span>{Math.round(clientRenderProgress * 100)}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${clientRenderProgress * 100}%` }}
                  />
                </div>
                {clientRenderEstimatedTime !== null && (
                  <p className="mt-2 text-[10px] text-neutral-400 text-right">
                    Estimated time remaining: {Math.ceil(clientRenderEstimatedTime / 1000)}s
                  </p>
                )}
              </div>
            )}

            {/* Debug Logs Panel */}
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[11px] font-bold text-foreground uppercase tracking-wider">Debug Logs</span>
                <div className="flex gap-2">
                  <button
                    onClick={copyLogs}
                    className="h-5 rounded bg-neutral-800 hover:bg-neutral-700 px-2 text-[9px] font-bold text-foreground transition-colors"
                  >
                    Copy Logs
                  </button>
                  <button
                    onClick={clearLogs}
                    className="h-5 rounded bg-neutral-800 border border-border px-2 text-[9px] font-bold text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear Logs
                  </button>
                </div>
              </div>
              <div className="bg-black/35 rounded border border-border/50 p-2.5 max-h-48 overflow-y-auto font-mono text-[9px] leading-relaxed text-neutral-300">
                {logs.length === 0 ? (
                  <p className="text-muted-foreground italic font-light">No logs recorded yet.</p>
                ) : (
                  <div className="space-y-1 whitespace-pre-wrap">
                    {logs.map((log, idx) => (
                      <div key={idx} className={
                        log.level === 'error' ? 'text-destructive' :
                          log.level === 'warning' ? 'text-amber-400' :
                            log.level === 'success' ? 'text-emerald-400' : 'text-neutral-300'
                      }>
                        <span className="text-muted-foreground mr-1.5 font-light">{log.timestamp}</span>
                        <span className="font-semibold uppercase mr-1.5 text-[8px] opacity-75">
                          [{log.category}]
                        </span>
                        {log.message}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => {
                  setClientRenderProgress(null);
                  setClientRenderError(null);
                  if (clientRenderFileUrl) {
                    URL.revokeObjectURL(clientRenderFileUrl);
                    setClientRenderFileUrl(null);
                  }
                }}
                className="h-8 rounded border border-border bg-panel-2 hover:bg-accent px-4 text-xs font-semibold text-foreground transition-colors"
              >
                {clientRenderFileUrl || clientRenderError ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
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
    <div className="flex w-full max-w-2xl items-center gap-2 rounded-md border border-border bg-panel/95 px-3.5 py-2 text-xs backdrop-blur">
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
        } catch { }
        await audio.play();
        try {
          player.play();
        } catch { }
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

function PreviewAudioSegment({
  src,
  segment,
  playerRef,
  fps,
  volume = 1,
}: {
  src: string;
  segment: AudioSegment;
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  volume?: number;
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
      const isWithin = t >= segment.projStart && t < segment.projStart + segment.duration;

      if (isWithin) {
        const targetSeek = segment.srcStart + (t - segment.projStart);
        if (Math.abs(audio.currentTime - targetSeek) > DRIFT_HARD) {
          audio.currentTime = targetSeek;
        }
        if (audio.paused) {
          audio.play().catch(() => { });
        }
      } else {
        if (!audio.paused) {
          audio.pause();
        }
      }
    };

    const hardSync = () => {
      const t = targetTime();
      const isWithin = t >= segment.projStart && t < segment.projStart + segment.duration;
      if (isWithin) {
        audio.currentTime = segment.srcStart + (t - segment.projStart);
      } else {
        audio.pause();
      }
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
        const t = targetTime();
        const isWithin = t >= segment.projStart && t < segment.projStart + segment.duration;
        if (isWithin) {
          hardSync();
          try {
            player.pause();
          } catch { }
          await audio.play();
          try {
            player.play();
          } catch { }
          startDriftCheck();
        } else {
          audio.pause();
        }
      } catch (_) {
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
      const t = targetTime();
      const isWithin = t >= segment.projStart && t < segment.projStart + segment.duration;
      if (isWithin) {
        hardSync();
        if (driftTimer != null && audio.paused) {
          audio.play().catch(() => { });
        }
      } else {
        audio.pause();
        stopDriftCheck();
      }
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

    // Initial sync
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
  }, [playerRef, fps, src, segment.id, segment.projStart, segment.duration, segment.srcStart]);

  return (
    <audio
      ref={audioRef}
      src={src}
      preload="auto"
      style={{ display: "none" }}
    />
  );
}

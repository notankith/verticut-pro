import { useEditor } from "@/store/editor";
import { useTimelineActions } from "./hooks";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ClipDoc, MarkerDoc, AudioSegment } from "@/server/mongo.server";
import type { PlayerRef } from "@remotion/player";
import { usePlayerFrame } from "./usePlayerFrame";
import { Eye, EyeOff, Film, Music, Layers } from "lucide-react";

export function Timeline({
  playerRef,
  fps,
  onSeek,
}: {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  onSeek: (t: number) => void;
}) {
  const clips = useEditor((s) => s.clips);
  const markers = useEditor((s) => s.markers);
  const projectId = useEditor((s) => s.projectId);
  const zoom = useEditor((s) => s.zoom);
  const audioDuration = useEditor((s) => s.audioDuration);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const settings = useEditor((s) => s.settings);
  const select = useEditor((s) => s.select);
  const set = useEditor((s) => s.set);

  const hideMedia = useEditor((s) => s.hideMedia);
  const hideOverlays = useEditor((s) => s.hideOverlays);
  const muteAudio = useEditor((s) => s.muteAudio);

  const { moveClip, trimClip, updateClip, moveAudioSegment, trimAudioSegment, addKeyframe } = useTimelineActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const didAutoFitRef = useRef<string | null>(null);

  const clipsEnd = clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
  const projectDuration = Math.max(audioDuration || 0, clipsEnd, 1);
  const totalWidth = Math.max(projectDuration * zoom, 1);
  const headerWidth = 140;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!projectDuration || projectDuration <= 0) return;

    const containerWidth = container.clientWidth - headerWidth;
    if (containerWidth <= 0) return;

    const fitKey = `${projectId}:${Math.ceil(projectDuration)}`;
    if (didAutoFitRef.current === fitKey) return;

    const nextZoom = Math.max(2, Math.min(200, Math.floor(containerWidth / projectDuration)));
    set({ zoom: nextZoom });
    container.scrollLeft = 0;
    didAutoFitRef.current = fitKey;
  }, [projectDuration, projectId, set]);

  function presetTint(id: string) {
    return settings.presets.find((p) => p.id === id)?.tint ?? "#71717a";
  }

  function startScrubFromEvent(e: React.PointerEvent<HTMLDivElement>) {
    const targetEl = e.currentTarget as HTMLDivElement;
    e.preventDefault();
    try { targetEl.setPointerCapture(e.pointerId); } catch { }
    try { playerRef.current?.pause(); } catch { }
    const rect = targetEl.getBoundingClientRect();
    const seekFromClientX = (cx: number) => {
      const x = cx - rect.left - headerWidth + (containerRef.current?.scrollLeft ?? 0);
      onSeek(Math.max(0, x / zoom));
    };
    seekFromClientX(e.clientX);
    const move = (ev: PointerEvent) => seekFromClientX(ev.clientX);
    const end = (ev: PointerEvent) => {
      try { targetEl.releasePointerCapture(ev.pointerId); } catch { }
      targetEl.removeEventListener("pointermove", move);
      targetEl.removeEventListener("pointerup", end);
      targetEl.removeEventListener("pointercancel", end);
    };
    targetEl.addEventListener("pointermove", move);
    targetEl.addEventListener("pointerup", end);
    targetEl.addEventListener("pointercancel", end);
  }

  const audioSegments = useEditor((s) => s.audioSegments);
  const currentTime = useEditor((s) => s.currentTime);

  return (
    <div className="flex h-full flex-col bg-track">
      <div className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2 shrink-0">
        <span className="text-[10px] uppercase font-bold tracking-[0.16em] text-muted-foreground mr-1">Timeline</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-semibold">Zoom</span>
          <input
            type="range"
            min={2}
            max={200}
            value={zoom}
            onChange={(e) => set({ zoom: Number(e.target.value) })}
            className="w-36 accent-primary"
          />
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-x-auto overflow-y-hidden select-none">
        <div style={{ width: totalWidth + headerWidth, minHeight: "100%" }} className="flex flex-col relative">

          {/* Ruler */}
          <div
            onPointerDown={startScrubFromEvent}
            className="sticky top-0 z-30 h-7 shrink-0 cursor-ew-resize border-b border-border bg-panel flex"
            style={{ width: totalWidth + headerWidth, touchAction: "none" }}
          >
            <div
              className="sticky left-0 z-35 shrink-0 bg-panel border-r border-border"
              style={{ width: headerWidth }}
            />
            <div className="relative flex-1 h-full pointer-events-none">
              <Ruler totalWidth={totalWidth} zoom={zoom} duration={projectDuration} />
            </div>
          </div>

          {/* Media Layer */}
          <div
            data-track-layer="media"
            className="relative h-20 shrink-0 border-b border-border bg-panel flex"
            style={{ width: totalWidth + headerWidth }}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              startScrubFromEvent(e);
            }}
          >
            <div
              className="sticky left-0 z-20 shrink-0 h-full border-r border-border bg-panel-2/95 backdrop-blur flex items-center justify-between px-3"
              style={{ width: headerWidth }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Film className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-[10.5px] font-bold text-foreground truncate">Media Layer</span>
              </div>
              <button
                type="button"
                onClick={() => set({ hideMedia: !hideMedia })}
                className="text-muted-foreground hover:text-foreground hover:bg-accent p-1 rounded"
                title={hideMedia ? "Show Media Layer" : "Hide Media Layer"}
              >
                {hideMedia ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
              </button>
            </div>

            <div className={`relative flex-1 h-full ${hideMedia ? "opacity-30 pointer-events-none" : ""}`}>
              {clips.filter(c => c.layer === "media" || (!c.layer && c.kind !== "text" && c.kind !== "solid")).map((c) => (
                <ClipBlock
                  key={c.id}
                  clip={c}
                  zoom={zoom}
                  tint={presetTint(c.labelPresetId)}
                  selected={selectedClipId === c.id}
                  onSelect={() => select(c.id)}
                  onMove={(s, r) => moveClip(c.id, s, r)}
                  onTrim={(e, v, r) => trimClip(c.id, e, v, r)}
                  onKeyframeClick={
                    c.kind === "media" ? (time) => addKeyframe(c.id, { time }) : undefined
                  }
                />
              ))}
              {markers
                .slice()
                .sort((a, b) => a.start - b.start)
                .map((marker, index) => (
                  <TimelineMarker key={marker.id} marker={marker} zoom={zoom} onSeek={onSeek} colorIndex={index} />
                ))}
            </div>
          </div>

          {/* Overlay Layer */}
          <div
            data-track-layer="overlay"
            className="relative h-24 shrink-0 border-b border-border bg-panel flex"
            style={{ width: totalWidth + headerWidth }}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              startScrubFromEvent(e);
            }}
          >
            <div
              className="sticky left-0 z-20 shrink-0 h-full border-r border-border bg-panel-2/95 backdrop-blur flex items-center justify-between px-3"
              style={{ width: headerWidth }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-[10.5px] font-bold text-foreground truncate">Overlay Layer</span>
              </div>
              <button
                type="button"
                onClick={() => set({ hideOverlays: !hideOverlays })}
                className="text-muted-foreground hover:text-foreground hover:bg-accent p-1 rounded"
                title={hideOverlays ? "Show Overlay Layer" : "Hide Overlay Layer"}
              >
                {hideOverlays ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
              </button>
            </div>

            <div className={`relative flex-1 h-full ${hideOverlays ? "opacity-30 pointer-events-none" : ""}`}>
              {clips.filter(c => c.layer === "overlay" || (!c.layer && (c.kind === "text" || c.kind === "solid"))).map((c) => (
                <ClipBlock
                  key={c.id}
                  clip={c}
                  zoom={zoom}
                  tint={presetTint(c.labelPresetId)}
                  selected={selectedClipId === c.id}
                  onSelect={() => select(c.id)}
                  onMove={(s, r) => moveClip(c.id, s, r)}
                  onTrim={(e, v, r) => trimClip(c.id, e, v, r)}
                  onKeyframeClick={
                    c.kind === "media" ? (time) => addKeyframe(c.id, { time }) : undefined
                  }
                />
              ))}
            </div>
          </div>

          {/* Audio Layer */}
          <div
            className="relative h-14 shrink-0 border-b border-border bg-panel flex"
            style={{ width: totalWidth + headerWidth }}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              startScrubFromEvent(e);
            }}
          >
            <div
              className="sticky left-0 z-20 shrink-0 h-full border-r border-border bg-panel-2/95 backdrop-blur flex items-center justify-between px-3"
              style={{ width: headerWidth }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Music className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-[10.5px] font-bold text-foreground truncate">Audio Layer</span>
              </div>
              <button
                type="button"
                onClick={() => set({ muteAudio: !muteAudio })}
                className="text-muted-foreground hover:text-foreground hover:bg-accent p-1 rounded"
                title={muteAudio ? "Unmute Audio Layer" : "Mute Audio Layer"}
              >
                {muteAudio ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
              </button>
            </div>

            <div className={`relative flex-1 h-full ${muteAudio ? "opacity-30 pointer-events-none" : ""}`}>
              {audioSegments.map((s) => (
                <AudioSegmentBlock
                  key={s.id}
                  segment={s}
                  zoom={zoom}
                  selected={selectedClipId === s.id}
                  onSelect={() => select(s.id)}
                  onMove={(newStart) => moveAudioSegment(s.id, newStart)}
                  onTrim={(edge, val) => trimAudioSegment(s.id, edge, val)}
                />
              ))}
            </div>
          </div>

          {/* Red Playhead line */}
          <div className="pointer-events-none absolute inset-y-0 z-25" style={{ left: headerWidth + currentTime * zoom }}>
            <div className="h-full w-px bg-primary relative">
              <div className="absolute top-0 -left-[5px] w-[11px] h-3 bg-primary rounded-b" />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function Playhead({
  playerRef,
  fps,
  zoom,
  onSeek,
  containerRef,
}: {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  zoom: number;
  onSeek: (t: number) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const frame = usePlayerFrame(playerRef);
  const currentTime = frame / fps;
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  function onBadgePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch { }
    try { playerRef?.current?.pause(); } catch { }
    const container = containerRef?.current;
    const trackEl = container?.querySelector(".relative.h-24") as HTMLElement | null;
    const rect = trackEl?.getBoundingClientRect() ?? container?.getBoundingClientRect();
    if (!rect) return;
    const seekFromClientX = (cx: number) => {
      const x = cx - rect.left + (container?.scrollLeft ?? 0);
      const t = Math.max(0, x / zoom);
      setScrubTime(t);
      onSeek(t);
    };
    seekFromClientX(e.clientX);
    const move = (ev: PointerEvent) => seekFromClientX(ev.clientX);
    const up = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId); } catch { }
      setScrubTime(null);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  const displayTime = scrubTime != null ? scrubTime : currentTime;

  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary"
      style={{ left: displayTime * zoom }}
    >
      <div
        onPointerDown={onBadgePointerDown}
        className="pointer-events-auto absolute -top-6 left-1/2 -translate-x-1/2 cursor-grab rounded-sm bg-primary px-1 text-[9px] font-mono text-primary-foreground select-none"
        style={{ touchAction: "none" }}
      >
        {fmtTC(displayTime)}
      </div>
    </div>
  );
}

function fmtTC(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 30);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
}

function Ruler({ totalWidth, zoom, duration }: { totalWidth: number; zoom: number; duration: number }) {
  const step = zoom < 40 ? 5 : zoom < 80 ? 2 : 1;
  const ticks: number[] = [];
  for (let s = 0; s <= duration + step; s += step) ticks.push(s);
  return (
    <div className="relative h-full" style={{ width: totalWidth }}>
      {ticks.map((s) => (
        <div key={s} className="absolute top-0 bottom-0 border-l border-ruler" style={{ left: s * zoom }}>
          <span className="absolute left-1 top-0.5 text-[9px] text-muted-foreground">{s}s</span>
        </div>
      ))}
    </div>
  );
}

function TimelineMarker({
  marker,
  zoom,
  onSeek,
  colorIndex,
}: {
  marker: MarkerDoc;
  zoom: number;
  onSeek: (t: number) => void;
  colorIndex: number;
}) {
  const colors = ["#38bdf8", "#f97316", "#22c55e", "#e879f9", "#facc15", "#ef4444"];
  const color = colors[colorIndex % colors.length];
  return (
    <button
      type="button"
      onClick={() => onSeek(Math.max(0, marker.start))}
      className="absolute top-0 bottom-0 z-[5] text-left"
      style={{ left: marker.start * zoom }}
      title={`${marker.label} @ ${marker.start.toFixed(2)}s`}
    >
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2" style={{ backgroundColor: color, opacity: 0.95 }} />
      <div
        className="absolute -top-0.5 left-1/2 -translate-x-1/2 rounded px-1 py-0.5 text-[9px] font-semibold text-white shadow"
        style={{ backgroundColor: color, whiteSpace: "nowrap", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {marker.label}
      </div>
    </button>
  );
}

function ClipBlock({
  clip,
  zoom,
  tint,
  selected,
  onSelect,
  onMove,
  onTrim,
  onKeyframeClick,
}: {
  clip: ClipDoc;
  zoom: number;
  tint: string;
  selected: boolean;
  onSelect: () => void;
  onMove: (start: number, record?: boolean) => void;
  onTrim: (edge: "start" | "end", v: number, record?: boolean) => void;
  onKeyframeClick?: (time: number) => void;
}) {
  const [drag, setDrag] = useState<null | { kind: "move" | "left" | "right" | "keyframe"; startX: number; startY?: number; orig: number; keyframeIndex?: number; multiOrig?: Record<string, number>; multiIds?: string[] }>(null);
  const [deltaY, setDeltaY] = useState(0);
  const { updateClip } = useTimelineActions();

  const latest = useRef({ zoom, onMove, onTrim, updateClip, clip });
  latest.current = { zoom, onMove, onTrim, updateClip, clip };

  useEffect(() => {
    if (!drag) return;

    function move(ev: MouseEvent) {
      if (!drag) return;
      const { zoom, onMove, onTrim, updateClip, clip } = latest.current;
      const dx = ev.clientX - drag.startX;
      const dt = dx / zoom;

      // If this drag started as a multi-drag, update all involved clips together
      if (drag.kind === "move" && drag.multiOrig && drag.multiIds) {
        const ids = drag.multiIds;
        // compute tentative new starts
        const newStarts: Record<string, number> = {};
        let minStart = Infinity;
        for (const id of ids) {
          const orig = drag.multiOrig[id] ?? 0;
          const val = Math.max(0, orig + dt);
          newStarts[id] = val;
          if (val < minStart) minStart = val;
        }

        // snapping: compute last end among other clips and audioSegments
        const state = useEditor.getState();
        const otherClips = state.clips.filter((c) => !ids.includes(c.id));
        const otherAudio = state.audioSegments || [];
        let lastEnd = 0;
        for (const o of otherClips) lastEnd = Math.max(lastEnd, o.start + o.duration);
        for (const a of otherAudio) lastEnd = Math.max(lastEnd, a.projStart + a.duration);
        const SNAP = 8 / (state.zoom || 60);
        if (Math.abs(minStart - lastEnd) < SNAP) {
          const delta = lastEnd - minStart;
          for (const id of ids) newStarts[id] = Math.max(0, newStarts[id] + delta);
        }

        // Apply transient update without recording history
        useEditor.getState().updateClips((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, start: newStarts[c.id] ?? c.start } : c)), false);
        return;
      }

      if (drag.kind === "move") {
        onMove(drag.orig + dt, false);
        if (drag.startY !== undefined) {
          setDeltaY(ev.clientY - drag.startY);
        }
      }
      else if (drag.kind === "left") onTrim("start", drag.orig + dt, false);
      else if (drag.kind === "right") onTrim("end", drag.orig + dt, false);
      else if (drag.kind === "keyframe" && drag.keyframeIndex != null && clip.keyframes) {
        const kfs = [...clip.keyframes];
        const newTime = Math.max(clip.start, Math.min(clip.start + clip.duration, drag.orig + dt));
        kfs[drag.keyframeIndex] = { ...kfs[drag.keyframeIndex], time: newTime };
        updateClip(clip.id, { keyframes: kfs }, false);
      }
    }

    function up(ev: MouseEvent) {
      if (drag && drag.kind === "move") {
        const elements = document.elementsFromPoint(ev.clientX, ev.clientY);
        let hoveredLayer: "media" | "overlay" | null = null;
        for (const el of elements) {
          const layerAttr = el.getAttribute?.("data-track-layer");
          if (layerAttr === "media" || layerAttr === "overlay") {
            hoveredLayer = layerAttr as "media" | "overlay";
            break;
          }
        }
        const { updateClip, clip } = latest.current;
        if (hoveredLayer && hoveredLayer !== clip.layer) {
          updateClip(clip.id, { layer: hoveredLayer }, true);
        }
      }
      // If it was a multi-drag, finalize and record history once
      if (drag && drag.kind === "move" && drag.multiOrig && drag.multiIds) {
        const ids = drag.multiIds;
        const finalMap: Record<string, number> = {};
        const state = useEditor.getState();
        const cur = state.clips;
        for (const id of ids) {
          const c = cur.find((x) => x.id === id);
          if (c) finalMap[id] = c.start;
        }
        // apply as single recorded update
        state.updateClips((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, start: finalMap[c.id] ?? c.start } : c)), true);
      }
      setDrag(null);
      setDeltaY(0);
    }

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag]);

  return (
    <div
      onMouseDown={(e) => {
        onSelect();
        // Save current state for undo before starting drag
        const store = useEditor.getState();
        store.set({ past: [...store.past.slice(-50), store.clips] });

        if ((e.target as HTMLElement).dataset.handle === "left") {
          setDrag({ kind: "left", startX: e.clientX, orig: clip.start });
        } else if ((e.target as HTMLElement).dataset.handle === "right") {
          setDrag({ kind: "right", startX: e.clientX, orig: clip.start + clip.duration });
        } else if ((e.target as HTMLElement).dataset.keyframeIndex) {
          const kfIdx = parseInt((e.target as HTMLElement).dataset.keyframeIndex || "", 10);
          if (clip.keyframes?.[kfIdx]) {
            setDrag({ kind: "keyframe", startX: e.clientX, orig: clip.keyframes[kfIdx].time, keyframeIndex: kfIdx });
          }
        } else {
          setDrag({ kind: "move", startX: e.clientX, startY: e.clientY, orig: clip.start });
        }
      }}
      className={`absolute top-2 bottom-2 cursor-grab overflow-visible rounded border transition-shadow duration-200 ${selected ? "border-primary ring-1 ring-primary shadow-lg" : "border-border"
        }`}
      style={{
        left: clip.start * zoom,
        width: Math.max(20, clip.duration * zoom),
        transform: `translateY(${deltaY}px)`,
        backgroundImage: clip.imageUrl ? `url(${clip.imageUrl})` : `linear-gradient(180deg, color-mix(in oklab, ${tint} 35%, var(--panel)) 0%, color-mix(in oklab, ${tint} 15%, var(--panel)) 100%)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        zIndex: drag ? 50 : undefined,
      }}
    >
      <div data-handle="left" className="absolute left-0 top-0 bottom-0 w-3 z-20 cursor-ew-resize bg-white/10 hover:bg-white/30 border-r border-white/25 transition-colors" title="Drag to trim start" />
      <div data-handle="right" className="absolute right-0 top-0 bottom-0 w-3 z-20 cursor-ew-resize bg-white/10 hover:bg-white/30 border-l border-white/25 transition-colors" title="Drag to trim end" />

      {/* Keyframe markers */}
      {clip.keyframes?.map((k, idx) => (
        <div
          key={idx}
          data-keyframe-index={idx}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect();
            onKeyframeClick?.(k.time);
            setDrag({ kind: "keyframe", startX: e.clientX, orig: k.time, keyframeIndex: idx });
          }}
          className="absolute top-1/2 -translate-y-1/2 cursor-ew-resize hover:scale-125 transition-transform"
          style={{
            left: (k.time - clip.start) * zoom,
            transform: "translate(-50%, -50%)",
          }}
          title={`KF: ${k.time.toFixed(2)}s`}
        >
          <div className="text-yellow-400 text-base pointer-events-none">★</div>
        </div>
      ))}

      {clip.imageUrl && <div className="absolute inset-0 bg-black/45 rounded-sm z-[1]" />}
      <div className="pointer-events-none p-1.5 text-[10px] leading-tight relative h-full w-full z-[2]">
        <div className="truncate font-semibold flex items-center gap-1.5">
          {clip.imageUrl && (
            <img src={clip.imageUrl} alt="" className="h-4.5 w-4.5 rounded-sm object-cover shrink-0" />
          )}
          <span className="truncate">{clip.kind === "text" ? `T: ${clip.textContent || "Text"}` : clip.kind === "solid" ? "Solid Layer" : clip.labelText}</span>
        </div>
        <div className="absolute bottom-1 left-2 text-[9px] uppercase tracking-wide opacity-80">{clip.animation}</div>
        <div className="absolute bottom-1 right-2 text-[9px] font-mono opacity-80">{clip.duration.toFixed(2)}s</div>
      </div>
    </div>
  );
}
function AudioSegmentBlock({
  segment,
  zoom,
  selected,
  onSelect,
  onMove,
  onTrim,
}: {
  segment: AudioSegment;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (projStart: number) => void;
  onTrim: (edge: "start" | "end", v: number) => void;
}) {
  const [drag, setDrag] = useState<null | { kind: "move" | "left" | "right"; startX: number; orig: number; multiOrig?: Record<string, number>; multiIds?: string[] }>(null);

  useEffect(() => {
    if (!drag) return;
    function move(ev: MouseEvent) {
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dt = dx / zoom;
      if (drag.kind === "move" && drag.multiOrig && drag.multiIds) {
        const ids = drag.multiIds;
        const state = useEditor.getState();
        const segs = state.audioSegments.map((s) => ({ ...s }));
        let minStart = Infinity;
        for (const id of ids) {
          const orig = drag.multiOrig[id] ?? 0;
          const val = Math.max(0, orig + dt);
          const idx = segs.findIndex((x) => x.id === id);
          if (idx >= 0) segs[idx].projStart = val;
          if (val < minStart) minStart = val;
        }
        // snapping to last end of others
        const otherEnds = state.clips.map((c) => c.start + c.duration).concat(state.audioSegments.filter(s => !ids.includes(s.id)).map(s => s.projStart + s.duration));
        const lastEnd = otherEnds.length ? Math.max(...otherEnds) : 0;
        const SNAP = 8 / (state.zoom || 60);
        if (Math.abs(minStart - lastEnd) < SNAP) {
          const delta = lastEnd - minStart;
          for (const id of ids) {
            const idx = segs.findIndex((x) => x.id === id);
            if (idx >= 0) segs[idx].projStart = Math.max(0, segs[idx].projStart + delta);
          }
        }
        state.set({ audioSegments: segs });
        return;
      }
      if (drag.kind === "move") onMove(drag.orig + dt);
      else if (drag.kind === "left") onTrim("start", drag.orig + dt);
      else if (drag.kind === "right") onTrim("end", drag.orig + dt);
    }
    function up() {
      setDrag(null);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag, zoom, onMove, onTrim]);

  return (
    <div
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect();
        const state = useEditor.getState();
        if ((e.target as HTMLElement).dataset.handle === "left") {
          setDrag({ kind: "left", startX: e.clientX, orig: segment.projStart });
        } else if ((e.target as HTMLElement).dataset.handle === "right") {
          setDrag({ kind: "right", startX: e.clientX, orig: segment.projStart + segment.duration });
        } else {
          // Multi-select toggle for audio segments
          let sel = state.selectedClipIds || [];
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            if (sel.includes(segment.id)) sel = sel.filter((x) => x !== segment.id);
            else sel = [...sel, segment.id];
            state.set({ selectedClipId: sel[sel.length - 1] ?? null, selectedClipIds: sel });
          } else {
            state.set({ selectedClipId: segment.id, selectedClipIds: [segment.id] });
          }

          const finalSel = state.selectedClipIds.length > 0 ? state.selectedClipIds : [segment.id];
          if (finalSel.length > 1) {
            const map: Record<string, number> = {};
            for (const s of state.audioSegments) map[s.id] = s.projStart;
            const multiOrig: Record<string, number> = {};
            for (const id of finalSel) if (map[id] != null) multiOrig[id] = map[id];
            setDrag({ kind: "move", startX: e.clientX, orig: segment.projStart, multiOrig, multiIds: finalSel });
          } else {
            setDrag({ kind: "move", startX: e.clientX, orig: segment.projStart });
          }
        }
      }}
      className={`absolute top-0.5 h-5 rounded border cursor-grab overflow-hidden select-none ${selected ? "border-[#10b981] bg-[#10b981]/25 ring-1 ring-[#10b981]" : "border-[#10b981]/30 bg-[#10b981]/12 hover:bg-[#10b981]/18"
        }`}
      style={{
        left: segment.projStart * zoom,
        width: Math.max(12, segment.duration * zoom),
      }}
      title={`Audio segment: ${segment.duration.toFixed(2)}s`}
    >
      <div data-handle="left" className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/40" />
      <div data-handle="right" className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/40" />
      <div className="pointer-events-none px-2 text-[9px] truncate text-foreground/80 font-mono leading-relaxed select-none">
        {segment.duration.toFixed(2)}s
      </div>
    </div>
  );
}

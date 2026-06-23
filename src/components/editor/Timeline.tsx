import { useEditor } from "@/store/editor";
import { useTimelineActions } from "./hooks";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ClipDoc, MarkerDoc, AudioSegment } from "@/server/mongo.server";
import type { PlayerRef } from "@remotion/player";
import { usePlayerFrame } from "./usePlayerFrame";

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
  const { moveClip, trimClip, updateClip, moveAudioSegment, trimAudioSegment } = useTimelineActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const didAutoFitRef = useRef<string | null>(null);
  const clipsEnd = clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
  const projectDuration = Math.max(audioDuration || 0, clipsEnd, 1);
  const totalWidth = Math.max(projectDuration * zoom, 1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!projectDuration || projectDuration <= 0) return;

    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) return;

    // Auto-fit per project + duration bucket so it also runs when the
    // final voiceover duration arrives after initial load.
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
    try { targetEl.setPointerCapture(e.pointerId); } catch {}
    try { playerRef.current?.pause(); } catch {}
    const rect = targetEl.getBoundingClientRect();
    const seekFromClientX = (cx: number) => {
      const x = cx - rect.left + (containerRef.current?.scrollLeft ?? 0);
      onSeek(Math.max(0, x / zoom));
    };
    seekFromClientX(e.clientX);
    const move = (ev: PointerEvent) => seekFromClientX(ev.clientX);
    const end = (ev: PointerEvent) => {
      try { targetEl.releasePointerCapture(ev.pointerId); } catch {}
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
      <div className="flex items-center gap-3 border-b border-border bg-panel px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Timeline</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={2}
            max={200}
            value={zoom}
            onChange={(e) => set({ zoom: Number(e.target.value) })}
            className="w-32"
          />
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-x-auto overflow-y-auto">
        <div style={{ width: totalWidth }} className="relative">
          {/* Ruler */}
          <div
            onPointerDown={startScrubFromEvent}
            className="sticky top-0 z-10 h-6 cursor-ew-resize select-none border-b border-border bg-panel"
            style={{ width: totalWidth, touchAction: "none" }}
          >
            <Ruler totalWidth={totalWidth} zoom={zoom} duration={projectDuration} />
          </div>

          {/* Audio track (voice-over) */}
          <div className="relative h-8 border-b border-border bg-panel px-2 text-[11px] text-muted-foreground">
            <div className="absolute left-2 top-1 text-[10px]">Voice-over</div>
            <div
              className="absolute left-0 top-0 h-full"
              style={{ width: totalWidth }}
            >
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
              <div className="absolute top-0 bottom-0 w-px bg-border" style={{ left: currentTime * zoom }} />
            </div>
          </div>

          {/* Track */}
          <div
            className="relative h-24"
            style={{ width: totalWidth }}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              startScrubFromEvent(e);
            }}
          >
            {clips.map((c) => (
              <ClipBlock
                key={c.id}
                clip={c}
                zoom={zoom}
                tint={presetTint(c.labelPresetId)}
                selected={selectedClipId === c.id}
                onSelect={() => select(c.id)}
                onMove={(s) => moveClip(c.id, s)}
                onTrim={(edge, v) => trimClip(c.id, edge, v)}
              />
            ))}
            {markers
              .slice()
              .sort((a, b) => a.start - b.start)
              .map((marker, index) => (
                <TimelineMarker key={marker.id} marker={marker} zoom={zoom} onSeek={onSeek} colorIndex={index} />
              ))}
            <Playhead playerRef={playerRef} fps={fps} zoom={zoom} onSeek={onSeek} containerRef={containerRef} />
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
    try { target.setPointerCapture(e.pointerId); } catch {}
    try { playerRef?.current?.pause(); } catch {}
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
      try { target.releasePointerCapture(ev.pointerId); } catch {}
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
}: {
  clip: ClipDoc;
  zoom: number;
  tint: string;
  selected: boolean;
  onSelect: () => void;
  onMove: (start: number) => void;
  onTrim: (edge: "start" | "end", v: number) => void;
}) {
  const [drag, setDrag] = useState<null | { kind: "move" | "left" | "right" | "keyframe"; startX: number; orig: number; keyframeIndex?: number }>(null);
  const { updateClip } = useTimelineActions();

  useEffect(() => {
    if (!drag) return;
    function move(ev: MouseEvent) {
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dt = dx / zoom;
      if (drag.kind === "move") onMove(drag.orig + dt);
      else if (drag.kind === "left") onTrim("start", drag.orig + dt);
      else if (drag.kind === "right") onTrim("end", drag.orig + dt);
      else if (drag.kind === "keyframe" && drag.keyframeIndex != null && clip.keyframes) {
        const kfs = [...clip.keyframes];
        const newTime = Math.max(clip.start, Math.min(clip.start + clip.duration, drag.orig + dt));
        kfs[drag.keyframeIndex] = { ...kfs[drag.keyframeIndex], time: newTime };
        updateClip(clip.id, { keyframes: kfs });
      }
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
  }, [drag, zoom, onMove, onTrim, clip.id, clip.keyframes, clip.start, clip.duration, updateClip]);

  return (
    <div
      onMouseDown={(e) => {
        onSelect();
        if ((e.target as HTMLElement).dataset.handle === "left") {
          setDrag({ kind: "left", startX: e.clientX, orig: clip.start });
        } else if ((e.target as HTMLElement).dataset.handle === "right") {
          setDrag({ kind: "right", startX: e.clientX, orig: clip.start + clip.duration });
        } else if ((e.target as HTMLElement).dataset.keyframeIndex) {
          const kfIdx = parseInt((e.target as HTMLElement).dataset.keyframeIndex, 10);
          if (clip.keyframes?.[kfIdx]) {
            setDrag({ kind: "keyframe", startX: e.clientX, orig: clip.keyframes[kfIdx].time, keyframeIndex: kfIdx });
          }
        } else {
          setDrag({ kind: "move", startX: e.clientX, orig: clip.start });
        }
      }}
      className={`absolute top-2 bottom-2 cursor-grab overflow-visible rounded border relative ${
        selected ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
      style={{
        left: clip.start * zoom,
        width: Math.max(20, clip.duration * zoom),
        background: `linear-gradient(180deg, color-mix(in oklab, ${tint} 35%, var(--panel)) 0%, color-mix(in oklab, ${tint} 15%, var(--panel)) 100%)`,
      }}
    >
      <div data-handle="left" className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/40" />
      <div data-handle="right" className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/40" />
      
      {/* Keyframe markers */}
      {clip.keyframes?.map((k, idx) => (
        <div
          key={idx}
          data-keyframe-index={idx}
          onMouseDown={(e) => {
            e.stopPropagation();
            onSelect();
            setDrag({ kind: "keyframe", startX: e.clientX, orig: k.time, keyframeIndex: idx });
          }}
          className="absolute top-1/2 -translate-y-1/2 cursor-grab hover:scale-125 transition-transform"
          style={{
            left: (k.time - clip.start) * zoom,
            transform: "translate(-50%, -50%)",
          }}
          title={`KF: ${k.time.toFixed(2)}s`}
        >
          <div className="text-yellow-400 text-base">★</div>
        </div>
      ))}
      
      <div className="pointer-events-none p-1.5 text-[10px] leading-tight">
        <div className="truncate font-semibold">{clip.labelText}</div>
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
  const [drag, setDrag] = useState<null | { kind: "move" | "left" | "right"; startX: number; orig: number }>(null);

  useEffect(() => {
    if (!drag) return;
    function move(ev: MouseEvent) {
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dt = dx / zoom;
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
        if ((e.target as HTMLElement).dataset.handle === "left") {
          setDrag({ kind: "left", startX: e.clientX, orig: segment.projStart });
        } else if ((e.target as HTMLElement).dataset.handle === "right") {
          setDrag({ kind: "right", startX: e.clientX, orig: segment.projStart + segment.duration });
        } else {
          setDrag({ kind: "move", startX: e.clientX, orig: segment.projStart });
        }
      }}
      className={`absolute top-1 h-6 rounded border cursor-grab overflow-hidden select-none ${
        selected ? "border-primary bg-primary/20 ring-1 ring-primary" : "border-border bg-panel-2 hover:bg-panel-2/90"
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


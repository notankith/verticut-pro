import { useEditor } from "@/store/editor";
import { useTimelineActions } from "./hooks";
import { useEffect, useRef, useState } from "react";
import type { ClipDoc } from "@/server/mongo.server";

export function Timeline({
  currentTime,
  onSeek,
}: {
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const { clips, zoom, audioDuration, selectedClipId, settings, select, set } = useEditor();
  const { moveClip, trimClip } = useTimelineActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const totalWidth = Math.max((audioDuration || 30) * zoom, 800);

  function presetTint(id: string) {
    return settings.presets.find((p) => p.id === id)?.tint ?? "#71717a";
  }

  function handleRulerClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left + (containerRef.current?.scrollLeft ?? 0);
    onSeek(x / zoom);
  }

  return (
    <div className="flex h-full flex-col bg-track">
      <div className="flex items-center gap-3 border-b border-border bg-panel px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Timeline</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={20}
            max={200}
            value={zoom}
            onChange={(e) => set({ zoom: Number(e.target.value) })}
            className="w-32"
          />
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-x-auto overflow-y-hidden">
        <div style={{ width: totalWidth }} className="relative">
          {/* Ruler */}
          <div
            onClick={handleRulerClick}
            className="sticky top-0 z-10 h-6 cursor-pointer border-b border-border bg-panel"
            style={{ width: totalWidth }}
          >
            <Ruler totalWidth={totalWidth} zoom={zoom} duration={audioDuration || 30} />
          </div>
          {/* Track */}
          <div className="relative h-24" style={{ width: totalWidth }}>
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
            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary"
              style={{ left: currentTime * zoom }}
            >
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 rounded-sm bg-primary px-1 text-[9px] font-mono text-primary-foreground">
                {fmtTC(currentTime)}
              </div>
            </div>
          </div>
        </div>
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
        onSelect();
        if ((e.target as HTMLElement).dataset.handle === "left") {
          setDrag({ kind: "left", startX: e.clientX, orig: clip.start });
        } else if ((e.target as HTMLElement).dataset.handle === "right") {
          setDrag({ kind: "right", startX: e.clientX, orig: clip.start + clip.duration });
        } else {
          setDrag({ kind: "move", startX: e.clientX, orig: clip.start });
        }
      }}
      className={`absolute top-2 bottom-2 cursor-grab overflow-hidden rounded border ${
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
      <div className="pointer-events-none p-1.5 text-[10px] leading-tight">
        <div className="truncate font-semibold">{clip.labelText}</div>
        <div className="absolute bottom-1 left-2 text-[9px] uppercase tracking-wide opacity-80">{clip.animation}</div>
        <div className="absolute bottom-1 right-2 text-[9px] font-mono opacity-80">{clip.duration.toFixed(2)}s</div>
      </div>
    </div>
  );
}

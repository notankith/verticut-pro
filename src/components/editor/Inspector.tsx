import { useEditor } from "@/store/editor";
import { useTimelineActions } from "./hooks";
import { uploadToR2 } from "@/lib/upload";
import { useEffect, useRef, useState } from "react";
import type { ClipDoc } from "@/server/mongo.server";
import { Trash2, RefreshCw, Image as ImageIcon, Star, Diamond, VolumeX, Volume2, Sparkles, Type, Film } from "lucide-react";

const ANIMS: ClipDoc["animation"][] = ["zoom-in", "zoom-out", "pan-left", "pan-right"];

function DraggableNumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const handlePointerDown = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startVal = value;
    const handleMove = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) * step;
      onChange(Math.max(min, Math.min(max, startVal + delta)));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={Number(Number(value).toFixed(2))}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerDown={handlePointerDown}
      className="w-full rounded border border-border bg-panel-2 px-2 py-0.5 font-mono text-[10px] cursor-ew-resize outline-none"
    />
  );
}

// Probe image dimensions helper
function useImageDimensions(imageUrl?: string) {
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setImgDims(null);
    if (!imageUrl) return;
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);
  return imgDims;
}

// Shared interpolation pure helper
function interpClipProp(clip: ClipDoc, prop: "posX" | "posY" | "scale" | "rotation" | "opacity", time: number) {
  if (!clip.keyframes || clip.keyframes.length === 0) return undefined;
  const kfs = clip.keyframes.slice().sort((a, b) => a.time - b.time);
  let prev = null as any;
  let next = null as any;
  for (let i = 0; i < kfs.length; i++) {
    if (kfs[i].time <= time) prev = kfs[i];
    if (kfs[i].time > time) { next = kfs[i]; break; }
  }
  if (!prev && !next) return undefined;
  if (!prev) return (next as any)[prop];
  if (!next) return (prev as any)[prop];
  const pVal = (prev as any)[prop];
  const nVal = (next as any)[prop];
  if (pVal == null || nVal == null) return pVal ?? nVal;
  const alpha = (time - prev.time) / Math.max(1e-6, next.time - prev.time);
  return pVal + (nVal - pVal) * alpha;
}

// ----------------------------------------------------
// ANIMATION PANEL
// ----------------------------------------------------
export function AnimationPanel() {
  const { selectedClipId, clips, currentTime } = useEditor();
  const { updateClip } = useTimelineActions();
  const clip = clips.find((c) => c.id === selectedClipId);
  const imgDims = useImageDimensions(clip?.imageUrl);

  if (!clip) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground bg-panel">
        Select a layer or transition on the timeline to animate.
      </div>
    );
  }

  // Keyframing helpers
  const handlePropChange = (prop: "posX" | "posY" | "scale" | "rotation" | "opacity", value: number) => {
    const isKeyframed = clip.keyframedProps?.includes(prop);
    if (isKeyframed) {
      const existingKeyframes = clip.keyframes || [];
      const index = existingKeyframes.findIndex((k) => Math.abs(k.time - currentTime) < 0.05);
      const nextKeyframes = [...existingKeyframes];
      if (index >= 0) {
        nextKeyframes[index] = { ...nextKeyframes[index], [prop]: value };
      } else {
        nextKeyframes.push({ time: currentTime, [prop]: value });
      }
      updateClip(clip.id, { keyframes: nextKeyframes });
    } else {
      updateClip(clip.id, { [prop]: value });
    }
  };

  const toggleKeyframe = (prop: "posX" | "posY" | "scale" | "rotation" | "opacity") => {
    const props = clip.keyframedProps || [];
    const isKeyframed = props.includes(prop);
    const nextProps = isKeyframed ? props.filter((p) => p !== prop) : [...props, prop];

    let nextKeyframes = clip.keyframes || [];
    if (!isKeyframed) {
      const val = interpClipProp(clip, prop, currentTime) ?? clip[prop] ?? (prop === "scale" || prop === "opacity" ? 1 : prop === "rotation" ? 0 : 50);
      const index = nextKeyframes.findIndex((k) => Math.abs(k.time - currentTime) < 0.05);
      if (index >= 0) {
        nextKeyframes[index] = { ...nextKeyframes[index], [prop]: val };
      } else {
        nextKeyframes.push({ time: currentTime, [prop]: val });
      }
    } else {
      nextKeyframes = nextKeyframes.map(k => {
        const copy = { ...k };
        delete copy[prop];
        return copy;
      }).filter(k => Object.keys(k).length > 1);
    }
    updateClip(clip.id, { keyframedProps: nextProps, keyframes: nextKeyframes });
  };

  const hasKeyframeAtCurrentTime = (prop: string) => {
    if (!clip.keyframes) return false;
    const kf = clip.keyframes.find(k => Math.abs(k.time - currentTime) < 0.05);
    return kf ? kf[prop as keyof typeof kf] !== undefined : false;
  };

  const addRemoveKeyframe = (prop: "posX" | "posY" | "scale" | "rotation" | "opacity") => {
    if (!clip.keyframedProps?.includes(prop)) return;
    const existing = clip.keyframes || [];
    const index = existing.findIndex(k => Math.abs(k.time - currentTime) < 0.05);
    let nextKeyframes = [...existing];

    if (index >= 0 && nextKeyframes[index][prop] !== undefined) {
      nextKeyframes[index] = { ...nextKeyframes[index] };
      delete nextKeyframes[index][prop];
      if (Object.keys(nextKeyframes[index]).length <= 1) {
        nextKeyframes.splice(index, 1);
      }
    } else {
      const val = interpClipProp(clip, prop, currentTime) ?? clip[prop] ?? (prop === "scale" || prop === "opacity" ? 1 : prop === "rotation" ? 0 : 50);
      if (index >= 0) {
        nextKeyframes[index] = { ...nextKeyframes[index], [prop]: val };
      } else {
        nextKeyframes.push({ time: currentTime, [prop]: val });
      }
    }
    updateClip(clip.id, { keyframes: nextKeyframes });
  };

  if (clip.kind === "text" || clip.kind === "solid") {
    return (
      <div className="h-full overflow-y-auto space-y-4 p-4 text-xs bg-panel">
        <header className="border-b border-border pb-2">
          <h3 className="text-xs font-semibold">Animation</h3>
          <p className="text-[10px] text-muted-foreground mr-1">Animate overlay parameters</p>
        </header>

        <div className="bg-panel-2 p-2.5 rounded border border-border space-y-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Properties Keyframes</div>

          {/* Scale Keyframing */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground">Scale</label>
              <div className="flex items-center gap-1.5">
                <div className="w-16">
                  <DraggableNumberInput
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={interpClipProp(clip, "scale", currentTime) ?? clip.scale ?? 1}
                    onChange={(v) => handlePropChange("scale", v)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => addRemoveKeyframe("scale")}
                  className={`rounded p-1 transition-colors ${hasKeyframeAtCurrentTime("scale")
                    ? "text-primary hover:bg-primary/20"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  disabled={!clip.keyframedProps?.includes("scale")}
                  title="Add Keyframe"
                >
                  <Diamond className="h-3.5 w-3.5 fill-current" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleKeyframe("scale")}
                  className={`rounded p-1 transition-colors ${clip.keyframedProps?.includes("scale")
                    ? "text-yellow-500 bg-yellow-500/20"
                    : "text-muted-foreground hover:bg-accent"
                    }`}
                  title="Keyframe Switch"
                >
                  <Star className="h-3.5 w-3.5 fill-current" />
                </button>
              </div>
            </div>
          </div>

          {/* Position X Keyframing */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground">Position X (%)</label>
              <div className="flex items-center gap-1.5">
                <div className="w-16">
                  <DraggableNumberInput
                    min={-100}
                    max={200}
                    step={1}
                    value={interpClipProp(clip, "posX", currentTime) ?? clip.posX ?? 50}
                    onChange={(v) => handlePropChange("posX", v)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => addRemoveKeyframe("posX")}
                  className={`rounded p-1 transition-colors ${hasKeyframeAtCurrentTime("posX")
                    ? "text-primary hover:bg-primary/20"
                    : "text-muted-foreground hover:bg-accent"
                    }`}
                  disabled={!clip.keyframedProps?.includes("posX")}
                >
                  <Diamond className="h-3.5 w-3.5 fill-current" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleKeyframe("posX")}
                  className={`rounded p-1 transition-colors ${clip.keyframedProps?.includes("posX")
                    ? "text-yellow-500 bg-yellow-500/20"
                    : "text-muted-foreground hover:bg-accent"
                    }`}
                >
                  <Star className="h-3.5 w-3.5 fill-current" />
                </button>
              </div>
            </div>
          </div>

          {/* Position Y Keyframing */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground">Position Y (%)</label>
              <div className="flex items-center gap-1.5">
                <div className="w-16">
                  <DraggableNumberInput
                    min={-100}
                    max={200}
                    step={1}
                    value={interpClipProp(clip, "posY", currentTime) ?? clip.posY ?? 50}
                    onChange={(v) => handlePropChange("posY", v)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => addRemoveKeyframe("posY")}
                  className={`rounded p-1 transition-colors ${hasKeyframeAtCurrentTime("posY")
                    ? "text-primary hover:bg-primary/20"
                    : "text-muted-foreground hover:bg-accent"
                    }`}
                  disabled={!clip.keyframedProps?.includes("posY")}
                >
                  <Diamond className="h-3.5 w-3.5 fill-current" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleKeyframe("posY")}
                  className={`rounded p-1 transition-colors ${clip.keyframedProps?.includes("posY")
                    ? "text-yellow-500 bg-yellow-500/20"
                    : "text-muted-foreground hover:bg-accent"
                    }`}
                >
                  <Star className="h-3.5 w-3.5 fill-current" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Display keyframes list */}
        {renderKeyframesList(clip, updateClip)}
      </div>
    );
  }

  // Visual Media (image/video) Animation properties
  return (
    <div className="h-full overflow-y-auto space-y-4 p-4 text-xs bg-panel">
      <header className="border-b border-border pb-2">
        <h3 className="text-xs font-semibold">Animation</h3>
        <p className="text-[10px] text-muted-foreground">Ken Burns effect & Keyframes</p>
      </header>

      {/* Animation Types selection */}
      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">Animation Type</label>
        <div className="grid grid-cols-2 gap-1.5">
          {ANIMS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => updateClip(clip.id, { animation: a })}
              className={`rounded border px-2 py-1.5 text-[11px] capitalize transition-colors ${clip.animation === a
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border bg-panel-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
            >
              {a.replace("-", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Animation Intensity slider */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
          <label>Animation Intensity</label>
          <span className="font-mono">{(clip.intensity ?? 1).toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={clip.intensity ?? 1}
          onChange={(e) => updateClip(clip.id, { intensity: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </div>

      {/* Anchor point X and Y sliders */}
      <div className="space-y-2 border-t border-border pt-3">
        <label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">Ken Burns Focus (Anchor)</label>
        <div className="space-y-3 mt-1.5">
          <AnchorInput
            axis="X"
            value={clip.anchorX ?? 50}
            maxPx={imgDims?.w}
            onChange={(v) => updateClip(clip.id, { anchorX: v })}
          />
          <AnchorInput
            axis="Y"
            value={clip.anchorY ?? 50}
            maxPx={imgDims?.h}
            onChange={(v) => updateClip(clip.id, { anchorY: v })}
          />
        </div>

        <div className="mt-1 flex items-center justify-between">
          <button
            onClick={() => updateClip(clip.id, { anchorX: 50, anchorY: 50 })}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Reset to center
          </button>
          <span className="text-[10px] font-mono text-muted-foreground">
            {(clip.anchorX ?? 50)}% / {(clip.anchorY ?? 50)}%
          </span>
        </div>
      </div>

      {/* Display keyframes list */}
      {renderKeyframesList(clip, updateClip)}
    </div>
  );
}

function renderKeyframesList(clip: ClipDoc, updateClip: any) {
  if (!clip.keyframes || clip.keyframes.length === 0) return null;
  return (
    <div className="border-t border-border pt-3.5 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Keyframes Timeline
      </div>
      <div className="flex flex-col gap-1.5">
        {clip.keyframes
          .slice()
          .sort((a, b) => a.time - b.time)
          .map((kf, idx) => (
            <div key={idx} className="flex items-center justify-between rounded border border-border bg-panel-2 px-2 py-1 text-[10.5px]">
              <span className="font-medium text-foreground">Keyframe {idx + 1}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.01"
                  value={Number(kf.time.toFixed(3))}
                  onChange={(e) => {
                    const newTime = Math.max(clip.start, Math.min(clip.start + clip.duration, Number(e.target.value)));
                    const nextKfs = [...clip.keyframes!];
                    const origIdx = clip.keyframes!.findIndex(k => k.time === kf.time);
                    if (origIdx >= 0) {
                      nextKfs[origIdx] = { ...nextKfs[origIdx], time: newTime };
                      updateClip(clip.id, { keyframes: nextKfs });
                    }
                  }}
                  className="w-14 rounded border border-border bg-panel px-1 py-0.5 text-right font-mono text-[10px]"
                />
                <span className="text-[9px] text-muted-foreground opacity-60">s</span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// MEDIA PANEL
// ----------------------------------------------------
export function MediaPanel({
  onImportMedia,
  onDownloadMedia,
}: {
  onImportMedia?: () => void;
  onDownloadMedia?: () => void;
}) {
  return (
    <div className="h-full flex flex-col p-4 text-xs bg-panel">
      <header className="border-b border-border pb-2.5 mb-4 shrink-0">
        <h3 className="text-xs font-semibold">Media Manager</h3>
        <p className="text-[10px] text-muted-foreground">Manage and download project media assets</p>
      </header>

      <div className="space-y-3 flex-1 flex flex-col justify-center max-w-xs mx-auto w-full">
        <button
          type="button"
          onClick={onImportMedia}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-panel-2 py-3.5 hover:bg-accent text-sm font-semibold transition-all shadow-sm hover:scale-[1.01]"
        >
          <Film className="h-4.5 w-4.5 text-primary" />
          Import Media
        </button>

        <button
          type="button"
          onClick={onDownloadMedia}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-panel-2 py-3.5 hover:bg-accent text-sm font-semibold transition-all shadow-sm hover:scale-[1.01]"
        >
          <Sparkles className="h-4.5 w-4.5 text-yellow-500" />
          Download Media
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// CAPTIONS PANEL
// ----------------------------------------------------
export function CaptionsPanel() {
  const { settings } = useEditor();
  const updateSettings = useEditor((s) => s.updateSettings);

  const onChange = (patch: Partial<typeof settings>) => {
    updateSettings(patch);
  };

  const showCaptions = settings.showCaptions ?? true;

  return (
    <div className="h-full overflow-y-auto space-y-4 p-4 text-xs bg-panel">
      <header className="border-b border-border pb-2.5">
        <h3 className="text-xs font-semibold">Captions Settings</h3>
        <p className="text-[10px] text-muted-foreground mr-1">Tweak text styling controls</p>
      </header>

      {/* Toggle */}
      <div className="flex items-center justify-between bg-panel-2 p-2.5 rounded border border-border">
        <div>
          <div className="font-semibold text-foreground text-[11.5px]">Display Captions</div>
          <div className="text-[9px] text-muted-foreground">Display overlay captions in player</div>
        </div>
        <button
          type="button"
          onClick={() => onChange({ showCaptions: !showCaptions })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${showCaptions ? "bg-primary" : "bg-muted"
            }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${showCaptions ? "translate-x-4.5" : "translate-x-1"
              }`}
          />
        </button>
      </div>

      {showCaptions && (
        <div className="space-y-4 pt-1">
          {/* Colors */}
          <div className="grid grid-cols-2 gap-3 pb-2 border-b border-border/50">
            <div>
              <label className="mb-1 block text-[10px] text-muted-foreground">Text Color</label>
              <div className="flex gap-1.5">
                <input
                  type="color"
                  value={settings.captionTextColor ?? "#000000"}
                  onChange={(e) => onChange({ captionTextColor: e.target.value })}
                  className="h-7 w-7 rounded border border-border bg-transparent p-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.captionTextColor ?? "#000000"}
                  onChange={(e) => onChange({ captionTextColor: e.target.value })}
                  className="w-16 rounded border border-border bg-panel-2 px-1 text-[10px] text-center font-mono"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-muted-foreground">Background Color</label>
              <div className="flex gap-1.5">
                <input
                  type="color"
                  value={settings.captionBgColor ?? "#ffffff"}
                  onChange={(e) => onChange({ captionBgColor: e.target.value })}
                  className="h-7 w-7 rounded border border-border bg-transparent p-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.captionBgColor ?? "#ffffff"}
                  onChange={(e) => onChange({ captionBgColor: e.target.value })}
                  className="w-16 rounded border border-border bg-panel-2 px-1 text-[10px] text-center font-mono"
                />
              </div>
            </div>
          </div>

          {/* Positions */}
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                <label>Position X (Horizontal)</label>
                <span className="font-mono">{settings.captionPosX ?? 50}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.captionPosX ?? 50}
                onChange={(e) => onChange({ captionPosX: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                <label>Position Y (Vertical)</label>
                <span className="font-mono">{settings.captionPosY ?? 75}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.captionPosY ?? 75}
                onChange={(e) => onChange({ captionPosY: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>
          </div>

          {/* Size */}
          <div className="space-y-1 pt-1">
            <div className="flex justify-between items-center text-[10px] text-muted-foreground">
              <label>Font Size</label>
              <span className="font-mono">{settings.captionFontSize ?? 36}px</span>
            </div>
            <input
              type="range"
              min={12}
              max={120}
              value={settings.captionFontSize ?? 36}
              onChange={(e) => onChange({ captionFontSize: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Legacy fallback component
export function Inspector() {
  return <MediaPanel />;
}

// ----------------------------------------------------
// ANCHOR INPUT SUB-COMPONENT
// ----------------------------------------------------
function AnchorInput({
  axis,
  value,
  maxPx,
  onChange,
}: {
  axis: "X" | "Y";
  value: number; // percentage 0..100
  maxPx?: number | null; // intrinsic pixel size for axis
  onChange: (v: number) => void;
}) {
  const px = Math.round(((value ?? 0) / 100) * (maxPx ?? 100));
  const clampPercent = (p: number) => Math.max(0, Math.min(100, Math.round(p)));
  const onPxChange = (newPx: number) => {
    if (maxPx && maxPx > 0) {
      const nextPct = clampPercent((newPx / maxPx) * 100);
      onChange(nextPct);
    } else {
      onChange(clampPercent(newPx));
    }
  };

  return (
    <div>
      <label className="mb-0.5 block text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold">
        {axis} ({maxPx ? `${px}px / ${value}%` : `${value}%`})
      </label>
      <div className="flex items-center gap-1.5">
        <input
          type="range"
          min={0}
          max={maxPx ?? 100}
          step={1}
          value={px}
          onChange={(e) => onPxChange(Number(e.target.value))}
          className="flex-1 accent-primary"
        />
        <input
          type="number"
          min={0}
          max={maxPx ?? 100}
          value={px}
          onChange={(e) => onPxChange(Number(e.target.value))}
          className="w-16 rounded border border-border bg-panel-2 px-1 py-0.5 text-right font-mono text-[10px]"
        />
      </div>
    </div>
  );
}

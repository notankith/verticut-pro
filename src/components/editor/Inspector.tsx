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

      {/* Anchor point X slider */}
      <div className="space-y-1.5 border-t border-border pt-3">
        <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
          <label>Ken Burns Focus (Anchor X)</label>
          <span className="font-mono">{(clip.anchorX ?? 50)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={clip.anchorX ?? 50}
          onChange={(e) => updateClip(clip.id, { anchorX: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <button
            onClick={() => updateClip(clip.id, { anchorX: 50, anchorY: 50 })}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Reset to center
          </button>
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
  const { selectedClipId, clips } = useEditor();
  const { updateClip, deleteClip } = useTimelineActions();
  const replaceRef = useRef<HTMLInputElement>(null);
  const splitBottomRef = useRef<HTMLInputElement>(null);

  const clip = clips.find((c) => c.id === selectedClipId);
  const isMediaClip = clip && clip.kind === "media";

  return (
    <div className="h-full flex flex-col p-4 text-xs bg-panel overflow-y-auto space-y-4">
      <header className="border-b border-border pb-2.5 mb-2 shrink-0">
        <h3 className="text-xs font-semibold">Media Manager</h3>
        <p className="text-[10px] text-muted-foreground mr-1">Manage, download, and configure media tracks</p>
      </header>

      {/* Project Media Actions */}
      <div className="bg-panel-2 p-3 rounded border border-border space-y-2">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5">Project Assets</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onImportMedia}
            className="flex-1 flex items-center justify-center gap-1.5 rounded border border-border bg-panel py-2 hover:bg-accent font-semibold text-[11px]"
          >
            <Film className="h-3.5 w-3.5 text-primary" />
            Import Media
          </button>

          <button
            type="button"
            onClick={onDownloadMedia}
            className="flex-1 flex items-center justify-center gap-1.5 rounded border border-border bg-panel py-2 hover:bg-accent font-semibold text-[11px]"
          >
            <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
            Download Media
          </button>
        </div>
      </div>

      {/* Selected Media Item Actions */}
      {isMediaClip ? (
        <div className="bg-panel-2 p-3 rounded border border-border space-y-3.5">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1">Selected Media Properties</div>
            <p className="text-[9.5px] text-muted-foreground">Modify settings for the selected track element</p>
          </div>

          {/* Split Screen Control */}
          <div>
            <button
              type="button"
              onClick={() =>
                updateClip(clip.id, {
                  splitScreen: clip.splitScreen?.enabled
                    ? { ...clip.splitScreen, enabled: false }
                    : { ...(clip.splitScreen ?? {}), enabled: true },
                })
              }
              className={`w-full rounded border py-2.5 text-[11.5px] font-semibold transition-all ${clip.splitScreen?.enabled
                ? "border-primary bg-primary/10 text-primary shadow-sm"
                : "border-border bg-panel text-muted-foreground hover:bg-accent"
                }`}
            >
              Split Screen Interface: {clip.splitScreen?.enabled ? "ON" : "OFF"}
            </button>

            {clip.splitScreen?.enabled && (
              <div className="mt-2.5 space-y-2 rounded border border-border bg-panel/40 p-2">
                <div className="text-[9px] font-medium text-muted-foreground">
                  Layout: main media (top half) · bottom image (bottom half)
                </div>
                {clip.splitScreen.bottomImageUrl ? (
                  <div className="relative group rounded border border-border overflow-hidden">
                    <img
                      src={clip.splitScreen.bottomImageUrl}
                      alt="Bottom half preview"
                      className="w-full h-16 object-cover"
                    />
                  </div>
                ) : (
                  <div className="h-10 rounded border border-dashed border-border/80 flex items-center justify-center text-[10px] text-muted-foreground bg-panel/30">
                    Bottom half is empty
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => splitBottomRef.current?.click()}
                  className="flex w-full items-center justify-center gap-1.5 rounded border border-border bg-panel py-1.5 text-[10.5px] hover:bg-accent font-semibold"
                >
                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
                  {clip.splitScreen.bottomImageUrl ? "Replace Bottom Image" : "Import Bottom Image"}
                </button>
                <p className="text-center text-[9px] text-muted-foreground font-medium italic">
                  Tip: Or hit Ctrl+V with this media clip selected
                </p>
              </div>
            )}
          </div>

          {/* Replace Main Media */}
          <div className="border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => replaceRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 rounded border border-border bg-panel py-2 text-[11px] font-semibold hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5 text-primary" />
              Replace Main Media
            </button>
          </div>

          {/* Delete Clip */}
          <div className="border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => deleteClip(clip.id)}
              className="w-full flex items-center justify-center gap-1.5 rounded border border-destructive/35 bg-destructive/10 py-2.5 text-destructive hover:bg-destructive/15 text-[11px] font-semibold transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Media Clip
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-center p-3 text-[10.5px] text-muted-foreground border border-dashed border-border/80 rounded bg-panel-2/30">
          Select any media clip on the timeline to configure split screen, replace, or delete.
        </div>
      )}

      {/* Hidden inputs */}
      <input
        ref={replaceRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f || !clip) return;
          try {
            const isVideo = f.type.startsWith("video/");
            const { key, url } = await uploadToR2(f, isVideo ? "video" : "image");
            updateClip(clip.id, {
              videoUrl: isVideo ? url : undefined,
              videoKey: isVideo ? key : undefined,
              imageUrl: !isVideo ? url : undefined,
              imageKey: !isVideo ? key : undefined,
            });
          } catch (err) {
            console.error("Replacement failed", err);
          } finally {
            e.target.value = "";
          }
        }}
      />

      <input
        ref={splitBottomRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f || !clip) return;
          try {
            const { key, url } = await uploadToR2(f, "image");
            updateClip(clip.id, {
              splitScreen: { enabled: true, bottomImageKey: key, bottomImageUrl: url },
            });
          } catch (err) {
            console.error("Split screen bottom import failed:", err);
          } finally {
            e.target.value = "";
          }
        }}
      />
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

          {/* Font dropdown */}
          <div className="space-y-1 pb-1">
            <label className="text-[10px] text-muted-foreground block font-semibold uppercase">Font Family</label>
            <select
              value={settings.captionFont ?? "AcuminProCondensedBlack"}
              onChange={(e) => onChange({ captionFont: e.target.value })}
              className="w-full rounded border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary cursor-pointer"
            >
              <option value="AcuminProCondensedBlack">Acumin Pro Black (Local)</option>
              <option value="Montserrat">Montserrat Bold</option>
              <option value="Inter">Inter ExtraBold</option>
              <option value="Playfair Display">Playfair Display Black</option>
              <option value="Anton">Anton</option>
              <option value="Outfit">Outfit Bold</option>
            </select>
          </div>

          {/* Positions & Size */}
          <div className="space-y-3 border-t border-border/50 pt-2.5">
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
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            <div className="space-y-1">
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
                className="w-full accent-primary cursor-pointer"
              />
            </div>
          </div>

          {/* Lines & Words layout details */}
          <div className="space-y-3 border-t border-border/50 pt-2.5">
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                <label>Words Per Line</label>
                <span className="font-mono">{settings.captionWordsPerLine ?? 3}</span>
              </div>
              <input
                type="range"
                min={1}
                max={15}
                value={settings.captionWordsPerLine ?? 3}
                onChange={(e) => onChange({ captionWordsPerLine: Number(e.target.value) })}
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                <label>Lines Per Segment</label>
                <span className="font-mono">{settings.captionLinesPerSegment ?? 1}</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                value={settings.captionLinesPerSegment ?? 1}
                onChange={(e) => onChange({ captionLinesPerSegment: Number(e.target.value) })}
                className="w-full accent-primary cursor-pointer"
              />
            </div>
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

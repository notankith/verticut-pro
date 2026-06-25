import { useEditor } from "@/store/editor";
import { useTimelineActions } from "./hooks";
import { uploadToR2 } from "@/lib/upload";
import { useEffect, useRef, useState, useCallback } from "react";
import type { ClipDoc } from "@/server/mongo.server";
import { Trash2, RefreshCw, Image as ImageIcon, Star, Diamond, VolumeX, Volume2 } from "lucide-react";

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
    // e.preventDefault(); // allow focus to switch so it feels native
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
      className="w-full rounded border border-border bg-panel-3 px-2 py-0.5 font-mono text-[10px] cursor-ew-resize"
    />
  );
}

export function Inspector() {
  const { selectedClipId, clips, settings, audioSegments, currentTime } = useEditor();
  const { updateClip, deleteClip, updateAudioSegment, deleteAudioSegment, splitAudioAt, addKeyframe } = useTimelineActions();
  const replaceRef = useRef<HTMLInputElement>(null);
  const splitBottomRef = useRef<HTMLInputElement>(null);
  const clip = clips.find((c) => c.id === selectedClipId);
  const audioSegment = audioSegments.find((s) => s.id === selectedClipId);

  const interpClipProp = (clip: ClipDoc, prop: "posX" | "posY" | "scale" | "rotation" | "opacity", time: number) => {
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
  };

  const handlePropChange = (prop: "posX" | "posY" | "scale" | "rotation" | "opacity", value: number) => {
    if (!clip) return;
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
    if (!clip) return;
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
    if (!clip?.keyframes) return false;
    const kf = clip.keyframes.find(k => Math.abs(k.time - currentTime) < 0.05);
    return kf ? kf[prop as keyof typeof kf] !== undefined : false;
  };

  const addRemoveKeyframe = (prop: "posX" | "posY" | "scale" | "rotation" | "opacity") => {
    if (!clip || !clip.keyframedProps?.includes(prop)) return;
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

  // Probe the selected image's intrinsic pixel dimensions so the anchor inputs
  // can range 0..naturalWidth / 0..naturalHeight instead of a fixed 0–100.
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const imageUrl = clip?.imageUrl;
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

  if (audioSegment) {
    return (
      <div className="h-full overflow-y-auto space-y-4 p-3 text-xs">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Audio Segment Inspector</h3>
        
        <div className="bg-panel-2 p-2.5 rounded border border-border space-y-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Properties</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-muted-foreground">Start Time (s)</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={Number(audioSegment.projStart.toFixed(2))}
                onChange={(e) => updateAudioSegment(audioSegment.id, { projStart: Math.max(0, Number(e.target.value)) })}
                className="w-full rounded border border-border bg-panel-3 px-2 py-1 font-mono"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-muted-foreground">Duration (s)</label>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={Number(audioSegment.duration.toFixed(2))}
                onChange={(e) => updateAudioSegment(audioSegment.id, { duration: Math.max(0.1, Number(e.target.value)) })}
                className="w-full rounded border border-border bg-panel-3 px-2 py-1 font-mono"
              />
            </div>
          </div>
        </div>

        <div className="bg-panel-2 p-2.5 rounded border border-border space-y-2">    
          <div>
            <label className="mb-0.5 block text-muted-foreground">Source Start Offset (s)</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={Number(audioSegment.srcStart.toFixed(2))}
              onChange={(e) => updateAudioSegment(audioSegment.id, { srcStart: Math.max(0, Number(e.target.value)) })}
              className="w-full rounded border border-border bg-panel-3 px-2 py-1 font-mono"
            />
          </div>
        </div>

        <div className="bg-panel-2 p-2.5 rounded border border-border space-y-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Actions</div>
          
          <button
            type="button"
            onClick={() => splitAudioAt(currentTime)}
            disabled={currentTime <= audioSegment.projStart || currentTime >= audioSegment.projStart + audioSegment.duration}
            className="w-full flex items-center justify-center gap-1.5 rounded border border-border bg-panel-3 py-1.5 hover:bg-accent disabled:opacity-50 disabled:hover:bg-panel-3"
          >
            Split at Playhead ({currentTime.toFixed(2)}s)
          </button>
        </div>

        <button
          onClick={() => deleteAudioSegment(audioSegment.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-destructive/50 bg-destructive/10 py-1.5 text-destructive hover:bg-destructive/20"
        >
          <Trash2 className="h-3 w-3" /> Delete Audio Segment
        </button>
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Select a clip on the timeline to edit properties.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-4 p-3 text-xs">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Clip Inspector</h3>

      <div className="bg-panel-2 p-2.5 rounded border border-border space-y-2">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Timing</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-muted-foreground">Start Time (s)</label>
            <DraggableNumberInput
              step={0.1}
              min={0}
              max={999}
              value={clip.start}
              onChange={(v) => updateClip(clip.id, { start: v })}
            />
          </div>
          <div>
            <label className="mb-0.5 block text-muted-foreground">Duration (s)</label>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={Number(clip.duration.toFixed(2))}
              onChange={(e) => updateClip(clip.id, { duration: Math.max(0.1, Number(e.target.value)) })}
              className="w-full rounded border border-border bg-panel-3 px-2 py-1 font-mono text-[10px]"
            />
          </div>
        </div>
      </div>

      {clip.kind === "text" && (
        <div className="bg-panel-2 p-2.5 rounded border border-border space-y-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Text Layer</div>
          <textarea
            value={clip.textContent || ""}
            onChange={(e) => updateClip(clip.id, { textContent: e.target.value })}
            className="w-full rounded border border-border bg-panel-3 px-2 py-1 font-sans text-xs min-h-[60px]"
          />
        </div>
      )}

      {clip.kind === "solid" && (
        <div className="bg-panel-2 p-2.5 rounded border border-border space-y-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Solid Layer</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={clip.solidColor || "#800000"}
              onChange={(e) => updateClip(clip.id, { solidColor: e.target.value })}
              className="h-6 w-8 cursor-pointer rounded border border-border"
            />
            <span className="font-mono text-[10px]">{clip.solidColor || "#800000"}</span>
          </div>
        </div>
      )}

      {(clip.kind === "solid" || clip.kind === "text") && (
        <div className="bg-panel-2 p-2.5 rounded border border-border space-y-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Transform</div>
          <div className="space-y-2">
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
                {clip.kind !== "text" && (
                  <>
                    <button
                      type="button"
                      onClick={() => addRemoveKeyframe("scale")}
                      className={`rounded p-1 transition-colors ${
                        hasKeyframeAtCurrentTime("scale")
                          ? "text-primary hover:bg-primary/20"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                      disabled={!clip.keyframedProps?.includes("scale")}
                      title="Add/Remove Keyframe at Playhead"
                    >
                      <Diamond className="h-3.5 w-3.5 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleKeyframe("scale")}
                      className={`rounded p-1 transition-colors ${
                        clip.keyframedProps?.includes("scale")
                          ? "text-yellow-500 bg-yellow-500/20 hover:bg-yellow-500/30"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                      title="Toggle Scale Keyframing"
                    >
                      <Star className="h-3.5 w-3.5 fill-current" />
                    </button>
                  </>
                )}
              </div>
            </div>
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
                {clip.kind !== "text" && (
                  <>
                    <button
                      type="button"
                      onClick={() => addRemoveKeyframe("posX")}
                      className={`rounded p-1 transition-colors ${
                        hasKeyframeAtCurrentTime("posX")
                          ? "text-primary hover:bg-primary/20"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                      disabled={!clip.keyframedProps?.includes("posX")}
                      title="Add/Remove Keyframe at Playhead"
                    >
                      <Diamond className="h-3.5 w-3.5 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleKeyframe("posX")}
                      className={`rounded p-1 transition-colors ${
                        clip.keyframedProps?.includes("posX")
                          ? "text-yellow-500 bg-yellow-500/20 hover:bg-yellow-500/30"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                      title="Toggle Position X Keyframing"
                    >
                      <Star className="h-3.5 w-3.5 fill-current" />
                    </button>
                  </>
                )}
              </div>
            </div>
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
                {clip.kind !== "text" && (
                  <>
                    <button
                      type="button"
                      onClick={() => addRemoveKeyframe("posY")}
                      className={`rounded p-1 transition-colors ${
                        hasKeyframeAtCurrentTime("posY")
                          ? "text-primary hover:bg-primary/20"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                      disabled={!clip.keyframedProps?.includes("posY")}
                      title="Add/Remove Keyframe at Playhead"
                    >
                      <Diamond className="h-3.5 w-3.5 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleKeyframe("posY")}
                      className={`rounded p-1 transition-colors ${
                        clip.keyframedProps?.includes("posY")
                          ? "text-yellow-500 bg-yellow-500/20 hover:bg-yellow-500/30"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                      title="Toggle Position Y Keyframing"
                    >
                      <Star className="h-3.5 w-3.5 fill-current" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {(!clip.kind || clip.kind === "media") && clip.videoUrl && (
        <div className="bg-panel-2 p-2.5 rounded border border-border space-y-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Audio</div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => updateClip(clip.id, { muted: !clip.muted })}
              className="rounded p-2 hover:bg-accent"
            >
              {clip.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <div className="flex-1">
              <div className="flex justify-between mb-1">
                <label className="text-[10px] text-muted-foreground">Volume</label>
                <span className="text-[10px] text-muted-foreground">{clip.volume ?? 100}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.volume ?? 100}
                disabled={clip.muted}
                onChange={(e) => updateClip(clip.id, { volume: Number(e.target.value) })}
                className={`w-full ${clip.muted ? 'opacity-50' : ''}`}
              />
            </div>
          </div>
        </div>
      )}

      {clip.kind !== "text" && (
        <>
          <div>
        <label className="mb-1 block text-muted-foreground">Animation</label>
        <div className="grid grid-cols-2 gap-1.5">
          {ANIMS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => updateClip(clip.id, { animation: a })}
              className={`rounded border px-2 py-1.5 text-[11px] capitalize transition-colors ${
                clip.animation === a
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-panel-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {a.replace("-", " ")}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-muted-foreground">Label preset</label>
        <select
          value={clip.labelPresetId}
          onChange={(e) => {
            const nextId = e.target.value;
            const p = settings.presets.find((x) => x.id === nextId);
            // Pulling preset text into labelText keeps the rendered overlay in
            // sync. For "custom", default to the preset's text but the inline
            // input below lets the user override per-clip.
            updateClip(clip.id, { labelPresetId: nextId, labelText: p?.text ?? clip.labelText });
          }}
          className="w-full rounded border border-border bg-panel-2 px-2 py-1.5"
        >
          {settings.presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {clip.labelPresetId === "custom" ? (
          <div className="mt-2">
            <label className="mb-1 block text-muted-foreground">Custom credits</label>
            <input
              autoFocus
              value={clip.labelText}
              placeholder="e.g. © Source"
              onChange={(e) => updateClip(clip.id, { labelText: e.target.value })}
              className="w-full rounded border border-border bg-panel-2 px-2 py-1.5"
            />
          </div>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-muted-foreground">
          Anchor point <span className="text-[10px]">(animation origin within layer)</span>
        </label>
        <div className="grid grid-cols-1 gap-2">
          <AnchorInput
            axis="X"
            value={clip.anchorX ?? 50}
            maxPx={imgDims?.w}
            onChange={(v) => updateClip(clip.id, { anchorX: v })}
          />
        </div>
          <div className="mt-2">
            <label className="mb-1 block text-muted-foreground">Animation intensity ({(clip.intensity ?? 1).toFixed(1)}×)</label>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={clip.intensity ?? 1}
              onChange={(e) => updateClip(clip.id, { intensity: Number(e.target.value) })}
              className="w-full"
            />
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() =>
                updateClip(clip.id, {
                  splitScreen: clip.splitScreen?.enabled
                    ? { ...clip.splitScreen, enabled: false }
                    : { ...(clip.splitScreen ?? {}), enabled: true },
                })
              }
              className={`w-full rounded border px-2 py-1.5 text-[11px] transition-colors ${
                clip.splitScreen?.enabled
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-panel-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              Split Screen {clip.splitScreen?.enabled ? "On" : "Off"}
            </button>

            {clip.splitScreen?.enabled && (
              <div className="mt-2 space-y-1.5">
                <div className="text-[10px] text-muted-foreground">
                  Top: current image (pan left) · Bottom: {clip.splitScreen.bottomImageUrl ? "imported" : "empty"}
                </div>
                {clip.splitScreen.bottomImageUrl && (
                  <img
                    src={clip.splitScreen.bottomImageUrl}
                    alt="bottom half"
                    className="w-full rounded"
                    style={{ height: 38, objectFit: "cover" }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => splitBottomRef.current?.click()}
                  className="flex w-full items-center justify-center gap-1.5 rounded border border-border bg-panel-2 py-1.5 text-[11px] hover:bg-accent"
                >
                  <ImageIcon className="h-3 w-3" />
                  {clip.splitScreen.bottomImageUrl ? "Replace bottom" : "Import bottom"}
                </button>
                <p className="text-center text-[10px] text-muted-foreground">or Ctrl+V with this clip selected</p>
              </div>
            )}
          </div>

        <div className="mt-1.5 flex items-center justify-between">
          <button
            onClick={() => updateClip(clip.id, { anchorX: 50, anchorY: 50 })}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Reset to center
          </button>
          <span className="text-[10px] text-muted-foreground">
            {(clip.anchorX ?? 50)}% / {(clip.anchorY ?? 50)}%
          </span>
        </div>
      </div>
      </>
      )}

      <div className="flex gap-2">
        {clip.kind !== "text" && (
          <button
            onClick={() => replaceRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded border border-border bg-panel-2 py-1.5 hover:bg-accent"
          >
            <RefreshCw className="h-3 w-3" /> Replace
          </button>
        )}
        <button
          onClick={() => deleteClip(clip.id)}
          className={`flex items-center justify-center gap-1.5 rounded border border-destructive/50 bg-destructive/10 py-1.5 text-destructive hover:bg-destructive/20 ${clip.kind === "text" ? "flex-1" : "px-3"}`}
        >
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </div>

      {clip.kind !== "text" && clip.keyframes && clip.keyframes.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Keyframes Editor
          </div>
          <div className="flex flex-col gap-2">
            {clip.keyframes
              .map((kf, originalIdx) => ({ kf, originalIdx }))
              .sort((a, b) => a.kf.time - b.kf.time)
              .map(({ kf, originalIdx }, displayIdx) => (
              <div key={originalIdx} className="flex items-center justify-between rounded border border-border bg-panel-2 px-2 py-1.5 text-[11px]">
                <span className="font-medium text-foreground">Keyframe {displayIdx + 1}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    value={Number(kf.time.toFixed(3))}
                    onChange={(e) => {
                      const newTime = Math.max(clip.start, Math.min(clip.start + clip.duration, Number(e.target.value)));
                      const nextKfs = [...clip.keyframes!];
                      nextKfs[originalIdx] = { ...nextKfs[originalIdx], time: newTime };
                      updateClip(clip.id, { keyframes: nextKfs });
                    }}
                    className="w-16 rounded border border-border bg-panel px-1.5 py-0.5 text-right font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-muted-foreground opacity-60">sec</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        ref={replaceRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const { key, url } = await uploadToR2(f, "image");
          updateClip(clip.id, { imageKey: key, imageUrl: url });
        }}
      />
      <input
        ref={splitBottomRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const targetEl = e.target;
          try {
            const { key, url } = await uploadToR2(f, "image");
            updateClip(clip.id, {
              splitScreen: { enabled: true, bottomImageKey: key, bottomImageUrl: url },
            });
          } catch (err) {
            console.error("Split screen bottom import failed:", err);
          } finally {
            targetEl.value = "";
          }
        }}
      />
    </div>
  );
}

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
  // Convert stored percent -> pixel for UI when we have intrinsic size
  const px = Math.round(((value ?? 0) / 100) * (maxPx ?? 100));
  const clampPercent = (p: number) => Math.max(0, Math.min(100, Math.round(p)));
  const onPxChange = (newPx: number) => {
    if (maxPx && maxPx > 0) {
      const nextPct = clampPercent((newPx / maxPx) * 100);
      onChange(nextPct);
    } else {
      // fallback: treat incoming value as percent when no intrinsic size
      onChange(clampPercent(newPx));
    }
  };

  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
        {axis} ({maxPx ? `${px}px / ${value}%` : `${value}%`})
      </label>
      <div className="flex items-center gap-1">
        <input
          type="range"
          min={0}
          max={maxPx ?? 100}
          step={1}
          value={px}
          onChange={(e) => onPxChange(Number(e.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          min={0}
          max={maxPx ?? 100}
          value={px}
          onChange={(e) => onPxChange(Number(e.target.value))}
          className="w-20 rounded border border-border bg-panel-2 px-1 py-0.5 text-right text-[11px]"
        />
      </div>
    </div>
  );
}

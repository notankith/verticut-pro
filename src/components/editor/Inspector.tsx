import { useEditor } from "@/store/editor";
import { useTimelineActions } from "./hooks";
import { uploadToR2 } from "@/lib/upload";
import { useEffect, useRef, useState } from "react";
import type { ClipDoc } from "@/server/mongo.server";
import { Trash2, RefreshCw, Image as ImageIcon } from "lucide-react";

const ANIMS: ClipDoc["animation"][] = ["zoom-in", "zoom-out", "pan-left", "pan-right"];

export function Inspector() {
  const { selectedClipId, clips, settings } = useEditor();
  const { updateClip, deleteClip } = useTimelineActions();
  const replaceRef = useRef<HTMLInputElement>(null);
  const splitBottomRef = useRef<HTMLInputElement>(null);
  const clip = clips.find((c) => c.id === selectedClipId);

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

  if (!clip) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a clip
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-4 p-3 text-xs">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Clip Inspector</h3>

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

      <div className="flex gap-2">
        <button
          onClick={() => replaceRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-border bg-panel-2 py-1.5 hover:bg-accent"
        >
          <RefreshCw className="h-3 w-3" /> Replace
        </button>
        <button
          onClick={() => deleteClip(clip.id)}
          className="flex items-center justify-center gap-1.5 rounded border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-destructive hover:bg-destructive/20"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </div>

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

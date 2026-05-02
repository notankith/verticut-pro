import { useEditor } from "@/store/editor";
import { useTimelineActions } from "./hooks";
import { uploadToR2 } from "@/lib/upload";
import { useRef } from "react";
import type { ClipDoc } from "@/server/mongo.server";
import { Trash2, RefreshCw } from "lucide-react";

const ANIMS: ClipDoc["animation"][] = ["zoom-in", "zoom-out", "pan-left", "pan-right"];

export function Inspector() {
  const { selectedClipId, clips, settings } = useEditor();
  const { updateClip, deleteClip } = useTimelineActions();
  const replaceRef = useRef<HTMLInputElement>(null);
  const clip = clips.find((c) => c.id === selectedClipId);

  if (!clip) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a clip
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3 text-xs">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Clip Inspector</h3>

      <div>
        <label className="mb-1 block text-muted-foreground">Animation</label>
        <select
          value={clip.animation}
          onChange={(e) => updateClip(clip.id, { animation: e.target.value as ClipDoc["animation"] })}
          className="w-full rounded border border-border bg-panel-2 px-2 py-1.5"
        >
          {ANIMS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-muted-foreground">Label text</label>
        <input
          value={clip.labelText}
          onChange={(e) => updateClip(clip.id, { labelText: e.target.value })}
          className="w-full rounded border border-border bg-panel-2 px-2 py-1.5"
        />
      </div>

      <div>
        <label className="mb-1 block text-muted-foreground">Label preset</label>
        <select
          value={clip.labelPresetId}
          onChange={(e) => {
            const p = settings.presets.find((x) => x.id === e.target.value);
            updateClip(clip.id, { labelPresetId: e.target.value, labelText: p?.text ?? clip.labelText });
          }}
          className="w-full rounded border border-border bg-panel-2 px-2 py-1.5"
        >
          {settings.presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-muted-foreground">Duration ({clip.duration.toFixed(2)}s)</label>
        <input
          type="range"
          min={0.5}
          max={20}
          step={0.1}
          value={clip.duration}
          onChange={(e) => updateClip(clip.id, { duration: Number(e.target.value) })}
          className="w-full"
        />
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
    </div>
  );
}

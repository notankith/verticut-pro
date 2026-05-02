import { useEditor } from "@/store/editor";
import { useRef, useCallback, useEffect, useState } from "react";
import type { ClipDoc } from "@/server/mongo.server";

const ANIMS: ClipDoc["animation"][] = ["zoom-in", "zoom-out", "pan-left", "pan-right"];

function pickAnimation(neighbors: (ClipDoc | undefined)[]): ClipDoc["animation"] {
  const used = new Set(neighbors.filter(Boolean).map((c) => c!.animation));
  return ANIMS.find((a) => !used.has(a)) ?? "zoom-in";
}

function findNextStart(clips: ClipDoc[]) {
  if (clips.length === 0) return 0;
  const last = clips[clips.length - 1];
  return last.start + last.duration;
}

export function useTimelineActions() {
  const { clips, updateClips, settings, select, audioDuration } = useEditor();
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  const addImageClips = useCallback(
    (images: { url: string; key: string }[], presetId?: string) => {
      const preset = settings.presets.find((p) => p.id === presetId) ?? settings.presets[0];
      let cursor = findNextStart(clipsRef.current);
      const newClips: ClipDoc[] = [];
      for (const img of images) {
        const prev = clipsRef.current[clipsRef.current.length - 1] ?? newClips[newClips.length - 1];
        const animation = pickAnimation([prev, newClips[newClips.length - 1]]);
        const c: ClipDoc = {
          id: crypto.randomUUID(),
          start: cursor,
          duration: 3.5,
          imageUrl: img.url,
          imageKey: img.key,
          animation,
          labelText: preset?.text ?? settings.defaultLabelText,
          labelPresetId: preset?.id ?? "custom",
        };
        newClips.push(c);
        cursor += 3.5;
      }
      updateClips([...clipsRef.current, ...newClips]);
      if (newClips[0]) select(newClips[0].id);
    },
    [settings, updateClips, select],
  );

  const moveClip = useCallback(
    (id: string, newStart: number) => {
      updateClips((prev) => {
        const list = [...prev].sort((a, b) => a.start - b.start);
        const idx = list.findIndex((c) => c.id === id);
        if (idx < 0) return prev;
        const c = list[idx];
        const dur = c.duration;
        let s = Math.max(0, newStart);
        const before = list[idx - 1];
        const after = list[idx + 1];
        const beforeEnd = before ? before.start + before.duration : 0;
        const afterStart = after ? after.start : Math.max(audioDuration, s + dur);
        // Snap
        const SNAP = 8 / (useEditor.getState().zoom || 60);
        if (Math.abs(s - beforeEnd) < SNAP) s = beforeEnd;
        if (Math.abs(s + dur - afterStart) < SNAP) s = afterStart - dur;
        // Clamp to no overlap
        if (s < beforeEnd) s = beforeEnd;
        if (s + dur > afterStart) s = afterStart - dur;
        list[idx] = { ...c, start: s };
        return list;
      });
    },
    [updateClips, audioDuration],
  );

  const trimClip = useCallback(
    (id: string, edge: "start" | "end", newValue: number) => {
      updateClips((prev) => {
        const list = [...prev].sort((a, b) => a.start - b.start);
        const idx = list.findIndex((c) => c.id === id);
        if (idx < 0) return prev;
        const c = list[idx];
        const before = list[idx - 1];
        const after = list[idx + 1];
        const beforeEnd = before ? before.start + before.duration : 0;
        const afterStart = after ? after.start : Math.max(audioDuration || 9999, c.start + c.duration);
        if (edge === "start") {
          let s = Math.max(beforeEnd, Math.min(c.start + c.duration - 0.5, newValue));
          const dur = c.start + c.duration - s;
          list[idx] = { ...c, start: s, duration: dur };
        } else {
          const end = Math.min(afterStart, Math.max(c.start + 0.5, newValue));
          list[idx] = { ...c, duration: end - c.start };
        }
        return list;
      });
    },
    [updateClips, audioDuration],
  );

  const deleteClip = useCallback(
    (id: string) => {
      updateClips((prev) => prev.filter((c) => c.id !== id));
      select(null);
    },
    [updateClips, select],
  );

  const updateClip = useCallback(
    (id: string, patch: Partial<ClipDoc>) => {
      updateClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [updateClips],
  );

  return { addImageClips, moveClip, trimClip, deleteClip, updateClip };
}

// Auto-save hook
export function useAutoSave(save: (clips: ClipDoc[]) => Promise<void>) {
  const clips = useEditor((s) => s.clips);
  const setSaving = useEditor((s) => s.set);
  const [first, setFirst] = useState(true);
  useEffect(() => {
    if (first) {
      setFirst(false);
      return;
    }
    setSaving({ saving: "saving" });
    const t = setTimeout(async () => {
      try {
        await save(clips);
        setSaving({ saving: "saved" });
      } catch {
        setSaving({ saving: "idle" });
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips]);
}

import { useCallback, useRef, useState, useEffect } from "react";
import { useEditor } from "@/store/editor";
import type { ClipDoc } from "@/server/mongo.server";

const ANIMS: ClipDoc["animation"][] = ["zoom-in", "zoom-out", "pan-left", "pan-right"];

function findNextStart(clips: ClipDoc[]) {
  if (clips.length === 0) return 0;
  const last = clips[clips.length - 1];
  return last.start + last.duration;
}

export { findNextStart };

export function useTimelineActions() {
  const { clips, updateClips, settings, select, audioDuration } = useEditor();
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  const addImageClips = useCallback(
    (images: { url: string; key: string }[], presetId?: string) => {
      const chosenPresetId = presetId ?? settings.defaultPresetId;
      const preset = settings.presets.find((p) => p.id === chosenPresetId) ?? settings.presets[0];
      let cursor = findNextStart(clipsRef.current);
      const newClips: ClipDoc[] = [];
      for (const img of images) {
        const isVideo = img.url.match(/\.(mp4|webm|mov|mkv)$/i) || img.url.includes("/video/");
        const c: ClipDoc = {
          id: crypto.randomUUID(),
          start: cursor,
          duration: 3.5,
          ...(isVideo ? { videoUrl: img.url, videoKey: img.key } : { imageUrl: img.url, imageKey: img.key }),
          animation: "zoom-in",
          intensity: settings.animationIntensity,
          labelText: preset?.text ?? settings.defaultLabelText,
          labelPresetId: preset?.id ?? "custom",
        };
        newClips.push(c);
        cursor += 3.5;
      }
      for (let i = 0; i < newClips.length; i++) {
        // "completely mixed and random"
        newClips[i].animation = ANIMS[Math.floor(Math.random() * ANIMS.length)];
      }
      updateClips([...clipsRef.current, ...newClips]);
      if (newClips[0]) select(newClips[0].id);
    },
    [settings, updateClips, select],
  );

  const moveClip = useCallback(
    (id: string, newStart: number, record = true) => {
      updateClips((prev) => {
        const idx = prev.findIndex((c) => c.id === id);
        if (idx < 0) return prev;
        const c = prev[idx];
        const dur = c.duration;
        
        const othersToSnap = prev.filter(o => o.id !== id);
        
        let target = Math.max(0, newStart);
        const SNAP = 8 / (useEditor.getState().zoom || 60);

        let snappedPos = target;
        let nearestSnapDist = SNAP;
        for (const o of othersToSnap) {
          const d1 = Math.abs(target - (o.start + o.duration));
          if (d1 < nearestSnapDist) { snappedPos = o.start + o.duration; nearestSnapDist = d1; }
          const d2 = Math.abs((target + dur) - o.start);
          if (d2 < nearestSnapDist) { snappedPos = o.start - dur; nearestSnapDist = d2; }
          const d3 = Math.abs(target - o.start);
          if (d3 < nearestSnapDist) { snappedPos = o.start; nearestSnapDist = d3; }
          const d4 = Math.abs((target + dur) - (o.start + o.duration));
          if (d4 < nearestSnapDist) { snappedPos = o.start + o.duration - dur; nearestSnapDist = d4; }
        }
        
        target = Math.max(0, snappedPos);
        
        const list = [...prev];
        list[idx] = { ...c, start: target };
        return list;
      }, record);
    },
    [updateClips],
  );

  const trimClip = useCallback(
    (id: string, edge: "start" | "end", newValue: number, record = true) => {
      updateClips((prev) => {
        const c = prev.find((x) => x.id === id);
        if (!c) return prev;
        
        let newStart = c.start;
        let newDur = c.duration;
        
        if (edge === "start") {
          newStart = Math.max(0, Math.min(c.start + c.duration - 0.5, newValue));
          newDur = c.start + c.duration - newStart;
        } else {
          const end = Math.max(c.start + 0.5, newValue);
          newDur = end - c.start;
        }
        
        const list = [...prev];
        const globalIdx = list.findIndex(x => x.id === id);
        list[globalIdx] = { ...c, start: newStart, duration: newDur };
        return list;
      }, record);
    },
    [updateClips],
  );

  const deleteClip = useCallback(
    (id: string) => {
      updateClips((prev) => prev.filter((c) => c.id !== id));
      select(null);
    },
    [updateClips, select],
  );
 
  const updateClip = useCallback(
    (id: string, patch: Partial<ClipDoc>, record = true) => {
      updateClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)), record);
    },
    [updateClips],
  );

  const splitClip = useCallback(
    (id: string, atTime: number) => {
      updateClips((prev) => {
        const list = [...prev].sort((a, b) => a.start - b.start);
        const idx = list.findIndex((c) => c.id === id);
        if (idx < 0) return prev;
        const c = list[idx];
        if (atTime <= c.start + 0.01 || atTime >= c.start + c.duration - 0.01) return prev;
        const leftDur = atTime - c.start;
        const rightDur = c.start + c.duration - atTime;
        const left: ClipDoc = { ...c, id: crypto.randomUUID(), duration: leftDur };
        const right: ClipDoc = { ...c, id: crypto.randomUUID(), start: atTime, duration: rightDur };
        list.splice(idx, 1, left, right);
        return list;
      });
    },
    [updateClips],
  );

  const addKeyframe = useCallback(
    (clipId: string, kf: { time: number; scale?: number; posX?: number; posY?: number; rotation?: number }) => {
      updateClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, keyframes: [...(c.keyframes ?? []), kf] } : c)));
    },
    [updateClips],
  );

  // Audio editing helpers: operate on audioSegments stored in the editor state
  const splitAudioAt = useCallback(
    (t: number) => {
      const segs = useEditor.getState().audioSegments.slice();
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (t > s.projStart && t < s.projStart + s.duration) {
          const offset = t - s.projStart;
          const left: any = { id: crypto.randomUUID(), srcStart: s.srcStart, duration: offset, projStart: s.projStart };
          const right: any = { id: crypto.randomUUID(), srcStart: s.srcStart + offset, duration: s.duration - offset, projStart: s.projStart + offset };
          segs.splice(i, 1, left, right);
          // adjust following segments' projStart (they are already correct relative)
          useEditor.getState().set({ audioSegments: segs });
          return;
        }
      }
    },
    [],
  );

  const deleteAudioRange = useCallback(
    (start: number, end: number, closeGap = true) => {
      if (end <= start) return;
      const segs = useEditor.getState().audioSegments.slice();
      let removed = 0;
      const keep: typeof segs = [];
      for (const s of segs) {
        const segStart = s.projStart;
        const segEnd = s.projStart + s.duration;
        if (segEnd <= start || segStart >= end) {
          keep.push({ ...s });
        } else {
          // segment overlaps deletion range — may need to keep left/right parts
          if (segStart < start) {
            keep.push({ id: crypto.randomUUID(), srcStart: s.srcStart, duration: start - segStart, projStart: segStart });
          }
          if (segEnd > end) {
            const rightDur = segEnd - end;
            const rightSrc = s.srcStart + (s.duration - rightDur);
            // will set projStart after compaction
            keep.push({ id: crypto.randomUUID(), srcStart: rightSrc, duration: rightDur, projStart: end });
          }
          removed += Math.min(segEnd, end) - Math.max(segStart, start);
        }
      }
      // If closeGap, shift following segments earlier by removed amount
      if (closeGap && removed > 0) {
        keep.sort((a, b) => a.projStart - b.projStart);
        let cur = 0;
        for (const s of keep) {
          s.projStart = cur;
          cur += s.duration;
        }
      }
      useEditor.getState().set({ audioSegments: keep });
    },
    [],
  );

  const moveAudioSegment = useCallback(
    (id: string, newStart: number) => {
      const segs = useEditor.getState().audioSegments.slice();
      const idx = segs.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const s = segs[idx];
      let val = Math.max(0, newStart);
      
      const before = segs.filter((seg) => seg.id !== id && seg.projStart <= s.projStart).sort((a, b) => a.projStart - b.projStart).pop();
      const after = segs.filter((seg) => seg.id !== id && seg.projStart > s.projStart).sort((a, b) => a.projStart - b.projStart)[0];
      const beforeEnd = before ? before.projStart + before.duration : 0;
      const afterStart = after ? after.projStart : 999999;
      
      const SNAP = 8 / (useEditor.getState().zoom || 60);
      if (Math.abs(val - beforeEnd) < SNAP) val = beforeEnd;
      if (Math.abs(val + s.duration - afterStart) < SNAP) val = afterStart - s.duration;
      
      if (val < beforeEnd) val = beforeEnd;
      if (val + s.duration > afterStart) val = afterStart - s.duration;
      
      segs[idx] = { ...s, projStart: val };
      useEditor.getState().set({ audioSegments: segs });
    },
    []
  );

  const trimAudioSegment = useCallback(
    (id: string, edge: "start" | "end", newValue: number) => {
      const segs = useEditor.getState().audioSegments.slice();
      const idx = segs.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const s = segs[idx];
      const before = segs.filter((seg) => seg.id !== id && seg.projStart <= s.projStart).sort((a, b) => a.projStart - b.projStart).pop();
      const after = segs.filter((seg) => seg.id !== id && seg.projStart > s.projStart).sort((a, b) => a.projStart - b.projStart)[0];
      const beforeEnd = before ? before.projStart + before.duration : 0;
      const afterStart = after ? after.projStart : 999999;
      
      if (edge === "start") {
        let val = Math.max(beforeEnd, Math.min(s.projStart + s.duration - 0.1, newValue));
        const diff = val - s.projStart;
        segs[idx] = {
          ...s,
          projStart: val,
          srcStart: s.srcStart + diff,
          duration: s.duration - diff
        };
      } else {
        let val = Math.min(afterStart, Math.max(s.projStart + 0.1, newValue));
        segs[idx] = {
          ...s,
          duration: val - s.projStart
        };
      }
      useEditor.getState().set({ audioSegments: segs });
    },
    []
  );

  const deleteAudioSegment = useCallback(
    (id: string) => {
      const segs = useEditor.getState().audioSegments.filter((s) => s.id !== id);
      useEditor.getState().set({ audioSegments: segs });
      select(null);
    },
    [select]
  );

  const updateAudioSegment = useCallback(
    (id: string, patch: Partial<AudioSegment>) => {
      const segs = useEditor.getState().audioSegments.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      );
      useEditor.getState().set({ audioSegments: segs });
    },
    []
  );

  return {
    addImageClips,
    moveClip,
    trimClip,
    deleteClip,
    updateClip,
    splitClip,
    addKeyframe,
    splitAudioAt,
    deleteAudioRange,
    moveAudioSegment,
    trimAudioSegment,
    deleteAudioSegment,
    updateAudioSegment,
  };
}


// Auto-save hook
export function useAutoSave(save: (clips: ClipDoc[], audioDuration: number, audioSegments: AudioSegment[]) => Promise<void>) {
  const clips = useEditor((s) => s.clips);
  const audioDuration = useEditor((s) => s.audioDuration);
  const audioSegments = useEditor((s) => s.audioSegments);
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
        await save(clips, audioDuration, audioSegments);
        setSaving({ saving: "saved" });
      } catch {
        setSaving({ saving: "idle" });
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, audioDuration, audioSegments]);
}

import { useEditor } from "@/store/editor";
import { useRef, useCallback, useEffect, useState } from "react";
import type { ClipDoc, AudioSegment } from "@/server/mongo.server";

const ANIMS: ClipDoc["animation"][] = ["zoom-in", "zoom-out", "pan-left", "pan-right"];

function shuffle<T>(arr: T[]) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Generate a balanced sequence of animations of length N such that:
// - total counts are as equal as possible across ANIMS
// - order is randomized
// - avoids adjacent duplicates when possible
function generateBalancedAnimations(total: number): ClipDoc["animation"][] {
  if (total <= 0) return [];
  // base count and distribute remainder randomly among animations
  const base = Math.floor(total / ANIMS.length);
  let rem = total % ANIMS.length;
  const order = shuffle(ANIMS.slice());
  const counts: Record<string, number> = {};
  for (const a of ANIMS) counts[a] = base;
  for (let i = 0; i < rem; i++) counts[order[i]]++;

  // Greedy build to avoid adjacent duplicates
  const result: ClipDoc["animation"][] = [];
  for (let i = 0; i < total; i++) {
    const prev = result[i - 1];
    const candidates = ANIMS.filter((a) => counts[a] > 0 && a !== prev);
    if (candidates.length === 0) {
      // fallback: pick any with remaining count
      const any = ANIMS.filter((a) => counts[a] > 0);
      if (any.length === 0) break;
      const pick = any[Math.floor(Math.random() * any.length)];
      result.push(pick);
      counts[pick]--;
      continue;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    result.push(pick);
    counts[pick]--;
  }

  // If we failed to generate full length without adjacency, try simple shuffle attempts
  if (result.length !== total) {
    const flat: ClipDoc["animation"][] = [];
    for (const a of ANIMS) for (let i = 0; i < (Math.floor(total / ANIMS.length)); i++) flat.push(a);
    let extra = total - flat.length;
    const rndOrder = shuffle(ANIMS.slice());
    for (let i = 0; i < extra; i++) flat.push(rndOrder[i % rndOrder.length]);
    for (let attempt = 0; attempt < 50; attempt++) {
      const cand = shuffle(flat);
      let ok = true;
      for (let i = 1; i < cand.length; i++) if (cand[i] === cand[i - 1]) { ok = false; break; }
      if (ok) return cand;
    }
    // last resort: return cand even if duplicates
    return shuffle(flat);
  }

  return result;
}

// Generate assignments for `newCount` clips given existing clips so we do not
// change previous clips' animations but still try to balance totals.
function generateAssignmentsForNew(existing: ClipDoc[], newCount: number): ClipDoc["animation"][] {
  const existingCounts: Record<string, number> = {};
  for (const a of ANIMS) existingCounts[a] = 0;
  for (const c of existing) existingCounts[c.animation] = (existingCounts[c.animation] || 0) + 1;

  const total = existing.length + newCount;
  const base = Math.floor(total / ANIMS.length);
  let rem = total % ANIMS.length;
  const order = shuffle(ANIMS.slice());
  const desired: Record<string, number> = {};
  for (const a of ANIMS) desired[a] = base;
  for (let i = 0; i < rem; i++) desired[order[i]]++;

  // How many we need to assign to new clips per animation
  const need: Record<string, number> = {};
  let sumNeed = 0;
  for (const a of ANIMS) {
    const n = Math.max(0, desired[a] - (existingCounts[a] || 0));
    need[a] = n;
    sumNeed += n;
  }

  // Adjust if rounding left some unassigned or over-assigned
  const result: ClipDoc["animation"][] = [];
  if (sumNeed < newCount) {
    // fill remaining randomly
    const extras = newCount - sumNeed;
    const pool = [] as string[];
    for (const a of ANIMS) for (let i = 0; i < need[a]; i++) pool.push(a);
    // add extras distributed among ANIMS
    const rnd = shuffle(ANIMS.slice());
    for (let i = 0; i < extras; i++) pool.push(rnd[i % rnd.length]);
    // shuffle pool and avoid adjacency
    let attempt = 0;
    while (attempt < 50) {
      const cand = shuffle(pool);
      let ok = true;
      for (let i = 1; i < cand.length; i++) if (cand[i] === cand[i - 1]) { ok = false; break; }
      if (ok) { return cand as ClipDoc["animation"][]; }
      attempt++;
    }
    return shuffle(pool) as ClipDoc["animation"][];
  }

  if (sumNeed > newCount) {
    // reduce some needs to fit newCount
    let over = sumNeed - newCount;
    // reduce from animations with largest need first
    const sorted = ANIMS.slice().sort((a, b) => need[b] - need[a]);
    for (const a of sorted) {
      if (over <= 0) break;
      const dec = Math.min(over, need[a]);
      need[a] -= dec;
      over -= dec;
    }
  }

  // Build pool from need counts
  for (const a of ANIMS) for (let i = 0; i < need[a]; i++) result.push(a);

  // Shuffle and try to avoid adjacency, considering last existing animation
  const lastExisting = existing.length ? existing[existing.length - 1].animation : null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const cand = shuffle(result.slice());
    let ok = true;
    if (lastExisting && cand.length > 0 && cand[0] === lastExisting) ok = false;
    for (let i = 1; i < cand.length && ok; i++) if (cand[i] === cand[i - 1]) ok = false;
    if (ok) return cand as ClipDoc["animation"][];
  }

  return shuffle(result) as ClipDoc["animation"][];
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
      const chosenPresetId = presetId ?? settings.defaultPresetId;
      const preset = settings.presets.find((p) => p.id === chosenPresetId) ?? settings.presets[0];
      let cursor = findNextStart(clipsRef.current);
      const newClips: ClipDoc[] = [];
      for (const img of images) {
        const c: ClipDoc = {
          id: crypto.randomUUID(),
          start: cursor,
          duration: 3.5,
          imageUrl: img.url,
          imageKey: img.key,
          animation: "zoom-in",
          intensity: settings.animationIntensity,
          labelText: preset?.text ?? settings.defaultLabelText,
          labelPresetId: preset?.id ?? "custom",
        };
        newClips.push(c);
        cursor += 3.5;
      }
      // Assign animations only for the newly added clips, leaving existing
      // clips' animations unchanged while attempting to balance totals.
      const assignments = generateAssignmentsForNew(clipsRef.current, newClips.length);
      for (let i = 0; i < newClips.length; i++) {
        newClips[i].animation = assignments[i] ?? ANIMS[Math.floor(Math.random() * ANIMS.length)];
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

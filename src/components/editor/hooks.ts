import { useEditor } from "@/store/editor";
import { useRef, useCallback, useEffect, useState } from "react";
import type { ClipDoc } from "@/server/mongo.server";

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

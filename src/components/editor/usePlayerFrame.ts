import { useEffect, useState, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";

// Subscribe to a Remotion Player's frameupdate event so only the calling
// component re-renders per frame, not the parent that owns the Player.
export function usePlayerFrame(playerRef: RefObject<PlayerRef | null>) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", onFrame as never);
    return () => p.removeEventListener("frameupdate", onFrame as never);
  }, [playerRef]);
  return frame;
}

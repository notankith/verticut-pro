import { useEditor } from "@/store/editor";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { usePlayerFrame } from "./usePlayerFrame";

type Word = { text: string; start: number; end: number };

// Last word whose start <= t. Keeps highlight on the previous word during silence gaps.
function findActiveIndex(words: Word[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function WordTranscript({
  playerRef,
  fps,
  onSeek,
}: {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  onSeek: (t: number) => void;
}) {
  const transcript = useEditor((s) => s.transcript);
  const frame = usePlayerFrame(playerRef);
  const currentTime = frame / fps;

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);

  const activeIndex = useMemo(
    () => findActiveIndex(transcript, currentTime),
    [transcript, currentTime],
  );

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = activeRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    const elTop = el.offsetTop;
    const elHeight = el.offsetHeight;
    const cTop = container.scrollTop;
    const cHeight = container.clientHeight;
    if (elTop < cTop + 16 || elTop + elHeight > cTop + cHeight - 16) {
      container.scrollTo({ top: elTop - cHeight / 2 + elHeight / 2, behavior: "smooth" });
    }
  }, [activeIndex]);

  return (
    <div className="flex h-full flex-col p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Transcript
        </h3>
        {transcript.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{transcript.length} words</span>
        )}
      </div>
      <div className="flex-1 min-h-0 rounded border border-border bg-panel-2">
        {transcript.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-muted-foreground">
            Transcript will appear here once ready…
          </div>
        ) : (
          <div ref={scrollRef} className="h-full overflow-y-auto px-3 py-2 leading-relaxed">
            {transcript.map((w, i) => {
              const isActive = i === activeIndex;
              const isPast = i < activeIndex;
              return (
                <span
                  key={i}
                  ref={isActive ? activeRef : undefined}
                  onClick={() => onSeek(w.start)}
                  title={`${w.start.toFixed(2)}s`}
                  className={`mr-1 inline-block cursor-pointer rounded px-1 py-0.5 transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold"
                      : isPast
                      ? "text-foreground hover:bg-accent"
                      : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {w.text}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

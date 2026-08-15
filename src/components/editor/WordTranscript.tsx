import { useEditor } from "@/store/editor";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { usePlayerFrame } from "./usePlayerFrame";
import type { AudioSegment } from "@/server/mongo.server";
import { Copy, Check } from "lucide-react";

type Word = { text: string; start: number; end: number };

// Last word whose start <= t. Keeps highlight on the previous word during silence gaps.
function findActiveIndex(words: Word[], t: number): number {
  if (t < 0) return -1;
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

function getSourceTime(audioSegments: AudioSegment[], t: number): number {
  for (const s of audioSegments) {
    if (t >= s.projStart && t < s.projStart + s.duration) {
      return s.srcStart + (t - s.projStart);
    }
  }
  return -1;
}

function getProjTime(audioSegments: AudioSegment[], sourceTime: number): number {
  for (const s of audioSegments) {
    if (sourceTime >= s.srcStart && sourceTime < s.srcStart + s.duration) {
      return s.projStart + (sourceTime - s.srcStart);
    }
  }
  return sourceTime;
}

// Convert seconds to MM:SS format for sentence timestamp indicators
function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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
  const audioSegments = useEditor((s) => s.audioSegments);
  const frame = usePlayerFrame(playerRef);
  const currentTime = frame / fps;

  const [viewMode, setViewMode] = useState<"plain" | "segmented">("plain");
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(transcript, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeTime = useMemo(() => {
    if (!audioSegments || audioSegments.length === 0) return currentTime;
    return getSourceTime(audioSegments, currentTime);
  }, [audioSegments, currentTime]);

  const activeIndex = useMemo(
    () => findActiveIndex(transcript, activeTime),
    [transcript, activeTime],
  );

  // Group words into sentences based on ending punctuation marks (. ? !)
  const sentences = useMemo(() => {
    const result: { words: Word[]; startIndex: number }[] = [];
    let currentWords: Word[] = [];
    let startIndex = 0;

    transcript.forEach((w, index) => {
      if (currentWords.length === 0) {
        startIndex = index;
      }
      currentWords.push(w);
      const text = w.text.trim();
      const lastChar = text[text.length - 1];
      if (lastChar === "." || lastChar === "?" || lastChar === "!") {
        result.push({ words: currentWords, startIndex });
        currentWords = [];
      }
    });

    if (currentWords.length > 0) {
      result.push({ words: currentWords, startIndex });
    }
    return result;
  }, [transcript]);

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
    <div className="flex h-full flex-col p-4 text-xs bg-panel">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Transcript
          </h3>
          {transcript.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded bg-panel-3 hover:bg-accent hover:text-foreground text-[9px] text-muted-foreground px-1.5 py-0.5 font-semibold border border-border transition-colors cursor-pointer"
                title="Copy Transcript JSON"
              >
                {copied ? <Check className="h-2.5 w-2.5 text-green-500" /> : <Copy className="h-2.5 w-2.5" />}
                Copy JSON
              </button>
            </div>
          )}
        </div>

        {/* View Mode Switcher */}
        <div className="flex rounded bg-panel-3 p-0.5 text-[9px] font-semibold border border-border">
          <button
            type="button"
            onClick={() => setViewMode("plain")}
            className={`px-2 py-0.5 rounded transition-colors ${viewMode === "plain"
              ? "bg-primary text-primary-foreground font-bold"
              : "text-muted-foreground hover:text-foreground"
              }`}
          >
            Normal
          </button>
          <button
            type="button"
            onClick={() => setViewMode("segmented")}
            className={`px-2 py-0.5 rounded transition-colors ${viewMode === "segmented"
              ? "bg-primary text-primary-foreground font-bold"
              : "text-muted-foreground hover:text-foreground"
              }`}
          >
            Segmented
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-md border border-border bg-panel-2">
        {transcript.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-muted-foreground">
            Transcript will appear here once ready…
          </div>
        ) : (
          <div ref={scrollRef} className="h-full overflow-y-auto px-4 py-3 leading-relaxed">
            {viewMode === "plain" ? (
              // Normal View (continuous inline block)
              <div>
                {transcript.map((w, i) => {
                  const isActive = i === activeIndex;
                  const isPast = i < activeIndex;
                  return (
                    <span
                      key={i}
                      ref={isActive ? activeRef : undefined}
                      onClick={() => {
                        if (audioSegments && audioSegments.length > 0) {
                          onSeek(getProjTime(audioSegments, w.start));
                        } else {
                          onSeek(w.start);
                        }
                      }}
                      title={`${w.start.toFixed(2)}s`}
                      className={`mr-1 inline-block cursor-pointer rounded px-1 py-0.5 transition-colors ${isActive
                        ? "bg-primary text-primary-foreground font-semibold"
                        : isPast
                          ? "text-foreground hover:bg-accent font-medium mt-0.5"
                          : "text-muted-foreground hover:bg-accent mt-0.5"
                        }`}
                    >
                      {w.text}
                    </span>
                  );
                })}
              </div>
            ) : (
              // Segmented Sentence View (sentence blocks with time indicators)
              <div className="space-y-4">
                {sentences.map((sentence, sIdx) => {
                  const firstWord = sentence.words[0];
                  const tStr = firstWord ? fmtTime(firstWord.start) : "00:00";

                  return (
                    <div key={sIdx} className="flex items-start gap-3">
                      <span className="text-[10px] font-bold text-primary/70 select-none bg-panel-3 px-1.5 py-0.5 rounded shrink-0 w-11 text-center font-mono">
                        {tStr}
                      </span>
                      <div className="flex-1">
                        {sentence.words.map((w, wIdx) => {
                          const absoluteIdx = sentence.startIndex + wIdx;
                          const isActive = absoluteIdx === activeIndex;
                          const isPast = absoluteIdx < activeIndex;
                          return (
                            <span
                              key={wIdx}
                              ref={isActive ? activeRef : undefined}
                              onClick={() => {
                                if (audioSegments && audioSegments.length > 0) {
                                  onSeek(getProjTime(audioSegments, w.start));
                                } else {
                                  onSeek(w.start);
                                }
                              }}
                              title={`${w.start.toFixed(2)}s`}
                              className={`mr-1 inline-block cursor-pointer rounded px-1 py-0.5 transition-colors ${isActive
                                ? "bg-primary text-primary-foreground font-semibold"
                                : isPast
                                  ? "text-foreground hover:bg-accent font-medium mt-0.5"
                                  : "text-muted-foreground hover:bg-accent mt-0.5"
                                }`}
                            >
                              {w.text}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Replace } from "lucide-react";
import { useEditor } from "@/store/editor";
import {
  applyWordText,
  buildCaptionSegments,
  fmtCaptionTime,
  getProjTime,
  getSourceTime,
  replaceTranscriptWords,
} from "@/lib/captions";

export function SpellCheckPanel({ onSeek }: { onSeek?: (t: number) => void }) {
  const transcript = useEditor((s) => s.transcript);
  const updateTranscript = useEditor((s) => s.updateTranscript);
  const settings = useEditor((s) => s.settings);
  const audioSegments = useEditor((s) => s.audioSegments);
  const currentTime = useEditor((s) => s.currentTime);

  const [query, setQuery] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const wordsPerLine = settings.captionWordsPerLine ?? 3;
  const linesPerSegment = settings.captionLinesPerSegment ?? 1;

  const segments = useMemo(
    () => buildCaptionSegments(transcript, wordsPerLine, linesPerSegment),
    [transcript, wordsPerLine, linesPerSegment],
  );

  const srcT = useMemo(() => {
    if (!audioSegments || audioSegments.length === 0) return currentTime;
    const mapped = getSourceTime(audioSegments, currentTime);
    return mapped < 0 ? currentTime : mapped;
  }, [audioSegments, currentTime]);

  const activeIndex = useMemo(() => {
    if (segments.length === 0 || srcT < segments[0].start) return -1;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const next = segments[i + 1];
      const limit = next ? next.start : seg.end + 2;
      if (srcT >= seg.start && srcT < limit) {
        if (srcT > seg.end + 1 && next && next.start - seg.end > 1.5) return -1;
        return i;
      }
    }
    return -1;
  }, [segments, srcT]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return segments.map((seg, index) => ({ seg, index }));
    return segments
      .map((seg, index) => ({ seg, index }))
      .filter(({ seg }) => seg.words.some((w) => w.text.toLowerCase().includes(q)));
  }, [segments, query]);

  useEffect(() => {
    if (query.trim()) return;
    const el = activeRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    const elTop = el.offsetTop;
    const elHeight = el.offsetHeight;
    const cTop = container.scrollTop;
    const cHeight = container.clientHeight;
    if (elTop < cTop + 8 || elTop + elHeight > cTop + cHeight - 8) {
      container.scrollTo({ top: elTop - 12, behavior: "smooth" });
    }
  }, [activeIndex, query]);

  const seekToSegment = (start: number) => {
    if (!onSeek) return;
    if (audioSegments && audioSegments.length > 0) {
      onSeek(getProjTime(audioSegments, start));
    } else {
      onSeek(start);
    }
  };

  const replacedCount = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return 0;
    return transcript.reduce((n, w) => {
      const stripped = w.text.replace(/([.!?,]+)$/, "");
      return stripped.toLowerCase() === needle ? n + 1 : n;
    }, 0);
  }, [transcript, query]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel text-xs">
      <header className="shrink-0 border-b border-border px-3 py-2.5 space-y-2">
        <div>
          <h3 className="text-xs font-semibold">Spell Check</h3>
          <p className="text-[10px] text-muted-foreground">
            Edit words in the same segments as on-screen captions. Changes update the preview and render.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a word…"
            className="w-full rounded border border-border bg-panel-2 py-1 pl-6 pr-2 text-[10px] outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            placeholder="Replace with…"
            className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-2 py-1 text-[10px] outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={!query.trim() || replacedCount === 0}
            onClick={() => updateTranscript((prev) => replaceTranscriptWords(prev, query, replaceWith))}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-panel-2 px-2 py-1 text-[9px] font-semibold text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            title="Replace every matching word, keeping trailing punctuation"
          >
            <Replace className="h-3 w-3" />
            All{replacedCount > 0 ? ` (${replacedCount})` : ""}
          </button>
        </div>
        <div className="text-[9px] text-muted-foreground">
          {segments.length} segment{segments.length === 1 ? "" : "s"} · {wordsPerLine} word{wordsPerLine === 1 ? "" : "s"}/line · {linesPerSegment} line{linesPerSegment === 1 ? "" : "s"}/segment
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1.5">
        {transcript.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-muted-foreground">
            Transcript will appear here once ready…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">No segments match that search.</div>
        ) : (
          filtered.map(({ seg, index }) => {
            const isActive = index === activeIndex;
            return (
              <div
                key={`${seg.wordStartIndex}-${seg.start}`}
                ref={isActive ? activeRef : undefined}
                className={`rounded border p-2 transition-colors ${
                  isActive ? "border-primary bg-primary/10" : "border-border bg-panel-2"
                }`}
              >
                <button
                  type="button"
                  onClick={() => seekToSegment(seg.start)}
                  className="mb-1.5 flex w-full items-center justify-between text-left"
                  title="Jump to this caption in the preview"
                >
                  <span className="font-mono text-[10px] font-bold text-primary/80">{fmtCaptionTime(seg.start)}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {seg.words.length} word{seg.words.length === 1 ? "" : "s"}
                  </span>
                </button>
                <div className="flex flex-wrap gap-1">
                  {seg.words.map((w, wIdx) => {
                    const wordIndex = seg.wordStartIndex + wIdx;
                    const matches =
                      query.trim() &&
                      w.text.toLowerCase().includes(query.trim().toLowerCase());
                    return (
                      <input
                        key={wordIndex}
                        value={w.text}
                        onChange={(e) =>
                          updateTranscript((prev) => applyWordText(prev, wordIndex, e.target.value))
                        }
                        onFocus={() => seekToSegment(w.start)}
                        spellCheck
                        className={`min-w-[2.5ch] rounded border bg-panel px-1.5 py-0.5 text-[11px] font-medium outline-none focus:border-primary ${
                          matches ? "border-primary/70 text-foreground" : "border-border text-foreground"
                        }`}
                        style={{ width: `${Math.max(3, w.text.length + 1)}ch` }}
                        aria-label={`Word ${wordIndex + 1}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

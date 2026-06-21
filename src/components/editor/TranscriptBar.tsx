import { useEditor } from "@/store/editor";
import type { AudioSegment } from "@/server/mongo.server";

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

export function TranscriptBar({ currentTime, onSeek }: { currentTime: number; onSeek: (t: number) => void }) {
  const transcript = useEditor((s) => s.transcript);
  const audioSegments = useEditor((s) => s.audioSegments);

  if (!transcript || transcript.length === 0) {
    return (
      <div className="flex h-9 items-center px-3 text-[11px] text-muted-foreground bg-panel border-b border-border">
        Transcript will appear here once ready…
      </div>
    );
  }

  const activeTime = audioSegments && audioSegments.length > 0 ? getSourceTime(audioSegments, currentTime) : currentTime;

  return (
    <div className="h-9 overflow-x-auto whitespace-nowrap bg-panel border-b border-border px-3 py-2 text-[12px] leading-tight">
      {transcript.map((w, i) => {
        const past = w.end < activeTime;
        const current = activeTime >= w.start && activeTime <= w.end;
        const cls = current ? "text-primary font-semibold" : past ? "text-foreground" : "text-muted-foreground";
        return (
          <span
            key={i}
            className={`mr-1.5 cursor-pointer ${cls}`}
            onClick={() => {
              if (audioSegments && audioSegments.length > 0) {
                onSeek(getProjTime(audioSegments, w.start));
              } else {
                onSeek(w.start);
              }
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
}

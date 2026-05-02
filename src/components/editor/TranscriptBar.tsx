import { useEditor } from "@/store/editor";

export function TranscriptBar({ currentTime, onSeek }: { currentTime: number; onSeek: (t: number) => void }) {
  const transcript = useEditor((s) => s.transcript);
  if (!transcript || transcript.length === 0) {
    return (
      <div className="flex h-9 items-center px-3 text-[11px] text-muted-foreground bg-panel border-b border-border">
        Transcript will appear here once ready…
      </div>
    );
  }
  return (
    <div className="h-9 overflow-x-auto whitespace-nowrap bg-panel border-b border-border px-3 py-2 text-[12px] leading-tight">
      {transcript.map((w, i) => {
        const past = w.end < currentTime;
        const current = currentTime >= w.start && currentTime <= w.end;
        const cls = current ? "text-primary font-semibold" : past ? "text-foreground" : "text-muted-foreground";
        return (
          <span key={i} className={`mr-1.5 cursor-pointer ${cls}`} onClick={() => onSeek(w.start)}>
            {w.text}
          </span>
        );
      })}
    </div>
  );
}

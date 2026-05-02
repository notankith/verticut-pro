import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Upload, Film, Loader2, Download } from "lucide-react";
import { createProjectFromAudio, listProjects, listRenders, type ProjectListItem, type RenderItem } from "@/server/api.functions";
import { uploadToR2 } from "@/lib/upload";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "VertiCut — Vertical video editor" }] }),
  component: Home,
});

function fmtDuration(s: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function Home() {
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [renders, setRenders] = useState<RenderItem[]>([]);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
    listRenders().then(setRenders).catch(() => {});
    const t = setInterval(() => {
      listRenders().then(setRenders).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || !files[0]) return;
    const f = files[0];
    if (!/audio|mp3|wav|ogg|m4a/i.test(f.type + " " + f.name)) {
      setError("Please drop an audio file (mp3/wav)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { key, url } = await uploadToR2(f, "audio");
      const { id } = await createProjectFromAudio({ data: { audioKey: key, audioUrl: url } });
      nav({ to: "/project/$id", params: { id } });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-screen overflow-auto bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3 bg-panel">
        <Film className="h-5 w-5 text-primary" />
        <h1 className="text-sm font-semibold tracking-wide">VERTICUT</h1>
        <span className="text-xs text-muted-foreground">vertical video editor</span>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 space-y-10">
        <section>
          <DropZone busy={busy} onFiles={handleFiles} onClick={() => inputRef.current?.click()} />
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Projects</h2>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects yet. Drop an audio file above to start.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  to="/project/$id"
                  params={{ id: p.id }}
                  className="block rounded-md border border-border bg-panel p-4 hover:bg-panel-2 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium line-clamp-2">{p.name}</h3>
                    <StatusBadge status={p.transcriptStatus} />
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{p.clipCount} clips</span>
                    <span>{fmtDuration(p.duration)}</span>
                    <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Downloads</h2>
          {renders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No renders yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border bg-panel">
              {renders.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm truncate">{r.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.status === "rendering" ? `Rendering ${Math.round(r.progress * 100)}%` : r.status}
                      {r.error ? ` — ${r.error}` : ""}
                    </div>
                  </div>
                  {r.status === "done" && r.url ? (
                    <a
                      href={r.url}
                      download={r.filename}
                      className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground capitalize">{r.status}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-aew/20 text-aew",
    ready: "bg-primary/20 text-primary",
    error: "bg-destructive/20 text-destructive",
  };
  const label = status === "pending" ? "Transcribing" : status === "ready" ? "Draft" : "Error";
  return <span className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[status] ?? ""}`}>{label}</span>;
}

function DropZone({ busy, onFiles, onClick }: { busy: boolean; onFiles: (f: FileList | null) => void; onClick: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onClick={onClick}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
      className={`flex h-64 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
        over ? "border-primary bg-primary/5" : "border-border bg-panel hover:bg-panel-2"
      }`}
    >
      {busy ? (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="mt-3 text-sm">Uploading & starting transcription…</p>
        </>
      ) : (
        <>
          <Upload className="h-10 w-10 text-primary" />
          <p className="mt-3 text-base font-medium">Drop audio to start</p>
          <p className="text-xs text-muted-foreground">or click to choose mp3 / wav</p>
        </>
      )}
    </div>
  );
}

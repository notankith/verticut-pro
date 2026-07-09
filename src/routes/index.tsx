import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  Upload, Film, Loader2, Download, Settings as SettingsIcon, Trash2,
  Activity, CheckCircle2, AlertCircle, Clock, Zap, TrendingUp,
  Plus, ArrowRight, RefreshCw, X,
} from "lucide-react";
import {
  createProjectFromAudio,
  clearProjectsAndRenders,
  deleteProject,
  getGlobalSettings,
  listProjects,
  listRenders,
  saveGlobalSettings,
  resetAllData,
  type ProjectListItem,
  type RenderItem,
} from "@/api.functions";
import { uploadToR2 } from "@/lib/upload";
import { SettingsPanel } from "@/components/editor/SettingsPanel";
import type { SettingsDoc } from "@/server/mongo.server";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Verticut Pro" }] }),
  component: Home,
});

function fmtDuration(s: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function fmtRelative(ts: number) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function Home() {
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [renders, setRenders] = useState<RenderItem[]>([]);
  const [tab, setTab] = useState<"projects" | "settings">("projects");
  const [settings, setSettings] = useState<SettingsDoc | null>(null);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      listProjects().catch(() => []),
      listRenders().catch(() => []),
      getGlobalSettings().catch(() => null),
    ]).then(([p, r, s]) => {
      if (!mounted) return;
      setProjects(p);
      setRenders(r);
      setSettings(s);
      setLoading(false);
    });
    const t = setInterval(() => {
      listRenders().then(setRenders).catch(() => {});
    }, 4000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  // Derived stats
  const stats = useMemo(() => {
    const activeRenders = renders.filter((r) => r.status === "queued" || r.status === "rendering");
    const doneRenders = renders.filter((r) => r.status === "done");
    const failedRenders = renders.filter((r) => r.status === "error");
    const totalClips = projects.reduce((sum, p) => sum + p.clipCount, 0);
    return {
      totalProjects: projects.length,
      activeRenders: activeRenders.length,
      doneRenders: doneRenders.length,
      failedRenders: failedRenders.length,
      totalClips,
      activeList: activeRenders,
      doneList: doneRenders.slice(0, 5),
      failedList: failedRenders.slice(0, 3),
    };
  }, [projects, renders]);

  function applySettingsPatch(patch: Partial<SettingsDoc>) {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function saveSettingsNow() {
    if (!settings) return;
    setSavingState("saving");
    try {
      await saveGlobalSettings({ data: { settings } });
      setSavingState("saved");
      setTimeout(() => setSavingState("idle"), 2000);
    } catch {
      setSavingState("idle");
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files[0]) return;
    const f = files[0];
    if (!/audio|mp3|wav|ogg|m4a/i.test(f.type + " " + f.name)) {
      setError("Please drop an audio file (mp3/wav)");
      setTimeout(() => setError(null), 4000);
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
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    try {
      await resetAllData({ data: { confirmed: true } });
      const [newProjects, newRenders] = await Promise.all([listProjects(), listRenders()]);
      setProjects(newProjects);
      setRenders(newRenders);
    } catch (e) {
      alert(`Reset failed: ${e}`);
      throw e;
    }
  }

  async function handleClearLogs() {
    try {
      await clearProjectsAndRenders({ data: { confirmed: true } });
      const [newProjects, newRenders] = await Promise.all([listProjects(), listRenders()]);
      setProjects(newProjects);
      setRenders(newRenders);
    } catch (e) {
      alert(`Clear logs failed: ${e}`);
      throw e;
    }
  }

  async function handleDeleteProject(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await deleteProject({ data: { id } });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setRenders((prev) => prev.filter((r) => r.projectId !== id));
    } catch (e) {
      alert(`Delete failed: ${e}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="h-screen overflow-auto bg-background text-foreground">
      {/* Top Bar */}
      <header className="sticky top-0 z-50 flex items-center gap-4 border-b border-border bg-panel/80 px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Film className="h-4 w-4 text-primary" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold tracking-tight">VERTICUT</span>
            <span className="text-[11px] font-medium text-muted-foreground">Pro</span>
          </div>
        </div>

        <div className="mx-2 h-5 w-px bg-border" />

        <nav className="flex items-center gap-1">
          <button
            onClick={() => setTab("projects")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-smooth ${
              tab === "projects"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setTab("settings")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-smooth ${
              tab === "settings"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            <SettingsIcon className="h-3.5 w-3.5" /> Settings
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {stats.activeRenders > 0 && (
            <div className="flex items-center gap-2 rounded-full border border-border bg-panel-2 px-3 py-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">
                {stats.activeRenders} rendering
              </span>
            </div>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-smooth hover:bg-primary/90 btn-press"
          >
            <Plus className="h-3.5 w-3.5" /> New Project
          </button>
        </div>
      </header>

      {tab === "settings" ? (
        <main className="bg-background">
          {settings ? (
            <SettingsPanel
              settings={settings}
              onChange={applySettingsPatch}
              onSave={saveSettingsNow}
              onClearLogs={handleClearLogs}
              onReset={handleReset}
              saving={savingState}
              subtitle="Saved globally — applies to every project."
            />
          ) : (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
        </main>
      ) : (
        <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
          {/* Stats Row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 animate-fade-in-up">
            <StatCard
              icon={<Film className="h-4 w-4" />}
              label="Projects"
              value={stats.totalProjects}
              accent="text-primary"
            />
            <StatCard
              icon={<Activity className="h-4 w-4" />}
              label="Active Jobs"
              value={stats.activeRenders}
              accent="text-warning"
              pulse={stats.activeRenders > 0}
            />
            <StatCard
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Completed"
              value={stats.doneRenders}
              accent="text-success"
            />
            <StatCard
              icon={<Zap className="h-4 w-4" />}
              label="Total Clips"
              value={stats.totalClips}
              accent="text-foreground"
            />
          </div>

          {/* Drop Zone + Active Jobs */}
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            {/* Drop Zone */}
            <section className="animate-fade-in-up" style={{ animationDelay: "0.05s" }}>
              <DropZone busy={busy} onFiles={handleFiles} onClick={() => inputRef.current?.click()} />
              <input
                ref={inputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              {error && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive animate-fade-in">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                  <button onClick={() => setError(null)} className="ml-auto text-destructive/60 hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </section>

            {/* Active Jobs Panel */}
            <section className="animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
              <div className="rounded-xl border border-border bg-panel p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Activity className="h-3.5 w-3.5" /> Active Jobs
                  </h2>
                  {stats.activeRenders > 0 && (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {stats.activeRenders} running
                    </span>
                  )}
                </div>
                {stats.activeList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground">No active renders</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.activeList.map((r) => (
                      <ActiveJobCard key={r.id} render={r} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Projects Grid */}
          <section className="animate-fade-in-up" style={{ animationDelay: "0.15s" }}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Projects</h2>
              {projects.length > 0 && (
                <span className="text-xs text-muted-foreground">{projects.length} total</span>
              )}
            </div>
            {loading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-28 rounded-xl border border-border bg-panel">
                    <div className="skeleton h-full w-full rounded-xl" />
                  </div>
                ))}
              </div>
            ) : projects.length === 0 ? (
              <EmptyState
                icon={<Film className="h-8 w-8" />}
                title="No projects yet"
                description="Drop an audio file above to create your first project."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p, i) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    index={i}
                    deleting={deletingId === p.id}
                    onDelete={() => handleDeleteProject(p.id)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Recent Renders */}
          {(stats.doneList.length > 0 || stats.failedList.length > 0) && (
            <section className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight">Recent Renders</h2>
                <span className="text-xs text-muted-foreground">{renders.length} total</span>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-panel">
                {stats.doneList.map((r, i) => (
                  <RenderRow key={r.id} render={r} isLast={i === stats.doneList.length - 1 && stats.failedList.length === 0} />
                ))}
                {stats.failedList.map((r, i) => (
                  <RenderRow key={r.id} render={r} isLast={i === stats.failedList.length - 1} failed />
                ))}
              </div>
            </section>
          )}
        </main>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function StatCard({
  icon, label, value, accent, pulse,
}: { icon: React.ReactNode; label: string; value: number; accent: string; pulse?: boolean }) {
  return (
    <div className={`rounded-xl border border-border bg-panel p-4 transition-smooth hover:border-border/80 ${pulse ? "animate-pulse-glow" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={accent}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

function ActiveJobCard({ render }: { render: RenderItem }) {
  const pct = Math.round(render.progress * 100);
  return (
    <div className="rounded-lg border border-border bg-panel-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{render.filename}</span>
        <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        {fmtRelative(render.createdAt)}
      </div>
    </div>
  );
}

function ProjectCard({
  project, index, deleting, onDelete,
}: { project: ProjectListItem; index: number; deleting: boolean; onDelete: () => void }) {
  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-border bg-panel transition-smooth hover:border-primary/30 hover:shadow-lg card-hover animate-fade-in-up"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <Link to="/project/$id" params={{ id: project.id }} className="block p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium leading-snug line-clamp-2">{project.name}</h3>
          <StatusBadge status={project.transcriptStatus} />
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Film className="h-3 w-3" /> {project.clipCount} clips
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {fmtDuration(project.duration)}
          </span>
          <span className="ml-auto">{fmtRelative(project.createdAt)}</span>
        </div>
      </Link>
      <button
        type="button"
        aria-label="Delete project"
        title="Delete project"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
        disabled={deleting}
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-panel-2 text-muted-foreground opacity-0 transition-all hover:border-destructive/30 hover:text-destructive group-hover:opacity-100 disabled:opacity-60"
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function RenderRow({ render, isLast, failed }: { render: RenderItem; isLast: boolean; failed?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 transition-smooth hover:bg-panel-2 ${isLast ? "" : "border-b border-border"}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${failed ? "bg-destructive/10" : "bg-success/10"}`}>
          {failed ? <AlertCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{render.filename}</div>
          <div className="text-[11px] text-muted-foreground">
            {failed && render.error ? render.error.slice(0, 60) : fmtRelative(render.createdAt)}
          </div>
        </div>
      </div>
      {render.status === "done" && render.url ? (
        <a
          href={render.url}
          download={render.filename}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-xs font-medium transition-smooth hover:border-primary/30 hover:bg-primary/10 hover:text-primary btn-press"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </a>
      ) : (
        <span className="text-xs text-muted-foreground capitalize">{render.status}</span>
      )}
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-panel/50 py-16 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; cls: string; dot: string }> = {
    pending: { label: "Transcribing", cls: "text-warning", dot: "bg-warning" },
    ready: { label: "Ready", cls: "text-primary", dot: "bg-primary" },
    error: { label: "Error", cls: "text-destructive", dot: "bg-destructive" },
  };
  const c = config[status] ?? { label: status, cls: "text-muted-foreground", dot: "bg-muted-foreground" };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-panel-2 px-2 py-0.5 text-[10px] font-medium ${c.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot} ${status === "pending" ? "animate-pulse" : ""}`} />
      {c.label}
    </span>
  );
}

function DropZone({ busy, onFiles, onClick }: { busy: boolean; onFiles: (f: FileList | null) => void; onClick: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onClick={onClick}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
      className={`relative flex h-48 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-all duration-300 ${
        over
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-border bg-panel hover:border-border/80 hover:bg-panel-2"
      }`}
    >
      <div className={`absolute inset-0 bg-grid opacity-30 transition-opacity ${over ? "opacity-60" : ""}`} />
      <div className="relative flex flex-col items-center">
        {busy ? (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
            <p className="mt-3 text-sm font-medium">Uploading & starting transcription…</p>
            <p className="mt-1 text-xs text-muted-foreground">This may take a moment</p>
          </>
        ) : (
          <>
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 transition-transform ${over ? "scale-110" : ""}`}>
              <Upload className="h-6 w-6 text-primary" />
            </div>
            <p className="mt-3 text-sm font-medium">Drop audio to start</p>
            <p className="mt-1 text-xs text-muted-foreground">
              or <span className="text-primary">click to browse</span> · mp3, wav, m4a
            </p>
          </>
        )}
      </div>
    </div>
  );
}

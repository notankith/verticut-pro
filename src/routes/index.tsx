import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Upload,
  Film,
  Loader2,
  Download,
  Settings as SettingsIcon,
  Trash2,
  Search,
  Sparkles,
  ArrowRight,
  LogOut,
  Plus,
  Play,
  Scissors,
  Layers,
  ChevronDown,
  Copy,
  Edit2,
  Filter,
  Check,
  Mic,
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
  getCurrentUser,
  logoutUser,
  duplicateProject,
  saveProject,
  generateGeminiVoiceover,
  type ProjectListItem,
  type RenderItem,
} from "@/api.functions";
import { uploadToR2 } from "@/lib/upload";
import { SettingsPanel } from "@/components/editor/SettingsPanel";
import type { SettingsDoc } from "@/server/mongo.server";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "VertiCut Pro — Premium Vertical Video Editor" }] }),
  component: Home,
});

function fmtDuration(s: number) {
  if (!s) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function Home() {
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("Processing...");
  const [isVoiceoverModalOpen, setIsVoiceoverModalOpen] = useState(false);
  const [voiceoverScript, setVoiceoverScript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [renders, setRenders] = useState<RenderItem[]>([]);
  const [tab, setTab] = useState<"projects" | "settings">("projects");
  const [settings, setSettings] = useState<SettingsDoc | null>(null);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");
  const [actionProjectId, setActionProjectId] = useState<string | null>(null);

  // Sorting & Searching State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "duration">("recent");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");

  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        setCurrentUser(user);
        if (user) {
          listProjects().then(setProjects).catch(() => { });
          listRenders().then(setRenders).catch(() => { });
          getGlobalSettings().then(setSettings).catch(() => { });
        }
      })
      .catch(() => { })
      .finally(() => setAuthLoading(false));
  }, []);

  // Poll renders if logged in
  useEffect(() => {
    if (!currentUser) return;
    const t = setInterval(() => {
      listRenders().then(setRenders).catch(() => { });
    }, 4500);
    return () => clearInterval(t);
  }, [currentUser]);

  function applySettingsPatch(patch: Partial<SettingsDoc>) {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function saveSettingsNow() {
    if (!settings) return;
    setSavingState("saving");
    try {
      await saveGlobalSettings({ data: { settings } });
      setSavingState("saved");
    } catch {
      setSavingState("idle");
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files[0]) return;
    const f = files[0];
    if (!/audio|mp3|wav|ogg|m4a/i.test(f.type + " " + f.name)) {
      setError("Please select an audio file (mp3/wav/ogg)");
      return;
    }
    setBusy(true);
    setBusyMessage("Uploading soundtrack...");
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

  async function handleGenerateVoiceover() {
    if (!voiceoverScript.trim()) return;
    setBusy(true);
    setBusyMessage("Synthesizing voiceover via Gemini...");
    setError(null);
    try {
      const { id } = await generateGeminiVoiceover({ data: { script: voiceoverScript } });
      setBusyMessage("Setting up project timeline...");
      setIsVoiceoverModalOpen(false);
      nav({ to: "/project/$id", params: { id } });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    try {
      await resetAllData({ data: { confirmed: true } });
      const [newProjects, newRenders] = await Promise.all([
        listProjects(),
        listRenders(),
      ]);
      setProjects(newProjects);
      setRenders(newRenders);
    } catch (e) {
      alert(`Reset failed: ${e}`);
    }
  }

  async function handleClearLogs() {
    try {
      await clearProjectsAndRenders({ data: { confirmed: true } });
      const [newProjects, newRenders] = await Promise.all([
        listProjects(),
        listRenders(),
      ]);
      setProjects(newProjects);
      setRenders(newRenders);
    } catch (e) {
      alert(`Clear failed: ${e}`);
    }
  }

  async function handleDeleteProject(id: string) {
    setActionProjectId(id);
    try {
      await deleteProject({ data: { id } });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setRenders((prev) => prev.filter((r) => r.projectId !== id));
    } catch (e) {
      alert(`Delete failed: ${e}`);
    } finally {
      setActionProjectId(null);
    }
  }

  async function handleDuplicateProject(id: string) {
    setActionProjectId(id);
    try {
      await duplicateProject({ data: { id } });
      const current = await listProjects();
      setProjects(current);
    } catch (e) {
      alert(`Duplication failed: ${e}`);
    } finally {
      setActionProjectId(null);
    }
  }

  async function handleRenameProject(id: string, newName: string) {
    if (!newName.trim()) return;
    setRenamingId(null);
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name: newName } : p));
    try {
      const proj = projects.find((p) => p.id === id);
      if (proj) {
        await saveProject({ data: { id, name: newName, clips: [] } });
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleLogout() {
    await logoutUser();
    window.location.href = "/";
  }

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#09090b]">
        <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
      </div>
    );
  }

  // GUEST LANDING PAGE (SaaS REDESIGN)
  if (!currentUser) {
    return (
      <div className="h-screen w-screen overflow-y-auto bg-[#09090b] text-neutral-200 font-sans selection:bg-violet-600/30 selection:text-white overflow-x-hidden">
        {/* Navigation */}
        <header className="sticky top-0 z-50 border-b border-white/5 bg-[#09090b]/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600/10 text-violet-500 ring-1 ring-violet-500/20">
                <Film className="h-4 w-4" />
              </div>
              <span className="font-bold tracking-tight text-white">VertiCut Pro</span>
            </div>
            <nav className="hidden md:flex items-center gap-8 text-sm text-neutral-400">
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#workflow" className="hover:text-white transition-colors">Workflow</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            </nav>
            <div className="flex items-center gap-4">
              <Link to="/login" className="text-sm font-medium hover:text-white transition-colors">
                Sign In
              </Link>
              <Link
                to="/signup"
                className="inline-flex h-9 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black hover:opacity-90 transition-opacity"
              >
                Get Started
              </Link>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section className="relative pt-20 pb-24 md:pt-32 md:pb-36 max-w-7xl mx-auto px-6 text-center">
          <div className="absolute inset-0 -z-10 flex items-center justify-center">
            <div className="h-[300px] w-[500px] bg-violet-600/10 blur-[120px] rounded-full" />
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/5 px-3.5 py-1 text-xs font-semibold text-violet-400 mb-6">
            <Sparkles className="h-3 w-3" /> Powered by AI Speech Alignment
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white max-w-3xl mx-auto leading-[1.1]">
            Create premium vertical clips in minutes.
          </h1>
          <p className="text-neutral-400 text-lg mt-6 max-w-xl mx-auto font-light leading-relaxed">
            Import audio files, auto-transcribe spoken tracks, shift camera focus, and generate beautiful dynamic shorts with fluid overlays.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/signup"
              className="inline-flex h-11 w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-6 text-base font-semibold text-white hover:opacity-90 active:scale-[0.99] transition-all shadow-lg shadow-violet-600/20"
            >
              Start Free Trial <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#features"
              className="inline-flex h-11 w-full sm:w-auto items-center justify-center rounded-xl border border-neutral-800 bg-[#121214] px-6 text-base font-semibold hover:border-neutral-700 transition-colors"
            >
              Learn More
            </a>
          </div>

          {/* Editor Dashboard Preview Mockup */}
          <div className="mt-16 md:mt-20 rounded-2xl border border-white/10 bg-[#121214]/60 p-2 shadow-2xl">
            <div className="aspect-video w-full rounded-xl bg-black border border-white/5 overflow-hidden relative flex flex-col justify-between">
              {/* Header mockup */}
              <div className="border-b border-neutral-900 px-4 py-2 flex items-center gap-2 bg-[#09090b]">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-neutral-800" />
                  <div className="w-2.5 h-2.5 rounded-full bg-neutral-800" />
                  <div className="w-2.5 h-2.5 rounded-full bg-neutral-800" />
                </div>
                <div className="mx-auto w-32 h-3 rounded bg-neutral-900" />
              </div>
              {/* Center layout mockup */}
              <div className="flex-1 flex bg-[#0c0c0e]">
                <div className="w-64 border-r border-neutral-900 bg-[#09090b] p-3 flex flex-col gap-2">
                  <div className="h-6 rounded bg-neutral-900 w-1/2" />
                  <div className="aspect-[4/5] rounded border border-neutral-800 bg-[#121214] mt-2 flex items-center justify-center">
                    <Plus className="h-5 w-5 text-neutral-600 animate-pulse" />
                  </div>
                </div>
                <div className="flex-1 p-8 flex items-center justify-center">
                  <div className="aspect-[9/16] h-[300px] rounded-xl border border-neutral-800 bg-[#09090b] flex flex-col justify-end p-4 relative overflow-hidden group shadow-lg">
                    <div className="absolute inset-0 bg-gradient-to-t from-violet-950/20 to-transparent" />
                    <Play className="h-8 w-8 text-neutral-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    <div className="text-center bg-black/60 backdrop-blur py-1 px-2.5 rounded text-[10px] text-white select-none whitespace-nowrap mb-6">
                      "dynamic captions rendering here"
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="border-t border-white/5 bg-[#0c0c0e] py-24">
          <div className="mx-auto max-w-7xl px-6">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Advanced features. Minimal effort.
              </h2>
              <p className="mt-4 text-neutral-400 text-sm">
                Everything you need to compile social media content in seconds.
              </p>
            </div>

            <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {/* Card 1 */}
              <div className="rounded-2xl border border-neutral-800 bg-[#121214]/40 p-6 hover:border-neutral-700/60 transition-colors">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 text-violet-500 mb-4">
                  <Scissors className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-white">Smart Word Trimming</h3>
                <p className="mt-2 text-xs text-neutral-400 leading-relaxed">
                  Select key phrases in transcripts and automatically sync segment boundaries on the timeline with zero zoom adjustments.
                </p>
              </div>

              {/* Card 2 */}
              <div className="rounded-2xl border border-neutral-800 bg-[#121214]/40 p-6 hover:border-neutral-700/60 transition-colors">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 text-violet-500 mb-4">
                  <Layers className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-white">Split Screen Layouts</h3>
                <p className="mt-2 text-xs text-neutral-400 leading-relaxed">
                  Toggle bottom image placements, configure customizable keyframe properties, and align stickers dynamically.
                </p>
              </div>

              {/* Card 3 */}
              <div className="rounded-2xl border border-neutral-800 bg-[#121214]/40 p-6 hover:border-neutral-700/60 transition-colors">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 text-violet-500 mb-4">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-white">Isolated Workspace Assets</h3>
                <p className="mt-2 text-xs text-neutral-400 leading-relaxed">
                  Access custom presets, settings, and render logs safely isolated behind your secure user dashboard session.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Workflow Section */}
        <section id="workflow" className="py-24 max-w-7xl mx-auto px-6">
          <div className="rounded-3xl border border-white/5 bg-gradient-to-br from-[#121214] to-[#09090b] p-8 md:p-12 relative overflow-hidden flex flex-col md:flex-row gap-10 items-center">
            <div className="flex-1 space-y-6">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
                Import audio. Export masterpiece.
              </h2>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600/20 text-xs font-semibold text-violet-400">1</div>
                  <p className="text-xs text-neutral-450 leading-relaxed"><strong className="text-white font-medium">Upload soundtrack:</strong> Drop any mp3 or wav voiceover file onto the dashboard.</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600/20 text-xs font-semibold text-violet-400">2</div>
                  <p className="text-xs text-neutral-450 leading-relaxed"><strong className="text-white font-medium">Refine timestamps:</strong> Transcripts analyze topics and segments. Splitting, dragging, and duration trims compile synchronously.</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600/20 text-xs font-semibold text-violet-400">3</div>
                  <p className="text-xs text-neutral-450 leading-relaxed"><strong className="text-white font-medium">Render & Download:</strong> Click download to fetch the finalized high-definition MP4 asset.</p>
                </div>
              </div>
            </div>
            <div className="aspect-[4/3] w-full max-w-[380px] rounded-2xl border border-neutral-800 bg-[#09090b] flex items-center justify-center p-6 text-center select-none text-xs text-neutral-500 font-light">
              Interactive workspace mock rendering...
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="bg-[#0c0c0e] border-t border-white/5 py-24">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white text-center mb-12">Frequently Asked Questions</h2>
            <div className="space-y-6">
              <div className="rounded-xl border border-neutral-800 bg-[#121214]/50 p-5">
                <h4 className="text-sm font-bold text-white">How does audio transcription work?</h4>
                <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                  We leverage advanced AI speech recognition to generate word-level timestamp structures, which can be selected to trim and cut sections of the video logic automatically.
                </p>
              </div>
              <div className="rounded-xl border border-neutral-800 bg-[#121214]/50 p-5">
                <h4 className="text-sm font-bold text-white">Is my project data safe?</h4>
                <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                  Yes, each workspace environment uses private DB indices linked to specific user credentials. No cross-project leaking ever occurs.
                </p>
              </div>
              <div className="rounded-xl border border-neutral-800 bg-[#121214]/50 p-5">
                <h4 className="text-sm font-bold text-white">What resolution is exported?</h4>
                <p className="text-xs text-neutral-450 mt-2 leading-relaxed">
                  Downloads are compiled locally or remotely in high-definition vertical format (1080x1920) matching optimal dimensions for Reels, Shorts, and TikToks.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/5 bg-[#09090b] py-8 text-center text-xs text-neutral-600">
          <p>© {new Date().getFullYear()} VertiCut Pro. Created with modern aesthetics. All rights reserved.</p>
        </footer>
      </div>
    );
  }

  // REDESIGNED PROJECTS DASHBOARD (USER AUTHENTICATED)
  const filteredProjects = projects
    .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "duration") return b.duration - a.duration;
      const tA = a.updatedAt || a.createdAt;
      const tB = b.updatedAt || b.createdAt;
      return tB - tA; // default recent
    });

  return (
    <div className="h-screen flex flex-col bg-[#09090b] text-[#f4f4f5] font-sans overflow-hidden">
      {/* Premium Header */}
      <header className="flex h-14 items-center justify-between border-b border-white/[0.06] bg-[#0c0c0e]/80 backdrop-blur px-6 shrink-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/10 text-violet-500 ring-1 ring-violet-500/15">
            <Film className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-xs font-bold uppercase tracking-widest text-white">VERTICUT PRO</h1>
            <p className="text-[9px] text-[#a1a1aa] font-medium tracking-tight">Isolated Workspace Dashboard</p>
          </div>
        </div>

        {/* Header Tabs */}
        <div className="hidden sm:flex items-center gap-1.5 bg-[#18181b] p-1 rounded-lg">
          <button
            onClick={() => setTab("projects")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${tab === "projects" ? "bg-[#27272a] text-white shadow-sm" : "text-[#a1a1aa] hover:text-white"
              }`}
          >
            Projects
          </button>
          <button
            onClick={() => setTab("settings")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all ${tab === "settings" ? "bg-[#27272a] text-white shadow-sm" : "text-[#a1a1aa] hover:text-white"
              }`}
          >
            <SettingsIcon className="h-3 w-3" /> Settings
          </button>
        </div>

        {/* User profile dropdown/logout */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] font-medium text-[#e4e4e7] truncate max-w-[120px]">{currentUser.email}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Log Out"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] hover:bg-neutral-800 transition-colors text-neutral-400 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto bg-[#09090b]">
        {tab === "settings" ? (
          <main className="max-w-4xl mx-auto px-6 py-8">
            {settings ? (
              <SettingsPanel
                settings={settings}
                onChange={applySettingsPatch}
                onSave={saveSettingsNow}
                onClearLogs={handleClearLogs}
                onReset={handleReset}
                saving={savingState}
                subtitle="Settings are private and apply to your personal workspace only."
              />
            ) : (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
              </div>
            )}
          </main>
        ) : (
          <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
            {/* Create Project + Button card */}
            <section>
              <div
                onClick={() => {
                  setVoiceoverScript("");
                  setError(null);
                  setIsVoiceoverModalOpen(true);
                }}
                className="flex h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-[#0c0c0e] hover:bg-[#121214] hover:border-violet-500/20 transition-all select-none group"
              >
                <div className="space-y-2 text-center">
                  <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-violet-600/10 text-violet-400 group-hover:scale-105 transition-transform duration-200 ring-1 ring-violet-500/10">
                    <Plus className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-semibold text-white font-medium">Create New Project</p>
                  <p className="text-xs text-neutral-500 font-light">Generate via Gemini TTS or upload audio</p>
                </div>
              </div>
            </section>

            {/* Redesigned Projects Grid Section */}
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/[0.06] pb-3 shrink-0">
                <h2 className="text-xs font-extrabold uppercase tracking-widest text-[#a1a1aa]">Your Projects</h2>

                {/* Search & Sort Panel */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
                    <input
                      type="text"
                      placeholder="Search projects..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] pl-8 pr-2.5 text-xs outline-none focus:border-violet-500/40 text-white placeholder:text-neutral-600 transition-colors w-40 sm:w-48"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 border border-white/[0.08] rounded-lg bg-[#0c0c0e] px-2 h-8.5">
                    <Filter className="h-3 w-3 text-neutral-500" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="bg-transparent border-none text-[11px] font-semibold text-neutral-400 outline-none cursor-pointer focus:ring-0 pr-1 py-0"
                    >
                      <option value="recent">Recent</option>
                      <option value="name">Name</option>
                      <option value="duration">Length</option>
                    </select>
                  </div>
                </div>
              </div>

              {filteredProjects.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/[0.05] bg-[#0c0c0e]/30 px-4 py-8 text-center text-xs text-neutral-500">
                  No projects found. Import an audio file to compile your first clip list.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredProjects.map((p) => {
                    const working = actionProjectId === p.id;
                    const editing = renamingId === p.id;
                    return (
                      <div
                        key={p.id}
                        className="group relative flex flex-col rounded-xl border border-white/[0.06] bg-[#0c0c0e] hover:bg-[#121214] transition-all hover:-translate-y-0.5 duration-200 overflow-hidden shadow-md hover:shadow-lg shadow-black/20"
                      >
                        {/* Project Card Header / Thumbnail */}
                        <Link
                          to="/project/$id"
                          params={{ id: p.id }}
                          disabled={editing}
                          className="relative aspect-video w-full border-b border-white/[0.05] bg-neutral-950 flex items-center justify-center overflow-hidden shrink-0"
                        >
                          {p.thumbnailUrl ? (
                            <img
                              src={p.thumbnailUrl}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-300 pointer-events-none"
                            />
                          ) : (
                            <div className="absolute inset-0 bg-gradient-to-tr from-violet-950/20 via-neutral-900 to-neutral-950 opacity-80" />
                          )}
                          <Play className="h-6 w-6 text-white/20 group-hover:text-white/60 transition-colors pointer-events-none" />
                          <div className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase text-neutral-300 border border-white/5">
                            {p.clipCount} {p.clipCount === 1 ? 'clip' : 'clips'}
                          </div>
                          <div className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                            {fmtDuration(p.duration)}
                          </div>
                        </Link>

                        {/* Project Details */}
                        <div className="flex-1 p-4 flex flex-col justify-between gap-3">
                          <div className="space-y-1">
                            {editing ? (
                              <input
                                autoFocus
                                type="text"
                                value={renamingName}
                                onChange={(e) => setRenamingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleRenameProject(p.id, renamingName);
                                  if (e.key === "Escape") setRenamingId(null);
                                }}
                                onBlur={() => handleRenameProject(p.id, renamingName)}
                                className="h-7 w-full rounded border border-violet-500 bg-[#161619] px-2 text-xs text-white outline-none"
                              />
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <Link
                                  to="/project/$id"
                                  params={{ id: p.id }}
                                  className="text-xs font-semibold truncate hover:text-violet-400 transition-colors block flex-1"
                                >
                                  {p.name}
                                </Link>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setRenamingId(p.id);
                                    setRenamingName(p.name);
                                  }}
                                  className="inline-flex h-5 w-5 items-center justify-center text-neutral-500 hover:text-white rounded hover:bg-neutral-800 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Edit2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            )}
                            <p className="text-[10px] text-neutral-550 leading-tight">
                              Edited {new Date(p.updatedAt || p.createdAt).toLocaleString()}
                            </p>
                          </div>

                          <div className="flex items-center justify-between border-t border-white/[0.04] pt-2">
                            {/* Status badge */}
                            <span
                              className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${p.transcriptStatus === "pending"
                                ? "bg-violet-950/40 text-violet-450 border border-violet-500/10"
                                : p.transcriptStatus === "error"
                                  ? "bg-red-950/40 text-red-400 border border-red-500/10"
                                  : "bg-[#18181b] text-neutral-450 border border-white/5"
                                }`}
                            >
                              {p.transcriptStatus === "pending"
                                ? "Transcribing"
                                : p.transcriptStatus === "ready"
                                  ? "Subtitles Active"
                                  : "Error"}
                            </span>

                            {/* Dropdown Options */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={working}
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleDuplicateProject(p.id);
                                }}
                                title="Duplicate"
                                className="inline-flex h-6.5 w-6.5 items-center justify-center rounded border border-white/5 bg-[#18181b] text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors disabled:opacity-50"
                              >
                                {working ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={working}
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleDeleteProject(p.id);
                                }}
                                title="Delete"
                                className="inline-flex h-6.5 w-6.5 items-center justify-center rounded border border-white/5 bg-[#18181b] text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors disabled:opacity-50"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Reders Section */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[#a1a1aa] border-b border-white/[0.06] pb-2 shrink-0">Download Center</h2>
              {renders.length === 0 ? (
                <p className="text-xs text-neutral-500">No projects queued for rendering yet.</p>
              ) : (
                <ul className="divide-y divide-white/[0.04] rounded-xl border border-white/[0.06] bg-[#0c0c0e] overflow-hidden">
                  {renders.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-[#121214] transition-colors">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate max-w-[280px] sm:max-w-md">{r.filename}</div>
                        <div className="text-[10px] text-neutral-400 mt-0.5">
                          {r.status === "rendering" ? `Processing render frame progress: ${Math.round(r.progress * 100)}%` : r.status}
                          {r.error ? ` — Error logic: ${r.error}` : ""}
                        </div>
                      </div>
                      {r.status === "done" && r.url ? (
                        <a
                          href={r.url}
                          download={r.filename}
                          className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[10px] font-bold text-white hover:opacity-90 transition-opacity"
                        >
                          <Download className="h-3 w-3" /> Download
                        </a>
                      ) : (
                        <span className="text-[10px] font-bold text-neutral-500 capitalize">{r.status}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </main>
        )}
      </div>

      {isVoiceoverModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-2xl rounded-2xl border border-white/[0.08] bg-[#0c0c0e] p-6 shadow-xl flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/10 text-violet-500">
                  <Mic className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Create Voiceover & Project</h3>
                  <p className="text-[10px] text-neutral-400 font-light">Provide a script or upload an existing file</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!busy) setIsVoiceoverModalOpen(false);
                }}
                className="text-neutral-400 hover:text-white text-xs font-semibold hover:bg-neutral-800 px-2.5 py-1.5 rounded transition-all"
                disabled={busy}
              >
                Cancel
              </button>
            </div>

            {/* Split Panels */}
            {busy ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                <div className="text-center">
                  <p className="text-xs font-semibold text-white">{busyMessage}</p>
                  <p className="text-[9px] text-neutral-450 mt-1 font-light">
                    Processing audio alignment and setting up your project dashboard
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
                {/* Left side: Gemini Speech Creator */}
                <div className="space-y-4 flex flex-col justify-between">
                  <div className="space-y-2">
                    <h4 className="text-xs font-extrabold uppercase tracking-widest text-violet-400">Gemini Voice Generation</h4>
                    <p className="text-[10px] text-neutral-450 font-light leading-snug">
                      Write or paste a script. The project timeline is created matching the exact synthesized voice duration.
                    </p>
                  </div>

                  <textarea
                    placeholder="Enter script content here..."
                    rows={6}
                    value={voiceoverScript}
                    onChange={(e) => setVoiceoverScript(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.08] bg-[#161619] p-3 text-xs text-white outline-none focus:border-violet-500/50 placeholder:text-neutral-600 transition-colors resize-none"
                  />

                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={handleGenerateVoiceover}
                      disabled={!voiceoverScript.trim()}
                      className="w-full inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Generate Voiceover
                    </button>
                    <p className="text-[9px] text-center text-neutral-500 font-light leading-tight">
                      Generates using model and voice configs saved in your profile Settings.
                    </p>
                  </div>
                </div>

                {/* Right side: File Upload Dropzone */}
                <div className="space-y-4 flex flex-col justify-between pt-6 md:pt-0 md:pl-6">
                  <div className="space-y-2">
                    <h4 className="text-xs font-extrabold uppercase tracking-widest text-[#a1a1aa]">Upload Voiceover</h4>
                    <p className="text-[10px] text-neutral-450 font-light leading-snug">
                      Already have an audio file ready? Drop or browse your pre-recorded mp3/wav/ogg track here.
                    </p>
                  </div>

                  <div
                    onClick={() => inputRef.current?.click()}
                    className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] hover:border-violet-500/30 bg-[#121214]/30 hover:bg-[#121214]/65 transition-all p-8 text-center cursor-pointer min-h-[140px]"
                  >
                    <Upload className="h-6 w-6 text-neutral-400 mb-2" />
                    <p className="text-xs font-bold text-white">Select File</p>
                    <p className="text-[9px] text-neutral-500 font-light mt-0.5 font-sans">MP3, WAV, OGG up to 20MB</p>
                  </div>

                  <input
                    ref={inputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.ogg"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleFiles(e.target.files);
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-500 text-center font-medium bg-red-950/20 border border-red-500/10 rounded-lg p-2.5">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

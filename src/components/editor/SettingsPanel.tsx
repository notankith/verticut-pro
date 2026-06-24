import { uploadToR2 } from "@/lib/upload";
import { DEFAULT_TEMPLATE_WINDOW, TEMPLATES, type TemplateWindow } from "@/lib/templates";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SettingsDoc } from "@/server/mongo.server";

type Props = {
  settings: SettingsDoc;
  onChange: (patch: Partial<SettingsDoc>) => void;
  onSave?: () => void;
  onReset?: () => Promise<void>;
  onClearLogs?: () => Promise<void>;
  saving?: "idle" | "saving" | "saved";
  title?: string;
  subtitle?: string;
};

export function SettingsPanel({ settings, onChange, onSave, onReset, onClearLogs, saving, title, subtitle }: Props) {
  const [newPreset, setNewPreset] = useState({ name: "", text: "" });
  const [musicTesting, setMusicTesting] = useState<HTMLAudioElement | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearLogsConfirm, setShowClearLogsConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isClearingLogs, setIsClearingLogs] = useState(false);
  const [subTab, setSubTab] = useState<"general" | "templates" | "captions">("general");

  const templateWindow = settings.templateWindow ?? DEFAULT_TEMPLATE_WINDOW;
  const activeTemplateId = settings.activeTemplateId ?? null;
  const activeTemplate = useMemo(() => TEMPLATES.find((t) => t.id === activeTemplateId) ?? null, [activeTemplateId]);

  function deletePreset(id: string) {
    onChange({ presets: settings.presets.filter((p) => p.id !== id) });
  }

  function addPreset() {
    if (!newPreset.name.trim()) return;
    const tints = ["#ef4444", "#eab308", "#a855f7", "#22c55e", "#3b82f6", "#ec4899"];
    onChange({
      presets: [
        ...settings.presets,
        {
          id: crypto.randomUUID(),
          name: newPreset.name.trim(),
          text: newPreset.text.trim(),
          tint: tints[settings.presets.length % tints.length],
        },
      ],
    });
    setNewPreset({ name: "", text: "" });
  }

  async function handleReset() {
    setIsResetting(true);
    try {
      if (onReset) await onReset();
      setShowResetConfirm(false);
    } catch (err) {
      alert(`Reset failed: ${err}`);
    } finally {
      setIsResetting(false);
    }
  }

  async function handleClearLogs() {
    setIsClearingLogs(true);
    try {
      if (onClearLogs) await onClearLogs();
      setShowClearLogsConfirm(false);
    } catch (err) {
      alert(`Clear logs failed: ${err}`);
    } finally {
      setIsClearingLogs(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6 text-sm">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{title ?? "Settings"}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {onSave ? (
            <>
              {saving === "saving" ? (
                <span className="text-[10px] text-muted-foreground">Saving…</span>
              ) : saving === "saved" ? (
                <span className="text-[10px] text-muted-foreground">Saved</span>
              ) : null}
              <button
                onClick={onSave}
                className="rounded bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Save settings
              </button>
            </>
          ) : null}
          {onClearLogs ? (
            <button
              onClick={() => setShowClearLogsConfirm(true)}
              disabled={isClearingLogs}
              className="flex items-center gap-1.5 rounded bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-500/20 disabled:opacity-50"
              title="Delete projects and downloads history"
            >
              <Trash2 className="h-3 w-3" /> Clear logs
            </button>
          ) : null}
          {onReset ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              disabled={isResetting}
              className="flex items-center gap-1.5 rounded bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
              title="Delete all projects and downloads (settings will be preserved)"
            >
              <Trash2 className="h-3 w-3" /> Reset all
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setSubTab("general")}
          className={`rounded-t px-3 py-2 text-xs ${subTab === "general" ? "bg-panel text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          General
        </button>
        <button
          type="button"
          onClick={() => setSubTab("templates")}
          className={`rounded-t px-3 py-2 text-xs ${subTab === "templates" ? "bg-panel text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Templates
        </button>
        <button
          type="button"
          onClick={() => setSubTab("captions")}
          className={`rounded-t px-3 py-2 text-xs ${subTab === "captions" ? "bg-panel text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Captions
        </button>
      </div>

      {subTab === "general" ? (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Label Presets</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Show Labels</span>
                <button
                  type="button"
                  onClick={() => onChange({ showLabels: !(settings.showLabels ?? true) })}
                  className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
                    (settings.showLabels ?? true) ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      (settings.showLabels ?? true) ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
            <ul className="space-y-2">
              {settings.presets.map((p, i) => (
                <li key={p.id} className="flex items-center gap-2 rounded border border-border bg-panel p-2">
                  <span className="h-3 w-3 rounded" style={{ background: p.tint }} />
                  <input
                    value={p.name}
                    onChange={(e) => {
                      const next = [...settings.presets];
                      next[i] = { ...p, name: e.target.value };
                      onChange({ presets: next });
                    }}
                    className="w-32 rounded bg-panel-2 px-2 py-1 text-xs"
                  />
                  <input
                    value={p.text}
                    onChange={(e) => {
                      const next = [...settings.presets];
                      next[i] = { ...p, text: e.target.value };
                      onChange({ presets: next });
                    }}
                    className="flex-1 rounded bg-panel-2 px-2 py-1 text-xs"
                  />
                  <button onClick={() => deletePreset(p.id)} className="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 rounded border border-dashed border-border p-2">
              <input
                placeholder="Name"
                value={newPreset.name}
                onChange={(e) => setNewPreset({ ...newPreset, name: e.target.value })}
                className="w-32 rounded bg-panel-2 px-2 py-1 text-xs"
              />
              <input
                placeholder="Label text"
                value={newPreset.text}
                onChange={(e) => setNewPreset({ ...newPreset, text: e.target.value })}
                className="flex-1 rounded bg-panel-2 px-2 py-1 text-xs"
              />
              <button onClick={addPreset} className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground">
                + Add preset
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Default Label</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Default label text</label>
                <input
                  value={settings.defaultLabelText}
                  onChange={(e) => onChange({ defaultLabelText: e.target.value })}
                  className="w-full rounded border border-border bg-panel-2 px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Font size ({settings.defaultFontSize}px)</label>
                <input
                  type="range"
                  min={10}
                  max={64}
                  value={settings.defaultFontSize}
                  onChange={(e) => onChange({ defaultFontSize: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Animation</h3>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Global intensity ({settings.animationIntensity.toFixed(1)}×)</label>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.1}
                value={settings.animationIntensity}
                onChange={(e) => onChange({ animationIntensity: Number(e.target.value) })}
                className="w-full"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Higher = faster movement.</p>

              <div className="mt-3 flex items-center gap-2">
                <input
                  id="transitionAnimation"
                  type="checkbox"
                  checked={settings.transitionAnimation ?? true}
                  onChange={(e) => onChange({ transitionAnimation: e.target.checked })}
                  className="h-4 w-4"
                />
                <label htmlFor="transitionAnimation" className="text-xs text-muted-foreground">
                  Transition animation
                </label>
              </div>
            </div>
          </section>
        </>
      ) : subTab === "templates" ? (
        <TemplateEditor
          activeTemplate={activeTemplate}
          windowRect={templateWindow}
          onSelectTemplate={(id) => onChange({ activeTemplateId: id })}
          onWindowChange={(next) => onChange({ templateWindow: next })}
        />
      ) : (
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Word-Level Captions</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Text Color</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.captionTextColor ?? "#000000"}
                  onChange={(e) => onChange({ captionTextColor: e.target.value })}
                  className="h-8 w-8 rounded border border-border bg-transparent p-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.captionTextColor ?? "#000000"}
                  onChange={(e) => onChange({ captionTextColor: e.target.value })}
                  className="flex-1 rounded border border-border bg-panel-2 px-2.5 py-1 text-xs"
                />
              </div>
            </div>
            
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Background Color</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.captionBgColor ?? "#ffffff"}
                  onChange={(e) => onChange({ captionBgColor: e.target.value })}
                  className="h-8 w-8 rounded border border-border bg-transparent p-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.captionBgColor ?? "#ffffff"}
                  onChange={(e) => onChange({ captionBgColor: e.target.value })}
                  className="flex-1 rounded border border-border bg-panel-2 px-2.5 py-1 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Position X (%)</label>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.captionPosX ?? 50}
                onChange={(e) => onChange({ captionPosX: Number(e.target.value) })}
                className="w-full"
              />
              <span className="text-[10px] text-muted-foreground mt-0.5 block text-right">{settings.captionPosX ?? 50}%</span>
            </div>
            
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Position Y (%)</label>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.captionPosY ?? 75}
                onChange={(e) => onChange({ captionPosY: Number(e.target.value) })}
                className="w-full"
              />
              <span className="text-[10px] text-muted-foreground mt-0.5 block text-right">{settings.captionPosY ?? 75}%</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Font Size ({settings.captionFontSize ?? 36}px)</label>
            <input
              type="range"
              min={12}
              max={120}
              value={settings.captionFontSize ?? 36}
              onChange={(e) => onChange({ captionFontSize: Number(e.target.value) })}
              className="w-full"
            />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Background Music</h3>
        <div className="flex items-center gap-2">
          <input
            placeholder="MP3 URL"
            value={settings.musicUrl}
            onChange={(e) => onChange({ musicUrl: e.target.value })}
            className="flex-1 rounded border border-border bg-panel-2 px-2 py-1.5 text-xs"
          />
          <label className="cursor-pointer rounded border border-border bg-panel-2 px-3 py-1.5 text-xs hover:bg-accent">
            Upload
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const { url } = await uploadToR2(f, "music");
                onChange({ musicUrl: url });
              }}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground">Volume {settings.musicVolume}</label>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.musicVolume}
            onChange={(e) => onChange({ musicVolume: Number(e.target.value) })}
            className="flex-1"
          />
          <button
            onClick={() => {
              if (musicTesting) {
                musicTesting.pause();
                setMusicTesting(null);
                return;
              }
              if (!settings.musicUrl) return;
              const a = new Audio(settings.musicUrl);
              a.volume = settings.musicVolume / 100;
              a.play();
              setMusicTesting(a);
            }}
            className="rounded border border-border bg-panel-2 px-3 py-1 text-xs"
          >
            {musicTesting ? "Stop" : "Test"}
          </button>
        </div>
      </section>

      {showClearLogsConfirm && (
        <ConfirmDialog
          title="Clear logs?"
          body="This will delete all projects and download history. Your settings and presets will be preserved. This action cannot be undone."
          confirmLabel={isClearingLogs ? "Clearing…" : "Clear logs"}
          onCancel={() => setShowClearLogsConfirm(false)}
          onConfirm={handleClearLogs}
          busy={isClearingLogs}
          confirmTone="amber"
        />
      )}

      {showResetConfirm && (
        <ConfirmDialog
          title="Reset all data?"
          body="This will delete all projects and download history. Your settings and presets will be preserved. This action cannot be undone."
          confirmLabel={isResetting ? "Resetting…" : "Delete all"}
          onCancel={() => setShowResetConfirm(false)}
          onConfirm={handleReset}
          busy={isResetting}
          confirmTone="destructive"
        />
      )}
    </div>
  );
}

function TemplateEditor({
  activeTemplate,
  windowRect,
  onSelectTemplate,
  onWindowChange,
}: {
  activeTemplate: { id: string; name: string; overlayUrl: string } | null;
  windowRect: TemplateWindow;
  onSelectTemplate: (id: string | null) => void;
  onWindowChange: (next: TemplateWindow) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<null | { mode: "move" | "resize"; startX: number; startY: number; start: TemplateWindow; canvasW: number; canvasH: number }>(null);

  useEffect(() => {
    if (!drag) return;

    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    const clampWindow = (w: TemplateWindow): TemplateWindow => {
      const left = clamp(w.left);
      const top = clamp(w.top);
      const width = Math.max(5, Math.min(100 - left, w.width));
      const height = Math.max(5, Math.min(100 - top, w.height));
      return { left, top, width, height };
    };

    const onMove = (ev: PointerEvent) => {
      const dxPct = ((ev.clientX - drag.startX) / Math.max(1, drag.canvasW)) * 100;
      const dyPct = ((ev.clientY - drag.startY) / Math.max(1, drag.canvasH)) * 100;
      const next = { ...drag.start };
      if (drag.mode === "move") {
        next.left = Math.min(100 - next.width, Math.max(0, drag.start.left + dxPct));
        next.top = Math.min(100 - next.height, Math.max(0, drag.start.top + dyPct));
      } else {
        next.width = Math.min(100 - next.left, Math.max(5, drag.start.width + dxPct));
        next.height = Math.min(100 - next.top, Math.max(5, drag.start.height + dyPct));
      }
      onWindowChange(clampWindow(next));
    };

    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
    };
  }, [drag, onWindowChange]);

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Templates</h3>
      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">Active template</label>
          <select
            value={activeTemplate?.id ?? ""}
            onChange={(e) => onSelectTemplate(e.target.value || null)}
            className="w-full rounded border border-border bg-panel-2 px-2 py-1.5 text-xs"
          >
            <option value="">No template</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">Drag the box to move it. Drag the corner to resize it.</p>
          <div className="rounded border border-border bg-panel-2 p-2 text-[11px] text-muted-foreground">
            {activeTemplate ? `${activeTemplate.name} overlay enabled` : "No overlay selected"}
          </div>
        </div>

        <div className="flex justify-center">
          <div ref={canvasRef} className="relative w-full max-w-[280px] overflow-hidden rounded border border-border bg-[#111]" style={{ aspectRatio: "9 / 16" }}>
            {activeTemplate ? (
              <img src={activeTemplate.overlayUrl} alt={activeTemplate.name} className="absolute inset-0 h-full w-full object-cover" />
            ) : null}
            <div
              onPointerDown={(e) => {
                const canvas = canvasRef.current?.getBoundingClientRect();
                if (!canvas) return;
                const target = e.target as HTMLElement;
                const mode: "move" | "resize" = target.dataset.handle === "resize" ? "resize" : "move";
                setDrag({
                  mode,
                  startX: e.clientX,
                  startY: e.clientY,
                  start: windowRect,
                  canvasW: canvas.width,
                  canvasH: canvas.height,
                });
                try {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                } catch {}
              }}
              className="absolute rounded border-2 border-cyan-400 bg-cyan-400/15"
              style={{
                left: `${windowRect.left}%`,
                top: `${windowRect.top}%`,
                width: `${windowRect.width}%`,
                height: `${windowRect.height}%`,
                touchAction: "none",
              }}
            >
              <div className="absolute inset-0 cursor-move" />
              <button
                type="button"
                data-handle="resize"
                className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border border-cyan-300 bg-cyan-400"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  busy,
  confirmTone,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  busy: boolean;
  confirmTone: "amber" | "destructive";
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="max-w-sm rounded-lg border border-border bg-panel p-6 shadow-lg">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${confirmTone === "amber" ? "bg-amber-600 hover:bg-amber-700" : "bg-destructive hover:bg-destructive/90"}`}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

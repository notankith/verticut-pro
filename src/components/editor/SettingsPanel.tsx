import { uploadToR2 } from "@/lib/upload";
import { useState } from "react";
import type { SettingsDoc } from "@/server/mongo.server";

type Props = {
  settings: SettingsDoc;
  onChange: (patch: Partial<SettingsDoc>) => void;
  onSave?: () => void;
  saving?: "idle" | "saving" | "saved";
  title?: string;
  subtitle?: string;
};

export function SettingsPanel({ settings, onChange, onSave, saving, title, subtitle }: Props) {
  const [newPreset, setNewPreset] = useState({ name: "", text: "" });
  const [musicTesting, setMusicTesting] = useState<HTMLAudioElement | null>(null);

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

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6 text-sm">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{title ?? "Settings"}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {onSave ? (
          <div className="flex items-center gap-2">
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
          </div>
        ) : null}
      </header>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Label Presets</h3>
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
        </div>
      </section>

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
    </div>
  );
}

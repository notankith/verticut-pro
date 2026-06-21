import { create } from "zustand";
import type { ClipDoc, MarkerDoc, SettingsDoc, AudioSegment } from "@/server/mongo.server";
import { DEFAULT_TEMPLATE_WINDOW } from "@/lib/templates";

export type Keyframe = {
  time: number; // seconds (project time)
  scale?: number;
  posX?: number; // percentage 0..100
  posY?: number; // percentage 0..100
  rotation?: number; // degrees
};

export type EditorState = {
  projectId: string;
  name: string;
  audioUrl: string;
  audioDuration: number; // seconds
  transcript: { text: string; start: number; end: number }[];
  clips: ClipDoc[];
  markers: MarkerDoc[];
  settings: SettingsDoc;
  selectedClipId: string | null; // "VOICEOVER" reserved for audio track
  zoom: number; // pixels per second
  saving: "idle" | "saving" | "saved";
  // history
  past: ClipDoc[][];
  future: ClipDoc[][];

  // Playback state (updated from player)
  currentTime: number;

  // Audio editing: list of audio segments composing project audio
  audioSegments: AudioSegment[];

  set: (patch: Partial<EditorState>) => void;
  init: (p: Omit<EditorState, "selectedClipId" | "zoom" | "saving" | "past" | "future" | "set" | "init" | "updateClips" | "updateSettings" | "select" | "undo" | "redo" | "currentTime">) => void;
  updateClips: (next: ClipDoc[] | ((prev: ClipDoc[]) => ClipDoc[]), record?: boolean) => void;
  updateSettings: (next: Partial<SettingsDoc>) => void;
  select: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
};

export const useEditor = create<EditorState>((set, get) => ({
  projectId: "",
  name: "",
  audioUrl: "",
  audioDuration: 0,
  transcript: [],
  clips: [],
  markers: [],
  settings: {
    _id: "",
    defaultLabelText: "",
    defaultFontSize: 18,
    animationIntensity: 1,
    musicUrl: "",
    musicVolume: 30,
    defaultPresetId: "",
    presets: [],
    transitionAnimation: true,
    activeTemplateId: null,
    templateWindow: DEFAULT_TEMPLATE_WINDOW,
  },
  selectedClipId: null,
  zoom: 60,
  saving: "idle",
  past: [],
  future: [],

  currentTime: 0,
  audioSegments: [],

  set: (patch) => set(patch),
  init: (p) =>
    set({
      ...p,
      currentTime: 0,
      settings: {
        ...p.settings,
        transitionAnimation: p.settings.transitionAnimation ?? true,
        activeTemplateId: p.settings.activeTemplateId ?? null,
        templateWindow: p.settings.templateWindow ?? DEFAULT_TEMPLATE_WINDOW,
      },
      markers: p.markers ?? [],
      selectedClipId: null,
      zoom: 60,
      saving: "idle",
      past: [],
      future: [],
      // Initialize audioSegments: if they exist on project, use them, otherwise fallback to one mapping of full audio
      audioSegments: (p.audioSegments && p.audioSegments.length > 0)
        ? p.audioSegments
        : [{ id: crypto.randomUUID(), srcStart: 0, duration: p.audioDuration ?? 0, projStart: 0 }],
    }),
  updateClips: (next, record = true) => {
    const prev = get().clips;
    const value = typeof next === "function" ? next(prev) : next;
    if (record) {
      set({ clips: value, past: [...get().past.slice(-50), prev], future: [] });
    } else {
      set({ clips: value });
    }
  },
  updateSettings: (next) => set({ settings: { ...get().settings, ...next } }),
  select: (id) => set({ selectedClipId: id }),
  undo: () => {
    const { past, clips, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({ clips: prev, past: past.slice(0, -1), future: [clips, ...future].slice(0, 50) });
  },
  redo: () => {
    const { past, clips, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({ clips: next, future: future.slice(1), past: [...past, clips].slice(-50) });
  },
}));

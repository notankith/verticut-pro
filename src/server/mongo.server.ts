import { MongoClient, type Db, type Document } from "mongodb";
import type { TemplateWindow } from "@/lib/templates";

let client: MongoClient | null = null;
let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (dbPromise) return dbPromise;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");
  client = new MongoClient(uri);
  dbPromise = client.connect().then((c) => c.db("verticut"));
  return dbPromise;
}

// Helper to get an untyped collection (we use string _ids, not ObjectId)
export async function coll<T extends Document = Document>(name: string) {
  const db = await getDb();
  return db.collection<T & { _id: string }>(name as never) as unknown as ReturnType<Db["collection"]>;
}

export type AudioSegment = {
  id: string;
  srcStart: number;
  duration: number;
  projStart: number;
};

export type ProjectDoc = {
  _id: string;
  name: string;
  audioKey: string;
  audioUrl: string;
  audioDuration: number;
  transcript: { text: string; start: number; end: number }[];
  transcriptStatus: "pending" | "ready" | "error";
  transcriptJobId?: string;
  clips?: ClipDoc[];
  markers?: MarkerDoc[];
  createdAt: number;
  updatedAt: number;
  audioSegments?: AudioSegment[];
};

export type ClipDoc = {
  id: string;
  kind?: "media" | "solid" | "text";
  start: number;
  duration: number;
  imageKey?: string;
  imageUrl?: string;
  videoKey?: string;
  videoUrl?: string;
  videoDuration?: number;
  solidColor?: string;
  textContent?: string;
  opacity?: number;
  trimStart?: number;
  trimEnd?: number;
  muted?: boolean;
  volume?: number;
  animation: "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "none";
  labelText: string;
  labelPresetId: string;
  intensity?: number;
  anchorX?: number;
  anchorY?: number;
  posX?: number;
  posY?: number;
  scale?: number;
  rotation?: number;
  splitScreen?: {
    enabled: boolean;
    bottomImageKey?: string;
    bottomImageUrl?: string;
  };
  keyframes?: { time: number; scale?: number; posX?: number; posY?: number; rotation?: number; opacity?: number }[];
  keyframedProps?: string[];
};

export type MarkerDoc = {
  id: string;
  start: number;
  label: string;
  kind?: "subject" | "entity" | "topic";
};

export type SettingsDoc = {
  _id: string;
  defaultLabelText: string;
  defaultFontSize: number;
  animationIntensity: number;
  musicUrl: string;
  musicVolume: number;
  // The preset to apply to future imports. Optional for back-compat.
  defaultPresetId?: string;
  presets: { id: string; name: string; text: string; tint: string }[];
  // Whether to enable transition animations between clips in preview and render
  transitionAnimation?: boolean;
  activeTemplateId?: string | null;
  templateWindow?: TemplateWindow;
  captionTextColor?: string;
  captionBgColor?: string;
  captionPosX?: number;
  captionPosY?: number;
  captionFontSize?: number;
  showLabels?: boolean;
};

export type RenderDoc = {
  _id: string;
  projectId: string;
  filename: string;
  status: "queued" | "rendering" | "done" | "error";
  progress: number;
  url?: string;
  error?: string;
  createdAt: number;
};

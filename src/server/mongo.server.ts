import { MongoClient, type Collection, type Document } from "mongodb";

let client: MongoClient | null = null;
let dbPromise: Promise<{ coll: <T extends Document = Document>(name: string) => Collection<T> }> | null = null;

export function getDb() {
  if (dbPromise) return dbPromise;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");
  client = new MongoClient(uri);
  dbPromise = client.connect().then((c) => {
    const db = c.db("verticut");
    return {
      coll: <T extends Document = Document>(name: string) => db.collection<T>(name),
    };
  });
  return dbPromise;
}

export type ProjectDoc = {
  _id: string;
  name: string;
  audioKey: string;
  audioUrl: string;
  audioDuration: number;
  transcript: { text: string; start: number; end: number }[];
  transcriptStatus: "pending" | "ready" | "error";
  createdAt: number;
  updatedAt: number;
};

export type ClipDoc = {
  id: string;
  start: number; // seconds
  duration: number; // seconds
  imageKey: string;
  imageUrl: string;
  animation: "zoom-in" | "zoom-out" | "pan-left" | "pan-right";
  labelText: string;
  labelPresetId: string;
};

export type SettingsDoc = {
  _id: string; // = projectId
  defaultLabelText: string;
  defaultFontSize: number;
  animationIntensity: number;
  musicUrl: string;
  musicVolume: number;
  presets: { id: string; name: string; text: string; tint: string }[];
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

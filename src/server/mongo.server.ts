import { MongoClient, type Db, type Document } from "mongodb";

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
  createdAt: number;
  updatedAt: number;
};

export type ClipDoc = {
  id: string;
  start: number;
  duration: number;
  imageKey: string;
  imageUrl: string;
  animation: "zoom-in" | "zoom-out" | "pan-left" | "pan-right";
  labelText: string;
  labelPresetId: string;
};

export type SettingsDoc = {
  _id: string;
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

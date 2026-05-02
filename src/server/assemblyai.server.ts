// Minimal AssemblyAI HTTP client (no SDK — Workers compatible)
const BASE = "https://api.assemblyai.com/v2";

function key() {
  const k = process.env.ASSEMBLYAI_API_KEY;
  if (!k) throw new Error("ASSEMBLYAI_API_KEY not configured");
  return k;
}

export async function submitTranscript(audioUrl: string): Promise<string> {
  const r = await fetch(`${BASE}/transcript`, {
    method: "POST",
    headers: {
      authorization: key(),
      "content-type": "application/json",
    },
    body: JSON.stringify({ audio_url: audioUrl, punctuate: true, format_text: true }),
  });
  if (!r.ok) throw new Error(`AssemblyAI submit failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { id: string };
  return j.id;
}

export type AAIResult = {
  status: "queued" | "processing" | "completed" | "error";
  text?: string;
  audio_duration?: number;
  words?: { text: string; start: number; end: number }[];
  error?: string;
};

export async function getTranscript(id: string): Promise<AAIResult> {
  const r = await fetch(`${BASE}/transcript/${id}`, {
    headers: { authorization: key() },
  });
  if (!r.ok) throw new Error(`AssemblyAI poll failed: ${r.status}`);
  return (await r.json()) as AAIResult;
}

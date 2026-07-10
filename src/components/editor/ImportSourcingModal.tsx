import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEditor } from "@/store/editor";
import { parseSourcingText, matchSourcingToTranscript } from "@/lib/sourcing";
import { fetchAndUploadImageUrl } from "@/lib/upload";
import type { ClipDoc } from "@/server/mongo.server";
import { Loader2 } from "lucide-react";

interface ImportSourcingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportSourcingModal({ open, onOpenChange }: ImportSourcingModalProps) {
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { transcript, audioDuration, clips, settings, updateClips } = useEditor();

  const handleProcess = async () => {
    if (!input.trim()) return;
    setProcessing(true);
    setError(null);

    try {
      // Accept multiple JSON shapes:
      // - [{ text, image }] → match text to transcript
      // - [{ start, end, image }] → use provided timestamps directly
      // - Mixed arrays containing both shapes
      let raw: any[] = [];
      try {
        raw = JSON.parse(input);
        if (!Array.isArray(raw)) throw new Error("Not an array");
      } catch (e) {
        throw new Error("Failed to parse JSON sourcing input. Make sure it's an array of objects.");
      }

      const timed: { start: number; end: number; link: string | null; originalText?: string }[] = [];
      const textPairs: { text: string; link: string | null }[] = [];

      for (const item of raw) {
        if (!item) continue;
        // Normalize common image field names
        const link = item.image ?? item.imageUrl ?? item.url ?? item.link ?? null;
        const hasStart = typeof item.start === "number" && Number.isFinite(item.start);
        const hasEnd = typeof item.end === "number" && Number.isFinite(item.end);
        const hasText = typeof item.text === "string" && item.text.trim().length > 0;

        if (hasStart && hasEnd && link) {
          timed.push({ start: Number(item.start), end: Number(item.end), link, originalText: item.text ?? "" });
        } else if (hasText) {
          textPairs.push({ text: String(item.text), link });
        } else if (link && !hasStart && !hasText) {
          // image-only without timestamps: treat as sequential placeholder — map later if transcript matching available
          textPairs.push({ text: "", link });
        }
      }

      let matches: { link: string | null; start: number; end: number; originalText: string }[] = [];

      // Direct timed entries are trusted as-is
      if (timed.length > 0) {
        for (const t of timed) {
          matches.push({ link: t.link, start: t.start, end: t.end, originalText: t.originalText ?? "" });
        }
      }

      // For text-based pairs, run the matcher; if there are any textPairs
      const textOnlyPairs = textPairs.filter(p => p.text && p.text.trim().length > 0);
      if (textOnlyPairs.length > 0) {
        const matched = matchSourcingToTranscript(textOnlyPairs, transcript, audioDuration);
        matches.push(...matched);
      }

      // For image-only pairs (no text, no timestamps), attempt to place them sequentially across transcript
      const imageOnly = textPairs.filter(p => !(p.text && p.text.trim().length > 0));
      if (imageOnly.length > 0 && transcript.length > 0) {
        // Divide transcript duration into equal segments for each image-only entry
        const dur = audioDuration || (transcript[transcript.length - 1]?.end ?? 0);
        const per = dur / imageOnly.length;
        for (let i = 0; i < imageOnly.length; i++) {
          const s = Math.max(0, per * i);
          const e = Math.min(dur, per * (i + 1));
          matches.push({ link: imageOnly[i].link, start: s, end: e, originalText: "" });
        }
      }

      if (matches.length === 0) {
        throw new Error("No valid sourcing items found. Provide objects with `text`+`image` or `start`+`end`+`image`.");
      }

      // Sort matches by start time
      matches.sort((a, b) => a.start - b.start);

      const newClips: ClipDoc[] = [];

      // Process each match
      for (const match of matches) {
        if (!match.link) continue; // Skip matches without a link

        let key = "";
        let url = match.link; // fallback to direct URL
        let isVideo = /\.(mp4|webm|mov)$/i.test(match.link || "");
        
        try {
          const res = await fetchAndUploadImageUrl(match.link);
          key = res.key;
          url = res.publicUrl;
          if (key.startsWith("video/")) {
            isVideo = true;
          }
        } catch (e) {
          console.warn("Failed to fetch/upload media, using direct URL", e);
        }

        const preset = settings.presets[0];
        
        const ANIMS = ["zoom-in", "zoom-out", "pan-left", "pan-right"] as const;

        const clipBase = {
          id: crypto.randomUUID(),
          kind: isVideo ? "video" : "image",
          start: match.start,
          duration: match.end - match.start,
          animation: settings.animationIntensity > 0 ? ANIMS[Math.floor(Math.random() * ANIMS.length)] : "none",
          labelText: settings.defaultLabelText || "",
          labelPresetId: preset?.id ?? "custom",
          intensity: settings.animationIntensity || 1,
        } as Partial<ClipDoc>;
        
        if (isVideo) {
          clipBase.videoUrl = url;
          clipBase.videoKey = key;
          clipBase.muted = true;
          clipBase.volume = 100;
          try {
            // Fetch video duration
            clipBase.videoDuration = await new Promise<number>((resolve, reject) => {
              const video = document.createElement("video");
              video.preload = "metadata";
              video.onloadedmetadata = () => resolve(video.duration);
              video.onerror = () => reject(new Error("Failed to load video metadata"));
              video.src = url;
            });
          } catch (err) {
            console.warn("Could not fetch video duration", err);
          }
        } else {
          clipBase.imageUrl = url;
          clipBase.imageKey = key;
        }

        newClips.push(clipBase as ClipDoc);
      }

      // Add to editor
      updateClips([...clips, ...newClips]);
      onOpenChange(false);
      setInput("");
    } catch (err) {
      console.error(err);
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[600px] bg-panel border-border text-foreground">
        <DialogHeader>
          <DialogTitle>Import Sourcing</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Paste your sourcing JSON array here. Each object should have a `text` and an `image` URL property.
          </p>
          
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full h-[200px] sm:h-[300px] bg-panel-2 border border-border rounded-md p-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
            placeholder={`[\n  {\n    "text": "Diawara Signs Four-Year Deal",\n    "image": null\n  },\n  {\n    "text": "Restricted free agent",\n    "image": "https://example.com/img.jpg"\n  }\n]`}
            disabled={processing}
          />

          {error && (
            <div className="p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm border border-border rounded-md hover:bg-accent disabled:opacity-50"
              disabled={processing}
            >
              Cancel
            </button>
            <button
              onClick={handleProcess}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              disabled={processing || !input.trim()}
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing...
                </>
              ) : (
                "Import Sourcing"
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

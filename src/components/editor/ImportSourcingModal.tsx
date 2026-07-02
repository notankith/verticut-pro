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
      const pairs = parseSourcingText(input);
      if (pairs.length === 0) {
        throw new Error("No valid text-link pairs found. Make sure links start with http.");
      }

      const matches = matchSourcingToTranscript(pairs, transcript, audioDuration);
      if (matches.length === 0) {
        throw new Error("Could not find any matches in the transcript.");
      }

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
        
        const clipBase = {
          id: crypto.randomUUID(),
          start: match.start,
          duration: match.end - match.start,
          animation: settings.animationIntensity > 0 ? "pan-left" : "none",
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

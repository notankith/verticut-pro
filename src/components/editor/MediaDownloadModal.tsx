import { useState } from "react";
import { DownloadCloud } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function MediaDownloadModal({ open, onOpenChange }: Props) {
  const [input, setInput] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[640px] border-border bg-panel p-6 text-foreground backdrop-blur-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <DownloadCloud className="h-4 w-4 text-primary" />
            Media Download
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Paste links or notes below. API integration will be connected here in a future update.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste media URLs or download instructions..."
            className="h-44 w-full resize-y rounded-md border border-border bg-panel-2 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
          />
          <div className="rounded-md border border-dashed border-border/80 bg-panel-2/70 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Future API placeholder</div>
            <p className="mt-1">
              Download job queue, source validation, progress, and import mapping will plug into this surface without changing the UI flow.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


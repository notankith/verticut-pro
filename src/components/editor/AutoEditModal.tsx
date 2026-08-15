import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEditor } from "@/store/editor";
import type { ClipDoc } from "@/server/mongo.server";
import { Loader2, Check, AlertTriangle, Play, FileJson, Sparkles } from "lucide-react";

interface AutoEditModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    playerRef: React.RefObject<any>;
}

interface Segment {
    start: number;
    end: number;
    query: string;
}

interface ProcessingLog {
    segmentIndex: number;
    query: string;
    status: "pending" | "verticut" | "ddg" | "success" | "warning";
    message: string;
}

interface SearchImage {
    id: string;
    url: string;
    title?: string;
}

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1080&auto=format&fit=crop&q=80";

// Randomize animation options, biasing heavily towards panning motions (80% probability)
const getRandomAnimation = (): ClipDoc["animation"] => {
    const rand = Math.random();
    if (rand < 0.4) return "pan-left";
    if (rand < 0.8) return "pan-right";
    if (rand < 0.9) return "zoom-in";
    return "zoom-out";
};

export function AutoEditModal({ open, onOpenChange, playerRef }: AutoEditModalProps) {
    const [input, setInput] = useState("");
    const [processing, setProcessing] = useState(false);
    const [clearExisting, setClearExisting] = useState(true);
    const [autoImport, setAutoImport] = useState(true);

    // Parsed segments
    const [segments, setSegments] = useState<Segment[]>([]);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);

    // States for automatic import logs
    const [logs, setLogs] = useState<ProcessingLog[]>([]);

    // States for manual selection
    const [searching, setSearching] = useState(false);
    const [overrideQuery, setOverrideQuery] = useState("");
    const [verticutImages, setVerticutImages] = useState<SearchImage[]>([]);
    const [ddgImages, setDdgImages] = useState<SearchImage[]>([]);
    const [topSelectedImage, setTopSelectedImage] = useState<SearchImage | null>(null);
    const [bottomSelectedImage, setBottomSelectedImage] = useState<SearchImage | null>(null);
    const [activeSlot, setActiveSlot] = useState<"top" | "bottom">("top");

    // Keep track of all image URLs imported during this active session
    const [usedImageUrls, setUsedImageUrls] = useState<string[]>([]);

    // Accumulated clips during manual building sessions
    const [currentBuildingClips, setCurrentBuildingClips] = useState<ClipDoc[]>([]);

    const [error, setError] = useState<string | null>(null);

    const { clips, updateClips, settings } = useEditor();

    const FPS = 30;

    // Initialize and run Auto Edit
    const handleStart = async () => {
        if (!input.trim()) return;
        setError(null);
        setLogs([]);
        setVerticutImages([]);
        setDdgImages([]);
        setTopSelectedImage(null);
        setBottomSelectedImage(null);
        setActiveSlot("top");
        setUsedImageUrls([]);

        let parsedSegments: Segment[] = [];
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed)) {
                parsedSegments = parsed;
            } else if (parsed && Array.isArray(parsed.segments)) {
                parsedSegments = parsed.segments;
            } else {
                throw new Error("Invalid structure. Data must be an array of segments or { segments: [...] }.");
            }

            // Validation
            for (let i = 0; i < parsedSegments.length; i++) {
                const s = parsedSegments[i];
                if (typeof s.start !== "number" || typeof s.end !== "number" || !s.query) {
                    throw new Error(`Segment index ${i} has invalid data. Ensure start, end, and query are present.`);
                }
            }
        } catch (err: any) {
            setError(err?.message || "Failed to parse JSON. Double check your format.");
            return;
        }

        setSegments(parsedSegments);
        setProcessing(true);

        // Initial timeline settings filter
        const initialAccumulatedClips = clearExisting
            ? clips.filter((c) => c.kind !== "media" && c.kind !== "solid")
            : [...clips];

        setCurrentBuildingClips(initialAccumulatedClips);

        if (autoImport) {
            // Run automatic processing
            runAutomaticImport(parsedSegments, initialAccumulatedClips);
        } else {
            // Manual selection flow starting with segment 0
            setCurrentStepIndex(0);
            setOverrideQuery(parsedSegments[0].query);
            triggerManualSearch(0, parsedSegments, parsedSegments[0].query);
        }
    };

    // ------------------ AUTOMATIC IMPORT PIPELINE ------------------
    const runAutomaticImport = async (segs: Segment[], initialClips: ClipDoc[]) => {
        const initialLogs: ProcessingLog[] = segs.map((s, idx) => ({
            segmentIndex: idx,
            query: s.query,
            status: "pending",
            message: `Pending start timestamp ${s.start}s - ${s.end}s`,
        }));
        setLogs(initialLogs);

        let accumulated = [...initialClips];
        const usedUrls: string[] = [];

        for (let idx = 0; idx < segs.length; idx++) {
            const segment = segs[idx];
            const frame = Math.round(segment.start * FPS);
            if (playerRef.current) playerRef.current.seekTo(frame);

            setLogs((prev) =>
                prev.map((l, i) =>
                    i === idx
                        ? { ...l, status: "verticut", message: `Searching database for "${segment.query}"...` }
                        : l
                )
            );

            let foundImages: SearchImage[] = [];

            // Query verticut
            try {
                const res = await fetch("/api/search-media", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ query: segment.query, page: 1, size: 24, source: "verticut" }),
                });
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data.images)) {
                        // FILTER OUT already used images
                        foundImages = data.images
                            .filter((img: any) => !usedUrls.includes(img.url))
                            .map((img: any) => ({
                                id: img.id || img.url,
                                url: img.url,
                                title: img.title
                            }));
                    }
                }
            } catch (err) {
                console.error("Vertical search failed for:", segment.query, err);
            }

            // Fallback to DDG if index 0 and needs at least 2 images, or index > 0 and needs 1 image but found none
            const minNeeded = idx === 0 ? 2 : 1;
            if (foundImages.length < minNeeded) {
                setLogs((prev) =>
                    prev.map((l, i) =>
                        i === idx
                            ? { ...l, status: "ddg", message: `Found ${foundImages.length} images. Querying General Search for "${segment.query}"...` }
                            : l
                    )
                );

                try {
                    const res = await fetch("/api/search-media", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ query: segment.query, page: 1, size: 24, source: "duckduckgo" }),
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data.images)) {
                            for (const img of data.images) {
                                // FILTER OUT duplicates
                                if (!usedUrls.includes(img.url) && !foundImages.some((fi) => fi.url === img.url)) {
                                    foundImages.push({
                                        id: img.id || img.url,
                                        url: img.url,
                                        title: img.title
                                    });
                                    if (foundImages.length >= minNeeded) break;
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error("General search failed for:", segment.query, err);
                }
            }

            let newClip: ClipDoc;
            let successStatus: "success" | "warning" = "success";
            let statusMsg = "";

            // SPLIT-SCREEN is strictly for the first segment (idx === 0)
            if (idx === 0) {
                let topImg = FALLBACK_IMAGE;
                let topKey = "fallback-stock-image";
                let bottomImg = FALLBACK_IMAGE;
                let bottomKey = "fallback-stock-image";

                if (foundImages.length >= 2) {
                    topImg = foundImages[0].url;
                    topKey = foundImages[0].id;
                    bottomImg = foundImages[1].url;
                    bottomKey = foundImages[1].id;
                    usedUrls.push(topImg, bottomImg);
                    statusMsg = `Imported split-screen layout with 2 images for "${segment.query}"`;
                } else if (foundImages.length === 1) {
                    topImg = foundImages[0].url;
                    topKey = foundImages[0].id;
                    bottomImg = foundImages[0].url;
                    bottomKey = foundImages[0].id;
                    usedUrls.push(topImg);
                    successStatus = "warning";
                    statusMsg = `Only 1 image found; duplicated to split-screen slots.`;
                } else {
                    successStatus = "warning";
                    statusMsg = `No images found; used fallback artwork.`;
                }

                newClip = {
                    id: crypto.randomUUID(),
                    kind: "media",
                    start: segment.start,
                    duration: segment.end - segment.start,
                    imageUrl: topImg,
                    imageKey: topKey,
                    animation: getRandomAnimation(),
                    intensity: settings.animationIntensity || 1,
                    splitScreen: {
                        enabled: true,
                        bottomImageKey: bottomKey,
                        bottomImageUrl: bottomImg,
                    },
                };
            } else {
                // Normal single media for all subsequent segments
                let mainImg = FALLBACK_IMAGE;
                let mainKey = "fallback-stock-image";

                if (foundImages.length >= 1) {
                    mainImg = foundImages[0].url;
                    mainKey = foundImages[0].id;
                    usedUrls.push(mainImg);
                    statusMsg = `Imported normal image layout for "${segment.query}"`;
                } else {
                    successStatus = "warning";
                    statusMsg = `No images found; used fallback artwork.`;
                }

                newClip = {
                    id: crypto.randomUUID(),
                    kind: "media",
                    start: segment.start,
                    duration: segment.end - segment.start,
                    imageUrl: mainImg,
                    imageKey: mainKey,
                    animation: getRandomAnimation(),
                    intensity: settings.animationIntensity || 1,
                    splitScreen: {
                        enabled: false,
                    },
                };
            }

            accumulated.push(newClip);
            updateClips([...accumulated]);

            setLogs((prev) =>
                prev.map((l, i) => (i === idx ? { ...l, status: successStatus, message: statusMsg } : l))
            );

            await new Promise((resolve) => setTimeout(resolve, 400));
        }

        setUsedImageUrls(usedUrls);
        setProcessing(false);
        setInput("");
        setTimeout(() => {
            onOpenChange(false);
        }, 1200);
    };

    // ------------------ MANUAL MATCHING PROCESSOR ------------------
    const triggerManualSearch = async (idx: number, segsList: Segment[], queryText: string) => {
        setSearching(true);
        setVerticutImages([]);
        setDdgImages([]);
        setTopSelectedImage(null);
        setBottomSelectedImage(null);
        setActiveSlot("top");

        const segment = segsList[idx];

        // Seek player to segment start frame coordinates
        const frame = Math.round(segment.start * FPS);
        if (playerRef.current) {
            playerRef.current.seekTo(frame);
        }

        try {
            // Parallel searches
            const [resVert, resDDG] = await Promise.all([
                fetch("/api/search-media", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ query: queryText, page: 1, size: 24, source: "verticut" }),
                }).then(async (r) => (r.ok ? r.json() : { images: [] })).catch(() => ({ images: [] })),
                fetch("/api/search-media", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ query: queryText, page: 1, size: 24, source: "duckduckgo" }),
                }).then(async (r) => (r.ok ? r.json() : { images: [] })).catch(() => ({ images: [] })),
            ]);

            const vImgs: SearchImage[] = Array.isArray(resVert.images) ? resVert.images : [];
            const dImgs: SearchImage[] = Array.isArray(resDDG.images) ? resDDG.images : [];

            setVerticutImages(vImgs);
            setDdgImages(dImgs);

            // Pre-fill selections using non-used image candidates
            const combined = [...vImgs, ...dImgs].filter((img) => !usedImageUrls.includes(img.url));

            if (idx === 0) {
                setTopSelectedImage(combined[0] ? combined[0] : { id: "fallback-stock-image", url: FALLBACK_IMAGE });
                setBottomSelectedImage(combined[1] ? combined[1] : combined[0] ? combined[0] : { id: "fallback-stock-image", url: FALLBACK_IMAGE });
            }
        } catch (err) {
            console.error("Search failed during manual matching trigger:", err);
        } finally {
            setSearching(false);
        }
    };

    const handleOverrideSearch = () => {
        if (!overrideQuery.trim()) return;
        triggerManualSearch(currentStepIndex, segments, overrideQuery);
    };

    const confirmAndAdvanceWithMedia = (top: SearchImage, bottom: SearchImage | null, updatedClipsList: ClipDoc[]) => {
        const segment = segments[currentStepIndex];
        let newClip: ClipDoc;

        if (currentStepIndex === 0) {
            newClip = {
                id: crypto.randomUUID(),
                kind: "media",
                start: segment.start,
                duration: segment.end - segment.start,
                imageUrl: top.url,
                imageKey: top.id,
                animation: getRandomAnimation(),
                intensity: settings.animationIntensity || 1,
                splitScreen: {
                    enabled: true,
                    bottomImageKey: bottom?.id || top.id,
                    bottomImageUrl: bottom?.url || top.url,
                },
            };

            // Add to usedUrls tracker
            setUsedImageUrls((prev) => [...prev, top.url, bottom?.url || top.url]);
        } else {
            newClip = {
                id: crypto.randomUUID(),
                kind: "media",
                start: segment.start,
                duration: segment.end - segment.start,
                imageUrl: top.url,
                imageKey: top.id,
                animation: getRandomAnimation(),
                intensity: settings.animationIntensity || 1,
                splitScreen: {
                    enabled: false,
                },
            };

            // Add to usedUrls tracker
            setUsedImageUrls((prev) => [...prev, top.url]);
        }

        const nextClips = [...updatedClipsList, newClip];
        setCurrentBuildingClips(nextClips);
        updateClips(nextClips);

        const nextIdx = currentStepIndex + 1;
        if (nextIdx < segments.length) {
            setCurrentStepIndex(nextIdx);
            setOverrideQuery(segments[nextIdx].query);
            triggerManualSearch(nextIdx, segments, segments[nextIdx].query);
        } else {
            // All segments resolved
            setProcessing(false);
            setInput("");
            onOpenChange(false);
        }
    };

    const handleImageClick = (img: SearchImage) => {
        // Prevent selecting same image twice
        if (usedImageUrls.includes(img.url)) return;

        if (currentStepIndex === 0) {
            if (activeSlot === "top") {
                setTopSelectedImage(img);
                setActiveSlot("bottom"); // switch selections slot to bottom automatically
            } else {
                setBottomSelectedImage(img);
                // Double selection complete on segment 0: confirm and advance!
                confirmAndAdvanceWithMedia(topSelectedImage || img, img, currentBuildingClips);
            }
        } else {
            // Normal single layout: click and immediately advance!
            confirmAndAdvanceWithMedia(img, null, currentBuildingClips);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => !processing && onOpenChange(val)}>
            <DialogContent className="fixed left-[50%] translate-x-[-50%] top-6 translate-y-0 sm:top-[50%] sm:translate-y-[-50%] w-[94vw] sm:max-w-[780px] bg-panel border-border text-foreground overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[95vh] p-0 animate-scale-in">
                <DialogHeader className="border-b border-border p-4">
                    <DialogTitle className="flex items-center justify-between text-sm uppercase tracking-wider font-bold text-foreground w-full pr-6">
                        <span className="flex items-center gap-2">
                            <FileJson className="h-4 w-4 text-primary" /> Auto Edit Video Builder
                        </span>
                        {processing && !autoImport && (
                            <span className="text-[10px] text-muted-foreground bg-border px-2 py-0.5 rounded font-mono normal-case tracking-normal">
                                Segment {currentStepIndex + 1} of {segments.length}
                            </span>
                        )}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 p-4 min-h-0 flex-1 flex flex-col overflow-y-auto">
                    {!processing ? (
                        <>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Paste the AI-analyzed segment JSON with queries & timestamps.
                                VertiCut will search stock libraries, let you customize matching visual assets,
                                and compile them directly onto your project timeline.
                            </p>

                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                className="w-full h-[120px] sm:h-[220px] bg-panel-2 border border-border rounded-md p-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-muted-foreground/50 transition shrink-0"
                                placeholder={`{\n  "segments": [\n    {\n      "start": 0.0,\n      "end": 2.8,\n      "query": "Cristiano Ronaldo playing"\n    },\n    {\n      "start": 2.8,\n      "end": 5.7,\n      "query": "Real Madrid stadium crowd"\n    }\n  ]\n}`}
                            />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-panel-2 p-3.5 rounded-lg border border-border/60 shrink-0">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="auto-import"
                                        checked={autoImport}
                                        onChange={(e) => setAutoImport(e.target.checked)}
                                        className="rounded border-border text-primary focus:ring-primary accent-primary h-3.5 w-3.5 cursor-pointer"
                                    />
                                    <label htmlFor="auto-import" className="text-xs text-foreground font-semibold select-none cursor-pointer">
                                        Auto Import images automatically
                                    </label>
                                </div>
                                <div className="flex items-center gap-2 border-t md:border-t-0 md:border-l border-border/50 pt-2 md:pt-0 md:pl-4">
                                    <input
                                        type="checkbox"
                                        id="clear-existing"
                                        checked={clearExisting}
                                        onChange={(e) => setClearExisting(e.target.checked)}
                                        className="rounded border-border text-primary focus:ring-primary accent-primary h-3.5 w-3.5 cursor-pointer"
                                    />
                                    <label htmlFor="clear-existing" className="text-xs text-muted-foreground select-none cursor-pointer">
                                        Clear existing media clips before import
                                    </label>
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2 mb-2">
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}
                        </>
                    ) : autoImport ? (
                        // AUTOMATIC PROGRESS LOG VIEW
                        <div className="flex-1 flex flex-col min-h-0">
                            <div className="space-y-2 mb-4 shrink-0 bg-panel-2 p-3.5 rounded-lg border border-border">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="font-semibold text-primary">Building Video: Auto Editing timeline...</span>
                                    <span className="text-[10px] text-muted-foreground font-mono">{Math.round((logs.filter(l => l.status === "success" || l.status === "warning").length / segments.length) * 100)}%</span>
                                </div>
                                <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                                    <div
                                        className="bg-primary h-full rounded-full transition-all duration-300"
                                        style={{ width: `${(logs.filter(l => l.status === "success" || l.status === "warning").length / segments.length) * 100}%` }}
                                    />
                                </div>
                            </div>

                            <div className="flex-1 border border-border bg-panel-2 rounded-lg p-3 overflow-y-auto space-y-2 font-mono text-[10px]">
                                {logs.map((log) => (
                                    <div
                                        key={log.segmentIndex}
                                        className={`flex items-start gap-2 py-0.5 border-b border-border/20 last:border-none ${log.status === "success"
                                            ? "text-green-400"
                                            : log.status === "warning"
                                                ? "text-yellow-500"
                                                : log.status === "pending"
                                                    ? "text-muted-foreground/60"
                                                    : "text-primary animate-pulse"
                                            }`}
                                    >
                                        <span className="shrink-0 font-bold">[{log.segmentIndex + 1}]</span>
                                        <span className="flex-1">
                                            <strong className="text-foreground">{log.query}</strong>: {log.message}
                                        </span>
                                        {log.status === "success" && <Check className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />}
                                        {log.status === "warning" && <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0 mt-0.5" />}
                                        {(log.status === "verticut" || log.status === "ddg") && (
                                            <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0 mt-0.5" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        // INTERACTIVE MANUAL CHOOSING INTERFACE with search override inputs, big gallery cards & auto advancement
                        <div className="flex-1 flex flex-col min-h-0 space-y-3">
                            {/* TOP: Search query manual overrides */}
                            <div className="flex gap-2 bg-panel-2 p-2 rounded-lg border border-border shrink-0">
                                <input
                                    type="text"
                                    value={overrideQuery}
                                    onChange={(e) => setOverrideQuery(e.target.value)}
                                    className="flex-1 h-8 bg-panel-3 border border-border rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50 transition-shadow"
                                    placeholder="Type to override search query manually..."
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleOverrideSearch();
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={handleOverrideSearch}
                                    className="h-8 px-4 bg-primary text-primary-foreground rounded text-xs hover:opacity-90 transition cursor-pointer font-semibold flex items-center gap-1"
                                >
                                    Search
                                </button>
                            </div>

                            {/* Slot indicators display (RENDER ONLY FOR SEGMENT 0) */}
                            {currentStepIndex === 0 && (
                                <div className="flex gap-3 bg-panel-2 p-2 rounded-lg border border-border shrink-0 animate-fade-in">
                                    <button
                                        type="button"
                                        onClick={() => setActiveSlot("top")}
                                        className={`flex-1 flex items-center justify-between p-2 rounded border text-left transition ${activeSlot === "top"
                                            ? "border-primary bg-primary/10"
                                            : "border-border/60 hover:bg-neutral-800/15"
                                            }`}
                                    >
                                        <div>
                                            <span className="text-[9px] uppercase font-bold text-muted-foreground">Slot 1</span>
                                            <span className="text-xs font-semibold text-foreground block">Top (Main) Screen</span>
                                        </div>
                                        {topSelectedImage ? (
                                            <img src={topSelectedImage.url} className="h-8 w-12 object-cover rounded border border-border/40" />
                                        ) : (
                                            <div className="h-8 w-12 bg-black/40 rounded flex items-center justify-center text-[8px] text-muted-foreground">Empty</div>
                                        )}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setActiveSlot("bottom")}
                                        className={`flex-1 flex items-center justify-between p-2 rounded border text-left transition ${activeSlot === "bottom"
                                            ? "border-primary bg-primary/10"
                                            : "border-border/60 hover:bg-neutral-800/15"
                                            }`}
                                    >
                                        <div>
                                            <span className="text-[9px] uppercase font-bold text-muted-foreground">Slot 2</span>
                                            <span className="text-xs font-semibold text-foreground block">Bottom Screen</span>
                                        </div>
                                        {bottomSelectedImage ? (
                                            <img src={bottomSelectedImage.url} className="h-8 w-12 object-cover rounded border border-border/40" />
                                        ) : (
                                            <div className="h-8 w-12 bg-black/40 rounded flex items-center justify-center text-[8px] text-muted-foreground">Empty</div>
                                        )}
                                    </button>
                                </div>
                            )}

                            {/* Side-by-side search results display: big image gallery cards */}
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0 min-h-[320px] overflow-y-auto md:overflow-visible">
                                {/* Column 1: VertiCut vertical images */}
                                <div className="flex flex-col border border-border rounded-lg bg-panel-2 overflow-hidden h-[240px] md:h-auto">
                                    <div className="p-2 border-b border-border/85 bg-panel-3 flex justify-between items-center text-[10px] font-bold text-primary shrink-0">
                                        <span>VertiCut Stocks</span>
                                        {searching && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-2">
                                        {verticutImages.length === 0 && !searching ? (
                                            <div className="text-center py-12 text-[10px] text-muted-foreground">No vertical images found.</div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2">
                                                {verticutImages.map((img) => {
                                                    const isUsed = usedImageUrls.includes(img.url);
                                                    return (
                                                        <button
                                                            key={img.url}
                                                            disabled={isUsed || searching}
                                                            onClick={() => handleImageClick(img)}
                                                            className={`relative w-full aspect-video rounded overflow-hidden border bg-black/45 transition ${isUsed
                                                                ? "border-emerald-500/40 opacity-70 cursor-not-allowed"
                                                                : "border-border hover:border-primary hover:scale-[1.02] cursor-pointer"
                                                                }`}
                                                        >
                                                            <img src={img.url} className={`w-full h-full object-cover ${isUsed ? "filter saturate-50 brightness-75 rgba-overlay" : ""}`} />
                                                            {isUsed && (
                                                                <div className="absolute inset-0 bg-emerald-950/45 backdrop-blur-[0.5px] flex items-center justify-center">
                                                                    <div className="bg-emerald-500 text-white rounded-full p-1 shadow">
                                                                        <Check className="h-3 w-3" />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Column 2: DuckDuckGo images */}
                                <div className="flex flex-col border border-border rounded-lg bg-panel-2 overflow-hidden h-[240px] md:h-auto">
                                    <div className="p-2 border-b border-border/85 bg-panel-3 flex justify-between items-center text-[10px] font-bold text-foreground shrink-0">
                                        <span>General (DDG)</span>
                                        {searching && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-2">
                                        {ddgImages.length === 0 && !searching ? (
                                            <div className="text-center py-12 text-[10px] text-muted-foreground">No general images found.</div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2">
                                                {ddgImages.map((img) => {
                                                    const isUsed = usedImageUrls.includes(img.url);
                                                    return (
                                                        <button
                                                            key={img.url}
                                                            disabled={isUsed || searching}
                                                            onClick={() => handleImageClick(img)}
                                                            className={`relative w-full aspect-video rounded overflow-hidden border bg-black/45 transition ${isUsed
                                                                ? "border-emerald-500/40 opacity-70 cursor-not-allowed"
                                                                : "border-border hover:border-primary hover:scale-[1.02] cursor-pointer"
                                                                }`}
                                                        >
                                                            <img src={img.url} className={`w-full h-full object-cover ${isUsed ? "filter saturate-50 brightness-75 rgba-overlay" : ""}`} />
                                                            {isUsed && (
                                                                <div className="absolute inset-0 bg-emerald-950/45 backdrop-blur-[0.5px] flex items-center justify-center">
                                                                    <div className="bg-emerald-500 text-white rounded-full p-1 shadow">
                                                                        <Check className="h-3 w-3" />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Confirm Step Buttons */}
                            <div className="flex justify-between items-center border-t border-border pt-3 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setProcessing(false);
                                        setInput("");
                                    }}
                                    className="px-4 py-2 text-xs border border-border rounded hover:bg-accent transition font-semibold cursor-pointer"
                                >
                                    Cancel / Abort
                                </button>
                                <div className="text-[10px] text-muted-foreground italic">
                                    {currentStepIndex === 0
                                        ? (activeSlot === "top" ? "Click visual image to set Slot 1 (Top)" : "Click visual image to set Slot 2 (Bottom) & advance")
                                        : "Click visual image to assign and automatically advance"}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {!processing && (
                    <div className="flex justify-end gap-2 border-t border-border p-4 bg-panel shrink-0">
                        <button
                            onClick={() => onOpenChange(false)}
                            className="px-4 py-2 text-xs border border-border rounded hover:bg-accent transition cursor-pointer font-semibold"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleStart}
                            className="px-4 py-2 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 transition cursor-pointer font-semibold"
                            disabled={!input.trim()}
                        >
                            <Play className="h-3 w-3" /> Start Auto Edit
                        </button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

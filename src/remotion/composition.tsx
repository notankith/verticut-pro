import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig, interpolate, staticFile, Video, AnimatedImage } from "remotion";
import type { ClipDoc, AudioSegment } from "../server/mongo.server";
import type { TemplateWindow } from "@/lib/templates";

export type CompositionProps = {
  audioUrl: string;
  musicUrl?: string;
  musicVolume?: number; // 0..1
  clips: ClipDoc[];
  defaultLabelText?: string;
  defaultFontSize?: number;
  intensity: number; // 0.5..3
  durationInFrames: number;
  fps: number;
  overlayUrl?: string;
  templateWindow?: TemplateWindow;
  // enable or disable the boundary transitions between clips
  enableTransitions?: boolean;
  audioSegments?: AudioSegment[];
  captionTextColor?: string;
  captionBgColor?: string;
  captionPosX?: number;
  captionPosY?: number;
  captionFontSize?: number;
  captionWordsPerLine?: number;
  captionLinesPerSegment?: number;
  captionFont?: string;
  showLabels?: boolean;
  showCaptions?: boolean;
  transcript?: { text: string; start: number; end: number }[];
  enableGradientOverlay?: boolean;
  gradientOverlayUrl?: string;
};

const ANIM_SHIFT = 0.6; // base scale/translate range (increased for stronger pan)
const TRANSITION_FRAMES = 8;
const CONTRAST_MULTIPLIER = 1.3;
const TRANSITION_DIRECTIONS = ["slide-left", "slide-right", "slide-up", "slide-down"] as const;
const DEFAULT_GRADIENT_OVERLAY_URL = "https://i.ibb.co/C5phXbpz/Gradient-Overlay.png";

type TransitionKind = (typeof TRANSITION_DIRECTIONS)[number];

function getBoundaryTransition(index: number): TransitionKind | null {
  return index >= 0 && index < TRANSITION_DIRECTIONS.length ? TRANSITION_DIRECTIONS[index] : null;
}

function getTransitionTransform(kind: TransitionKind, progress: number, mode: "in" | "out") {
  const p = Math.max(0, Math.min(1, progress));
  if (kind === "slide-left") {
    return mode === "in" ? { x: interpolate(p, [0, 1], [100, 0]), y: 0 } : { x: interpolate(p, [0, 1], [0, -100]), y: 0 };
  }
  if (kind === "slide-right") {
    return mode === "in" ? { x: interpolate(p, [0, 1], [-100, 0]), y: 0 } : { x: interpolate(p, [0, 1], [0, 100]), y: 0 };
  }
  if (kind === "slide-up") {
    return mode === "in" ? { x: 0, y: interpolate(p, [0, 1], [100, 0]) } : { x: 0, y: interpolate(p, [0, 1], [0, -100]) };
  }
  return mode === "in" ? { x: 0, y: interpolate(p, [0, 1], [-100, 0]) } : { x: 0, y: interpolate(p, [0, 1], [0, 100]) };
}

function KenBurns({
  frame,
  duration,
  animation,
  intensity,
  imageUrl,
  videoUrl,
  anchorX,
  anchorY,
  clip,
  fps,
}: {
  frame: number;
  duration: number;
  animation: ClipDoc["animation"];
  intensity: number;
  imageUrl?: string;
  videoUrl?: string;
  anchorX: number;
  anchorY: number;
  clip: ClipDoc;
  fps: number;
}) {
  const { width: compWidth, height: compHeight } = useVideoConfig();
  const actualVideoUrl = videoUrl || (imageUrl && (imageUrl.match(/\.(mp4|webm|mov|mkv)$/i) || imageUrl.includes("/video/")) ? imageUrl : undefined);
  const t = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const range = ANIM_SHIFT * intensity;
  let baseScale = 1.05;
  let txPercent = 0;
  let ty = 0;

  // Disable auto-animation if keyframes are present
  const hasKeyframes = clip.keyframes && clip.keyframes.length > 0;

  if (!hasKeyframes && animation === "zoom-in") {
    baseScale = 1 + range * 0.35 * t + 0.02;
  } else if (!hasKeyframes && animation === "zoom-out") {
    baseScale = 1 + range * 0.35 + 0.02 - range * 0.35 * t;
  } else if (!hasKeyframes && animation === "pan-left") {
    txPercent = Number(interpolate(t, [0, 1], [range * 5, -range * 5]));
    baseScale = 1.15; // 15% scale to cover the +/- 5% translation safely
  } else if (!hasKeyframes && animation === "pan-right") {
    txPercent = Number(interpolate(t, [0, 1], [-range * 5, range * 5]));
    baseScale = 1.15;
  } else if (!hasKeyframes) {
    baseScale = 1;
  }

  // Keyframe interpolation (clip.keyframes use project time; convert to local)
  let kfScale: number | undefined = undefined;
  let kfPosX: number | undefined = undefined;
  let kfPosY: number | undefined = undefined;
  let kfRot: number | undefined = undefined;
  let kfOpacity: number | undefined = undefined;
  if (clip.keyframes && clip.keyframes.length > 0) {
    const localT = frame / fps;
    const kfs = clip.keyframes
      .map((k) => ({ ...k, local: k.time - clip.start }))
      .filter((k) => k.local >= 0 && k.local <= duration)
      .sort((a, b) => a.local - b.local);
    if (kfs.length > 0) {
      function interpProp(prop: keyof typeof kfs[0]) {
        let prev = null as any;
        let next = null as any;
        for (let i = 0; i < kfs.length; i++) {
          if ((kfs[i] as any).local <= localT) prev = kfs[i];
          if ((kfs[i] as any).local > localT) { next = kfs[i]; break; }
        }
        if (!prev && !next) return undefined;
        if (!prev) return (next as any)[prop];
        if (!next) return (prev as any)[prop];
        const pVal = (prev as any)[prop];
        const nVal = (next as any)[prop];
        if (pVal == null || nVal == null) return pVal ?? nVal;
        const alpha = (localT - prev.local) / Math.max(1e-6, next.local - prev.local);
        return pVal + (nVal - pVal) * alpha;
      }
      kfScale = interpProp("scale");
      kfPosX = interpProp("posX");
      kfPosY = interpProp("posY");
      kfRot = interpProp("rotation");
      kfOpacity = interpProp("opacity");
    }
  }

  const appliedScale = (kfScale ?? clip.scale ?? 1) * baseScale;
  // For panning, we apply txPercent to the entire container transform, not objectPosition
  // So appliedPosX and appliedPosY only reflect explicit keyframes or anchor positions for objectPosition
  const appliedPosX = kfPosX ?? clip.posX ?? anchorX;
  const appliedPosY = kfPosY ?? clip.posY ?? anchorY;
  const appliedOpacity = kfOpacity ?? clip.opacity ?? 1;

  if (clip.layer === "overlay") {
    // Render as a sticker centered at appliedPosX%, appliedPosY%
    const isVid = actualVideoUrl;
    return (
      <AbsoluteFill style={{
        transform: `translate(-50%, -50%) translate(${appliedPosX}%, ${appliedPosY}%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
        opacity: appliedOpacity,
        willChange: "transform, opacity",
        width: "40%",
        height: "22.5%", // 16:9 ratio container
        transformOrigin: "center",
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: 8,
      }}>
        {isVid ? (
          <Video
            src={actualVideoUrl}
            startFrom={Math.round((clip.trimStart ?? 0) * fps)}
            muted={clip.muted ?? true}
            volume={(clip.volume ?? 100) / 100}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : imageUrl && /\.gif($|\?)/i.test(imageUrl) ? (
          <AnimatedImage
            src={imageUrl}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <Img
            src={imageUrl || ""}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}
      </AbsoluteFill>
    );
  }

  if (clip.kind === "solid") {
    return (
      <AbsoluteFill style={{
        transform: `translate(-50%, -50%) translate(${appliedPosX}%, ${appliedPosY}%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
        opacity: appliedOpacity,
        backgroundColor: clip.solidColor || "#800000",
        willChange: "transform, opacity",
        width: "100%",
        height: "100%",
        transformOrigin: "center",
      }} />
    );
  }

  if (clip.kind === "text") {
    return (
      <AbsoluteFill style={{
        transform: `translate(-50%, -50%) translate(${appliedPosX}%, ${appliedPosY}%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
        opacity: appliedOpacity,
        willChange: "transform, opacity",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transformOrigin: "center",
      }}>
        <div style={{
          fontSize: 80,
          fontWeight: 800,
          color: "#fff",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          textShadow: "0 2px 10px rgba(0,0,0,0.8)",
          textAlign: "center",
          whiteSpace: "pre-wrap",
          lineHeight: 1.1,
        }}>
          {clip.textContent || ""}
        </div>
      </AbsoluteFill>
    );
  }

  if (actualVideoUrl) {
    const trimStartSec = (clip && clip.trimStart) || 0;
    const trimStartFrames = Math.round(trimStartSec * fps);

    const vidDurFrames = clip.videoDuration ? Math.max(1, Math.round((clip.videoDuration - trimStartSec) * fps)) : Math.max(1, duration);
    const loopCount = clip.videoDuration ? Math.ceil(duration / vidDurFrames) : 1;

    const loops = [];
    for (let i = 0; i < loopCount; i++) {
      loops.push(
        <Sequence from={i * vidDurFrames} durationInFrames={vidDurFrames} key={i}>
          <Video
            src={actualVideoUrl}
            startFrom={trimStartFrames}
            muted={clip.muted ?? true}
            volume={(clip.volume ?? 100) / 100}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: `${appliedPosX}% ${appliedPosY}%`,
            }}
          />
        </Sequence>
      );
    }

    return (
      <AbsoluteFill style={{
        transform: `translate(${txPercent}%, 0%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
        opacity: appliedOpacity,
        filter: `contrast(${CONTRAST_MULTIPLIER})`,
        willChange: "transform, opacity",
      }}>
        {loops}
      </AbsoluteFill>
    );
  }

  if (imageUrl && /\.gif($|\?)/i.test(imageUrl)) {
    return (
      <AnimatedImage
        src={imageUrl}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: `${appliedPosX}% ${appliedPosY}%`,
          filter: `contrast(${CONTRAST_MULTIPLIER})`,
          opacity: appliedOpacity,
          transform: `translate(${txPercent}%, 0%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
        }}
      />
    );
  }

  return (
    <Img
      src={imageUrl || ""}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: `${appliedPosX}% ${appliedPosY}%`,
        filter: `contrast(${CONTRAST_MULTIPLIER})`,
        opacity: appliedOpacity,
        transform: `translate(${txPercent}%, 0%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
      }}
    />
  );
}

// Reference clip length: animations look natural when clip ≥ this many seconds.
// Shorter clips compress the same range into less time, which feels jittery,
// so we scale intensity down proportionally.
const REF_DURATION_SEC = 3.5;

function ClipLayer({
  clip,
  intensity,
  clipIndex,
  totalClips,
  enableTransitions = true,
}: {
  clip: ClipDoc;
  intensity: number;
  clipIndex: number;
  totalClips: number;
  enableTransitions?: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = Math.max(1, Math.round(clip.duration * fps));
  const anchorX = clip.anchorX ?? 50;
  const anchorY = clip.anchorY ?? 50;
  const appliedIntensity = clip.intensity ?? intensity;
  const durationFactor = Math.min(1, clip.duration / REF_DURATION_SEC);
  const scaledIntensity = appliedIntensity * durationFactor;
  const incomingKind = enableTransitions ? (clipIndex > 0 ? getBoundaryTransition(clipIndex - 1) : null) : null;
  const outgoingKind = enableTransitions ? (clipIndex < totalClips - 1 ? getBoundaryTransition(clipIndex) : null) : null;
  const incomingFrame = incomingKind ? Math.min(TRANSITION_FRAMES, dur) : 0;
  const outgoingFrame = outgoingKind ? Math.min(TRANSITION_FRAMES, dur) : 0;

  let transitionX = 0;
  let transitionY = 0;
  let transitionOpacity = 1;

  if (incomingKind && frame < incomingFrame) {
    const p = incomingFrame <= 0 ? 1 : frame / incomingFrame;
    const t = getTransitionTransform(incomingKind, p, "in");
    transitionX = t.x;
    transitionY = t.y;
    transitionOpacity = p;
  } else if (outgoingKind && frame >= Math.max(0, dur - outgoingFrame)) {
    const p = outgoingFrame <= 0 ? 1 : (frame - Math.max(0, dur - outgoingFrame)) / outgoingFrame;
    const t = getTransitionTransform(outgoingKind, p, "out");
    transitionX = t.x;
    transitionY = t.y;
    transitionOpacity = Math.max(0, 1 - p);
  }

  if (clip.splitScreen?.enabled) {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
        <AbsoluteFill
          style={{
            transform: `translate3d(${transitionX}%, ${transitionY}%, 0)`,
            opacity: transitionOpacity,
            willChange: "transform, opacity",
          }}
        >
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "50%", overflow: "hidden" }}>
            <KenBurns
              frame={frame}
              duration={dur}
              animation="pan-left"
              intensity={scaledIntensity}
              imageUrl={clip.imageUrl}
              videoUrl={clip.videoUrl}
              anchorX={anchorX}
              anchorY={anchorY}
              clip={clip}
              fps={fps}
            />
          </div>
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 3, backgroundColor: "#000", zIndex: 1 }} />
          {clip.splitScreen.bottomImageUrl ? (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", overflow: "hidden" }}>
              <KenBurns
                frame={frame}
                duration={dur}
                animation="pan-right"
                intensity={scaledIntensity}
                imageUrl={clip.splitScreen.bottomImageUrl}
                videoUrl={undefined}
                anchorX={50}
                anchorY={50}
                clip={clip}
                fps={fps}
              />
            </div>
          ) : (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", backgroundColor: "#111" }} />
          )}

        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: clip.kind === "text" ? "transparent" : "#000", overflow: clip.kind === "text" ? "visible" : "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `translate3d(${transitionX}%, ${transitionY}%, 0)`,
          opacity: transitionOpacity,
          willChange: "transform, opacity",
        }}
      >
        <KenBurns
          frame={frame}
          duration={dur}
          animation={clip.animation}
          intensity={scaledIntensity}
          imageUrl={clip.imageUrl}
          videoUrl={clip.videoUrl}
          anchorX={anchorX}
          anchorY={anchorY}
          clip={clip}
          fps={fps}
        />

      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function getSourceTime(audioSegments: AudioSegment[], t: number): number {
  for (const s of audioSegments) {
    if (t >= s.projStart && t < s.projStart + s.duration) {
      return s.srcStart + (t - s.projStart);
    }
  }
  return -1;
}

type TranscriptWord = {
  text: string;
  start: number;
  end: number;
};

function getWordProgress(
  words: TranscriptWord[],
  wordIndex: number,
  srcT: number,
  transitionDuration = 0.08
): { scale: number; bgOpacity: number; textOpacity: number } {
  if (words.length === 1) {
    return { scale: 1.05, bgOpacity: 1.0, textOpacity: 1.0 };
  }

  const wordA = words[0];
  const wordB = words[1];
  const boundary = wordB.start;
  const halfDt = transitionDuration / 2;

  let pA = 0;
  let pB = 0;

  if (srcT < boundary - halfDt) {
    pA = 1.0;
    pB = 0.0;
  } else if (srcT > boundary + halfDt) {
    pA = 0.0;
    pB = 1.0;
  } else {
    const linearP = (srcT - (boundary - halfDt)) / transitionDuration;
    const easeP = linearP * linearP * (3 - 2 * linearP);
    pB = easeP;
    pA = 1 - easeP;
  }

  const activeP = wordIndex === 0 ? pA : pB;

  return {
    scale: 0.92 + (1.05 - 0.92) * activeP,
    bgOpacity: activeP,
    textOpacity: 1.0,
  };
}

const CaptionOverlay: React.FC<{
  transcript?: TranscriptWord[];
  audioSegments?: AudioSegment[];
  captionTextColor?: string;
  captionBgColor?: string;
  captionPosX?: number;
  captionPosY?: number;
  captionFontSize?: number;
  captionWordsPerLine?: number;
  captionLinesPerSegment?: number;
  captionFont?: string;
}> = ({
  transcript = [],
  audioSegments = [],
  captionTextColor = "#000000",
  captionBgColor = "#ffffff",
  captionPosX = 50,
  captionPosY = 75,
  captionFontSize = 36,
  captionWordsPerLine = 3,
  captionLinesPerSegment = 1,
  captionFont = "AcuminProCondensedBlack",
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const currentTime = frame / fps;

    if (!transcript || transcript.length === 0) return null;

    const srcT = audioSegments && audioSegments.length > 0
      ? getSourceTime(audioSegments, currentTime)
      : currentTime;

    if (srcT < 0) return null;

    // Group segments: break on full stops or commas or max lines/words configuration
    const segments: { words: TranscriptWord[]; lines: TranscriptWord[][]; start: number; end: number; text: string }[] = [];
    let currentLine: TranscriptWord[] = [];
    let currentSegmentLines: TranscriptWord[][] = [];

    for (let i = 0; i < transcript.length; i++) {
      const w = transcript[i];
      currentLine.push(w);

      const text = w.text.trim();
      const hasPunctuation = /[.!?,]$/.test(text);

      if (currentLine.length >= captionWordsPerLine || hasPunctuation) {
        currentSegmentLines.push(currentLine);
        currentLine = [];

        if (currentSegmentLines.length >= captionLinesPerSegment || hasPunctuation) {
          segments.push({
            words: currentSegmentLines.flat(),
            lines: currentSegmentLines,
            text: currentSegmentLines.map(line => line.map(x => x.text).join(" ")).join("\n"),
            start: currentSegmentLines[0][0].start,
            end: currentSegmentLines[currentSegmentLines.length - 1][currentSegmentLines[currentSegmentLines.length - 1].length - 1].end,
          });
          currentSegmentLines = [];
        }
      }
    }
    if (currentLine.length > 0) {
      currentSegmentLines.push(currentLine);
    }
    if (currentSegmentLines.length > 0) {
      segments.push({
        words: currentSegmentLines.flat(),
        lines: currentSegmentLines,
        text: currentSegmentLines.map(line => line.map(x => x.text).join(" ")).join("\n"),
        start: currentSegmentLines[0][0].start,
        end: currentSegmentLines[currentSegmentLines.length - 1][currentSegmentLines[currentSegmentLines.length - 1].length - 1].end,
      });
    }

    let activeSegment = null;
    if (segments.length > 0) {
      if (srcT >= segments[0].start) {
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const nextSeg = segments[i + 1];
          const limit = nextSeg ? nextSeg.start : (seg.end + 2.0);
          if (srcT >= seg.start && srcT < limit) {
            if (srcT > seg.end + 1.0 && nextSeg && nextSeg.start - seg.end > 1.5) {
              break;
            }
            activeSegment = seg;
            break;
          }
        }
      }
    }

    if (!activeSegment) return null;

    // Resolve font styles
    const resolvedFont = captionFont || "AcuminProCondensedBlack";
    const googleFontStyles = `@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@800&family=Montserrat:wght@800&family=Outfit:wght@800&family=Playfair+Display:wght@800&display=swap');`;

    return (
      <div
        style={{
          position: "absolute",
          left: `50%`,
          top: `${captionPosY}%`,
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${captionFontSize * 0.15}px`,
          whiteSpace: "nowrap",
          pointerEvents: "none",
          maxWidth: "90%",
          overflow: "hidden",
          zIndex: 50,
        }}
      >
        <style>
          {`
          ${googleFontStyles}
          @font-face {
            font-family: 'AcuminProCondensedBlack';
            src: url('${staticFile("acumin-pro-condensed-black.otf")}') format('opentype');
            font-weight: 900;
            font-style: normal;
          }
        `}
        </style>
        <div
          style={{
            position: "relative",
            padding: `${captionFontSize * 0.2}px ${captionFontSize * 0.4}px`,
            fontSize: `${captionFontSize}px`,
            fontFamily: resolvedFont === "AcuminProCondensedBlack" ? "'AcuminProCondensedBlack', ui-sans-serif, system-ui, sans-serif" : `'${resolvedFont}', ui-sans-serif, system-ui, sans-serif`,
            fontWeight: 800,
            textTransform: "uppercase",
            color: captionTextColor,
            backgroundColor: captionBgColor,
            borderRadius: `${captionFontSize * 0.18}px`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: `${captionFontSize * 0.15}px`,
            whiteSpace: "normal",
            textAlign: "center",
          }}
        >
          {activeSegment.lines.map((line, lIdx) => (
            <div
              key={lIdx}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: `${captionFontSize * 0.25}px`,
                whiteSpace: "nowrap",
              }}
            >
              {line.map((w, wIdx) => (
                <span key={wIdx}>{w.text}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

export const VertiCutComposition: React.FC<CompositionProps> = ({
  audioUrl,
  musicUrl,
  musicVolume = 0.3,
  clips,
  defaultLabelText,
  defaultFontSize,
  intensity,
  fps,
  durationInFrames,
  overlayUrl,
  templateWindow,
  enableTransitions = true,
  audioSegments = [],
  captionTextColor,
  captionBgColor,
  captionPosX,
  captionPosY = 75,
  captionFontSize = 36,
  captionWordsPerLine = 3,
  captionLinesPerSegment = 1,
  captionFont = "AcuminProCondensedBlack",
  showLabels = true,
  showCaptions = true,
  transcript = [],
  enableGradientOverlay = true,
  gradientOverlayUrl = DEFAULT_GRADIENT_OVERLAY_URL,
}) => {
  const renderClips = (subset: { c: typeof clips[0]; originalIndex: number }[]) => (
    <>
      {subset.map(({ c, originalIndex }) => {
        const from = Math.round(c.start * fps);
        const dur = Math.max(1, Math.round(c.duration * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <ClipLayer
              clip={c}
              clipIndex={originalIndex}
              totalClips={clips.length}
              intensity={intensity}
              enableTransitions={enableTransitions && c.kind !== "text" && c.kind !== "solid"}
            />
          </Sequence>
        );
      })}
    </>
  );

  const clipsWithIndex = clips.map((c, originalIndex) => ({ c, originalIndex }));
  const solidClips = clipsWithIndex.filter(x => x.c.kind === "solid" && (x.c.layer as any) !== "overlay");
  const mediaClips = clipsWithIndex.filter(x => x.c.kind !== "solid" && x.c.kind !== "text" && (x.c.layer as any) !== "overlay");
  const textClips = clipsWithIndex.filter(
    x => x.c.kind === "text" || (x.c.layer as any) === "overlay" || (x.c.kind === "solid" && (x.c.layer as any) === "overlay")
  );

  const hasTemplate = Boolean(overlayUrl && templateWindow);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Preview audio is driven by a controlled HTMLAudioElement in the editor
          (see $id.tsx <PreviewAudio>), so the browser's audio clock is the source
          of truth. Server-side rendering uses worker/composition.jsx which keeps
          its own <Audio> tags. */}
      {renderClips(solidClips)}

      {hasTemplate ? (
        <div
          style={{
            position: "absolute",
            overflow: "hidden",
            left: `${templateWindow!.left}%`,
            top: `${templateWindow!.top}%`,
            width: `${templateWindow!.width}%`,
            height: `${templateWindow!.height}%`,
          }}
        >
          {renderClips(mediaClips)}
        </div>
      ) : (
        renderClips(mediaClips)
      )}

      {enableGradientOverlay ? (
        <Img
          src={gradientOverlayUrl || DEFAULT_GRADIENT_OVERLAY_URL}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center bottom",
            pointerEvents: "none",
            display: "block",
          }}
        />
      ) : null}

      {overlayUrl ? (
        <Img
          src={overlayUrl}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
            display: "block",
          }}
        />
      ) : null}

      {renderClips(textClips)}

      {showCaptions && (
        <CaptionOverlay
          transcript={transcript}
          audioSegments={audioSegments}
          captionTextColor={captionTextColor}
          captionBgColor={captionBgColor}
          captionPosX={captionPosX}
          captionPosY={captionPosY}
          captionFontSize={captionFontSize}
          captionWordsPerLine={captionWordsPerLine}
          captionLinesPerSegment={captionLinesPerSegment}
          captionFont={captionFont}
        />
      )}
    </AbsoluteFill>
  );
};

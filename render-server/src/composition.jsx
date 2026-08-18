// Mirror of src/remotion/composition.tsx in plain JSX so the render-server can
// bundle the VertiCut composition without TypeScript.
import React from "react";
import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, AnimatedImage } from "remotion";
import { Audio, Video } from "@remotion/media";

const ANIM_SHIFT = 0.6;
const TRANSITION_FRAMES = 8;
const CONTRAST_MULTIPLIER = 1.3;
const TRANSITION_DIRECTIONS = ["slide-left", "slide-right", "slide-up", "slide-down"];
const DEFAULT_GRADIENT_OVERLAY_URL = "https://i.ibb.co/C5phXbpz/Gradient-Overlay.png";

function getBoundaryTransition(index) {
  return index >= 0 && index < TRANSITION_DIRECTIONS.length ? TRANSITION_DIRECTIONS[index] : null;
}

function getTransitionTransform(kind, progress, mode) {
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
  overrideTrimStart,
  overrideTrimEnd,
  overrideVideoDuration,
}) {
  const { width: compWidth, height: compHeight } = useVideoConfig();
  const t = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const range = ANIM_SHIFT * intensity;
  let baseScale = 1.05;
  let txPercent = 0;
  let ty = 0;

  const hasKeyframes = clip.keyframes && clip.keyframes.length > 0;

  if (!hasKeyframes && animation === "zoom-in") {
    baseScale = 1 + range * 0.35 * t + 0.02;
  } else if (!hasKeyframes && animation === "zoom-out") {
    baseScale = 1 + range * 0.35 + 0.02 - range * 0.35 * t;
  } else if (!hasKeyframes && animation === "pan-left") {
    txPercent = Number(interpolate(t, [0, 1], [range * 5, -range * 5]));
    baseScale = 1.15;
  } else if (!hasKeyframes && animation === "pan-right") {
    txPercent = Number(interpolate(t, [0, 1], [-range * 5, range * 5]));
    baseScale = 1.15;
  } else if (!hasKeyframes) {
    baseScale = 1;
  }

  let kfScale = undefined;
  let kfPosX = undefined;
  let kfPosY = undefined;
  let kfRot = undefined;
  let kfOpacity = undefined;
  if (clip.keyframes && clip.keyframes.length > 0) {
    const localT = frame / fps;
    const kfs = clip.keyframes
      .map((k) => ({ ...k, local: k.time - clip.start }))
      .filter((k) => k.local >= 0 && k.local <= duration)
      .sort((a, b) => a.local - b.local);
    if (kfs.length > 0) {
      function interpProp(prop) {
        let prev = null;
        let next = null;
        for (let i = 0; i < kfs.length; i++) {
          if (kfs[i].local <= localT) prev = kfs[i];
          if (kfs[i].local > localT) { next = kfs[i]; break; }
        }
        if (!prev && !next) return undefined;
        if (!prev) return next[prop];
        if (!next) return prev[prop];
        const pVal = prev[prop];
        const nVal = next[prop];
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
  const appliedPosX = kfPosX ?? (clip.layer === "overlay" ? (clip.posX ?? anchorX) : anchorX);
  const appliedPosY = kfPosY ?? (clip.layer === "overlay" ? (clip.posY ?? anchorY) : anchorY);
  const appliedOpacity = kfOpacity ?? clip.opacity ?? 1;

  const actualVideoUrl = videoUrl || (imageUrl && (imageUrl.match(/\.(mp4|webm|mov|mkv)$/i) || imageUrl.includes("/video/")) ? imageUrl : undefined);
  const isGif = imageUrl && /\.gif($|\?)/i.test(imageUrl);

  if (clip.layer === "overlay") {
    return (
      <AbsoluteFill style={{
        transform: `translate(-50%, -50%) translate(${appliedPosX}%, ${appliedPosY}%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
        opacity: appliedOpacity,
        willChange: "transform, opacity",
        width: "40%",
        height: "22.5%",
        transformOrigin: "center",
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: 8,
      }}>
        {actualVideoUrl ? (
          <Video
            src={actualVideoUrl}
            trimBefore={Math.round((clip.trimStart ?? 0) * (fps || 30))}
            muted={clip.muted ?? true}
            volume={(clip.volume ?? 100) / 100}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : isGif ? (
          <AnimatedImage
            src={imageUrl}
            fit="cover"
            width={compWidth}
            height={compHeight}
            style={{
              width: "100%",
              height: "100%",
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
    const trimStartSec = overrideTrimStart !== undefined ? overrideTrimStart : ((clip && clip.trimStart) || 0);
    const trimStartFrames = Math.round(trimStartSec * (fps || 30));

    const actualTrimEndSec = overrideTrimEnd !== undefined ? overrideTrimEnd : (clip && clip.trimEnd);
    const actualVideoDuration = overrideVideoDuration !== undefined ? overrideVideoDuration : (clip && clip.videoDuration);

    const trimmedDuration = (actualTrimEndSec !== undefined && trimStartSec !== undefined) ? (actualTrimEndSec - trimStartSec) : undefined;
    const loopDurationSec = trimmedDuration ?? (actualVideoDuration ? (actualVideoDuration - trimStartSec) : undefined);

    const vidDurFrames = loopDurationSec ? Math.max(1, Math.round(loopDurationSec * (fps || 30))) : Math.max(1, duration);
    const loopCount = loopDurationSec ? Math.ceil(duration / vidDurFrames) : 1;

    const loops = [];
    for (let i = 0; i < loopCount; i++) {
      loops.push(
        <Sequence from={i * vidDurFrames} durationInFrames={vidDurFrames} key={i}>
          <Video
            src={actualVideoUrl}
            trimBefore={trimStartFrames}
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
        transform: `translate(${txPercent}%, ${ty}%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
        transformOrigin: `${appliedPosX}% ${appliedPosY}%`,
        opacity: appliedOpacity,
        filter: `contrast(${CONTRAST_MULTIPLIER})`,
        willChange: "transform, opacity",
      }}>
        {loops}
      </AbsoluteFill>
    );
  }

  if (isGif) {
    return (
      <AnimatedImage
        src={imageUrl}
        fit="cover"
        width={compWidth}
        height={compHeight}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectPosition: `${appliedPosX}% ${appliedPosY}%`,
          filter: `contrast(${CONTRAST_MULTIPLIER})`,
          opacity: appliedOpacity,
          transform: `translate(${txPercent}%, ${ty}%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
          transformOrigin: `${appliedPosX}% ${appliedPosY}%`,
        }}
      />
    );
  }

  return (
    <Img
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
        transform: `translate(${txPercent}%, ${ty}%) scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
        transformOrigin: `${appliedPosX}% ${appliedPosY}%`,
      }}
    />
  );
}

const REF_DURATION_SEC = 3.5;

function ClipLayer({ clip, intensity, defaultLabelText, fontSize, clipIndex, totalClips, enableTransitions = true, showLabels = true }) {
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
        <AbsoluteFill style={{ transform: `translate3d(${transitionX}%, ${transitionY}%, 0)`, opacity: transitionOpacity, willChange: "transform, opacity" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "50%", overflow: "hidden" }}>
            <KenBurns frame={frame} duration={dur} animation="pan-left" intensity={scaledIntensity} imageUrl={clip.imageUrl} videoUrl={clip.videoUrl} anchorX={anchorX} anchorY={anchorY} clip={clip} fps={fps} />
          </div>
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 3, backgroundColor: "#000", zIndex: 1 }} />
          {clip.splitScreen.bottomImageUrl || clip.splitScreen.bottomVideoUrl ? (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", overflow: "hidden" }}>
              <KenBurns
                frame={frame}
                duration={dur}
                animation="pan-right"
                intensity={scaledIntensity}
                imageUrl={clip.splitScreen.bottomImageUrl}
                videoUrl={clip.splitScreen.bottomVideoUrl}
                anchorX={50}
                anchorY={50}
                clip={clip}
                fps={fps}
                overrideTrimStart={clip.splitScreen.bottomTrimStart}
                overrideTrimEnd={clip.splitScreen.bottomTrimEnd}
                overrideVideoDuration={clip.splitScreen.bottomVideoDuration}
              />
            </div>
          ) : (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", backgroundColor: "#111" }} />
          )}
          {showLabels !== false && (
            <div
              style={{
                position: "absolute",
                top: 40,
                left: 40,
                color: "white",
                fontSize,
                fontFamily: "Inter, system-ui, sans-serif",
                fontWeight: 600,
                textShadow: "0 2px 8px rgba(0,0,0,0.8)",
                zIndex: 10,
              }}
            >
              {clip.labelText || defaultLabelText}
            </div>
          )}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: clip.kind === "text" ? "transparent" : "#000", overflow: clip.kind === "text" ? "visible" : "hidden" }}>
      <AbsoluteFill style={{ transform: `translate3d(${transitionX}%, ${transitionY}%, 0)`, opacity: transitionOpacity, willChange: "transform, opacity" }}>
        <KenBurns frame={frame} duration={dur} animation={clip.animation} intensity={scaledIntensity} imageUrl={clip.imageUrl} videoUrl={clip.videoUrl} anchorX={anchorX} anchorY={anchorY} clip={clip} fps={fps} />
        {showLabels !== false && (
          <div
            style={{
              position: "absolute",
              top: 40,
              left: 40,
              color: "white",
              fontSize,
              fontFamily: "Inter, system-ui, sans-serif",
              fontWeight: 600,
              textShadow: "0 2px 8px rgba(0,0,0,0.8)",
            }}
          >
            {clip.labelText || defaultLabelText}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function getSourceTime(audioSegments, t) {
  for (const s of audioSegments) {
    if (t >= s.projStart && t < s.projStart + s.duration) {
      return s.srcStart + (t - s.projStart);
    }
  }
  return -1;
}

function getWordProgress(words, wordIndex, srcT, transitionDuration = 0.08) {
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

const CaptionOverlay = ({
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
  const segments = [];
  let currentLine = [];
  let currentSegmentLines = [];

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

export const VertiCutComposition = ({
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
  captionPosY,
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
  const renderClips = (subset) => (
    <>
      {subset.map(({ c, originalIndex }) => {
        const from = Math.round(c.start * fps);
        const dur = Math.max(1, Math.round(c.duration * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <ClipLayer clip={c} clipIndex={originalIndex} totalClips={clips.length} intensity={intensity} defaultLabelText={defaultLabelText} fontSize={defaultFontSize} enableTransitions={enableTransitions && c.kind !== "text" && c.kind !== "solid"} showLabels={showLabels} />
          </Sequence>
        );
      })}
    </>
  );

  const clipsWithIndex = (clips || []).map((c, originalIndex) => ({ c, originalIndex }));
  const solidClips = clipsWithIndex.filter(x => x.c.kind === "solid");
  const mediaClips = clipsWithIndex.filter(x => x.c.kind !== "solid" && x.c.kind !== "text");
  const textClips = clipsWithIndex.filter(x => x.c.kind === "text");

  const hasTemplate = Boolean(overlayUrl && templateWindow);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {audioSegments && audioSegments.length > 0 ? (
        audioSegments.map((seg) => {
          const from = Math.round(seg.projStart * fps);
          const dur = Math.max(1, Math.round(seg.duration * fps));
          const startFrom = Math.round(seg.srcStart * fps);
          return (
            <Sequence key={seg.id} from={from} durationInFrames={dur}>
              <Audio src={audioUrl} trimBefore={startFrom} />
            </Sequence>
          );
        })
      ) : audioUrl ? (
        <Sequence from={0} durationInFrames={durationInFrames}>
          <Audio src={audioUrl} />
        </Sequence>
      ) : null}
      {musicUrl ? (
        <Sequence from={0} durationInFrames={durationInFrames}>
          <Audio src={musicUrl} volume={musicVolume} loop />
        </Sequence>
      ) : null}
      {renderClips(solidClips)}

      {hasTemplate ? (
        <div style={{ position: "absolute", overflow: "hidden", left: `${templateWindow.left}%`, top: `${templateWindow.top}%`, width: `${templateWindow.width}%`, height: `${templateWindow.height}%` }}>
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

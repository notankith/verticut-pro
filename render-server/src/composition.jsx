// Mirror of src/remotion/composition.tsx in plain JSX so the render-server can
// bundle the VertiCut composition without TypeScript.
import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

const ANIM_SHIFT = 0.6;
const TRANSITION_FRAMES = 8;
const CONTRAST_MULTIPLIER = 1.3;
const TRANSITION_DIRECTIONS = ["slide-left", "slide-right", "slide-up", "slide-down"];

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

function KenBurns({ frame, duration, animation, intensity, imageUrl, videoUrl, anchorX, anchorY, clip, fps }) {
  const t = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const range = ANIM_SHIFT * intensity;
  let baseScale = 1.05;
  let txPercent = 0;
  const hasKeyframes = clip.keyframes && clip.keyframes.length > 0;
  
  if (!hasKeyframes && animation === "zoom-in") {
    baseScale = 1 + range * 0.35 * t + 0.02;
  } else if (!hasKeyframes && animation === "zoom-out") {
    baseScale = 1 + range * 0.35 + 0.02 - range * 0.35 * t;
  } else if (!hasKeyframes && animation === "pan-left") {
    txPercent = interpolate(t, [0, 1], [range * 40, -range * 40]);
    baseScale = 1;
  } else if (!hasKeyframes && animation === "pan-right") {
    txPercent = interpolate(t, [0, 1], [-range * 40, range * 40]);
    baseScale = 1;
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
  const appliedPosX = (kfPosX ?? clip.posX ?? anchorX) + txPercent;
  const appliedPosY = kfPosY ?? clip.posY ?? anchorY;
  const appliedOpacity = kfOpacity ?? clip.opacity ?? 1;

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
        }}>
          {clip.textContent || ""}
        </div>
      </AbsoluteFill>
    );
  }

  if (videoUrl) {
    const trimStartSec = (clip && clip.trimStart) || 0;
    const trimStartFrames = Math.round(trimStartSec * (fps || 30));
    
    const vidDurFrames = clip.videoDuration ? Math.max(1, Math.round((clip.videoDuration - trimStartSec) * (fps || 30))) : Math.max(1, duration);
    const loopCount = clip.videoDuration ? Math.ceil(duration / vidDurFrames) : 1;
    
    const loops = [];
    for (let i = 0; i < loopCount; i++) {
      loops.push(
        <Sequence from={i * vidDurFrames} durationInFrames={vidDurFrames} key={i}>
          <OffthreadVideo
            src={videoUrl}
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
        transform: `scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
        opacity: appliedOpacity,
        filter: `contrast(${CONTRAST_MULTIPLIER})`,
        willChange: "transform",
      }}>
        {loops}
      </AbsoluteFill>
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
        transform: `scale(${appliedScale}) rotate(${kfRot ?? clip.rotation ?? 0}deg)`,
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
          {clip.splitScreen.bottomImageUrl ? (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", overflow: "hidden" }}>
              <KenBurns frame={frame} duration={dur} animation="pan-right" intensity={scaledIntensity} imageUrl={clip.splitScreen.bottomImageUrl} videoUrl={undefined} anchorX={50} anchorY={50} clip={clip} fps={fps} />
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
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  if (!transcript || transcript.length === 0) return null;

  const srcT = audioSegments && audioSegments.length > 0
    ? getSourceTime(audioSegments, currentTime)
    : currentTime;

  if (srcT < 0) return null;

  // Group into max 3-word segments
  const segments = [];
  for (let i = 0; i < transcript.length; i += 3) {
    const group = transcript.slice(i, i + 3);
    if (group.length > 0) {
      segments.push({
        words: group,
        text: group.map((w) => w.text).join(" "),
        start: group[0].start,
        end: group[group.length - 1].end,
      });
    }
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

  return (
    <div
      style={{
        position: "absolute",
        left: `${captionPosX}%`,
        top: `${captionPosY}%`,
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: `${captionFontSize * 0.25}px`,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        maxWidth: "90%",
        overflow: "hidden",
        zIndex: 50,
      }}
    >
      <style>
        {`
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
          padding: `${captionFontSize * 0.15}px ${captionFontSize * 0.4}px`,
          fontSize: `${captionFontSize}px`,
          fontFamily: "'AcuminProCondensedBlack', ui-sans-serif, system-ui, sans-serif",
          fontWeight: 900,
          textTransform: "uppercase",
          color: captionTextColor,
          backgroundColor: captionBgColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          whiteSpace: "pre-wrap",
          textAlign: "center",
        }}
      >
        <span>{activeSegment.text}</span>
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
  showLabels = true,
  transcript = [],
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
  const mediaClips = clipsWithIndex.filter(x => !x.c.kind || x.c.kind === "media");
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
              <Audio src={audioUrl} startFrom={startFrom} pauseWhenBuffering acceptableTimeShiftInSeconds={2} />
            </Sequence>
          );
        })
      ) : audioUrl ? (
        <Sequence from={0} durationInFrames={durationInFrames}>
          <Audio src={audioUrl} pauseWhenBuffering acceptableTimeShiftInSeconds={2} />
        </Sequence>
      ) : null}
      {musicUrl ? (
        <Sequence from={0} durationInFrames={durationInFrames}>
          <Audio src={musicUrl} volume={musicVolume} loop acceptableTimeShiftInSeconds={2} />
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

      {renderClips(textClips)}
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
      <CaptionOverlay
        transcript={transcript}
        audioSegments={audioSegments}
        captionTextColor={captionTextColor}
        captionBgColor={captionBgColor}
        captionPosX={captionPosX}
        captionPosY={captionPosY}
        captionFontSize={captionFontSize}
      />
    </AbsoluteFill>
  );
};

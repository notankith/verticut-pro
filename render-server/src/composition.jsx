// Mirror of src/remotion/composition.tsx in plain JSX so the render-server can
// bundle the VertiCut composition without TypeScript.
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

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

function KenBurns({ frame, duration, animation, intensity, imageUrl, anchorX, anchorY }) {
  const t = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const range = ANIM_SHIFT * intensity;
  let scale = 1.05;
  let txPercent = 0;
  if (animation === "zoom-in") {
    scale = 1 + range * 0.35 * t + 0.02;
  } else if (animation === "zoom-out") {
    scale = 1 + range * 0.35 + 0.02 - range * 0.35 * t;
  } else if (animation === "pan-left") {
    txPercent = interpolate(t, [0, 1], [range * 40, -range * 40]);
    scale = 1;
  } else if (animation === "pan-right") {
    txPercent = interpolate(t, [0, 1], [-range * 40, range * 40]);
    scale = 1;
  }

  const posX = Math.max(0, Math.min(100, anchorX + txPercent));
  return (
    <Img
      src={imageUrl}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: `${posX}% ${anchorY}%`,
        filter: `contrast(${CONTRAST_MULTIPLIER})`,
        transform: `scale(${scale}) translate(0px, 0px)`,
      }}
    />
  );
}

const REF_DURATION_SEC = 3.5;

function ClipLayer({ clip, intensity, defaultLabelText, fontSize, clipIndex, totalClips, enableTransitions = true }) {
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
            <KenBurns frame={frame} duration={dur} animation="pan-left" intensity={scaledIntensity} imageUrl={clip.imageUrl} anchorX={anchorX} anchorY={anchorY} />
          </div>
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 3, backgroundColor: "#000", zIndex: 1 }} />
          {clip.splitScreen.bottomImageUrl ? (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", overflow: "hidden" }}>
              <KenBurns frame={frame} duration={dur} animation="pan-right" intensity={scaledIntensity} imageUrl={clip.splitScreen.bottomImageUrl} anchorX={50} anchorY={50} />
            </div>
          ) : (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", backgroundColor: "#111" }} />
          )}
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
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate3d(${transitionX}%, ${transitionY}%, 0)`, opacity: transitionOpacity, willChange: "transform, opacity" }}>
        <KenBurns frame={frame} duration={dur} animation={clip.animation} intensity={scaledIntensity} imageUrl={clip.imageUrl} anchorX={anchorX} anchorY={anchorY} />
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

  // Group into max 2-word segments
  const segments = [];
  for (let i = 0; i < transcript.length; i += 2) {
    const group = transcript.slice(i, i + 2);
    if (group.length > 0) {
      segments.push({
        words: group,
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
      {activeSegment.words.map((word, idx) => {
        const { scale, bgOpacity } = getWordProgress(
          activeSegment.words,
          idx,
          srcT
        );

        return (
          <div
            key={idx}
            style={{
              position: "relative",
              padding: `${captionFontSize * 0.08}px ${captionFontSize * 0.25}px`,
              fontSize: `${captionFontSize}px`,
              fontFamily: "'AcuminProCondensedBlack', ui-sans-serif, system-ui, sans-serif",
              fontWeight: 900,
              textTransform: "uppercase",
              color: captionTextColor,
              transform: `scale(${scale})`,
              transformOrigin: "center center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: captionBgColor,
                borderRadius: "9999px",
                opacity: bgOpacity,
                zIndex: -1,
              }}
            />
            <span>{word.text}</span>
          </div>
        );
      })}
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
  captionFontSize,
  transcript = [],
}) => {
  const scene = (
    <>
      {(clips || []).map((c, index) => {
        const from = Math.round(c.start * fps);
        const dur = Math.max(1, Math.round(c.duration * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <ClipLayer clip={c} clipIndex={index} totalClips={(clips || []).length} intensity={intensity} defaultLabelText={defaultLabelText} fontSize={defaultFontSize} enableTransitions={enableTransitions} />
          </Sequence>
        );
      })}
    </>
  );

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
      {hasTemplate ? (
        <div
          style={{
            position: "absolute",
            overflow: "hidden",
            left: `${templateWindow.left}%`,
            top: `${templateWindow.top}%`,
            width: `${templateWindow.width}%`,
            height: `${templateWindow.height}%`,
          }}
        >
          {scene}
        </div>
      ) : (
        scene
      )}
      {overlayUrl ? (
        <Img
          src={overlayUrl}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "auto",
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

// Mirror of src/remotion/composition.tsx in plain JSX so the render-server can
// bundle the VertiCut composition without TypeScript.
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

const ANIM_SHIFT = 0.6;

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
        transform: `scale(${scale}) translate(0px, 0px)`,
      }}
    />
  );
}

function ClipLayer({ clip, intensity, defaultLabelText, fontSize }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = Math.max(1, Math.round(clip.duration * fps));
  const anchorX = clip.anchorX ?? 50;
  const anchorY = clip.anchorY ?? 50;
  const appliedIntensity = clip.intensity ?? intensity;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <KenBurns frame={frame} duration={dur} animation={clip.animation} intensity={appliedIntensity} imageUrl={clip.imageUrl} anchorX={anchorX} anchorY={anchorY} />
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
  );
}

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
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {audioUrl ? (
        <Sequence from={0} durationInFrames={durationInFrames}>
          <Audio src={audioUrl} pauseWhenBuffering acceptableTimeShiftInSeconds={2} />
        </Sequence>
      ) : null}
      {musicUrl ? (
        <Sequence from={0} durationInFrames={durationInFrames}>
          <Audio src={musicUrl} volume={musicVolume} loop acceptableTimeShiftInSeconds={2} />
        </Sequence>
      ) : null}
      {(clips || []).map((c) => {
        const from = Math.round(c.start * fps);
        const dur = Math.max(1, Math.round(c.duration * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <ClipLayer clip={c} intensity={intensity} defaultLabelText={defaultLabelText} fontSize={defaultFontSize} />
          </Sequence>
        );
      })}
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
    </AbsoluteFill>
  );
};

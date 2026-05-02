// Mirror of src/remotion/composition.tsx in plain JSX so the worker can bundle without TS.
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

const ANIM_SHIFT = 0.15;

function KenBurns({ frame, duration, animation, intensity, imageUrl }) {
  const t = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const range = ANIM_SHIFT * intensity;
  let scale = 1.1;
  let tx = 0;
  if (animation === "zoom-in") scale = 1 + range * t + 0.05;
  else if (animation === "zoom-out") scale = 1 + range + 0.05 - range * t;
  else if (animation === "pan-left") {
    scale = 1.15;
    tx = interpolate(t, [0, 1], [range * 100, -range * 100]);
  } else if (animation === "pan-right") {
    scale = 1.15;
    tx = interpolate(t, [0, 1], [-range * 100, range * 100]);
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
        transform: `scale(${scale}) translate(${tx}px, 0px)`,
        transformOrigin: "center",
      }}
    />
  );
}

function ClipLayer({ clip, intensity, defaultLabelText, fontSize }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = Math.max(1, Math.round(clip.duration * fps));
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <KenBurns frame={frame} duration={dur} animation={clip.animation} intensity={intensity} imageUrl={clip.imageUrl} />
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
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {audioUrl ? <Audio src={audioUrl} /> : null}
      {musicUrl ? <Audio src={musicUrl} volume={musicVolume} loop /> : null}
      {(clips || []).map((c) => {
        const from = Math.round(c.start * fps);
        const dur = Math.max(1, Math.round(c.duration * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <ClipLayer clip={c} intensity={intensity} defaultLabelText={defaultLabelText} fontSize={defaultFontSize} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

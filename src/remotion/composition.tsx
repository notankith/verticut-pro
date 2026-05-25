import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { ClipDoc } from "../server/mongo.server";

export type CompositionProps = {
  audioUrl: string;
  musicUrl?: string;
  musicVolume?: number; // 0..1
  clips: ClipDoc[];
  defaultLabelText: string;
  defaultFontSize: number;
  intensity: number; // 0.5..3
  durationInFrames: number;
  fps: number;
  overlayUrl?: string;
};

const ANIM_SHIFT = 0.6; // base scale/translate range (increased for stronger pan)
const TRANSITION_FRAMES = 8;
const CONTRAST_MULTIPLIER = 1.3;
const TRANSITION_DIRECTIONS = ["slide-left", "slide-right", "slide-up", "slide-down"] as const;

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
  anchorX,
  anchorY,
}: {
  frame: number;
  duration: number;
  animation: ClipDoc["animation"];
  intensity: number;
  imageUrl: string;
  anchorX: number;
  anchorY: number;
}) {
  const t = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const range = ANIM_SHIFT * intensity;
  let scale = 1.05;
  let txPercent = 0;
  let ty = 0;
  if (animation === "zoom-in") {
    // gentler zoom so pan doesn't feel weak by comparison
    scale = 1 + range * 0.35 * t + 0.02;
  } else if (animation === "zoom-out") {
    scale = 1 + range * 0.35 + 0.02 - range * 0.35 * t;
  } else if (animation === "pan-left") {
    // compute desired percent shift (negative -> move left over time)
    txPercent = Number(interpolate(t, [0, 1], [range * 40, -range * 40]));
    // Do not apply zoom during pan — keep scale at 1 to avoid visible zoom.
    scale = 1;
  } else if (animation === "pan-right") {
    txPercent = Number(interpolate(t, [0, 1], [-range * 40, range * 40]));
    scale = 1;
  }

  // Use objectPosition to offset the visible image by anchor + txPercent, and
  // use translate only for any small pixel adjustments (ty).
  // Clamp objectPosition so we don't ask for out-of-range positions which can
  // expose background. Keep within 0..100.
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
        transform: `scale(${scale}) translate(0px, ${ty}px)`,
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
  defaultLabelText,
  fontSize,
  clipIndex,
  totalClips,
}: {
  clip: ClipDoc;
  intensity: number;
  defaultLabelText: string;
  fontSize: number;
  clipIndex: number;
  totalClips: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = Math.max(1, Math.round(clip.duration * fps));
  const anchorX = clip.anchorX ?? 50;
  const anchorY = clip.anchorY ?? 50;
  const appliedIntensity = clip.intensity ?? intensity;
  const durationFactor = Math.min(1, clip.duration / REF_DURATION_SEC);
  const scaledIntensity = appliedIntensity * durationFactor;
  const incomingKind = clipIndex > 0 ? getBoundaryTransition(clipIndex - 1) : null;
  const outgoingKind = clipIndex < totalClips - 1 ? getBoundaryTransition(clipIndex) : null;
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

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `translate3d(${transitionX}%, ${transitionY}%, 0)`,
          opacity: transitionOpacity,
          willChange: "transform, opacity",
        }}
      >
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
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Preview audio is driven by a controlled HTMLAudioElement in the editor
          (see $id.tsx <PreviewAudio>), so the browser's audio clock is the source
          of truth. Server-side rendering uses worker/composition.jsx which keeps
          its own <Audio> tags. */}
      {clips.map((c, index) => {
        const from = Math.round(c.start * fps);
        const dur = Math.max(1, Math.round(c.duration * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <ClipLayer clip={c} clipIndex={index} totalClips={clips.length} intensity={intensity} defaultLabelText={defaultLabelText} fontSize={defaultFontSize} />
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

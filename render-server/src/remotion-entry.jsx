import { registerRoot, Composition } from "remotion";
import React from "react";
import { VertiCutComposition } from "./composition.jsx";

const Root = () => (
  <Composition
    id="VertiCut"
    component={VertiCutComposition}
    durationInFrames={300}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{
      audioUrl: "",
      clips: [],
      defaultLabelText: "",
      defaultFontSize: 18,
      intensity: 1,
      durationInFrames: 300,
      fps: 30,
    }}
  />
);

registerRoot(Root);

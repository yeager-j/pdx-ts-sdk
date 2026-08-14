// Extracted from packages/reference-spike/content/situations.mdx:264 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="gated-approach"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod, currentStage } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Shroud Whispers",
  prefix: "shroud" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const whisper = mod.situationType("whisper", {
  name: "Shroud Whispers",
  monthlyProgress: { base: 1 },
  stages: {
    shroud_whisper_faint: {
      name: "Faint",
      icon: "GFX_situation_stage_faint",
      iconBackground: "GFX_situation_stage_faint_bg",
      end: { base: 60 },
    },
    shroud_whisper_loud: {
      name: "Loud",
      icon: "GFX_situation_stage_loud",
      iconBackground: "GFX_situation_stage_loud_bg",
      end: { base: 120 },
    },
  },
  approach: {
    shroud_whisper_listen: {
      name: "Listen",
      icon: "GFX_situation_approach_listen",
      iconBackground: "GFX_situation_approach_listen_bg",
      default: true,
    },
    shroud_whisper_answer: {
      name: "Answer",
      icon: "GFX_situation_approach_answer",
      iconBackground: "GFX_situation_approach_answer_bg",
      // Misspell this and it does not compile. Nest it inside `and(...)` and
      // it does compile, unchecked — which is what most vanilla script is.
      allow: currentStage("shroud_whisper_loud"),
    },
  },
});

export const feature = mod.feature("whispers", [whisper]);

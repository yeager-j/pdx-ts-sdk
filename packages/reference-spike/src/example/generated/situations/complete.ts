// Extracted from packages/reference-spike/content/situations.mdx:51 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="complete"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod, hasSituationFlag } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Vergence",
  prefix: "verge" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const collapse = mod.situationType("collapse", {
  name: "Orbital Collapse",
  desc: "The station's orbit is decaying, and the schedule is slipping.",
  category: "negative",
  monthlyProgress: {
    base: 3,
    modifiers: [
      {
        factor: 1.5,
        // `descKey` pins the localization key. Without it the key is a hash of
        // the sentence, and editing the sentence silently orphans every
        // translation of it.
        descKey: "decay_accelerating",
        desc: "The decay is accelerating.",
        when: hasSituationFlag("verge_decay_accelerating"),
      },
    ],
  },
  stages: {
    verge_collapse_tremors: {
      name: "Tremors",
      desc: "Instruments are picking up the first wobble.",
      icon: "GFX_situation_stage_tremors",
      iconBackground: "GFX_situation_stage_tremors_bg",
      end: { base: 40 },
    },
    verge_collapse_fracture: {
      name: "Fracture",
      desc: "Structural failures are spreading through the ring.",
      icon: "GFX_situation_stage_fracture",
      iconBackground: "GFX_situation_stage_fracture_bg",
      end: { base: 100 },
    },
  },
  approach: {
    verge_collapse_brace: {
      name: "Brace the Ring",
      desc: "Pour alloys into the structure and buy time.",
      icon: "GFX_situation_approach_brace",
      iconBackground: "GFX_situation_approach_brace_bg",
      default: true,
      modifier: (m) => m.country.alloys.produces.mult(-0.05),
    },
    verge_collapse_evacuate: {
      name: "Evacuate",
      desc: "Write the station off and move everyone down the well.",
      icon: "GFX_situation_approach_evacuate",
      iconBackground: "GFX_situation_approach_evacuate_bg",
      modifier: (m) => m.country.unity.produces.mult(-0.02),
    },
  },
});

export const feature = mod.feature("collapse", [collapse]);

import {
  createMod,
  currentSituationApproach,
  currentStage,
  eventTarget,
  exists,
  hasOwner,
  onActions,
  target,
} from "@pdx-ts/sdk";

const mod = createMod({
  name: "Crystal Bloom",
  prefix: "crystal_bloom",
  supportedVersion: "v4.4.*",
});

const observe = "crystal_bloom_situation_bloom_approach_observe" as const;
const intervene = "crystal_bloom_situation_bloom_approach_intervene" as const;
const germination = "crystal_bloom_situation_bloom_stage_germination" as const;
const flowering = "crystal_bloom_situation_bloom_stage_flowering" as const;
const awakening = "crystal_bloom_situation_bloom_stage_awakening" as const;

const events = mod.namespace("bloom");
const bloomWorld = eventTarget<"planet">("crystal_bloom_world");

const unstableGrowth = events.situation(2, {
  title: "Unstable Growth",
  desc: "The crystal organism is consuming its own new structures.",
  location: target<"planet">(),
  isTriggeredOnly: true,
  options: [
    {
      name: "Stabilize the lattice.",
      key: "stabilize_lattice",
      effects: (situation) => situation.addSituationProgress(-5),
    },
  ],
});

const harmonicInsight = events.situation(3, {
  title: "A Harmonic Pattern",
  desc: "The bloom's pulses reveal how its next structures will form.",
  location: target<"planet">(),
  isTriggeredOnly: true,
  options: [
    {
      name: "Apply the pattern.",
      key: "apply_pattern",
      effects: (situation) => situation.addSituationProgress(8),
    },
  ],
});

const bloomComplete = events.situation(4, {
  title: "The Crystal Bloom Awakens",
  desc: "The organism opens into a stable, resonant structure.",
  location: target<"planet">(),
  isTriggeredOnly: true,
  options: [{ name: "Listen to its song.", key: "listen" }],
});

const crystalBloom = mod.situationType("crystal_bloom", {
  name: "The Crystal Bloom",
  typeName: "Crystal Organism",
  desc: "A crystalline organism is developing on one of our worlds.",
  category: "neutral",
  targetScope: "planet",
  showInOutliner: true,
  progressDirection: "monodirectional",
  startValue: 0,
  totalProgress: 100,
  monthlyProgress: {
    base: 3,
    modifiers: [
      {
        add: 2,
        desc: "Our observers let the bloom develop naturally.",
        descKey: "observation_progress",
        when: currentSituationApproach(observe),
      },
      {
        add: 4,
        desc: "Direct intervention accelerates the bloom.",
        descKey: "intervention_progress",
        when: currentSituationApproach(intervene),
      },
      {
        factor: 0.5,
        desc: "The bloom is still germinating.",
        descKey: "germination_progress",
        when: currentStage(germination),
      },
    ],
  },
  onStart: (situation) => situation.setSituationFlag("crystal_bloom_observed"),
  onProgressComplete: (situation) => situation.situationEvent({ id: bloomComplete }),
  onMonthly: {
    randomEvents: [
      { weight: 8, event: unstableGrowth },
      { weight: 12, event: harmonicInsight },
      { weight: 80 },
    ],
  },
  approach: {
    [observe]: {
      name: "Observe",
      desc: "Protect the site and study the bloom without disturbing it.",
      icon: "GFX_situation_approach_observe",
      iconBackground: "GFX_situation_approach_bg_green",
      default: true,
      aiWeight: 8,
    },
    [intervene]: {
      name: "Intervene",
      desc: "Reshape the organism before it can stabilize on its own.",
      icon: "GFX_situation_approach_intervene",
      iconBackground: "GFX_situation_approach_bg_red",
      allow: currentStage(flowering),
      resources: [{ category: "situations", cost: { amounts: { energy: 100 } } }],
      onSelect: (situation) => situation.addSituationProgress(5),
      aiWeight: 2,
    },
  },
  stages: {
    [germination]: {
      name: "Germination",
      desc: "Thin crystal roots spread below the surface.",
      sectionWeight: 30,
      icon: "GFX_situation_stage_germination",
      iconBackground: "GFX_situation_stage_bg",
      color: "teal",
      onFirstEnter: (situation) => situation.setSituationFlag("crystal_bloom_germinated"),
    },
    [flowering]: {
      name: "Flowering",
      desc: "Large resonant structures rise into the atmosphere.",
      sectionWeight: 40,
      icon: "GFX_situation_stage_flowering",
      iconBackground: "GFX_situation_stage_bg",
      color: "blue",
    },
    [awakening]: {
      name: "Awakening",
      desc: "The mature bloom begins to answer our signals.",
      sectionWeight: 30,
      icon: "GFX_situation_stage_awakening",
      iconBackground: "GFX_situation_stage_bg",
      color: "purple",
    },
  },
});

const beginBloom = events.country(1, {
  hideWindow: true,
  isTriggeredOnly: true,
  immediate: (country) => {
    country.randomOwnedPlanet({ limit: hasOwner() }, (planet) => {
      planet.saveEventTargetAs(bloomWorld);
    });
    country.if(exists(bloomWorld), (owner) => {
      owner.startSituation({
        type: crystalBloom,
        target: bloomWorld,
        effect: (situation) => {
          situation.target((planet) => {
            planet.setPlanetFlag("crystal_bloom_host");
          });
        },
      });
    });
  },
});

const atGameStart = mod.on(onActions.onGameStartCountry, [beginBloom]);

export const feature = mod.feature("bloom", [
  crystalBloom,
  unstableGrowth,
  harmonicInsight,
  bloomComplete,
  beginBloom,
  atGameStart,
]);

export default mod.compile([feature]);

import { createMod } from "@pdx-ts/sdk";
import { hasAuthority, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Archive Ambition",
  prefix: "archive_ambition",
  supportedVersion: "v4.4.*",
});

const resolve = mod.resource("resolve", {
  name: "Resolve",
  desc: "The determination required to preserve the galaxy's memory.",
  tradable: false,
  category: "other",
  aiWeight: { weight: 1 },
});

const cataloguers = mod.menacePerk("cataloguers", {
  name: "Unfailing Cataloguers",
  desc: "Every discovery strengthens the archive.",
  portrait: vanilla.spriteType("GFX_crisis_icon_integrity"),
  modifier: (modifier) => modifier.country.influence.produces.mult(0.1),
  onUnlock: (country) => country.setCountryFlag("archive_ambition_cataloguers_unlocked"),
});

const wardens = mod.menacePerk("wardens", {
  name: "Wardens of Memory",
  desc: "The archive's guardians stand ready against every threat.",
  portrait: vanilla.spriteType("GFX_crisis_icon_advanced_logic"),
  modifier: (modifier) => modifier.country.unity.produces.mult(0.1),
});

const firstRecord = mod.crisisLevel("first_record", {
  name: "The First Record",
  desc: "The work of preservation begins.",
  requiredCrisisCurrency: 0,
  perks: [cataloguers],
  onUnlock: (country) => country.setCountryFlag("archive_ambition_first_record"),
});

const livingArchive = mod.crisisLevel("living_archive", {
  name: "The Living Archive",
  desc: "Knowledge becomes the foundation of galactic defense.",
  allow: hasAuthority("auth_democratic"),
  requiredCrisisCurrency: 1_500,
  perks: [wardens],
  onUnlock: (country) => country.setCountryFlag("archive_ambition_living_archive"),
});

const surveyWorld = mod.crisisObjective("survey_world", {
  name: "Survey a World",
  desc: "Preserve another world's history.",
  reward: { base: 100 },
  recurring: true,
});

const defendArchive = mod.crisisObjective("defend_archive", {
  name: "Defend the Archive",
  desc: "Repel those who would erase the past.",
  potential: hasAuthority("auth_democratic"),
  reward: { base: 250, factor: 2 },
});

const archivePath = mod.crisisPath("archive", {
  crisisCurrency: {
    resource: resolve,
    localization: {
      name: "Resolve:",
      value: "£archive_ambition_resource_resolve£ $VAL|0$",
      currentValue: "Current Resolve: §Y$VALUE|0$§!",
      gaining: "Complete §HArchive Objectives§! to gain more §YResolve§!.",
      crisisObjective: "Archive Objectives",
      crisisObjectiveGained: "Resolve gained",
      crisisObjectiveProgress: "We have gained $AMOUNT$ Resolve from this Archive Objective.",
      crisisObjectiveReward: "$REWARD$",
      crisisLevelLocked: "Required to unlock this level:\\n",
      crisisLevelUnlocked: "At $LEVEL$, you get the rewards:\\n",
      crisisLevelUnlock: "Has §Y$CURRENCY$§! Resolve",
      crisisLevelDesc: "To advance through the Archive levels, accumulate Resolve.",
      crisisDescriptionTitle: "Keeper of the Archive",
      crisisDescription: "Every civilization the galaxy forgets, we remember.",
      crisisHowtoTitle: "Memory and Resolve",
      crisisHowto: "Pursuing §HArchive Objectives§! generates §HResolve§!.",
    },
  },
  levels: [firstRecord, livingArchive],
  objectives: [surveyWorld, defendArchive],
});

const archiveAmbition = mod.ascensionPerk("archive_ambition", {
  name: "Archive Ambition",
  desc: "Turn collective resolve toward preserving every civilization's memory.",
  onEnabled: (country) => country.activateCrisisProgression(archivePath),
});

export const feature = mod.feature("player_crisis", [
  resolve,
  cataloguers,
  wardens,
  firstRecord,
  livingArchive,
  surveyWorld,
  defendArchive,
  archivePath,
  archiveAmbition,
]);

export default mod.compile([feature]);

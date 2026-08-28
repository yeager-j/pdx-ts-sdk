import { createMod } from "@pdx-ts/sdk";
import { customTooltip, isSubject, owner, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Crystal Resonance",
  prefix: "crystal_resonance",
  supportedVersion: "v4.4.*",
});

const archiveTooltip = mod.localization("archive_tooltip", {
  english: "Stores discoveries made through resonance research.",
  french: "Conserve les découvertes issues de la recherche en résonance.",
});

const resonanceArchive = mod.building("resonance_archive", {
  name: "Resonance Archive",
  desc: "A living record of every harmonic signal we have found.",
  baseBuildtime: 360,
  category: "research",
  icon: "building_research_lab_1",
  buildingSets: ["research"],
  canBuild: true,
  customTooltip: archiveTooltip,
  potential: customTooltip({
    // Display text written where it is read. The SDK keys it against this
    // building and the field path, and ships it in this Feature's own file.
    successText: "The archive is yours to fill.",
    // A key vanilla owns, checked against the packaged inventory.
    failText: vanilla.localization("requires_independence"),
    conditions: owner(isSubject(false)),
  }),
});

const reconsider = mod.replaceLocalization("crisis.2010.a", {
  english: "Reconsider the signal.",
  french: "Réexaminez le signal.",
});

export const feature = mod.feature("resonance", [archiveTooltip, resonanceArchive, reconsider]);

export default mod.compile([feature]);

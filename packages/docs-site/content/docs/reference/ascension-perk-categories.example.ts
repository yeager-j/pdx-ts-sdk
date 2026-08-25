import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Archive Paths",
  prefix: "archive_paths",
  supportedVersion: "v4.4.*",
});

const preservation = mod.ascensionPerk("preservation", {
  name: "Galactic Preservation",
  desc: "Protect the records and relics of every civilization.",
});

const exploration = mod.ascensionPerk("exploration", {
  name: "Boundless Exploration",
  desc: "Seek knowledge beyond every charted frontier.",
});

const archivePaths = mod.ascensionPerkCategory("archive_paths", {
  name: "Archive Paths",
  desc: "Ascension perks devoted to discovery and preservation.",
  ascensionPerks: [preservation, exploration],
});

export const feature = mod.feature("archive_paths", [preservation, exploration, archivePaths]);

export default mod.compile([feature]);

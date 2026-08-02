/**
 * The calibration anchor (docs/verdict-patches.md): build the real
 * tech_gene_tailoring patch — cost.value * 2, one appended prerequisite —
 * and install it where the launcher finds it. In-game verification of the
 * doubled cost is the one claim no test can make; run this, launch the
 * game, and record the result in the verdict doc.
 */

import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildMod,
  collection,
  defineTechnology,
  patchTechnology,
  render,
  stellaris,
  write,
} from "@pdx-ts/sdk";

const vanilla = stellaris.load();

// Auto-researched at game start (tier 0 start tech), so appending it as a
// prerequisite never gates the patched tech — it only has to *show up* in
// the prerequisite list, a second observable on top of the cost.
const marker = defineTechnology({
  id: "pdx_calib_tech_marker",
  name: "Calibration Marker",
  desc: "If you can read this in the technology tooltip, the SDK's patch file won the override.",
  area: "society",
  tier: 0,
  category: "biology",
  startTech: true,
});

const geneTailoring = vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites");
const vanillaCost = geneTailoring.cost.value;

const geneTailoringPatch = patchTechnology(geneTailoring, (t) => ({
  cost: t.cost.value * 2,
  prerequisites: [...t.prerequisites, marker],
}));

const technologies = collection(undefined, [marker, geneTailoringPatch]);

// The patch guards — one vanilla view per mod, no duplicate patch, no id
// colliding with a real vanilla technology — are checked here, at the fold.
const mod = buildMod(
  {
    name: "PDX Calibration Patch",
    prefix: "pdx_calib",
    version: "1.0",
    supportedVersion: "v4.4.*",
  },
  [technologies],
  { vanilla }
);

const modRoot = join(homedir(), "Documents/Paradox Interactive/Stellaris/mod");
const contentDir = join(modRoot, "pdx_calib");
const files = render(mod);
await write(contentDir, files);

// The launcher-side descriptor: same fields as descriptor.mod plus the path.
await writeFile(
  join(modRoot, "pdx_calib.mod"),
  `name="PDX Calibration Patch"\nversion="1.0"\nsupported_version="v4.4.*"\npath="${contentDir}"\n`,
  "utf8"
);

const plan = mod.patchPlan!;
console.log(`Installed to ${contentDir}`);
for (const relPath of files.keys()) {
  console.log(`  wrote ${relPath}`);
}
console.log(
  `\nWin assertion (${plan.assertions[0]!.confidence}, Stellaris ${plan.assertions[0]!.verifiedAgainst}):`
);
console.log(`  ${plan.relPath} beats ${plan.assertions[0]!.beats.join(", ")}`);
console.log(`\nVerify in-game (build ${vanilla.gameVersion ?? "unknown"} installed):`);
console.log(`  1. Enable "PDX Calibration Patch" in the launcher playset, start a new game.`);
console.log(`  2. "Calibration Marker" should already be researched (tier-0 start tech).`);
console.log(`  3. Console: research_technology tech_genome_mapping — then find Gene Tailoring`);
console.log(`     among society research options (reroll with: research_all_technologies is NOT`);
console.log(`     needed; use "debugtooltip" and the tech tooltip).`);
console.log(`  4. Gene Tailoring must show cost ${vanillaCost * 2} (vanilla: ${vanillaCost}) and`);
console.log(`     "Calibration Marker" in its prerequisites.`);
console.log(`  5. Record the result + build number in docs/verdict-patches.md.`);

/**
 * Mainline artifact of the parser probe, written as a mod author would write
 * it — this file is the artifact the spike judges: zero casts, zero `any`.
 *
 * The design notes' unproven half, end to end: parse a vanilla technology,
 * read it through a typed surface, patch it with plain TypeScript, re-emit.
 * `cost` is a scripted-variable reference in the file, so the patch takes
 * `.value` — baking the number is a visible act, never a default (see
 * docs/handoff-pdxscript-parser.md, "Decisions already made").
 */

import { createMod } from "../../packages/sdk/src/index.ts";
import { TECH_FILE, VARS_FILE } from "./fixture.ts";
import { patchTechnology } from "./patch.ts";
import { parseVanilla } from "./surface.ts";

export const vanilla = parseVanilla({
  "common/technology/pp_soc_tech.txt": TECH_FILE,
  "common/scripted_variables/pp_vars.txt": VARS_FILE,
});

const mod = createMod({
  name: "Parser Probe",
  prefix: "pp",
  supportedVersion: "4.4.*",
});

/**
 * The rules say `cost` and `prerequisites` are optional on a technology;
 * `require` checks they are present here and records that in the type, so the
 * patch below can use them without narrowing boilerplate.
 */
export const geneForging = vanilla.technology("tech_gene_forging").require("cost", "prerequisites");

/** A new SDK-authored technology, referenced as an object — never an id string. */
export const chimericGrafts = mod.technology("chimeric_grafts", {
  name: "Chimeric Grafts",
  area: "society",
  tier: 2,
  category: "biology",
  prerequisites: [geneForging],
});

export const patched = patchTechnology(geneForging, (t) => ({
  cost: t.cost.value * 2,
  prerequisites: [...t.prerequisites, chimericGrafts],
}));

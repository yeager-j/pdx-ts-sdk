/**
 * The negative half of the parser probe: one `@ts-expect-error` per safety
 * claim the typed surface makes. If any annotation stops firing, `npm run
 * typecheck` fails — the claims are pinned, not assumed. Nothing here runs;
 * every case is wrapped in a function that is never called, so the file is
 * inert at runtime.
 */

import type { ResearchArea } from "../../src/generated/enums.ts";
import type { TechnologyDef } from "../../src/generated/technology.ts";
import { isPlanet } from "../../src/generated/triggers.ts";
import { patchTechnology } from "./patch.ts";
import { chimericGrafts, geneForging } from "./probe.ts";

/**
 * Claim 1: the design notes' literal `cost: vanilla.cost * 2` does not
 * compile. A parsed number is resolved-with-provenance, and arithmetic on it
 * is poisoned — the author must take `.value`, making the bake visible.
 */
export function arithmeticOnParsedNumber(): void {
  patchTechnology(geneForging, (t) => ({
    // @ts-expect-error — t.cost is a ParsedNumber, not a number; write t.cost.value * 2
    cost: t.cost * 2,
  }));
}

/** Claim 2: a ParsedNumber cannot be smuggled into a plain `number` field unresolved. */
export function parsedNumberIntoDef(): void {
  const def: TechnologyDef = {
    id: "pp_tech_smuggled",
    name: "Smuggled",
    area: "society",
    tier: 1,
    category: "biology",
    // @ts-expect-error — TechnologyDef.cost is a number; a ParsedNumber does not assign
    cost: geneForging.cost,
  };
  void def;
}

/** Claim 3: an unvalidated string does not assign where the rules say ResearchArea. */
export function rawStringAsArea(): void {
  const parsedElsewhere: string = "society";
  patchTechnology(geneForging, () => ({
    // @ts-expect-error — area takes ResearchArea; a raw string must be validated first
    area: parsedElsewhere,
  }));
  const area: ResearchArea = "society";
  void area;
}

/** Claim 4: the typed surface is honest — unmodelled fields are not phantom properties. */
export function phantomProperty(): void {
  // @ts-expect-error — gateway is unmodelled; it lives in the rest carry-through, not on the type
  void geneForging.gateway;
}

/** Claim 5: the patch object is closed — an unknown key is rejected, not carried. */
export function unknownPatchKey(): void {
  // @ts-expect-error — "weightt" is not a technology field; typos fail to compile
  patchTechnology(geneForging, () => ({ weightt: 5 }));
}

/** Claim 6: a patch cannot change identity — patched techs keep vanilla's id. */
export function patchTheId(): void {
  // @ts-expect-error — id is not patchable; an override must target the vanilla key
  patchTechnology(geneForging, () => ({ id: "tech_gene_forging_renamed" }));
}

/** Claim 7: scope branding survives the parse boundary — potential is country-scoped. */
export function wrongScopeInPatchedPotential(): void {
  patchTechnology(geneForging, () => ({
    // @ts-expect-error — a planet-scoped trigger is not valid in a technology's potential
    potential: isPlanet(chimericGrafts.id),
  }));
}

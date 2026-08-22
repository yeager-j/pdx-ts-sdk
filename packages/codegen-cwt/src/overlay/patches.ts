/**
 * Patch overlay rows: which registries offer a `patchX` whole-object override,
 * and the extra input forms a patch member admits over the definition's own.
 *
 * See `./index.ts` for what this directory is and how a row here earns its
 * place.
 */

import type { FieldWidening } from "./fields.ts";

/**
 * Registries whose collection factory also offers a vanilla patch.
 *
 * A prefixed definition cannot collide with vanilla, but a patch is a whole-
 * object override whose load order and emission have to be verified per
 * registry — so `patchX` appears only where that evidence exists. The member
 * names are derived (`patchTechnology`, `ParsedTechnology`, `TechnologyPatch`);
 * the row is the permission.
 */
export const CONTENT_PATCH_REGISTRIES = new Map<string, string>([
  [
    "technology",
    "the first registry the vanilla loader parses and the patch resolver plans emission for " +
      "(packages/sdk/src/stellaris/vanilla/, " +
      "packages/sdk/src/compiler/patches.ts) — verified in-game by the " +
      "patches-that-provably-win calibration",
  ],
  [
    "building",
    "parsed by the vanilla loader beside technology (PARSED_REGISTRIES in " +
      "packages/sdk/src/stellaris/vanilla/parse.ts), and its rule-table row is fully verified — " +
      "r8 established last-wins and whole-object replacement from matching diagnostics",
  ],
  [
    "megastructure",
    "parsed by the vanilla loader beside technology and building (PARSED_REGISTRIES in " +
      "packages/sdk/src/stellaris/vanilla/parse.ts), and its rule-table row carries two " +
      "non-refused cells — r8 verified last-wins, and whole-object replacement is the named " +
      "2026-07-31 judgment r8 could not discriminate. Assumed rather than verified is still a " +
      'rule the engine may act on: every win it backs reports `confidence: "assumed"` and ' +
      "every emitted patch file states the judgment in its header, so the weaker evidence is " +
      "visible rather than laundered",
  ],
]);

/**
 * Ergonomic widenings on a patch member, over what the definition's own member
 * already admits.
 *
 * Same shape and same review posture as {@link FIELD_WIDENINGS}, one surface
 * over: a row is a claim that the patch transform emits this extra form
 * correctly, which is evidence to produce, not a reading of the rules. The
 * extra form joins the member's admitted inputs — at the *element* level for a
 * list-shaped member, since that is the position the form occurs in.
 */
export const PATCH_WIDENINGS = new Map<string, FieldWidening>([
  [
    "technology.prerequisites",
    {
      extraType: "AnyOf<TechnologyRef>",
      // `TechnologyRef` is the member's own reference type and already imported;
      // `AnyOf` arrives with this row alone.
      symbols: ["AnyOf"],
      reason:
        "Vanilla writes `OR = { ... }` alternation groups in five technology files, and the " +
        "parsed surface hands them back as `AnyOf` values, so `[...t.prerequisites, mine]` has " +
        "to be a legal patch input. A definition of the mod's own has no such need: nothing " +
        "reads an authored OR group back out.",
    },
  ],
]);

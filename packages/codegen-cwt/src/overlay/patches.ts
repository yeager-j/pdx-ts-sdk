/**
 * Patch overlay rows: which registries offer a `patchX` whole-object override,
 * and the extra input forms a patch member admits over the definition's own.
 *
 * See `./index.ts` for what this directory is and how a row here earns its
 * place.
 */

import type { FieldWidening } from "./fields.ts";

/** Reviewed evidence and optional consumer guidance for one patchable registry. */
export interface ContentPatchRegistry {
  /** Evidence that permits the registry's whole-object patch surface. */
  readonly reason: string;
  /** JSDoc lines appended to the generated capability method. */
  readonly example?: readonly string[];
}

/**
 * Registries whose collection factory also offers a vanilla patch.
 *
 * A prefixed definition cannot collide with vanilla, but a patch is a whole-
 * object override whose load order and emission have to be verified per
 * registry — so `patchX` appears only where that evidence exists. The member
 * names are derived (`patchTechnology`, `ParsedTechnology`, `TechnologyPatch`);
 * the row is the permission.
 */
export const CONTENT_PATCH_REGISTRIES = new Map<string, ContentPatchRegistry>([
  [
    "technology",
    {
      reason:
        "the first registry the vanilla loader parses and the patch resolver plans emission for " +
        "(packages/sdk/src/installation/vanilla/, " +
        "packages/sdk/src/compiler/patches.ts) — verified in-game by the " +
        "patches-that-provably-win calibration",
    },
  ],
  [
    "building",
    {
      reason:
        "parsed by the vanilla loader beside technology (PARSED_REGISTRIES in " +
        "packages/sdk/src/installation/vanilla/parse.ts), and its rule-table row is fully verified — " +
        "r8 established last-wins and whole-object replacement from matching diagnostics",
    },
  ],
  [
    "ascension_perk_category",
    {
      reason:
        "parsed by the vanilla loader as a flat keyed registry, and its rule-table row carries two " +
        "explicit assumed cells — the SDK-289 judgment applies the r8/r10 keyed-script model until " +
        "a category-specific runtime oracle settles repeat registration and omitted-field behavior. " +
        'Every win it backs reports `confidence: "assumed"`, and every emitted patch file states ' +
        "the judgment in its header",
      example: [
        "@example",
        "```ts",
        'import { createMod } from "@pdx-ts/sdk";',
        'import * as stellaris from "@pdx-ts/sdk/installation";',
        "",
        "const mod = createMod({",
        '  name: "Archive Ambitions",',
        '  prefix: "archive_ambitions",',
        '  supportedVersion: "4.4.*",',
        "});",
        'const ambition = mod.ascensionPerk("archive", {});',
        "const vanilla = stellaris.load();",
        "const ambitions = vanilla.definition(",
        '  "ascension_perk_category",',
        '  "ap_category_ambitions"',
        ");",
        "const patch = mod.patchAscensionPerkCategory(ambitions, (category) => ({",
        "  ascensionPerks: [...category.ascensionPerks, ambition],",
        "}));",
        'const feature = mod.feature("ambitions", [ambition, patch]);',
        "mod.compile([feature], { vanilla });",
        "```",
      ],
    },
  ],
  [
    "megastructure",
    {
      reason:
        "parsed by the vanilla loader beside technology and building (PARSED_REGISTRIES in " +
        "packages/sdk/src/installation/vanilla/parse.ts), and its rule-table row carries two " +
        "non-refused cells — r8 verified last-wins, and whole-object replacement is the named " +
        "2026-07-31 judgment r8 could not discriminate. Assumed rather than verified is still a " +
        'rule the engine may act on: every win it backs reports `confidence: "assumed"` and ' +
        "every emitted patch file states the judgment in its header, so the weaker evidence is " +
        "visible rather than laundered",
    },
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

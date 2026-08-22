/**
 * The hand-maintained overlay: every place the generated API deliberately
 * departs from a mechanical reading of the rules.
 *
 * Keeping these in one audited overlay surface is the point. The rules cover
 * an enormous surface but they describe what the *game* accepts, not what a
 * TypeScript API should look like, and they carry no information at all about
 * some things the SDK needs. Scattering the differences through the emitters
 * would hide how much hand-maintenance this pipeline actually costs.
 * Domain-specific tables keep each decision near its consumer, while this
 * index keeps the complete inventory visible.
 *
 * Each entry states what it changes and why. Adding one should feel expensive.
 *
 * The rows live in `overlay/`, split by the domain that reads them:
 * `overlay/fields.ts` (content-type field lowering), `overlay/localisation.ts`
 * (required and synthetic localisation slots), `overlay/patches.ts` (patch
 * registries and widenings), `overlay/identity.ts` (witnesses, subtype
 * reference refinements, file stems), `overlay/grafts.ts` (hand-written
 * definers, hand-written vanilla refs, contribution sinks),
 * `overlay/script.ts` (trigger, effect, and modifier lowering), and
 * `overlay/mints.ts` (identity-mint shapes). This file is their index —
 * every importer keeps importing from here, unchanged.
 */

export * from "./fields.ts";
export * from "./grafts.ts";
export * from "./identity.ts";
export * from "./localisation.ts";
export * from "./mints.ts";
export * from "./patches.ts";
export * from "./script.ts";

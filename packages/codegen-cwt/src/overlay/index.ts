/**
 * The hand-maintained overlay: every place the generated API deliberately
 * departs from a mechanical reading of the rules.
 *
 * Keeping these in one table is the point. The rules cover an enormous surface
 * but they describe what the *game* accepts, not what a TypeScript API should
 * look like, and they carry no information at all about some things the SDK
 * needs. Scattering the differences through the emitters would hide how much
 * hand-maintenance this pipeline actually costs; collected here, it is a short
 * list anyone can audit.
 *
 * Each entry states what it changes and why. Adding one should feel expensive.
 *
 * The rows live in `overlay/`, split by the domain that reads them:
 * `overlay/content.ts` (content-type fields, localisation, patches, and
 * registry identity), `overlay/script.ts` (trigger, effect, and modifier
 * lowering), and `overlay/mints.ts` (identity-mint shapes). This file is
 * their index — every importer keeps importing from here, unchanged.
 */

export * from "./content.ts";
export * from "./script.ts";
export * from "./mints.ts";

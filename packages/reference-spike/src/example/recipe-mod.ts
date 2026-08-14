/**
 * The capability behind `#mod`, which is the one import a Recipe writes.
 *
 * `create-stellaris-mod init` scaffolds a project with exactly one module that
 * calls `createMod`, and aliases it as `#mod` in the project's own
 * `package.json#imports`. Every file a Recipe writes then imports the
 * capability from there rather than building its own, which is why a Recipe's
 * output is three lines shorter than the hand-written stories on this page and
 * why moving one deeper into the content directory never rewrites an import.
 *
 * So the spike supplies the other half. This is the scaffolded project's
 * `src/mod.ts`, standing in — and the reason the Recipe's story can be the
 * Recipe's exact bytes, compiled by the repository's own typecheck and folded
 * by the same synthesizer every other story goes through, rather than a copy
 * with the import rewritten to make it self-contained.
 *
 * The mod name and prefix are the spike's, not the Recipe's. A Recipe never
 * sees them: it renders the content, and the project it lands in decides what
 * every id is prefixed with.
 */

import { createMod } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Ember Archive",
  prefix: "ember" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

/**
 * Reading and emission, composed.
 *
 * The generator is two steps with a value between them: `read-facts.ts` turns
 * an install into {@link VanillaBuildFacts}, and `emit-package.ts` turns that
 * into files. This module is the one place they meet, and it exists so the
 * meeting is a named thing rather than an implicit call inside the emitter —
 * which is what it used to be, and what let a "pure" core reach the filesystem.
 *
 * Callers that already hold facts should use `emitVanillaPackage` directly.
 * This is for the callers that hold a directory: the CLI in `index.ts`, and the
 * tests that generate from a fixture install.
 */

import { emitVanillaPackage, type EmitOptions, type VanillaReport } from "./emit-package.ts";
import { readVanillaFacts, type VanillaBuildFactsOptions } from "./read-facts.ts";

/** An install to read, and the emission policy to read it under. */
export interface GenerateOptions extends VanillaBuildFactsOptions, EmitOptions {}

/**
 * Reads an install and emits the package from what it found.
 *
 * Impure, and named for the whole job rather than for either half: the result
 * depends on the contents of {@link GenerateOptions.installRoot} at the moment
 * of the call, not on the arguments alone.
 *
 * @param options - Which install to read, and the emission policy.
 * @returns The emitted files and the report describing what produced them.
 * @throws Error If reading refuses what it found, or emission refuses what it
 * was asked to write.
 */
export function generateVanillaPackage(options: GenerateOptions): {
  files: ReadonlyMap<string, string>;
  report: VanillaReport;
} {
  return emitVanillaPackage(readVanillaFacts(options), options);
}

/**
 * The vocabulary the recipe-matrix files share.
 *
 * The matrix was one file until its compile gates became a serial five-minute
 * tail behind the rest of the suite; it is now split per recipe so the gates
 * spread across Vitest workers. What stays shared is here: the canonical name,
 * the byte-level source chain every variant runs, and the golden-project
 * economy — one project per file, whose incremental `typecheck()` re-checks
 * only the swapped content file after the first full run.
 */

import { rmSync } from "node:fs";
import path from "node:path";
import { format, resolveConfig, type Options } from "prettier";
import { expect, it } from "vitest";

import type { GeneratedFeatureSource } from "../../src/catalog/types.ts";
import type { GoldenProject } from "./golden-project.ts";
import { expectGolden } from "./goldens.ts";

/** Long enough to run `tsc` over the SDK's sources on a cold cache. */
export const COMPILER_TIMEOUT = 180_000;

export const NAME = "Resonance Theory";
export const STEM = "resonance_theory";
export const PREFIX = "golden_mod";
export const MATERIALIZATION_MANIFEST = ".pdx-sdk-manifest.json";

/**
 * Prettier in-process, against this repository's own configuration. The
 * `filepath` is a hint rather than a read: it selects the TypeScript parser and
 * decides which `.prettierrc` applies, which is the whole point — the promise is
 * about *this* configuration, not about Prettier's defaults.
 */
export async function prettier(source: string): Promise<string> {
  const filepath = path.resolve(import.meta.dirname, "../../src/catalog/recipes/technology.ts");
  const config = (await resolveConfig(filepath)) ?? {};
  return format(source, { ...config, filepath } satisfies Options);
}

/**
 * The bytes-level chain every variant runs before any compiler sees it.
 *
 * Shared rather than restated per recipe: twelve variants asserting the same
 * five things in twelve wordings is twelve places for one of them to go quietly
 * missing, and the per-recipe difference that matters — what the build has to
 * emit — is asserted where it belongs, below each recipe's own describe.
 */
export function describeSource(golden: string, generate: () => GeneratedFeatureSource): void {
  const generated = generate();

  it("names the file after the derived stem", () => {
    expect(generated.stem).toBe(STEM);
    expect(generated.basename).toBe(`${STEM}.ts`);
  });

  it("matches the reviewed golden byte for byte", () => {
    expectGolden(golden, generated.contents);
  });

  it("renders the same bytes a second time", () => {
    expect(generate().contents).toBe(generated.contents);
  });

  it("is already formatted, so an author's first `npm run format` is a no-op", async () => {
    expect(await prettier(generated.contents)).toBe(generated.contents);
  });

  it("ends with exactly one newline and carries no trailing whitespace", () => {
    expect(generated.contents.endsWith("\n")).toBe(true);
    expect(generated.contents.endsWith("\n\n")).toBe(false);
    expect(generated.contents.split("\n").filter((line) => /\s$/.test(line))).toEqual([]);
  });
}

/**
 * Empties a shared project's output directory. A file's variants build into
 * one reused project, and each variant's `outFiles()` assertion is a statement
 * about that variant alone — not about how the build reconciles a predecessor's
 * output, which the materialization tests own.
 */
export function freshOut(project: GoldenProject): void {
  rmSync(project.outDir, { recursive: true, force: true });
}

/** Runs `tsc` over the project and requires a clean pass. */
export function expectTypechecks(project: GoldenProject): void {
  const result = project.typecheck();
  expect(result.output).toBe("");
  expect(result.status).toBe(0);
}

/** Renders a variant, mutates one substring, and requires `tsc` to refuse it. */
export function expectRefused(
  project: GoldenProject,
  generated: GeneratedFeatureSource,
  from: string,
  to: string,
  reported: string
): void {
  const bad = generated.contents.replace(from, to);
  expect(bad, "the mutation must actually have applied").not.toBe(generated.contents);

  project.place(generated.basename, bad);
  const result = project.typecheck();
  expect(result.status).not.toBe(0);
  expect(result.output).toContain(reported);
}

/**
 * Strips the leading `// ` from every commented field line, reports which
 * fields it found, and compiles the result in the given project — an example
 * that stopped matching would otherwise turn this gate into a second compile of
 * the unmodified file.
 */
export function compileUncommented(
  project: GoldenProject,
  generated: GeneratedFeatureSource,
  examples: readonly string[]
): void {
  const { source, uncommented } = uncomment(generated.contents, examples);
  expect(uncommented, "every example must actually have been uncommented").toEqual([...examples]);

  project.place(generated.basename, source);
  expectTypechecks(project);
}

function uncomment(
  source: string,
  fields: readonly string[]
): { source: string; uncommented: string[] } {
  const uncommented: string[] = [];
  const pattern = new RegExp(`^(\\s*)// ((?:${fields.join("|")}):.*)$`);
  const lines = source.split("\n").map((line) => {
    const match = pattern.exec(line);
    if (match === null) {
      return line;
    }
    uncommented.push(match[2]!.split(":")[0]!);
    return `${match[1]}${match[2]}`;
  });
  return { source: lines.join("\n"), uncommented };
}

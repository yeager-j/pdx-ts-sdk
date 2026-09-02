/** Enforces the codegen pipeline's dependency direction. */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : entry.name.endsWith(".ts") ? [target] : [];
  });
}

function stageImports(stage: string): Array<{ readonly file: string; readonly target: string }> {
  const root = path.join(SOURCE, stage);
  return sourceFiles(root).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/(?:import|export)[\s\S]*?from\s+["'](\.[^"']+)["']/g)].map(
      (match) => ({
        file: path.relative(SOURCE, file),
        target: path.resolve(path.dirname(file), match[1]!),
      })
    );
  });
}

function importsStage(target: string, stage: string): boolean {
  return target.startsWith(`${path.join(SOURCE, stage)}${path.sep}`);
}

describe("codegen stage boundaries", () => {
  it.each(["lower", "reconcile"])("keeps %s independent of emission and rendering", (stage) => {
    const violations = stageImports(stage)
      .filter(({ target }) => importsStage(target, "emit") || importsStage(target, "render"))
      .map(({ file, target }) => `${file} -> ${path.relative(SOURCE, target)}`);

    expect(violations).toEqual([]);
  });

  it("keeps generic rendering independent of semantic and emission stages", () => {
    const violations = stageImports("render")
      .filter(({ target }) => importsStage(target, "lower") || importsStage(target, "emit"))
      .map(({ file, target }) => `${file} -> ${path.relative(SOURCE, target)}`);

    expect(violations).toEqual([]);
  });

  it("keeps scalar interpretation owned by lowering", () => {
    const lowering = readFileSync(path.join(SOURCE, "lower/value.ts"), "utf8");
    const emission = readFileSync(path.join(SOURCE, "emit/typescript.ts"), "utf8");

    expect(lowering).toContain("export class ValueLowerer");
    expect(lowering).toMatch(/\bvalueFor\s*\(/);
    expect(lowering).toMatch(/\bunionFor\s*\(/);
    expect(emission).not.toMatch(/\bvalueFor\s*\(/);
    expect(emission).not.toMatch(/\bunionFor\s*\(/);
    expect(emission).not.toContain("implements LoweringContext");
  });
});

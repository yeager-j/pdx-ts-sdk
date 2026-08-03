/**
 * The corpus reader's two structural-splice behaviours, against real files.
 *
 * Both are invisible in the vanilla corpus: `common/solar_system_initializers`
 * happens to contain no `random_list` root today, and a per-definition arity bug
 * only shows as a *missing* report, which no green run can distinguish from a
 * correct one. Written to a temp directory rather than asserted against the
 * install, so these run in CI too.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readRegistryCorpus, type SpliceMember } from "@pdx-ts/codegen-cwt/corpus";
import { describe, expect, it } from "vitest";

/** `planet` holds `planet` and `moon`; `moon` holds `moon`. The real shape. */
const MOON: SpliceMember = { key: "moon", members: () => [MOON] };
const PLANET: SpliceMember = { key: "planet", members: () => [PLANET, MOON] };

function corpusOf(contents: string, excludedKey: string | null = null) {
  const root = mkdtempSync(path.join(tmpdir(), "pdx-corpus-"));
  mkdirSync(path.join(root, "common/systems"), { recursive: true });
  writeFileSync(path.join(root, "common/systems/test.txt"), contents, "utf8");
  return readRegistryCorpus(root, "common/systems", null, null, [], [PLANET], excludedKey);
}

describe("splice arity", () => {
  it("counts repetition inside one block, not across a definition's blocks", () => {
    // Two planets, each writing `size` once. Accumulating them under one path
    // made `planet.size` look repeatable and silently suppressed the "lowered
    // as a list but never repeated" report that catches a wrong array lowering.
    const corpus = corpusOf(`
      one = {
        planet = { size = 20 }
        planet = { size = 25 }
      }
    `);
    expect(corpus.definitions).toBe(1);
    expect(corpus.occurrences.get("planet.size")?.definitions).toBe(1);
    expect(corpus.occurrences.get("planet.size")?.repeated).toBe(0);
  });

  it("still sees a key repeated inside a single block", () => {
    // The upstream copy-paste the arity overlay rows are argued against — one
    // planet contradicting itself. This is the case that must stay visible.
    const corpus = corpusOf(`
      one = {
        planet = { size = 15 size = 20 }
      }
    `);
    expect(corpus.occurrences.get("planet.size")?.repeated).toBe(1);
  });

  it("counts repetition at any depth, since one field table serves them all", () => {
    const corpus = corpusOf(`
      one = {
        planet = { moon = { size = 4 } moon = { size = 6 size = 8 } }
      }
    `);
    // Two moons, one of which repeats `size` — the deep block is what counts.
    expect(corpus.occurrences.get("moon.size")?.repeated).toBe(1);
  });
});

describe("a sibling type sharing the directory", () => {
  it("is not counted as a definition of this registry", () => {
    // `## type_key_filter <> random_list`: the other type in
    // common/solar_system_initializers, told apart by its root key. Without the
    // exclusion an id-keyed registry reads it as one of its own.
    const contents = `
      one = { planet = { size = 20 } }
      random_list = { name = pick sol_system = 10 }
    `;
    expect(corpusOf(contents).definitions).toBe(2);
    expect(corpusOf(contents, "random_list").definitions).toBe(1);
    expect(corpusOf(contents, "random_list").occurrences.has("name")).toBe(false);
  });
});

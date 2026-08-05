/**
 * The corpus reader's descent behaviours, against real files, plus the emitter
 * side that configures them.
 *
 * Most are invisible in the vanilla corpus: `common/solar_system_initializers`
 * happens to contain no `random_list` root today, and a per-block arity bug only
 * shows as a *missing* report, which no green run can distinguish from a correct
 * one. Written to a temp directory rather than asserted against the install, so
 * these run in CI too.
 *
 * The last block measures the other half: a descent whose emitted fields do not
 * exist would report interiors nothing claims to author, so the reader's
 * configuration and the emitter's nested field list are asserted together.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readRegistryCorpus,
  type DescentNode,
  type SpliceMember,
} from "@pdx-ts/codegen-cwt/corpus";
import { loadRules } from "@pdx-ts/codegen-cwt/cwt/rules";
import { emitContentType } from "@pdx-ts/codegen-cwt/emit/content-type";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";
import { describe, expect, it } from "vitest";

/** `planet` holds `planet` and `moon`; `moon` holds `moon`. The real shape. */
const MOON: SpliceMember = { key: "moon", members: () => [MOON] };
const PLANET: SpliceMember = { key: "planet", members: () => [PLANET, MOON] };

function corpusOf(
  contents: string,
  descents: readonly DescentNode[] = [],
  excludedKey: string | null = null
) {
  const root = mkdtempSync(path.join(tmpdir(), "pdx-corpus-"));
  mkdirSync(path.join(root, "common/systems"), { recursive: true });
  writeFileSync(path.join(root, "common/systems/test.txt"), contents, "utf8");
  return readRegistryCorpus(root, "common/systems", null, null, descents, [PLANET], excludedKey);
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
    expect(corpusOf(contents, [], "random_list").definitions).toBe(1);
    expect(corpusOf(contents, [], "random_list").occurrences.has("name")).toBe(false);
  });
});

describe("plain struct descent", () => {
  const TERM_DATA: DescentNode = {
    field: "term_data",
    mode: "struct",
    children: [{ field: "discrete_terms", mode: "struct", children: [] }],
  };

  it("records the block's own entries under a dotted path", () => {
    const corpus = corpusOf(
      `
      one = { term_data = { agreement_preset = foo strength = 3 } }
    `,
      [TERM_DATA]
    );
    // The owning key still reports its own occurrence: the interior is
    // additional evidence, not a replacement for it.
    expect(corpus.occurrences.get("term_data")?.definitions).toBe(1);
    expect(corpus.occurrences.get("term_data.strength")?.definitions).toBe(1);
    expect([...(corpus.occurrences.get("term_data.agreement_preset")?.values ?? [])]).toEqual([
      "foo",
    ]);
  });

  it("descends two levels, where the emitter lowered two", () => {
    const corpus = corpusOf(
      `
      one = { term_data = { discrete_terms = { key = trade value = 2 } } }
    `,
      [TERM_DATA]
    );
    expect(corpus.occurrences.get("term_data.discrete_terms.key")?.definitions).toBe(1);
    expect(corpus.occurrences.get("term_data.discrete_terms.value")?.definitions).toBe(1);
    // Not walked past what the node names: `value` is a scalar here, and an
    // unnamed child would be a path no emitted field could be measured against.
    expect(corpus.occurrences.has("term_data.discrete_terms.value.x")).toBe(false);
  });

  it("counts a repeated struct's occurrences as separate blocks", () => {
    // Each `text = { ... }` is its own block, so two of them each writing
    // `trigger` once is not a repetition — the same rule the splice walk uses.
    const corpus = corpusOf(
      `
      one = {
        text = { trigger = yes }
        text = { trigger = no }
      }
      two = { text = { trigger = yes trigger = no } }
    `,
      [{ field: "text", mode: "struct", children: [] }]
    );
    expect(corpus.occurrences.get("text.trigger")?.definitions).toBe(2);
    expect(corpus.occurrences.get("text.trigger")?.repeated).toBe(1);
  });

  it("counts an interior key once per definition however many blocks write it", () => {
    const corpus = corpusOf(
      `
      one = {
        text = { trigger = yes }
        text = { trigger = no }
        text = { trigger = yes }
      }
    `,
      [{ field: "text", mode: "struct", children: [] }]
    );
    expect(corpus.occurrences.get("text.trigger")?.definitions).toBe(1);
    expect(corpus.occurrences.get("text.trigger")?.scalars).toBe(1);
  });
});

describe("wrapped struct descent", () => {
  // `resource_terms = { { key = ... } { key = ... } }`: the repetition lives on
  // a bare anonymous block inside the container, not on the container's key.
  const RESOURCE_TERMS: DescentNode = {
    field: "resource_terms",
    mode: "wrappedStruct",
    children: [],
  };

  it("records each bare block's entries", () => {
    const corpus = corpusOf(
      `
      one = {
        resource_terms = {
          { key = energy value = 10 }
          { key = minerals value = 20 }
        }
      }
    `,
      [RESOURCE_TERMS]
    );
    expect(corpus.occurrences.get("resource_terms.key")?.definitions).toBe(1);
    expect([...(corpus.occurrences.get("resource_terms.key")?.values ?? [])].sort()).toEqual([
      "energy",
      "minerals",
    ]);
  });

  it("treats each bare block as its own arity boundary", () => {
    const corpus = corpusOf(
      `
      one = { resource_terms = { { key = energy } { key = minerals } } }
      two = { resource_terms = { { key = energy key = minerals } } }
    `,
      [RESOURCE_TERMS]
    );
    expect(corpus.occurrences.get("resource_terms.key")?.definitions).toBe(2);
    expect(corpus.occurrences.get("resource_terms.key")?.repeated).toBe(1);
  });
});

describe("struct map descent", () => {
  // `section_slots = { mid = { ... } }`: the engine key is not part of the
  // path, because the emitter has one field table for every key.
  const SECTION_SLOTS: DescentNode = { field: "section_slots", mode: "structMap", children: [] };

  it("aggregates every engine key's block under one path", () => {
    const corpus = corpusOf(
      `
      one = {
        section_slots = {
          mid = { locator = part1 }
          bow = { locator = part2 }
        }
      }
    `,
      [SECTION_SLOTS]
    );
    expect(corpus.occurrences.get("section_slots.locator")?.definitions).toBe(1);
    expect([...(corpus.occurrences.get("section_slots.locator")?.values ?? [])].sort()).toEqual([
      "part1",
      "part2",
    ]);
    expect(corpus.occurrences.has("section_slots.mid")).toBe(false);
  });

  it("counts each engine key's block as its own arity boundary", () => {
    const corpus = corpusOf(
      `
      one = { section_slots = { mid = { locator = a } bow = { locator = b } } }
    `,
      [SECTION_SLOTS]
    );
    expect(corpus.occurrences.get("section_slots.locator")?.repeated).toBe(0);
  });
});

describe("repeated-struct descent", () => {
  const STAGES: DescentNode = {
    field: "stages",
    mode: "repeatedStruct",
    keying: "container",
    children: [],
  };
  const APPROACH: DescentNode = {
    field: "approach",
    mode: "repeatedStruct",
    keying: "siblings",
    identityKey: "name",
    children: [],
  };

  it("reports one id-keyed block's fields under the owning key", () => {
    const corpus = corpusOf(
      `
      one = { stages = { stage_1 = { icon = a } stage_2 = { icon = b } } }
    `,
      [STAGES]
    );
    expect(corpus.occurrences.get("stages.icon")?.definitions).toBe(1);
    // The record key is identity, not a field: it never becomes a path.
    expect(corpus.occurrences.has("stages.stage_1")).toBe(false);
  });

  it("counts each entry as its own arity boundary", () => {
    // Previously every stage of a definition poured into one flattened list, so
    // two stages each writing `icon` once read as a repetition and suppressed
    // the "lowered as a list but never repeated" report.
    const corpus = corpusOf(
      `
      one = { stages = { stage_1 = { icon = a } stage_2 = { icon = b } } }
      two = { stages = { stage_1 = { icon = a icon = b } } }
    `,
      [STAGES]
    );
    expect(corpus.occurrences.get("stages.icon")?.definitions).toBe(2);
    expect(corpus.occurrences.get("stages.icon")?.repeated).toBe(1);
  });

  it("skips the identity key of a siblings-keyed entry", () => {
    const corpus = corpusOf(
      `
      one = {
        approach = { name = approach_a icon = a }
        approach = { name = approach_b icon = b }
      }
    `,
      [APPROACH]
    );
    expect(corpus.occurrences.has("approach.name")).toBe(false);
    expect(corpus.occurrences.get("approach.icon")?.definitions).toBe(1);
    expect(corpus.occurrences.get("approach.icon")?.repeated).toBe(0);
  });
});

describe("the emitter's descent channel", () => {
  const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));
  const emitter = new Emitter(rules);
  emitter.beginFile();
  const emission = emitContentType(
    emitter,
    rules.contentTypes.get("war_goal")!,
    rules.bodies.get("war_goal")!,
    "war_goal"
  );
  emitter.endFile();

  it("reports a plain struct's interior as nested emitted fields", () => {
    // `forbidden_peace_offers = { demand_surrender status_quo surrender }` is
    // the singular case of the struct shape; before the descent channel its
    // three members were invisible behind one top-level key.
    const nested = emission.nestedEmittedFields
      .filter((field) => field.field.startsWith("war_goal.forbidden_peace_offers."))
      .map((field) => field.field);
    expect(nested.sort()).toEqual([
      "war_goal.forbidden_peace_offers.demand_surrender",
      "war_goal.forbidden_peace_offers.status_quo",
      "war_goal.forbidden_peace_offers.surrender",
    ]);
  });

  it("configures the reader for the same field it lowered", () => {
    const descent = emission.corpusDescents.find((node) => node.field === "forbidden_peace_offers");
    expect(descent).toEqual({ field: "forbidden_peace_offers", mode: "struct", children: [] });
    // Every descent names a field the emission also claims at the top level, so
    // no walk can report an interior nothing promised to author.
    const emitted = new Set(emission.emittedFields.map((field) => field.field));
    expect(emission.corpusDescents.filter((node) => !emitted.has(node.field))).toEqual([]);
  });
});

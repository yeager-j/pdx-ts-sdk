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
  type RegistryLayout,
  type SpliceMember,
} from "@pdx-ts/codegen-cwt/corpus";
import { emitAliasSplice } from "@pdx-ts/codegen-cwt/emit/content/alias-splice";
import { emitContentType } from "@pdx-ts/codegen-cwt/emit/content/content-type";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { Emitter } from "@pdx-ts/codegen-cwt/render/emitter";
import { describe, expect, it } from "vitest";

/** `planet` holds `planet` and `moon`; `moon` holds `moon`. The real shape. */
const MOON: SpliceMember = { key: "moon", members: () => [MOON], descents: [] };
const PLANET: SpliceMember = { key: "planet", members: () => [PLANET, MOON], descents: [] };

function corpusOf(
  contents: string,
  descents: readonly DescentNode[] = [],
  excludedKey: string | null = null,
  spliceMembers: readonly SpliceMember[] = [PLANET],
  layout: RegistryLayout = {}
) {
  return corpusOfFiles({ [`test${layout.extension ?? ".txt"}`]: contents }, layout, {
    descents,
    excludedKey,
    spliceMembers,
  });
}

/**
 * The same reader over a whole directory, for the cases where filenames matter.
 * A key with a `/` in it is a nested path, created under the registry root.
 */
function corpusOfFiles(
  files: Readonly<Record<string, string>>,
  layout: RegistryLayout = {},
  options: {
    registry?: string;
    keyword?: string | null;
    nameField?: string | null;
    descents?: readonly DescentNode[];
    excludedKey?: string | null;
    spliceMembers?: readonly SpliceMember[];
  } = {}
) {
  const root = mkdtempSync(path.join(tmpdir(), "pdx-corpus-"));
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, "common/systems", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents, "utf8");
  }
  return readRegistryCorpus(root, {
    registry: options.registry ?? "system",
    registryPath: "common/systems",
    keyword: options.keyword ?? null,
    nameField: options.nameField ?? null,
    descents: options.descents ?? [],
    spliceMembers: options.spliceMembers ?? [PLANET],
    excludedKey: options.excludedKey ?? null,
    layout,
  });
}

describe("scalar observations", () => {
  it("compares quoted strings by semantic value while preserving other game spellings", () => {
    const corpus = corpusOf(`
      one = { mode = "foo" enabled = yes count = 2 }
    `);
    expect([...(corpus.occurrences.get("mode")?.values ?? [])]).toEqual(["foo"]);
    expect([...(corpus.occurrences.get("enabled")?.values ?? [])]).toEqual(["yes"]);
    expect([...(corpus.occurrences.get("count")?.values ?? [])]).toEqual(["2"]);
  });
});

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

describe("descent below a spliced block", () => {
  // `planet.count = { min = int max = int }` — the one shape the splice walk
  // could not see, since it recorded a leaf's key and stopped there.
  const COUNT: DescentNode = { field: "count", mode: "struct", children: [] };
  const DEEP_MOON: SpliceMember = { key: "moon", members: () => [DEEP_MOON], descents: [COUNT] };
  const DEEP_PLANET: SpliceMember = {
    key: "planet",
    members: () => [DEEP_PLANET, DEEP_MOON],
    descents: [COUNT],
  };
  const spliced = (contents: string) => corpusOf(contents, [], null, [DEEP_PLANET]);

  it("records the block's entries under the member key", () => {
    const corpus = spliced(`
      one = { planet = { count = { min = 1 max = 3 } } }
    `);
    // The owning key keeps its own occurrence, as at every other descent.
    expect(corpus.occurrences.get("planet.count")?.definitions).toBe(1);
    expect([...(corpus.occurrences.get("planet.count.min")?.values ?? [])]).toEqual(["1"]);
    expect([...(corpus.occurrences.get("planet.count.max")?.values ?? [])]).toEqual(["3"]);
  });

  it("aggregates the interior across depths, as the one field table does", () => {
    const corpus = spliced(`
      one = {
        planet = {
          count = { min = 1 }
          planet = { count = { max = 3 } }
          moon = { count = { min = 2 } }
        }
      }
    `);
    expect(corpus.occurrences.get("planet.count.min")?.definitions).toBe(1);
    expect(corpus.occurrences.get("planet.count.max")?.definitions).toBe(1);
    // A moon is its own category with its own table, so its interior is its own
    // path — the aggregation is per member key, not across the whole tree.
    expect(corpus.occurrences.get("moon.count.min")?.definitions).toBe(1);
  });

  it("treats each interior block as its own arity boundary", () => {
    const corpus = spliced(`
      one = { planet = { count = { min = 1 } } planet = { count = { min = 2 } } }
      two = { planet = { count = { min = 1 min = 2 } } }
    `);
    expect(corpus.occurrences.get("planet.count.min")?.definitions).toBe(2);
    expect(corpus.occurrences.get("planet.count.min")?.repeated).toBe(1);
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

describe("file layout", () => {
  it("propagates an unreadable registry path instead of treating it as empty", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pdx-corpus-"));
    // A regular-file parent reliably makes readdirSync report ENOTDIR on both macOS and Linux,
    // without depending on platform-specific permission handling.
    const regularFile = path.join(root, "not-a-directory");
    writeFileSync(regularFile, "", "utf8");

    expect(() =>
      readRegistryCorpus(root, {
        registry: "system",
        registryPath: "not-a-directory/registry",
        keyword: null,
        nameField: null,
      })
    ).toThrowError(expect.objectContaining({ code: "ENOTDIR" }));
  });

  it("returns an empty corpus for a genuinely absent registry directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pdx-corpus-"));

    const corpus = readRegistryCorpus(root, {
      registry: "system",
      registryPath: "missing/registry",
      keyword: null,
      nameField: null,
    });

    expect(corpus).toEqual({ definitions: 0, files: 0, occurrences: new Map() });
  });

  // A registry whose files are not `.txt` reads as an empty directory rather
  // than as an unread one, so the extension has to reach the reader or the
  // conformance evidence for it is vacuous.
  it("reads the files carrying the registry's own extension and no others", () => {
    const corpus = corpusOfFiles(
      {
        "sprites.gfx": "one = { name = a }\ntwo = { name = b }",
        "readme.txt": "three = { name = c }",
      },
      { extension: ".gfx" }
    );
    expect(corpus.files).toBe(1);
    expect(corpus.definitions).toBe(2);
    expect([...(corpus.occurrences.get("name")?.values ?? [])]).toEqual(["a", "b"]);
  });

  it("counts nothing when the extension does not match", () => {
    const corpus = corpusOfFiles({ "sprites.gfx": "one = { name = a }" }, { extension: ".txt" });
    expect(corpus.files).toBe(0);
    expect(corpus.definitions).toBe(0);
  });

  // `skip_root_key = spriteTypes`: the definitions are the children of the
  // root block, and the root block itself is not one of them.
  it("descends one level into a named root block", () => {
    const corpus = corpusOfFiles(
      { "sprites.gfx": "spriteTypes = { one = { name = a } two = { name = b } }" },
      { extension: ".gfx", skipRootKeys: ["spriteTypes"] }
    );
    expect(corpus.definitions).toBe(2);
    expect(corpus.occurrences.get("name")?.definitions).toBe(2);
  });

  it("does not count a top-level entry belonging to no named root block", () => {
    const corpus = corpusOfFiles(
      {
        "sprites.gfx": "spriteTypes = { one = { name = a } }\nobjectTypes = { two = { name = b } }",
      },
      { extension: ".gfx", skipRootKeys: ["spriteTypes"] }
    );
    expect(corpus.definitions).toBe(1);
    expect([...(corpus.occurrences.get("name")?.values ?? [])]).toEqual(["a"]);
  });

  it("descends into every top-level block when the one segment is `any`", () => {
    const corpus = corpusOfFiles(
      {
        "sprites.gfx": "spriteTypes = { one = { name = a } }\nobjectTypes = { two = { name = b } }",
      },
      { extension: ".gfx", skipRootKeys: ["any"] }
    );
    expect(corpus.definitions).toBe(2);
    expect([...(corpus.occurrences.get("name")?.values ?? [])]).toEqual(["a", "b"]);
  });

  // `swapped_job`'s `skip_root_key = { any swappable_data }`: the segments are
  // successive levels, not alternatives. Applying them at one level would count
  // each job's `swappable_data` container as a definition and measure the swaps
  // inside it as that definition's fields.
  it("applies a multi-segment root key as successive levels", () => {
    const corpus = corpusOfFiles(
      {
        "jobs.txt": `
          some_job = {
            category = planet
            swappable_data = { swap_a = { name = a } swap_b = { name = b } }
          }
          other_job = { category = planet }
        `,
      },
      { skipRootKeys: ["any", "swappable_data"] }
    );
    expect(corpus.definitions).toBe(2);
    expect([...(corpus.occurrences.get("name")?.values ?? [])]).toEqual(["a", "b"]);
    // Neither the job's own fields nor the container that holds the swaps.
    expect(corpus.occurrences.has("category")).toBe(false);
    expect(corpus.occurrences.has("swappable_data")).toBe(false);
  });
});

describe("nested directories", () => {
  // `interface/` and `gfx/models/` both nest, and both are manifested. A reader
  // that walked one level flat measured `spriteType` from four of its 131 files
  // and `pdxmesh` from four of its 301 — a coverage number over a fraction of
  // the corpus, indistinguishable from a green one.
  it("counts definitions in nested directories", () => {
    const corpus = corpusOfFiles(
      {
        "top.gfx": "one = { name = a }",
        "nested/inner.gfx": "two = { name = b }",
        "nested/deeper/still.gfx": "three = { name = c }",
      },
      { extension: ".gfx" }
    );
    expect(corpus.files).toBe(3);
    expect(corpus.definitions).toBe(3);
    // Entry order is the walk's: each directory's names sorted, descending as
    // it meets them, so `nested/deeper/still.gfx` precedes `nested/inner.gfx`
    // and both precede `top.gfx`. Only its stability matters — the capped value
    // sample keeps whichever scalars arrive first, and the result is committed.
    expect([...(corpus.occurrences.get("name")?.values ?? [])]).toEqual(["c", "b", "a"]);
  });

  it("stops at the registry's own directory when the rules declare path_strict", () => {
    // `common/technology/tier` and `common/technology/category` are two other
    // CWT types. Descending would measure their bodies as technology fields.
    const corpus = corpusOfFiles(
      {
        "top.txt": "one = { name = a }",
        "tier/00_tiers.txt": "two = { name = b }",
      },
      { pathStrict: true }
    );
    expect(corpus.files).toBe(1);
    expect(corpus.definitions).toBe(1);
    expect([...(corpus.occurrences.get("name")?.values ?? [])]).toEqual(["a"]);
  });
});

describe("audited key casing", () => {
  // Enforced only for the registries `casing.ts` gives a table, which today is
  // the three `.gfx` ones — every `common/` registry is read exactly as written.
  const SPRITE_LAYOUT: RegistryLayout = { extension: ".gfx", skipRootKeys: ["spriteTypes"] };
  const spriteCorpus = (files: Readonly<Record<string, string>>) =>
    corpusOfFiles(files, SPRITE_LAYOUT, {
      registry: "spriteType",
      keyword: "spriteType",
      nameField: "name",
      spliceMembers: [],
    });

  it("merges an audited field-key variant into the canonical observation", () => {
    // 6,141 `texturefile` against 1,740 `textureFile` in the shipped files.
    // Read apart they are two half-counted fields, one of which the emitted
    // interface cannot express.
    const corpus = spriteCorpus({
      "a.gfx": "spriteTypes = { spriteType = { name = a texturefile = one.dds } }",
      "b.gfx": "spriteTypes = { spriteType = { name = b textureFile = two.dds } }",
    });
    expect(corpus.definitions).toBe(2);
    expect(corpus.occurrences.get("textureFile")?.definitions).toBe(2);
    expect(corpus.occurrences.has("texturefile")).toBe(false);
  });

  it("merges an audited keyword variant, so the definitions are counted", () => {
    // 77 of vanilla's sprites are written `SpriteType`.
    const corpus = spriteCorpus({
      "a.gfx": "spriteTypes = { SpriteType = { name = a } spriteType = { name = b } }",
    });
    expect(corpus.definitions).toBe(2);
  });

  it("folds a variant written inside a descended block", () => {
    // `animationtexturefile` is written 575 times and the rules' own
    // `animationtextureFile` zero times, one level inside `animation`.
    const corpus = corpusOfFiles(
      {
        "a.gfx":
          "spriteTypes = { spriteType = { name = a " +
          "animation = { animationtexturefile = one.dds } } }",
      },
      SPRITE_LAYOUT,
      {
        registry: "spriteType",
        keyword: "spriteType",
        nameField: "name",
        spliceMembers: [],
        descents: [{ field: "animation", mode: "struct", children: [] }],
      }
    );
    expect(corpus.occurrences.get("animation.animationtextureFile")?.definitions).toBe(1);
    expect(corpus.occurrences.has("animation.animationtexturefile")).toBe(false);
  });

  it("throws on a near-miss nobody audited, naming the registry, file, and key", () => {
    expect(() =>
      spriteCorpus({
        "a.gfx": "spriteTypes = { spriteType = { name = a textureFile = one.dds } }",
        "b.gfx": "spriteTypes = { spriteType = { name = b TEXTUREFILE = two.dds } }",
      })
    ).toThrow(/spriteType: b\.gfx writes "TEXTUREFILE".*"textureFile"/s);
  });

  it("throws on a near-miss of a key that is only in the corpus, not in the table", () => {
    // `noOfFrames` is not an audited entry — the game writes it one way. A
    // second spelling of it is still a near-miss and still has to be reviewed.
    expect(() =>
      spriteCorpus({
        "a.gfx": "spriteTypes = { spriteType = { name = a noOfFrames = 2 } }",
        "b.gfx": "spriteTypes = { spriteType = { name = b noofframes = 3 } }",
      })
    ).toThrow(/spriteType: b\.gfx writes "noofframes"/);
  });

  it("leaves an unrelated key of a sibling type in the same directory alone", () => {
    // `interface/` also holds `bitmapfonts` blocks. A casing decision about
    // another type's keys is not this registry's to make or to fail on.
    const corpus = spriteCorpus({
      "a.gfx": "spriteTypes = { spriteType = { name = a } } bitmapfonts = { x = { name = f } }",
      "b.gfx": "BitmapFonts = { x = { name = g } }",
    });
    expect(corpus.definitions).toBe(1);
  });

  it("reads a registry with no casing table exactly as written", () => {
    const corpus = corpusOfFiles({
      "a.txt": "one = { textureFile = x }",
      "b.txt": "two = { texturefile = y }",
    });
    expect(corpus.occurrences.get("textureFile")?.definitions).toBe(1);
    expect(corpus.occurrences.get("texturefile")?.definitions).toBe(1);
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

describe("descent below a repeated struct's entry", () => {
  // No shipped repeated-struct member lowers to a walkable block today, so
  // every case here is written rather than observed. That is the point: the
  // emitter now hands the reader whatever its members lower to, and a walk
  // that only ever ran against an empty child list would prove nothing about
  // what happens when one arrives.
  const chance = (children: DescentNode[] = []): DescentNode => ({
    field: "chance",
    mode: "struct",
    children,
  });
  const STAGES: DescentNode = {
    field: "stages",
    mode: "repeatedStruct",
    keying: "container",
    children: [chance([{ field: "modifier", mode: "struct", children: [] }])],
  };
  const APPROACH: DescentNode = {
    field: "approach",
    mode: "repeatedStruct",
    keying: "siblings",
    identityKey: "name",
    children: [chance([{ field: "modifier", mode: "struct", children: [] }])],
  };

  it("walks two levels below an id-keyed entry", () => {
    const corpus = corpusOf(
      `
      one = { stages = { stage_1 = { chance = { base = 2 modifier = { factor = 3 } } } } }
    `,
      [STAGES]
    );
    expect(corpus.occurrences.get("stages.chance.base")?.definitions).toBe(1);
    expect(corpus.occurrences.get("stages.chance.modifier.factor")?.definitions).toBe(1);
  });

  it("walks two levels below a siblings-keyed entry", () => {
    const corpus = corpusOf(
      `
      one = { approach = { name = approach_a chance = { base = 2 modifier = { factor = 3 } } } }
    `,
      [APPROACH]
    );
    expect(corpus.occurrences.get("approach.chance.base")?.definitions).toBe(1);
    expect(corpus.occurrences.get("approach.chance.modifier.factor")?.definitions).toBe(1);
  });

  it("skips the identity key only at the entry's own level", () => {
    // `name` is identity for an `approach`, and an ordinary field for anything
    // written inside one. Skipping it everywhere would hide a real interior.
    const corpus = corpusOf(
      `
      one = { approach = { name = approach_a chance = { name = inner base = 2 } } }
    `,
      [APPROACH]
    );
    expect(corpus.occurrences.has("approach.name")).toBe(false);
    expect(corpus.occurrences.get("approach.chance.name")?.definitions).toBe(1);
  });

  it("treats each inner block as its own arity boundary", () => {
    const corpus = corpusOf(
      `
      one = { stages = { stage_1 = { chance = { base = 2 } } stage_2 = { chance = { base = 3 } } } }
      two = { stages = { stage_1 = { chance = { base = 2 base = 3 } } } }
    `,
      [STAGES]
    );
    expect(corpus.occurrences.get("stages.chance.base")?.definitions).toBe(2);
    expect(corpus.occurrences.get("stages.chance.base")?.repeated).toBe(1);
  });
});

describe("weight-modifier descent", () => {
  // The real strip set: `modifier_rule.cwt`'s two maths enums plus `desc`.
  // Abbreviated to the members these cases write.
  const STRIPPED = new Set(["add", "factor", "mult", "round", "desc"]);
  const AI_WEIGHT: DescentNode = {
    field: "ai_weight",
    mode: "weightModifiers",
    strippedKeys: STRIPPED,
    children: [],
  };

  it("records a row's gating keys and nothing the operations own", () => {
    const corpus = corpusOf(
      `
      one = {
        ai_weight = {
          base = 1
          modifier = { factor = 2 desc = some_key is_country_type = default }
        }
      }
    `,
      [AI_WEIGHT]
    );
    expect([...(corpus.occurrences.get("ai_weight.modifier")?.keys ?? [])]).toEqual([
      "is_country_type",
    ]);
    // The weight block's own members stay where the top-level observation
    // already sees them: descending them would invent interior paths the
    // emitter never claimed, since a weight block has no CWT fields table.
    expect(corpus.occurrences.has("ai_weight.base")).toBe(false);
    expect(corpus.occurrences.has("ai_weight.modifier.factor")).toBe(false);
  });

  it("keeps each definition's own condition set apart", () => {
    // What the per-definition scope check reads: two definitions that each pick
    // one scope are not one definition that mixed them.
    const corpus = corpusOf(
      `
      one = { ai_weight = { modifier = { add = 1 is_capital = yes } } }
      two = { ai_weight = { modifier = { add = 1 has_ship_flag = x } } }
    `,
      [AI_WEIGHT]
    );
    expect(
      corpus.occurrences.get("ai_weight.modifier")?.keysByDefinition.map((keys) => [...keys])
    ).toEqual([["is_capital"], ["has_ship_flag"]]);
  });

  it("counts an ungated row as an occurrence with no keys", () => {
    // 159 shipped definitions write a row with no condition. The row is still
    // evidence that the
    // path exists — it just says nothing about which scope it runs in.
    const corpus = corpusOf(
      `
      one = { ai_weight = { modifier = { factor = 0 } } }
    `,
      [AI_WEIGHT]
    );
    const observation = corpus.occurrences.get("ai_weight.modifier");
    expect(observation?.definitions).toBe(1);
    expect(observation?.keys.size).toBe(0);
    expect(observation?.emptyBlocks).toBe(1);
  });

  it("treats one weight block as the arity boundary", () => {
    const corpus = corpusOf(
      `
      one = {
        ai_weight = { modifier = { factor = 2 always = yes } }
        ai_weight = { modifier = { factor = 3 always = yes } }
      }
      two = {
        ai_weight = {
          modifier = { factor = 2 always = yes }
          modifier = { factor = 3 always = no }
        }
      }
    `,
      [AI_WEIGHT]
    );
    expect(corpus.occurrences.get("ai_weight.modifier")?.definitions).toBe(2);
    expect(corpus.occurrences.get("ai_weight.modifier")?.repeated).toBe(1);
  });

  it("leaves the sibling row kinds alone", () => {
    // A `complex_trigger_modifier`'s members are its own shape, not conditions,
    // and reading them through the modifier filter would report `mode` and
    // `trigger` as trigger keys. Tracked separately as SDK-82.
    const corpus = corpusOf(
      `
      one = {
        ai_weight = {
          complex_trigger_modifier = { trigger = count_owned_pops mode = add }
          scaled_modifier = { scope = owner calc = pop_amount factor = 2 }
        }
      }
    `,
      [AI_WEIGHT]
    );
    expect(corpus.occurrences.has("ai_weight.modifier")).toBe(false);
    expect(corpus.occurrences.has("ai_weight.complex_trigger_modifier")).toBe(false);
  });
});

describe("triggered-modifier potential descent", () => {
  const TRIGGERED_MODIFIER: DescentNode = {
    field: "triggered_modifier",
    mode: "triggeredModifierPotential",
    children: [],
  };

  it("records only potential conditions, not modifier names", () => {
    const corpus = corpusOf(
      `
      one = {
        triggered_modifier = {
          potential = { is_capital = yes }
          country_unity_produces_add = 2
          modifier = { country_naval_cap_add = 5 }
        }
      }
    `,
      [TRIGGERED_MODIFIER]
    );
    expect([...(corpus.occurrences.get("triggered_modifier.potential")?.keys ?? [])]).toEqual([
      "is_capital",
    ]);
    expect(corpus.occurrences.has("triggered_modifier.country_unity_produces_add")).toBe(false);
    expect(corpus.occurrences.has("triggered_modifier.modifier")).toBe(false);
  });

  it("preserves a scalar potential for shape conformance", () => {
    const corpus = corpusOf(
      `
      one = {
        triggered_modifier = { potential = yes }
      }
    `,
      [TRIGGERED_MODIFIER]
    );
    const potential = corpus.occurrences.get("triggered_modifier.potential");
    expect(potential?.scalars).toBe(1);
    expect(potential?.blocks).toBe(0);
    expect([...potential!.values]).toEqual(["yes"]);
  });

  it("measures potential arity per triggered-modifier row", () => {
    const corpus = corpusOf(
      `
      one = {
        triggered_modifier = { potential = { always = yes } }
        triggered_modifier = { potential = { always = yes } }
      }
      two = {
        triggered_modifier = {
          potential = { always = yes }
          potential = { always = no }
        }
      }
    `,
      [TRIGGERED_MODIFIER]
    );
    const potential = corpus.occurrences.get("triggered_modifier.potential");
    expect(potential?.definitions).toBe(2);
    expect(potential?.repeated).toBe(1);
  });
});

/** Every path a descent tree records under, rooted at `prefix`. */
function descentPaths(nodes: readonly DescentNode[], prefix: string): string[] {
  return nodes.flatMap((node) => {
    const path = prefix === "" ? node.field : `${prefix}.${node.field}`;
    return [path, ...descentPaths(node.children, path)];
  });
}

describe("the emitter's descent channel", () => {
  const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));
  const emitter = new Emitter(rules);
  const emitRegistry = (registry: string) => {
    emitter.beginFile();
    const emitted = emitContentType(
      emitter,
      rules.contentTypes.get(registry)!,
      rules.bodies.get(registry)!,
      registry
    );
    emitter.endFile();
    return emitted;
  };
  const emission = emitRegistry("war_goal");

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

  it("describes a weight block's modifier rows on both sides", () => {
    // A weight block has no CWT fields table, so its interior is stated by the
    // lowering rather than derived from one. Both halves are asserted together
    // for the same reason every other descent is: a descent whose emitted field
    // does not exist reports an interior nothing claims to author.
    const emitted = emitRegistry("tradition");
    const descent = emitted.corpusDescents.find((node) => node.field === "ai_weight");
    expect(descent?.mode).toBe("weightModifiers");
    // The strip set is the grammar's own — both maths enums plus `desc` — not a
    // hand-kept list, so what survives it is exactly the spliced trigger.
    expect(descent?.strippedKeys?.has("factor")).toBe(true);
    expect(descent?.strippedKeys?.has("round")).toBe(true);
    expect(descent?.strippedKeys?.has("desc")).toBe(true);
    expect(descent?.strippedKeys?.has("is_country_type")).toBe(false);
    const row = emitted.nestedEmittedFields.find(
      (field) => field.field === "tradition.ai_weight.modifier"
    );
    expect(row).toEqual({
      field: "tradition.ai_weight.modifier",
      authoredPath: ["aiWeight"],
      shape: "weightModifier",
      repeated: true,
      clause: "trigger",
      // The holder's scope: `Modifier.when` is a `Trigger<S>` at whatever S the
      // weight block itself was lowered at.
      scope: ["country"],
    });
  });

  it("describes a triggered modifier's potential on both sides", () => {
    const emitted = emitRegistry("building");
    expect(emitted.corpusDescents).toContainEqual({
      field: "triggered_country_modifier",
      mode: "triggeredModifierPotential",
      children: [],
    });
    expect(emitted.nestedEmittedFields).toContainEqual({
      field: "building.triggered_country_modifier.potential",
      authoredPath: ["triggeredCountryModifier"],
      shape: "trigger",
      repeated: false,
      clause: "trigger",
      scope: ["planet"],
    });
  });

  it("claims a field at every level of a repeated struct's descent tree", () => {
    // `situation_type` is the registry with both repeated-struct keyings. Its
    // entries' members all lower to leaf shapes today, so the tree below them
    // is empty — the assertion is on the wiring, which is what would have to
    // hold the moment a member lowers to a block worth walking.
    const emitted = emitRegistry("situation_type");
    const claimed = new Set([
      ...emitted.emittedFields.map((field) => field.field),
      ...emitted.nestedEmittedFields.map((field) => field.field.slice("situation_type.".length)),
    ]);
    expect(descentPaths(emitted.corpusDescents, "").filter((p) => !claimed.has(p))).toEqual([]);
  });
});

describe("the splice emitter's descent channel", () => {
  const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));
  const emitter = new Emitter(rules);
  emitter.beginFile();
  const emission = emitAliasSplice(emitter, "planet_initializer")!;
  emitter.endFile();

  it("reports a member's block interior, rooted at the member key", () => {
    // `count = { min = int max = int }` beside the scalar `count = int`: the
    // block arm of a dual, whose interior 289 solar system initializers write
    // and no side of the gate could see.
    const emitted = emission.emittedFields.map((field) => field.field);
    expect(emitted).toContain("planet.count");
    expect(emitted).toContain("planet.count.min");
    expect(emitted).toContain("planet.count.max");
    // Rooted at the member key, not the category: one prefix, and the one the
    // corpus reader walks under.
    expect(emitted.filter((field) => field.startsWith("planet_initializer"))).toEqual([]);
  });

  it("configures the reader for the same fields it lowered", () => {
    expect(emission.corpusDescents).toContainEqual({
      field: "count",
      mode: "struct",
      children: [],
    });
    const claimed = new Set(emission.emittedFields.map((field) => field.field));
    const paths = descentPaths(emission.corpusDescents, emission.memberKey);
    expect(paths.filter((path) => !claimed.has(path))).toEqual([]);
  });
});

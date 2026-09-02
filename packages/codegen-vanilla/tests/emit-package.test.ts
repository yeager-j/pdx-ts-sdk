/**
 * Emission policy, measured against facts assembled in memory.
 *
 * Everything here used to need a fixture install on disk, because generation
 * took a directory and read it. It takes {@link VanillaBuildFacts} now, so the
 * questions that are really about *policy* — which registries must ship a
 * runtime membership set, which get a trie, what an empty one emits — can be
 * asked directly, with the facts the question needs and nothing else.
 *
 * That is worth more than the convenience. Two of the refusals below have no
 * fixture that reaches them: a fixture install either defines a mint-shaped
 * registry or fails much earlier, so "the facts do not carry a registry the SDK
 * needs a runtime set for" was unreachable evidence until the input became a
 * value.
 */

import type { EventKindSpec } from "@pdx-ts/codegen-cwt/lower/event-kinds";
import { describe, expect, it } from "vitest";

import { emitVanillaPackage } from "../src/emit-package.ts";
import { RUNTIME_ENUM_SET_NAMES, RUNTIME_ID_SET_REGISTRIES } from "../src/manifest.ts";
import type { RegistryBuildFacts, VanillaBuildFacts } from "../src/read-facts.ts";
import type { ScriptedRegistry } from "../src/read-scripted.ts";
import type { BucketLayout } from "../src/trie.ts";

const GAME_VERSION = "4.4.6";

/** A 64-character stand-in, so an emitted hash is shaped like a real one. */
const FAKE_SHA = "0".repeat(64);

function scriptedRegistry(registry: string): ScriptedRegistry {
  return { registry, definitions: [], files: 0, diagnostics: 0, missing: false };
}

/**
 * One registry's facts: where it lives, and what was found there.
 *
 * The source path per id is what the trie navigates by, so it is derived from
 * the id rather than left out — a bucket layout cannot be exercised without it.
 */
function registry(
  name: string,
  ids: readonly string[],
  options: { readonly oversized?: boolean; readonly bucket?: BucketLayout } = {}
): RegistryBuildFacts {
  return {
    spec: {
      registry: name,
      referenceName: name,
      path: `common/${name}`,
      extension: ".txt",
      keyword: null,
      nameField: null,
      skipRootKey: null,
      keyFilter: null,
      excludedKey: null,
      pathStrict: false,
      bucket: options.bucket ?? "stripped-file",
      oversized: options.oversized ?? false,
      subtypeProjections: [],
    },
    read: {
      registry: name,
      ids: [...ids],
      files: 1,
      diagnostics: 0,
      missing: false,
      sourcePaths: new Map(ids.map((id) => [id, `00_${id}.txt`])),
      subtypeProjections: [],
    },
  };
}

/**
 * A build's facts, complete enough to emit and no more.
 *
 * The runtime sets the SDK requires are present by default, because their
 * absence is its own refusal and every other test here would otherwise trip
 * over it first.
 */
function facts(overrides: Partial<VanillaBuildFacts> = {}): VanillaBuildFacts {
  return {
    formatVersion: 1,
    gameVersion: GAME_VERSION,
    evidence: {
      install: { sha256: FAKE_SHA },
      cwt: { version: "a".repeat(40), sha256: FAKE_SHA },
      docs: { version: "4.4.1", sha256: FAKE_SHA },
    },
    eventKinds: [] as readonly EventKindSpec[],
    events: {
      definitions: [],
      sourceFiles: [],
      path: "events",
      extension: ".txt",
      files: 0,
      diagnostics: 0,
      missing: false,
    },
    registries: RUNTIME_ID_SET_REGISTRIES.map((name) => registry(name, [])),
    complexEnums: RUNTIME_ENUM_SET_NAMES.map((name) => ({
      name,
      members: [],
      files: 1,
      selectorFiles: 1,
      diagnostics: 0,
      missing: false,
      gaps: [],
    })),
    scripted: {
      trigger: scriptedRegistry("scripted_trigger"),
      effect: scriptedRegistry("scripted_effect"),
    },
    inferredScopes: { trigger: [], effect: [] },
    paths: { paths: [], installFiles: 0, archives: 0, archiveEntries: 0, junkExcluded: 0 },
    localization: { keys: [], files: 0, unparsedLines: 0, gaps: [], missing: false },
    ...overrides,
  };
}

describe("emitVanillaPackage extraction gaps", () => {
  it("refuses to publish an exact-membership enum with no selector-bearing source files", () => {
    const complexEnums = facts().complexEnums.map((one) => ({
      ...one,
      members: [],
      files: 1,
      selectorFiles: 0,
      missing: false,
    }));

    expect(() => emitVanillaPackage(facts({ complexEnums }))).toThrow(
      /refusing to emit: 1 exact-membership complex enum has no selector-bearing source files:[\s\S]*component_tag/
    );
  });

  it("emits a proven empty enum after reading its matching source files", () => {
    const complexEnums = facts().complexEnums.map((one) => ({
      ...one,
      members: [],
    }));

    expect(() => emitVanillaPackage(facts({ complexEnums }))).not.toThrow();
  });

  it("emits the reviewed map-scenario exception when no file reaches its selector", () => {
    const complexEnums = [
      ...facts().complexEnums,
      {
        name: "map_setup_scenario_system_id",
        members: [],
        files: 6,
        selectorFiles: 0,
        diagnostics: 0,
        missing: false,
        gaps: [],
      },
    ];

    expect(() => emitVanillaPackage(facts({ complexEnums }))).not.toThrow();
  });

  it("refuses to publish an enum union a reader came back short of", () => {
    const complexEnums = facts().complexEnums.map((one) => ({
      ...one,
      gaps: [
        { inventory: one.name, source: "common/fake/00_broken.txt", detail: "unterminated string" },
      ],
    }));

    expect(() => emitVanillaPackage(facts({ complexEnums }))).toThrow(
      /refusing to emit: 1 gap[\s\S]*00_broken\.txt\): unterminated string/
    );
  });

  it("refuses to publish a localization inventory a reader came back short of", () => {
    expect(() =>
      emitVanillaPackage(
        facts({
          localization: {
            keys: ["KEPT"],
            files: 1,
            unparsedLines: 1,
            gaps: [
              {
                inventory: "localization",
                source: "localisation/english/keys.yml",
                detail: "1 line names neither a key nor a language header, first at line 3",
              },
            ],
            missing: false,
          },
        })
      )
    ).toThrow(/refusing to emit: 1 gap[\s\S]*localisation\/english\/keys\.yml/);
  });

  it("names every gap, not just the first", () => {
    // After a game patch the useful question is what shape of input the readers
    // stopped recognising, and one example rarely shows it.
    const complexEnums = facts().complexEnums.map((one) => ({
      ...one,
      gaps: [
        { inventory: one.name, source: "a.txt", detail: "first" },
        { inventory: one.name, source: "b.txt", detail: "second" },
      ],
    }));

    expect(() => emitVanillaPackage(facts({ complexEnums }))).toThrow(
      /refusing to emit: 2 gaps[\s\S]*a\.txt\): first[\s\S]*b\.txt\): second/
    );
  });

  it("emits when every inventory was read whole", () => {
    expect(() => emitVanillaPackage(facts())).not.toThrow();
  });
});

describe("emitVanillaPackage runtime sets", () => {
  it("refuses to emit when the facts carry no registry a runtime id set needs", () => {
    // An empty set would not fail the build — it would silently stop refusing
    // minted-name collisions for that registry, which is the one thing the set
    // exists to do.
    expect(() => emitVanillaPackage(facts({ registries: [] }))).toThrow(
      new RegExp(`"${RUNTIME_ID_SET_REGISTRIES[0]!}" needs a runtime id set`)
    );
  });

  it("refuses to emit when the facts carry no enum a runtime set needs", () => {
    expect(() => emitVanillaPackage(facts({ complexEnums: [] }))).toThrow(
      new RegExp(`"${RUNTIME_ENUM_SET_NAMES[0]}" needs a runtime enum set`)
    );
  });

  it("covers every mint-shaped registry, and only those", () => {
    const { files } = emitVanillaPackage(facts());
    const listed = [...files.get("gfx-ids.ts")!.matchAll(/^ {2}"([^"]+)":/gm)].map(
      (match) => match[1]!
    );

    expect(listed).toEqual([...RUNTIME_ID_SET_REGISTRIES]);
  });
});

describe("emitVanillaPackage trie policy", () => {
  const ids = ["tech_a", "tech_b", "tech_c"];

  it("gives a registry more ids than the threshold a trie", () => {
    const { files, report } = emitVanillaPackage(
      facts({ registries: [...facts().registries, registry("technology", ids)] }),
      { trieThreshold: 2 }
    );

    expect(files.has("registries/technology/index.ts")).toBe(true);
    expect(report.registries.find((one) => one.registry === "technology")?.trie).toMatchObject({
      buckets: 3,
      rootLeaves: 0,
      flatOnly: 0,
    });
  });

  it("leaves a registry at the threshold flat", () => {
    // Strictly greater, not greater-or-equal. A registry that exactly meets the
    // threshold still fits one completion menu.
    const { files, report } = emitVanillaPackage(
      facts({ registries: [...facts().registries, registry("technology", ids)] }),
      { trieThreshold: 3 }
    );

    expect(files.has("registries/technology/index.ts")).toBe(false);
    expect(report.registries.find((one) => one.registry === "technology")?.trie).toBeNull();
  });

  it("gives an explicitly oversized registry a trie whatever its current count", () => {
    // The count is what a registry happens to hold today; `oversized` is a
    // statement about the registry, and a game patch must not silently take a
    // published trie away by shipping fewer ids.
    const { files } = emitVanillaPackage(
      facts({
        registries: [...facts().registries, registry("technology", ids, { oversized: true })],
      }),
      { trieThreshold: 1000 }
    );

    expect(files.has("registries/technology/index.ts")).toBe(true);
  });
});

describe("emitVanillaPackage", () => {
  it("emits an empty registry as never rather than omitting it", () => {
    const { files } = emitVanillaPackage(
      facts({ registries: [...facts().registries, registry("technology", [])] })
    );

    expect(files.get("registries/technology.ts")).toContain("= never;");
  });

  it("stamps the game version the facts carry, not one passed beside them", () => {
    const { files, report } = emitVanillaPackage(facts({ gameVersion: "9.9.9" }));

    expect(report.gameVersion).toBe("9.9.9");
    expect(files.get("index.ts")).toContain("from Stellaris 9.9.9");
  });

  it("is a function of its facts: one value in, one set of bytes out", () => {
    // The property the split exists for. Before it, generation took a directory
    // and this could only be checked by reading that directory twice and hoping
    // nothing else had moved.
    const one = facts();
    const first = emitVanillaPackage(one);
    const second = emitVanillaPackage(one);

    expect([...second.files]).toEqual([...first.files]);
    expect(second.report.identifiersChecked).toBe(first.report.identifiersChecked);
  });
});

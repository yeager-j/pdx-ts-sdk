/**
 * Parsing, normalization and `@variable` resolution on their own, without a
 * `VanillaView`: every claim here is about what one file states, so the
 * failures are readable at the source that caused them rather than at a whole
 * load.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import {
  normalizeSources,
  parseStrict,
  readDefinition,
  registryOfPath,
  variableTables,
} from "../../src/stellaris/vanilla/parse.ts";
import {
  ParsedDefinition,
  ParsedTechnology,
} from "../../src/stellaris/vanilla/parsed-definitions.ts";
import { viewFromFiles } from "../../src/stellaris/vanilla/view.ts";

const TECH_PATH = "common/technology/pp_tech.txt";
const VARS_PATH = "common/scripted_variables/pp_vars.txt";

/** A view over no files: `readDefinition` only stores its `origin`. */
const ORIGIN = viewFromFiles({});

/** Reads one file's only definition the way a view would, without building one. */
function readOnlyDefinition(path: string, text: string): ParsedDefinition {
  const sources = normalizeSources([parseStrict(path, text)]);
  const source = sources[0]!;
  const { vars } = variableTables(sources);
  const entry = source.items.find(
    (item): item is PdxEntry => item.kind === "entry" && !item.key.startsWith("@")
  )!;
  return readDefinition(entry, source, registryOfPath(source.path)!, ORIGIN, vars);
}

function readOnlyTechnology(text: string): ParsedTechnology {
  const definition = readOnlyDefinition(TECH_PATH, text);
  expect(definition).toBeInstanceOf(ParsedTechnology);
  return definition as ParsedTechnology;
}

describe("parseStrict", () => {
  it("refuses input the parser had to repair, naming the file and the repair", () => {
    expect(() => parseStrict(TECH_PATH, "tech_pp = {\n\tarea = society\n")).toThrow(
      /pp_tech\.txt: parser repaired malformed input \(1: unclosed-at-eof\)/
    );
  });

  it("hashes the source when the caller states no hash", () => {
    expect(parseStrict(TECH_PATH, "tech_pp = {}\n").sha256).toBe(
      parseStrict("other.txt", "tech_pp = {}\n").sha256
    );
  });
});

describe("normalizeSources", () => {
  it("refuses a path outside this slice, naming the directories it parses", () => {
    expect(() => normalizeSources([parseStrict("events/pp_events.txt", "")])).toThrow(
      /Unsupported path events\/pp_events\.txt: this slice parses .*common\/technology.*common\/scripted_variables/
    );
  });

  it("returns the sources in logical path order", () => {
    const sources = normalizeSources([
      parseStrict("common/technology/01_late.txt", ""),
      parseStrict(VARS_PATH, ""),
      parseStrict("common/technology/00_early.txt", ""),
    ]);

    expect(sources.map((source) => source.path)).toEqual([
      VARS_PATH,
      "common/technology/00_early.txt",
      "common/technology/01_late.txt",
    ]);
  });
});

describe("variableTables", () => {
  const tables = () =>
    variableTables(
      normalizeSources([
        parseStrict(VARS_PATH, "@shared = 1\n@global_only = 7\n"),
        parseStrict(TECH_PATH, "@shared = 2\n@file_only = 3\n"),
      ])
    );

  it("lets a file-local @variable shadow the global of the same name", () => {
    const { vars } = tables();

    expect(vars.resolve("@shared", TECH_PATH, 1)).toBe(2);
    expect(vars.resolve("@shared", VARS_PATH, 1)).toBe(1);
  });

  it("treats only common/scripted_variables names as global", () => {
    const { global, locals } = tables();

    expect([...global.keys()]).toEqual(["@shared", "@global_only"]);
    expect([...(locals.get(TECH_PATH) ?? [])]).toEqual([
      ["@shared", 2],
      ["@file_only", 3],
    ]);
  });

  it("resolves a global from a file that does not declare it", () => {
    expect(tables().vars.resolve("@global_only", TECH_PATH, 4)).toBe(7);
  });

  it("names the file, the line and the defined names when a name is unknown", () => {
    expect(() => tables().vars.resolve("@nope", TECH_PATH, 12)).toThrow(
      /pp_tech\.txt:12: @nope is not defined in .* \(defined: @shared, @file_only, @shared, @global_only\)/
    );
  });
});

describe("readDefinition", () => {
  it("refuses a definition that is not a block", () => {
    expect(() => readOnlyDefinition(TECH_PATH, "tech_pp = 5\n")).toThrow(
      /pp_tech\.txt:1: technology tech_pp must be a block/
    );
  });

  it("refuses a body item that is not a key = value entry", () => {
    expect(() => readOnlyDefinition(TECH_PATH, "tech_pp = {\n\tloose_scalar\n}\n")).toThrow(
      /pp_tech\.txt:1: tech_pp must contain only key = value entries/
    );
  });

  it("reports an unknown @variable in a nested block at the nearest enclosing entry", () => {
    const text = "tech_pp = {\n\tarea = society\n\tmodifier = {\n\t\tsome_mod = @nope\n\t}\n}\n";

    expect(() => readOnlyDefinition(TECH_PATH, text)).toThrow(/pp_tech\.txt:4: @nope is not/);
  });

  it("gives a registry with no reader the plain tagged definition, body untouched", () => {
    const definition = readOnlyDefinition(
      "common/buildings/pp_buildings.txt",
      "building_pp = {\n\tcategory = pop_assembly\n\tpotential = { always = yes }\n}\n"
    );

    expect(definition).not.toBeInstanceOf(ParsedTechnology);
    expect(definition.registry).toBe("building");
    expect(definition.rest).toEqual(definition.body);
    expect(definition.rest.map((entry) => entry.key)).toEqual(["category", "potential"]);
    expect(definition.origin).toBe(ORIGIN);
  });
});

describe("the technology reader", () => {
  it("sends a block-valued cost to rest and leaves the field undefined", () => {
    const technology = readOnlyTechnology(
      "tech_pp = {\n\tarea = society\n\tcost = { factor = 2 }\n}\n"
    );

    expect(technology.cost).toBeUndefined();
    expect(technology.rest.map((entry) => entry.key)).toEqual(["cost"]);
  });

  it("refuses an area the game does not define", () => {
    expect(() => readOnlyTechnology("tech_pp = {\n\tarea = biology\n}\n")).toThrow(
      /pp_tech\.txt:2: area must be one of physics, society, engineering — got "biology"/
    );
  });

  it("reads an OR group in prerequisites as an AnyOf beside the plain refs", () => {
    const technology = readOnlyTechnology(
      "tech_pp = {\n\tarea = society\n\tprerequisites = { tech_a OR = { tech_b tech_c } }\n}\n"
    );

    expect(technology.prerequisites).toEqual([
      { id: "tech_a" },
      { kind: "any-of", options: [{ id: "tech_b" }, { id: "tech_c" }] },
    ]);
  });

  it("refuses an empty OR group rather than reading a prerequisite nothing satisfies", () => {
    expect(() =>
      readOnlyTechnology("tech_pp = {\n\tarea = society\n\tprerequisites = { OR = { } }\n}\n")
    ).toThrow(/pp_tech\.txt:3: empty OR group in prerequisites/);
  });
});

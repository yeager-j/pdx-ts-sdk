import { CONTENT_REGISTRIES } from "@pdx-ts/sdk/content-registries";
import { describe, expect, it } from "vitest";

import { buildFieldTable } from "../src/field-table.ts";

/**
 * The total-join gate: every registry's whole descriptor tree — nested tables
 * and alias categories included — must join the field-docs ledger without a
 * miss. `buildFieldTable` throws on any gap, so this test failing is the
 * drift signal, before any reference page renders the table.
 */
describe("buildFieldTable joins every registry", () => {
  for (const descriptor of CONTENT_REGISTRIES) {
    it(descriptor.type, () => {
      const model = buildFieldTable(descriptor.type);
      expect(model.rows.length).toBeGreaterThan(0);
      const ids = model.subTables.map((table) => table.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const row of [...model.rows, ...model.subTables.flatMap((table) => table.rows)]) {
        expect(row.type).not.toBe("");
      }
    });
  }
});

describe("buildFieldTable", () => {
  it("rejects a registry the SDK does not expose", () => {
    expect(() => buildFieldTable("no_such_registry")).toThrow(/No registry named/);
  });

  it("carries optionality, literals, and doc prose from the ledger", () => {
    const model = buildFieldTable("technology");
    const area = model.rows.find((row) => row.member === "area");
    expect(area?.optional).toBe(false);
    expect(area?.literals).toEqual(["physics", "society", "engineering"]);
    const tier = model.rows.find((row) => row.member === "tier");
    expect(tier?.optional).toBe(false);
  });

  it("carries reference targets from the descriptors", () => {
    const model = buildFieldTable("tradition_category");
    const adoption = model.rows.find((row) => row.member === "adoptionBonus");
    expect(adoption?.refTypes).toEqual(["tradition"]);
  });

  it("renders a repeated-struct member as a sub-table with its localisation", () => {
    const model = buildFieldTable("situation_type");
    const stages = model.rows.find((row) => row.member === "stages");
    expect(stages?.subTable).toBeDefined();
    const table = model.subTables.find((entry) => entry.id === stages?.subTable);
    expect(table?.rows.length).toBeGreaterThan(0);
    expect(table?.localisation?.length).toBeGreaterThan(0);
  });

  it("resolves an alias-struct member through its category", () => {
    const model = buildFieldTable("civic_or_origin");
    const potential = model.rows.find((row) => row.member === "potential");
    expect(potential?.subTable).toBe("government_trigger");
    const block = model.subTables.find((entry) => entry.id === "government_trigger");
    // The block's own combinators splice the category into itself; the shared
    // table must appear once, not recurse.
    expect(block?.rows.some((row) => row.subTable === "government_trigger")).toBe(true);
  });

  it("terminates on the mutually recursive planet/moon categories", () => {
    const model = buildFieldTable("solar_system_initializer");
    const planet = model.subTables.find((entry) => entry.id === "planet_initializer");
    expect(planet).toBeDefined();
    // The shared category table appears exactly once — its children
    // (`moon_initializer.count`, …) are their own tables, but no duplicate of
    // the category itself (`moon_initializer-2`) may exist.
    expect(model.subTables.some((entry) => entry.id === "moon_initializer")).toBe(true);
    expect(model.subTables.some((entry) => /^moon_initializer-\d+$/.test(entry.id))).toBe(false);
  });

  it("surfaces the omission rows of the alias categories a registry reaches", () => {
    const model = buildFieldTable("solar_system_initializer");
    const declined = model.omissions.filter((row) => row.kind === "declined");
    expect(declined.some((row) => row.path === "planet_initializer.change_orbit")).toBe(true);
  });

  it("omits game-token literals from boolean members", () => {
    // A boolean admits `yes`/`no` in script, but authors pass `true`/`false` —
    // printing the tokens would document strings that do not type-check.
    const model = buildFieldTable("situation_type");
    const permanent = model.rows.find((row) => row.member === "permanent");
    expect(permanent?.type).toBe("boolean");
    expect(permanent?.literals).toBeUndefined();
  });

  it("parenthesizes union element types in clause group arrays", () => {
    const model = buildFieldTable("civic_or_origin");
    const valuesRows = model.subTables
      .flatMap((table) => table.rows)
      .filter((row) => row.member === "values");
    expect(valuesRows.length).toBeGreaterThan(0);
    for (const row of valuesRows) {
      // `readonly (A | B)[]`, never the misparsed `readonly A | B[]`.
      expect(row.type).toMatch(/^readonly (\(.+\)|\S+)\[\]$/);
    }
  });

  it("keeps conditional requirements on nested localisation slots", () => {
    const model = buildFieldTable("tradition");
    const swap = model.rows.find((row) => row.member === "traditionSwap");
    const table = model.subTables.find((entry) => entry.id === swap?.subTable);
    const name = table?.localisation?.find((slot) => slot.member === "name");
    expect(name?.required).toBe(false);
    expect(name?.requiredUnless).toBe("inheritName");
  });

  it("marks a dual member once, under its shared authoring member", () => {
    const model = buildFieldTable("situation_type");
    const picture = [...model.rows, ...model.subTables.flatMap((table) => table.rows)].filter(
      (row) => row.member === "picture"
    );
    expect(picture.length).toBeGreaterThan(0);
    for (const row of picture) {
      expect(row.type).toContain(" | ");
    }
  });
});

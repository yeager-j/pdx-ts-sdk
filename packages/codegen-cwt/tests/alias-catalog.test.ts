/**
 * The generated alias catalog, rendered from the real rules.
 *
 * The catalog is what an `aliasStruct` field's category name resolves to at
 * write time, so the claims here are that every emitted category has a row,
 * that the rows import the tables the generated modules declare, and that a
 * field naming a category the worklist never emitted stops generation.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aliasCatalogCode,
  type AliasCatalogCategory,
} from "@pdx-ts/codegen-cwt/emit/content/alias-catalog";
import { emitAliasCategories } from "@pdx-ts/codegen-cwt/emit/content/alias-categories";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { Emitter } from "@pdx-ts/codegen-cwt/render/emitter";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));
const emitter = new Emitter(rules);
// The one unkeyed splice a content type seeds; `solar_system_initializer`
// contributes it during a real run, and the overlay rows seed the rest.
const { aliasCategories } = emitAliasCategories(emitter, rules, ["planet_initializer"]);

const categories: AliasCatalogCategory[] = [...aliasCategories].map(([category, emission]) => ({
  category,
  fieldsConstant: emission.fieldsConstant,
  module: `./${category.replaceAll("_", "-")}.ts`,
}));
const modules = [...aliasCategories].map(([category, emission]) => ({
  file: `${category.replaceAll("_", "-")}.ts`,
  code: emission.code,
}));
const catalog = aliasCatalogCode(categories, modules);

describe("the generated alias catalog", () => {
  it("holds a row for every category the worklist emitted", () => {
    for (const [category, emission] of aliasCategories) {
      expect(catalog).toContain(`  ${category}: ${emission.fieldsConstant},\n`);
      expect(catalog).toContain(
        `import { ${emission.fieldsConstant} } from "./${category.replaceAll("_", "-")}.ts";\n`
      );
    }
    expect(catalog).toContain(
      'export type AliasStructCategory =\n  | "government_trigger"\n  | "moon_initializer"'
    );
  });

  it("looks a category up as an own property, so no inherited name resolves", () => {
    expect(catalog).toContain("if (!Object.hasOwn(ALIAS_STRUCT_CATALOG, category)) {");
  });

  it("imports the tables by value, since the docs ledger is keyed by their identity", () => {
    expect(catalog).not.toContain("import type { GOVERNMENT_TRIGGER_FIELDS }");
  });

  it("renders the same text for the same categories, whatever order they arrive in", () => {
    expect(aliasCatalogCode([...categories].reverse(), modules)).toBe(catalog);
  });

  it("fails when an emitted field names a category the worklist never emitted", () => {
    const strayField =
      '{ key: "possible", member: "possible", shape: "aliasStruct", ' +
      'form: "block", category: "species_trigger" }';

    expect(() =>
      aliasCatalogCode(categories, [...modules, { file: "civic-or-origin.ts", code: strayField }])
    ).toThrow(
      "The alias catalog holds no field table for species_trigger (./civic-or-origin.ts) — an " +
        "aliasStruct field may only name a category the alias worklist emits"
    );
  });
});

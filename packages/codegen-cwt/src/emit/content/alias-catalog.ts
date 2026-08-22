/**
 * Renders `content-alias-catalog.ts`, the generated table that resolves an
 * alias category name to its field table.
 *
 * A category's field table can contain itself — `government_trigger` splices
 * its own combinators, `planet_initializer` splices `moon_initializer` back
 * into itself — so an `aliasStruct` field carries the category name and the
 * writer resolves it here. The tables are imported by value, because the
 * field-docs ledger is keyed by the identity of the very arrays the generated
 * modules declare.
 *
 * Every category an emitted `aliasStruct` field names is checked against the
 * catalog, so a missing category fails generation rather than the write that
 * would have looked it up.
 */

import { compareStrings, docComment } from "../../naming.ts";

/** One alias category the catalog resolves. */
export interface AliasCatalogCategory {
  /** CWT category name, as an `aliasStruct` field spells it. */
  readonly category: string;
  /** Name of the generated field-table constant. */
  readonly fieldsConstant: string;
  /** Module the constant is imported from, written as the catalog sees it. */
  readonly module: string;
}

/** One generated module whose `aliasStruct` fields the catalog has to cover. */
export interface AliasCatalogModule {
  /** Generated module file name, e.g. `civic-or-origin.ts`. */
  readonly file: string;
  /** Complete generated module text, which the referenced categories are read from. */
  readonly code: string;
}

/**
 * Field metadata as the lowering writes it, whose category name is the string
 * the SDK looks up at write time.
 */
const ALIAS_STRUCT_METADATA = /shape: "aliasStruct",\s*form: "\w+",\s*category: "([^"]+)"/g;

/** Every alias category named by an `aliasStruct` field in one module's text. */
function referencedCategories(code: string): string[] {
  return [...code.matchAll(ALIAS_STRUCT_METADATA)].map((match) => match[1]!);
}

/** Throws when a module names a category the catalog does not resolve. */
function assertCategoriesAreCatalogued(
  catalogued: ReadonlySet<string>,
  modules: readonly AliasCatalogModule[]
): void {
  const uncatalogued = modules.flatMap((module) =>
    referencedCategories(module.code)
      .filter((category) => !catalogued.has(category))
      .map((category) => `${category} (./${module.file})`)
  );
  if (uncatalogued.length > 0) {
    throw new Error(
      "The alias catalog holds no field table for " +
        `${[...new Set(uncatalogued)].sort(compareStrings).join(", ")} — an aliasStruct field ` +
        "may only name a category the alias worklist emits"
    );
  }
}

/**
 * Emits the alias-category catalog from the categories the worklist emitted.
 * Categories are sorted, so the same emissions always render the same text.
 */
export function aliasCatalogCode(
  categories: readonly AliasCatalogCategory[],
  modules: readonly AliasCatalogModule[]
): string {
  const sorted = [...categories].sort((left, right) =>
    compareStrings(left.category, right.category)
  );
  assertCategoriesAreCatalogued(new Set(sorted.map((entry) => entry.category)), modules);

  return (
    'import type { ContentField } from "../content/schema.ts";\n' +
    sorted
      .map((entry) => `import { ${entry.fieldsConstant} } from ${JSON.stringify(entry.module)};\n`)
      .join("") +
    "\n" +
    docComment(["The name of an alias category the SDK can write."]) +
    `export type AliasStructCategory =\n` +
    sorted.map((entry) => `  | ${JSON.stringify(entry.category)}`).join("\n") +
    ";\n\n" +
    docComment([
      "Every alias category's field table, keyed by the name its fields carry.",
      "",
      "An `aliasStruct` field names its category instead of holding the table,",
      "because a category contains itself; this is where the name resolves.",
    ]) +
    "export const ALIAS_STRUCT_CATALOG: Readonly<\n" +
    "  Record<AliasStructCategory, readonly ContentField[]>\n" +
    "> = {\n" +
    sorted.map((entry) => `  ${entry.category}: ${entry.fieldsConstant},\n`).join("") +
    "};\n\n" +
    docComment([
      "Returns the field table an alias category name resolves to.",
      "Throws when no generated category carries the name.",
    ]) +
    "export function aliasStructFieldsOf(category: string): readonly ContentField[] {\n" +
    "  if (!Object.hasOwn(ALIAS_STRUCT_CATALOG, category)) {\n" +
    '    throw new Error(`No field table for alias category "${category}"`);\n' +
    "  }\n" +
    "  return ALIAS_STRUCT_CATALOG[category as AliasStructCategory];\n" +
    "}\n"
  );
}

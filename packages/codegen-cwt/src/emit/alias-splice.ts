/**
 * Emits a *structural* CWT alias category as a named, self-referential block
 * interface.
 *
 * `solar_system_initializer` is the shape this exists for. Its entire planet
 * tree is declared as `alias_name[planet_initializer]`, spliced unkeyed at the
 * type's own top level, and `alias[planet_initializer:planet]` splices both
 * `planet_initializer` and `moon_initializer` back into itself. So the grammar
 * is mutually recursive and the nesting unbounded, and vanilla uses it: 2300
 * `planet` blocks and 664 `moon` blocks across the 360 shipped initializers,
 * nested three deep, anonymous and ordered.
 *
 * Two things make that expressible without a new runtime shape:
 *
 *  - the interfaces refer to each other by name, which TypeScript allows
 *    directly;
 *  - the *field tables* cannot, since a `const` cannot reference itself before
 *    it is initialised — so each category registers its table under its own name
 *    via `registerAliasStructFields`, and the writer resolves it at write time.
 *    That is the same indirection `emit/alias-struct.ts` needs for
 *    `government_trigger`'s combinators, reused rather than reinvented.
 *
 * What is *not* shared with alias-struct.ts is the body: that module matches a
 * fixed template of three member shapes, where a structural category's members
 * are ordinary fields and want the ordinary lowering. Hence this module runs the
 * same `fields.ts` loop `content-type.ts` runs, one level in.
 */

import type { DescentNode } from "../corpus.ts";
import { isOptional } from "../cwt/model.ts";
import { camelCase, docComment, indefiniteArticle } from "../naming.ts";
import { CONTENT_DECLINED_FIELDS, CONTENT_FIELD_OVERRIDES, FIELD_WIDENINGS } from "../overlay.ts";
import {
  lowerStructuralSplice,
  mergeByName,
  pickOrdinary,
  spliceTypeName,
  structuralSpliceOf,
  topLevelSplices,
  type EmittedField,
} from "./fields.ts";
import type { Emitter } from "./types.ts";

export interface AliasSpliceEmission {
  readonly code: string;
  /** The block interface, e.g. `PlanetInitializerFields`. */
  readonly typeName: string;
  /** The block's runtime field table, e.g. `PLANET_INITIALIZER_FIELDS`. */
  readonly fieldsConstant: string;
  /** The key each block is written under in script, e.g. `planet`. */
  readonly memberKey: string;
  /** Categories this one splices in turn, which the driver must also emit. */
  readonly spliceCategories: readonly string[];
  /**
   * Fields lowered inside the block, rooted at the *member key* rather than the
   * category — `planet.class`, `moon.size` — including those lowered inside a
   * member's own block (`planet.count.min`).
   *
   * The rooting is what lets the corpus gate line these up with the real files.
   * One table serves every depth, so a `class` written inside a third-level
   * moon is the same emitted field as one written inside a first-level planet,
   * and the corpus reader aggregates the same way.
   */
  readonly emittedFields: readonly EmittedField[];
  /**
   * How the corpus reader reaches those interiors, from the same lowerings —
   * the splice's counterpart to `ContentEmission.corpusDescents`. Their `field`
   * is the member's own key, since the reader roots them at the member key it
   * is already walking under.
   */
  readonly corpusDescents: readonly DescentNode[];
  /** Refused outright by CONTENT_DECLINED_FIELDS, each with its reason. */
  readonly declinedFields: readonly string[];
  /** Declared in the category but not expressible, each with its reason. */
  readonly unsupported: readonly string[];
}

/**
 * Emits one structural alias category, or returns `null` when the category is
 * not structural — which the caller reports rather than working around. See
 * {@link structuralSpliceOf} for the invariant.
 */
export function emitAliasSplice(emitter: Emitter, category: string): AliasSpliceEmission | null {
  const splice = structuralSpliceOf(emitter, category);
  if (splice === null) {
    return null;
  }
  const typeName = spliceTypeName(category);
  const body = splice.declaration.type;
  if (body.kind !== "block") {
    return null;
  }
  // The category module is shared by every registry that splices it, so it has
  // no registry's scope parameter to thread. `ScopeName` is the honest unpinned
  // type here; a field the rules do scope (`init_effect` carries
  // `## replace_scopes = { this = planet }`) still pins itself through
  // `field.scope`, which is where every scope in these bodies comes from.
  const ctx = { scope: splice.declaration.scope, unpinned: "ScopeName" };

  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const declinedFields: string[] = [];
  const unsupported: string[] = [];
  const emittedFields: EmittedField[] = [];
  const corpusDescents: DescentNode[] = [];
  const extraCode: string[] = [];
  const spliceCategories: string[] = [];
  // A member's own interior comes back rooted at the category, since that is
  // the path its overlay rows are keyed by; the corpus reader knows only the
  // member key. Re-rooting here is the one place the two spellings meet, the
  // same swap `declinedPathsOf` makes on the test side.
  const atMemberKey = (field: string): string =>
    `${splice.memberKey}${field.slice(category.length)}`;

  // Overlay rows are keyed by the category, not by the registry that splices
  // it: one lowering serves every consumer and every depth, so pinning a shape
  // per registry would be pinning it in only some of the places it appears.
  for (const [name, group] of mergeByName(body.fields, typeName)) {
    const fieldPath = `${category}.${name}`;
    const declined = CONTENT_DECLINED_FIELDS.get(fieldPath);
    if (declined !== undefined) {
      declinedFields.push(`${fieldPath} — ${declined}`);
      continue;
    }
    const lowering = pickOrdinary(
      emitter,
      group,
      name,
      ctx,
      CONTENT_FIELD_OVERRIDES.get(fieldPath),
      FIELD_WIDENINGS.get(fieldPath)?.extraType,
      fieldPath
    );
    if (lowering === null) {
      unsupported.push(`${fieldPath} (no declaration the emitter can lower)`);
      continue;
    }
    const optional = group.every((field) => isOptional(field.cardinality));
    members.push(
      docComment([...new Set(group.flatMap((field) => field.docs))], "  ") +
        `  ${camelCase(name)}${optional ? "?" : ""}: ${lowering.memberType};\n`
    );
    fieldMetadata.push(lowering.metadata);
    if (lowering.code !== undefined) {
      extraCode.push(lowering.code);
    }
    if (lowering.unsupported !== undefined) {
      unsupported.push(...lowering.unsupported);
    }
    emittedFields.push(
      { field: `${splice.memberKey}.${name}`, ...lowering.admits },
      ...(lowering.nested ?? []).map((field) => ({ ...field, field: atMemberKey(field.field) }))
    );
    corpusDescents.push(...(lowering.descents ?? []));
  }

  // Emitted after the named fields, matching the rules' declaration order and
  // the geometry vanilla writes: inside a `planet`, `change_orbit` advances the
  // orbit cursor and has to precede the `moon` blocks it applies to.
  for (const nested of topLevelSplices(body.fields, typeName)) {
    const nestedCategory = nested.key.category;
    if (spliceCategories.includes(nestedCategory)) {
      continue;
    }
    const lowered = lowerStructuralSplice(emitter, nestedCategory, nested.docs);
    if (lowered === null) {
      unsupported.push(
        `${category}.alias_name[${nestedCategory}] (spliced unkeyed; that category has ` +
          "no authoring member)"
      );
      continue;
    }
    members.push(docComment(lowered.docs, "  ") + `  ${lowered.member}?: ${lowered.memberType};\n`);
    fieldMetadata.push(lowered.metadata);
    emittedFields.push({ field: `${splice.memberKey}.${lowered.key!}`, ...lowered.admits! });
    spliceCategories.push(nestedCategory);
  }

  // From the category, not from `typeName`: the interface already ends in
  // "Fields", so constant-casing it would spell `..._FIELDS_FIELDS`.
  const fieldsConstant = `${category.toUpperCase()}_FIELDS`;
  const code =
    extraCode.join("") +
    docComment([
      `${indefiniteArticle(splice.memberKey) === "an" ? "An" : "A"} \`${splice.memberKey}\` ` +
        "block, as the game's rules describe it.",
      "",
      "Anonymous and ordered: these are written as repeated sibling blocks, so",
      "the array's order is the order the game reads them in, and an entry has",
      "no id of its own.",
    ]) +
    `export interface ${typeName} {\n` +
    members.join("") +
    "}\n\n" +
    `export const ${fieldsConstant}: readonly ContentField[] = [\n` +
    fieldMetadata.map((entry) => `  ${entry},\n`).join("") +
    "];\n\n" +
    `registerAliasStructFields(${JSON.stringify(category)}, ${fieldsConstant});\n`;

  return {
    code,
    typeName,
    fieldsConstant,
    memberKey: splice.memberKey,
    spliceCategories,
    emittedFields,
    corpusDescents,
    declinedFields,
    unsupported,
  };
}

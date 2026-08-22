/**
 * The alias-category worklist: every category emitted as its own shared
 * module, from either of the two reasons a category needs one — an overlay
 * row lowering a *keyed* field onto it (`civic_or_origin.potential` ->
 * `government_trigger`), or a body splicing it unkeyed
 * (`solar_system_initializer` -> `planet_initializer`). Both produce a named
 * interface plus a `registerAliasStructFields` call, so they share a write
 * loop and a report line in `index.ts`.
 *
 * A worklist rather than a flat list, because a spliced category can splice
 * further categories: `planet_initializer` reaches `moon_initializer`, which
 * reaches itself. Runs after the content loop so the splice seeds exist.
 */

import type { RuleSet } from "../../cwt/rules.ts";
import { structuralSpliceOf } from "../../lower/rule-shapes.ts";
import { CONTENT_FIELD_OVERRIDES, REPEATED_STRUCT_FIELD_OVERRIDES } from "../../overlay/index.ts";
import type { Emitter, Usage } from "../../render/emitter.ts";
import type { DocTable, FieldOmissionRow } from "../../render/field-rows.ts";
import { emitAliasSplice, type AliasSpliceEmission } from "./alias-splice.ts";
import { emitAliasStruct } from "./alias-struct.ts";

export interface AliasCategoryEmission {
  readonly code: string;
  readonly typeName: string;
  readonly usage: Usage;
  readonly emittedMembers: readonly string[];
  readonly declinedMembers: readonly string[];
  readonly omissions: readonly FieldOmissionRow[];
  readonly docTables: readonly DocTable[];
}

export function emitAliasCategories(
  emitter: Emitter,
  rules: RuleSet,
  inlineSplices: readonly string[]
): {
  aliasCategories: Map<string, AliasCategoryEmission>;
  aliasSplices: Map<string, AliasSpliceEmission>;
} {
  const aliasCategories = new Map<string, AliasCategoryEmission>();
  const aliasSplices = new Map<string, AliasSpliceEmission>();
  const emitCategory = (category: string, kind: "struct" | "splice"): void => {
    if (aliasCategories.has(category)) {
      return;
    }
    if (kind === "struct") {
      // An overlay row naming a category the rules do not declare is a
      // mistake in the row, so this throws rather than emitting nothing.
      const members = rules.aliasCategories.get(category);
      if (members === undefined || members.size === 0) {
        throw new Error(
          `overlay requests aliasStruct category "${category}" but the rules declare no ` +
            `alias[${category}:...] members — add it to EXTRA_ALIAS_CATEGORIES`
        );
      }
      emitter.beginFile(category);
      const emission = emitAliasStruct(emitter, category, members);
      aliasCategories.set(category, { ...emission, usage: emitter.endFile() });
      return;
    }
    // A splice seed is different: not every spliced category is structural, and
    // a non-structural one is not an error. `static_modifier` splices
    // `modifier`, whose authoring member is the `ModifierClosure` the runtime
    // already knows and whose members the rules keep outside `aliasCategories`
    // entirely — so there is no interface and no field table to emit.
    if (structuralSpliceOf(emitter, category) === null) {
      return;
    }
    emitter.beginFile(category);
    const emission = emitAliasSplice(emitter, category)!;
    const usage = emitter.endFile();
    aliasSplices.set(category, emission);
    aliasCategories.set(category, {
      code: emission.code,
      typeName: emission.typeName,
      usage,
      emittedMembers: emission.emittedFields.map((field) => field.field),
      declinedMembers: [...emission.declinedFields, ...emission.unsupported],
      omissions: emission.omissions,
      docTables: emission.docTables,
    });
    for (const nested of emission.spliceCategories) {
      emitCategory(nested, "splice");
    }
  };
  for (const override of [
    ...CONTENT_FIELD_OVERRIDES.values(),
    ...REPEATED_STRUCT_FIELD_OVERRIDES.values(),
  ]) {
    if (override.shape === "aliasStruct") {
      emitCategory(override.category!, "struct");
    }
  }
  for (const category of inlineSplices) {
    emitCategory(category, "splice");
  }
  return { aliasCategories, aliasSplices };
}

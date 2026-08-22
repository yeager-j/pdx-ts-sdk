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

/** One generated module and report entry for a structural alias category. */
export interface AliasCategoryEmission {
  /** Complete generated module text for the category. */
  readonly code: string;
  /** Name of the generated authoring interface. */
  readonly typeName: string;
  /** Imports and referenced symbols collected while generating the module. */
  readonly usage: Usage;
  /** Category member names represented by the authoring interface. */
  readonly emittedMembers: readonly string[];
  /** Category member names that codegen could not represent, with their reasons. */
  readonly declinedMembers: readonly string[];
  /** Structured omission rows used by the report and field-docs ledger. */
  readonly omissions: readonly FieldOmissionRow[];
  /** Documentation for the category's field tables. */
  readonly docTables: readonly DocTable[];
}

type AliasCategoryKind = "struct" | "splice";

interface AliasCategoryEmissionState {
  readonly aliasCategories: Map<string, AliasCategoryEmission>;
  readonly aliasSplices: Map<string, AliasSpliceEmission>;
}

function emitAliasCategory(
  emitter: Emitter,
  rules: RuleSet,
  state: AliasCategoryEmissionState,
  category: string,
  kind: AliasCategoryKind
): void {
  if (state.aliasCategories.has(category)) {
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
    state.aliasCategories.set(category, { ...emission, usage: emitter.endFile() });
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
  state.aliasSplices.set(category, emission);
  state.aliasCategories.set(category, {
    code: emission.code,
    typeName: emission.typeName,
    usage,
    emittedMembers: emission.emittedFields.map((field) => field.field),
    declinedMembers: [...emission.declinedFields, ...emission.unsupported],
    omissions: emission.omissions,
    docTables: emission.docTables,
  });
  for (const nested of emission.spliceCategories) {
    emitAliasCategory(emitter, rules, state, nested, "splice");
  }
}

/**
 * Emits every structural alias category seeded by overlays or top-level splices.
 * Recursive splice dependencies are discovered and emitted during the same worklist traversal.
 */
export function emitAliasCategories(
  emitter: Emitter,
  rules: RuleSet,
  inlineSplices: readonly string[]
): {
  /** Every emitted category, including structurally spliced categories. */
  aliasCategories: Map<string, AliasCategoryEmission>;
  /** Categories lowered specifically through the recursive structural-splice path. */
  aliasSplices: Map<string, AliasSpliceEmission>;
} {
  const state: AliasCategoryEmissionState = {
    aliasCategories: new Map(),
    aliasSplices: new Map(),
  };
  for (const override of [
    ...CONTENT_FIELD_OVERRIDES.values(),
    ...REPEATED_STRUCT_FIELD_OVERRIDES.values(),
  ]) {
    if (override.shape === "aliasStruct") {
      emitAliasCategory(emitter, rules, state, override.category!, "struct");
    }
  }
  for (const category of inlineSplices) {
    emitAliasCategory(emitter, rules, state, category, "splice");
  }
  return state;
}

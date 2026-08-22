/**
 * Pure recognizers: does one CWT rule declaration have shape X?
 *
 * Every function here inspects a `RuleType`/`RuleField` — or, where the rules
 * alone don't close the answer, the parsed rule model reachable through
 * `Emitter` (an enum's members, an alias category's members) — and returns
 * either a verdict (`null` for "not this shape") or the structural pieces the
 * verdict already found (which block, which trigger declaration, which enum
 * values). None of them knows how to lower what they find into TypeScript;
 * that is `fields.ts`'s job as the one consumer of every recognizer here.
 */

import { type FieldKey, type RuleField, type RuleType } from "../cwt/model.ts";
import type { AliasDecl } from "../cwt/rules.ts";
import { camelCase, isPlainName } from "../naming.ts";
import { type ContentFieldShape } from "../overlay.ts";
import type { Emitter } from "./types.ts";

export function bareValuesOf(type: RuleType): readonly RuleType[] | null {
  return type.kind === "block" && type.bare.length > 0
    ? type.bare.map((value) => value.type)
    : null;
}

export type BlockType = Extract<RuleType, { kind: "block" }>;

/**
 * Finds the anonymous-block shape behind a repeated-struct field, in either of
 * CWT's two spellings.
 *
 * "Direct": the field's own type is a block of ordinary named fields —
 * `text = { trigger = { ... } }` repeated, or a singular fixed-shape block
 * like `forbidden_peace_offers = { demand_surrender = ... }`.
 *
 * "Wrapped": the field is a singular container whose only content is one bare
 * anonymous block declared repeatable inside it — `discrete_terms = { ##
 * cardinality = 0..inf { key = ... value = ... } }`. The repetition lives on
 * the bare declaration, not on `discrete_terms` itself, so the result is
 * always a list regardless of the outer field's own cardinality — the same
 * convention `lowerValueList` already uses for bare scalar lists.
 */
export function structBlockOf(
  type: RuleType
): { readonly block: BlockType; readonly wrapped: boolean } | null {
  if (type.kind !== "block") {
    return null;
  }
  if (type.fields.length === 0 && type.bare.length === 1 && type.bare[0]!.type.kind === "block") {
    return { block: type.bare[0]!.type, wrapped: true };
  }
  if (type.fields.length > 0) {
    return { block: type, wrapped: false };
  }
  return null;
}

/** One enum-keyed block declaration, and the key set the rules close it to. */
export interface EnumKeyedEntry {
  readonly declaration: RuleField;
  readonly block: BlockType;
  readonly values: readonly string[];
}

/**
 * Finds that declaration inside a block type:
 * `enum[prereq_for_category] = { title = localisation … }`.
 *
 * Unlike `scalar = { … }`, which says nothing about which keys are legal, an
 * enum key names its keys exactly — so the declaration is one shape written
 * under each of a known, small set of names, and `enumKeyedMembers` (see
 * `fields.ts`) lowers it that way without an overlay row to disambiguate it.
 *
 * Declines a block with more than one such declaration, and an enum the rules
 * name but never populate (`valueFor` already reads that as an open `string`,
 * which is not a key set anything could expand).
 */
export function enumKeyedEntryOf(emitter: Emitter, block: BlockType): EnumKeyedEntry | null {
  const candidates = block.fields.flatMap((field) =>
    field.key.kind === "computed" && field.key.type.kind === "enum" && field.type.kind === "block"
      ? [{ declaration: field, block: field.type, enumName: field.key.type.name }]
      : []
  );
  if (candidates.length !== 1) {
    return null;
  }
  const { declaration, block: entry, enumName } = candidates[0]!;
  const values = emitter.rules.enums.get(enumName);
  if (values === undefined || values.length === 0 || !values.every(isPlainName)) {
    return null;
  }
  return { declaration, block: entry, values };
}

/**
 * Finds the single wildcard-keyed block declaration inside a block type, the
 * shape CWT uses for a keyed collection: `stages = { scalar = { icon = ... } }`
 * says "any scalar key maps to this block", not a field literally named
 * `scalar` — `classifyKey` reads that as a `computed` key rather than a `name`
 * one, so `mergeByName` (which only keeps `name` keys) sees nothing there.
 *
 * Ambiguous input — no such declaration, or more than one — declines rather
 * than guessing which one is the record's real shape.
 */
export function wildcardBlockOf(type: RuleType): BlockType | null {
  if (type.kind !== "block") {
    return null;
  }
  const candidates = type.fields.filter(
    (field): field is RuleField & { readonly type: BlockType } =>
      field.key.kind === "computed" && field.type.kind === "block"
  );
  return candidates.length === 1 ? candidates[0]!.type : null;
}

export function spliceCategory(type: RuleType): string | null {
  if (type.kind !== "block") {
    return null;
  }
  const categories = type.fields.flatMap((field) =>
    field.key.kind === "aliasName" ? [field.key.category] : []
  );
  if (categories.length === 0 || categories.length !== type.fields.length) {
    return null;
  }
  const unique = new Set(categories);
  return unique.size === 1 ? [...unique][0]! : null;
}

/**
 * The `single_alias` clauses whose expansion already names its runtime shape.
 *
 * A clause is a rule the vendored config writes once and splices everywhere; a
 * field that splices one is not "a block that happens to look like a modifier
 * map", it *is* the clause, and `RuleType.via` carries the name that says so.
 * That is the whole content of the 85 overlay `shape` rows this table replaced:
 * every one of them restated, per field, that `modifier`/`triggered_*_modifier`
 * splices `modifier_clause`/`triggered_modifier*_clause` — an open
 * modifier-name map (`alias_name[modifier]`) that the ordinary field model
 * cannot see, because an alias splice has no named key to lower.
 *
 * The `by_*` variants differ from plain `triggered_modifier_clause` only in the
 * scope their `potential` pushes (`## push_scope = pop_group|planet|starbase|
 * situation|leader`, aliases.cwt) and, for by_pop_group, one extra
 * `divide_over_pop_groups` key `TriggeredModifier` does not model. They share
 * this shape because `lowerOrdinary` reads that push_scope off the expanded
 * `potential` field rather than off the field's own container scope — the split
 * a bug bash caught on the by_planet rows, where the field's
 * `## replace_scopes = { this = country }` and the clause's planet-scoped
 * `potential` disagree and collapsing them typed the trigger against the wrong
 * scope. Deriving the shape does not derive that scope; `triggeredModifierPotential`
 * still validates it and still fails loudly when the clause has no `potential`.
 *
 * Deliberately absent:
 *
 * - `trigger_clause` / `effect_clause` — pure single-category splices, which
 *   `spliceCategory` already recognises structurally; adding them here would be
 *   a second authority for the same decision.
 * - `triggered_desc_clause` — `trigger` + `text`, ordinary named fields that
 *   `triggerStructOf` lowers as a `triggerStruct`.
 * - `leader_traits`, and any other clause `aliases.cwt` declares: no runtime
 *   shape claims them, so they stay reported as unsupported rather than being
 *   quietly bent into one that nearly fits.
 */
const CLAUSE_SHAPES = new Map<string, ContentFieldShape>([
  ["modifier_clause", "modifierBlock"],
  ["triggered_modifier_clause", "triggeredModifierBlock"],
  ["triggered_modifier_by_pop_group_clause", "triggeredModifierBlock"],
  ["triggered_modifier_by_planet_clause", "triggeredModifierBlock"],
  ["triggered_modifier_by_starbase_clause", "triggeredModifierBlock"],
  ["triggered_modifier_by_situation_clause", "triggeredModifierBlock"],
  ["triggered_modifier_by_leader_clause", "triggeredModifierBlock"],
]);

/**
 * The economic-template splice, which has no `single_alias` name to read.
 *
 * `resources = { category? alias_name[economic_template] }` is written out at
 * every site rather than aliased, so the fingerprint is the body: exactly one
 * `economic_template` or `economic_template_no_produce` splice, optionally a
 * named `category`, and nothing else. Anything further — a bare value, another
 * key — means the site is not the plain resource block the runtime shape models,
 * so this declines rather than lowering a field whose extra keys would vanish.
 *
 * `economic_template_only_produces` (crisis.cwt) is deliberately unmapped:
 * there is no `EconomicResourceBlockOnlyProduces` to lower it to, and mapping it
 * onto either neighbour would admit `cost`/`upkeep` the category refuses.
 */
function economicSpliceShape(type: RuleType): ContentFieldShape | null {
  if (type.kind !== "block" || type.bare.length > 0) {
    return null;
  }
  const splices = type.fields.flatMap((field) =>
    field.key.kind === "aliasName" ? [field.key.category] : []
  );
  const others = type.fields.filter(
    (field) => field.key.kind === "name" && field.key.name === "category"
  );
  if (splices.length !== 1 || splices.length + others.length !== type.fields.length) {
    return null;
  }
  switch (splices[0]!) {
    case "economic_template":
      return "economicResources";
    case "economic_template_no_produce":
      return "economicResourcesNoProduce";
    default:
      return null;
  }
}

/**
 * The runtime shape a field's own declaration names, or `null` when it names
 * none. Read only where the overlay states nothing, so an explicit row still
 * wins over the derivation.
 */
export function derivedClauseShape(field: RuleField): ContentFieldShape | undefined {
  if (field.type.kind !== "block") {
    return undefined;
  }
  const clause = field.type.via === undefined ? undefined : CLAUSE_SHAPES.get(field.type.via);
  return clause ?? economicSpliceShape(field.type) ?? undefined;
}

/**
 * Rewrites an all-scalar alias category as ordinary named fields.
 *
 * `possible_pre_triggers = { alias_name[pop_pre_trigger] = ... }` is a struct
 * wearing a splice's clothes: the category admits exactly seven members and
 * every one of them is a plain `bool`, so naming them turns the field into
 * something `lowerStruct` already knows how to emit — no new runtime shape, no
 * `Trigger` that would let an author write conditions the game will not read.
 *
 * Returns `null` for any category with a member the struct pipeline cannot
 * express (`government_trigger`'s clause blocks and self-recursive
 * combinators), leaving the field to be reported as unsupported rather than
 * half-lowered. One `RuleField` per declaration, so a member declared twice
 * merges through `mergeByName` exactly like an ordinary repeated key.
 */
export function aliasScalarFields(emitter: Emitter, category: string): RuleField[] | null {
  const members = emitter.rules.aliasCategories.get(category);
  if (members === undefined || members.size === 0) {
    return null;
  }
  const fields: RuleField[] = [];
  for (const [name, declarations] of members) {
    if (!isPlainName(name)) {
      return null;
    }
    for (const declaration of declarations) {
      if (declaration.type.kind === "block" || emitter.valueFor(declaration.type) === null) {
        return null;
      }
      fields.push({
        key: { kind: "name", name },
        type: declaration.type,
        // A splice never requires any particular member: the block is legal
        // empty, so every synthesized field is optional regardless of what the
        // declaration itself says.
        cardinality: { min: 0, max: 1 },
        docs: declaration.docs,
        scope: declaration.scope,
        line: declaration.line,
        comparison: declaration.comparison,
      });
    }
  }
  return fields;
}

export type AliasNameField = RuleField & { readonly key: Extract<FieldKey, { kind: "aliasName" }> };

/**
 * A *structural* alias category: one whose single member is a block, so the
 * category names a nested body rather than a vocabulary of rules.
 *
 * `alias[planet_initializer:planet]` is the case. Splicing that category into a
 * body means "a `planet = { ... }` block may appear here", and since `planet`'s
 * own body splices `planet_initializer` and `moon_initializer` back into itself,
 * the grammar is recursive and the nesting unbounded.
 *
 * The single-member invariant is enforced rather than worked around: a category
 * with two block members would need a naming scheme for the interfaces, and no
 * such category exists. Declining reports the gap instead of inventing one.
 */
export function structuralSpliceOf(
  emitter: Emitter,
  category: string
): { readonly memberKey: string; readonly declaration: AliasDecl } | null {
  const members = emitter.rules.aliasCategories.get(category);
  if (members === undefined || members.size !== 1) {
    return null;
  }
  const [memberKey, declarations] = [...members][0]!;
  if (!isPlainName(memberKey) || declarations.length !== 1) {
    return null;
  }
  const declaration = declarations[0]!;
  return declaration.type.kind === "block" ? { memberKey, declaration } : null;
}

/** Finds the one condition declaration a triggered-modifier block promises. */
export function triggeredModifierPotential(field: RuleField): RuleField {
  if (field.type.kind !== "block") {
    throw new Error(
      "A triggered-modifier field must expand to a block with a potential declaration"
    );
  }
  const potentials = field.type.fields.filter(
    (
      inner
    ): inner is RuleField & {
      readonly key: { readonly kind: "name"; readonly name: "potential" };
    } => inner.key.kind === "name" && inner.key.name === "potential"
  );
  if (potentials.length !== 1) {
    throw new Error(
      "A triggered-modifier block must expand to exactly one named potential declaration"
    );
  }
  return potentials[0]!;
}

export interface EconomicResourceOperationParts {
  readonly trigger: RuleField;
}

/**
 * Confirms the mixed CWT block the reusable economic-operation contract owns.
 *
 * A resource map alone is not this shape: `when` must correspond to exactly
 * one direct trigger clause and every complex maths sibling must remain
 * writable through `mult`/`multiplier`. Keeping this structural check beside
 * the lowering means an overlay cannot accidentally apply the shape to a
 * superficially similar block and silently discard one of its declared arms.
 */
export function economicResourceOperationParts(field: RuleField): EconomicResourceOperationParts {
  if (field.type.kind !== "block" || field.type.bare.length !== 0) {
    throw new Error(
      "An economic-resource operation field must be a named block with resource, trigger, and complex-maths declarations"
    );
  }
  const resources = field.type.fields.filter(
    (inner) =>
      inner.key.kind === "computed" &&
      inner.key.type.kind === "typeRef" &&
      inner.key.type.name === "resource" &&
      (inner.type.kind === "int" || inner.type.kind === "float")
  );
  const triggers = field.type.fields.filter(
    (inner) =>
      inner.key.kind === "name" &&
      inner.key.name === "trigger" &&
      spliceCategory(inner.type) === "trigger" &&
      inner.cardinality.min === 0 &&
      inner.cardinality.max === 1
  );
  const maths = field.type.fields.filter(
    (inner) =>
      inner.key.kind === "computed" &&
      inner.key.type.kind === "enum" &&
      inner.key.type.name === "complex_maths_enum" &&
      inner.type.kind === "valueField" &&
      inner.cardinality.min === 0 &&
      inner.cardinality.max === null
  );
  if (
    resources.length !== 1 ||
    triggers.length !== 1 ||
    maths.length !== 1 ||
    field.type.fields.length !== 3
  ) {
    throw new Error(
      "An economic-resource operation field must declare exactly one open <resource> numeric arm, one 0..1 pure trigger alias, and complex_maths_enum value-field arm"
    );
  }
  return { trigger: triggers[0]! };
}

export interface TriggerStruct {
  readonly block: BlockType;
  readonly trigger: RuleField;
  readonly ordinaryKeys: readonly string[];
}

/**
 * The one mixed block shape a normal struct cannot lower without losing its
 * splice: direct trigger entries plus ordinary named siblings.  It is narrow
 * on purpose; every other splice/computed/subtype/bare combination remains
 * unsupported rather than being partially emitted.
 */
export function triggerStructOf(type: RuleType): TriggerStruct | null {
  if (type.kind !== "block" || type.bare.length !== 0) {
    return null;
  }
  const triggers = type.fields.filter(
    (field): field is AliasNameField =>
      field.key.kind === "aliasName" && field.key.category === "trigger"
  );
  const ordinary = type.fields.filter(
    (field): field is RuleField & { readonly key: Extract<FieldKey, { readonly kind: "name" }> } =>
      field.key.kind === "name"
  );
  if (
    triggers.length !== 1 ||
    ordinary.length === 0 ||
    triggers.length + ordinary.length !== type.fields.length
  ) {
    return null;
  }
  const ordinaryKeys = ordinary.map((field) => field.key.name);
  if (ordinaryKeys.some((key) => camelCase(key) === "when")) {
    return null;
  }
  return {
    block: { kind: "block", fields: ordinary, bare: [] },
    trigger: triggers[0]!,
    ordinaryKeys,
  };
}

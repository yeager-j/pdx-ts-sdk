/**
 * Pure recognizers: does one CWT rule declaration have shape X?
 *
 * Every function here inspects a `RuleType`/`RuleField` — or, where the rules
 * alone don't close the answer, the parsed rule model reachable through
 * `LoweringContext` (an enum's members, an alias category's members) — and returns
 * either a verdict (`null` for "not this shape") or the structural pieces the
 * verdict already found (which block, which trigger declaration, which enum
 * values). None of them knows how to lower what they find into TypeScript;
 * that is `fields.ts`'s job as the one consumer of every recognizer here.
 */

import { type FieldKey, type RuleField, type RuleType } from "../cwt/model.ts";
import type { AliasDecl } from "../cwt/rules.ts";
import { camelCase, isPlainName } from "../naming.ts";
import { type ContentFieldShape } from "../overlay/index.ts";
import type { LoweringContext } from "./context.ts";

/** Returns a block's anonymous value types, or `null` when it has none. */
export function bareValuesOf(type: RuleType): readonly RuleType[] | null {
  return type.kind === "block" && type.bare.length > 0
    ? type.bare.map((value) => value.type)
    : null;
}

/** A CWT rule type narrowed to its block form. */
export type BlockType = Extract<RuleType, { kind: "block" }>;

/**
 * Finds a struct block in CWT's direct or single-bare-block spelling.
 * `wrapped` is true when anonymous repetition occurs inside the outer field key.
 */
export function structBlockOf(type: RuleType): {
  /** The anonymous block containing the struct's fields. */
  readonly block: BlockType;
  /** Whether the block is a bare value nested inside the outer key. */
  readonly wrapped: boolean;
} | null {
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
  /** The computed enum-key declaration. */
  readonly declaration: RuleField;
  /** The block shape shared by every enum key. */
  readonly block: BlockType;
  /** The closed set of plain enum keys. */
  readonly values: readonly string[];
}

/**
 * Finds the sole block declaration keyed by a small, populated enum.
 * Returns `null` when the declaration is ambiguous or the enum cannot provide a closed
 * set of plain member names.
 */
export function enumKeyedEntryOf(
  emitter: LoweringContext,
  block: BlockType
): EnumKeyedEntry | null {
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
 * Finds the single computed-key block used as a wildcard record value.
 * Returns `null` when no such declaration exists or several candidates are ambiguous.
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

/**
 * Returns the one alias category spliced throughout a block, or `null` when
 * the block contains other fields or multiple categories.
 */
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
 * Derives a runtime shape from a field's named clause or economic splice.
 * Call it only when no overlay shape is present; `undefined` means the declaration
 * does not identify a supported shape.
 */
export function derivedClauseShape(field: RuleField): ContentFieldShape | undefined {
  if (field.type.kind !== "block") {
    return undefined;
  }
  const clause = field.type.via === undefined ? undefined : CLAUSE_SHAPES.get(field.type.via);
  return clause ?? economicSpliceShape(field.type) ?? undefined;
}

/**
 * Expands an all-scalar alias category into ordinary optional named fields.
 * Returns `null` if any member name or value cannot be represented by the struct pipeline.
 */
export function aliasScalarFields(emitter: LoweringContext, category: string): RuleField[] | null {
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

/** A CWT rule field narrowed to an unkeyed alias splice. */
export type AliasNameField = RuleField & {
  /** The alias-splice key and its category. */
  readonly key: Extract<FieldKey, { kind: "aliasName" }>;
};

/**
 * Recognizes an alias category containing exactly one named block member.
 * Returns that structural declaration for nested interface lowering, or `null` when
 * the category is absent, ambiguous, or scalar-valued.
 */
export function structuralSpliceOf(
  emitter: LoweringContext,
  category: string
): {
  /** The PDXScript key emitted for the structural member. */
  readonly memberKey: string;
  /** The category's sole block declaration. */
  readonly declaration: AliasDecl;
} | null {
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

/** The structurally required parts of an economic-resource operation block. */
export interface EconomicResourceOperationParts {
  /** The optional trigger clause that gates the operation. */
  readonly trigger: RuleField;
}

/**
 * Validates and extracts the required parts of an economic-resource operation block.
 * The field must contain exactly one resource arm, optional trigger arm, and repeated
 * complex-maths arm; otherwise this function throws.
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

/** The ordinary and trigger portions of a mixed trigger-struct block. */
export interface TriggerStruct {
  /** The block after the trigger splice has been removed. */
  readonly block: BlockType;
  /** The original trigger-splice declaration. */
  readonly trigger: RuleField;
  /** The PDXScript names retained in {@link block}. */
  readonly ordinaryKeys: readonly string[];
}

/**
 * Recognizes a block containing one direct trigger splice and ordinary named fields.
 * Returns `null` for computed, subtype, bare, or conflicting `when` shapes that cannot
 * be represented without loss.
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

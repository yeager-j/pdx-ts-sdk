/**
 * Emits one content registry's authoring types and runtime field metadata.
 *
 * Registry-specific judgment lives in overlay rows. This module only lowers
 * rule shapes that the runtime content writer understands.
 */

import {
  isOptional,
  isRepeated,
  type RuleField,
  type RuleType,
  type ScopeContext,
} from "../cwt/model.ts";
import type { ContentBody, ContentType } from "../cwt/rules.ts";
import { camelCase, docComment, isPlainName, pascalCase } from "../naming.ts";
import {
  CONTENT_DECLINED_FIELDS,
  CONTENT_FIELD_OVERRIDES,
  FIELD_WIDENINGS,
  REPEATED_STRUCT_DEFINITIONS,
  REPEATED_STRUCT_FIELD_OVERRIDES,
  REQUIRED_LOCALISATION,
  type ContentFieldOverride,
  type RepeatedStructDefinition,
} from "../overlay.ts";
import { Emitter, type TsValue } from "./types.ts";

export interface ContentEmission {
  readonly code: string;
  readonly typeName: string;
  readonly fieldsConstant: string;
  readonly localisationConstant: string;
  readonly emittedFields: readonly string[];
  /**
   * Dotted paths lowered inside a repeated-struct field, e.g.
   * `tradition_swap.on_enabled` — invisible to `emittedFields`, which only
   * names the owning field itself (`tradition_swap`).
   */
  readonly nestedEmittedFields: readonly string[];
  /** Refused outright by CONTENT_DECLINED_FIELDS, each with its reason. */
  readonly declinedFields: readonly string[];
  /** Present in the rules but not expressible: blocked on emitter machinery. */
  readonly machineryBacklog: readonly string[];
  readonly unsupported: readonly string[];
  readonly localisationAliases: readonly string[];
}

interface LoweredField {
  readonly memberType: string;
  readonly metadata: string;
  /** Extra top-level declarations a nested struct level needed, prepended by the caller. */
  readonly code?: string;
  /** Paths bubbled up from a nested struct level, already prefixed. */
  readonly unsupported?: readonly string[];
}

function bareValuesOf(type: RuleType): readonly RuleType[] | null {
  return type.kind === "block" && type.bare.length > 0 ? type.bare : null;
}

type BlockType = Extract<RuleType, { kind: "block" }>;

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
function structBlockOf(
  type: RuleType
): { readonly block: BlockType; readonly wrapped: boolean } | null {
  if (type.kind !== "block") {
    return null;
  }
  if (type.fields.length === 0 && type.bare.length === 1 && type.bare[0]!.kind === "block") {
    return { block: type.bare[0] as BlockType, wrapped: true };
  }
  if (type.fields.length > 0) {
    return { block: type, wrapped: false };
  }
  return null;
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
function wildcardBlockOf(type: RuleType): BlockType | null {
  if (type.kind !== "block") {
    return null;
  }
  const candidates = type.fields.filter(
    (field): field is RuleField & { readonly type: BlockType } =>
      field.key.kind === "computed" && field.type.kind === "block"
  );
  return candidates.length === 1 ? candidates[0]!.type : null;
}

function spliceCategory(type: RuleType): string | null {
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
function aliasScalarFields(emitter: Emitter, category: string): RuleField[] | null {
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

function scopeType(
  emitter: Emitter,
  field: RuleField,
  inheritedScope: ScopeContext | null
): string {
  const declared = field.scope?.this ?? inheritedScope?.this;
  if (declared === undefined || declared === null) {
    return "ScopeName";
  }
  const canonical = emitter.canonicalScope(declared);
  return canonical === null ? "ScopeName" : JSON.stringify(canonical);
}

function flatten(fields: readonly RuleField[], typeName: string): RuleField[] {
  return fields.flatMap((field) => {
    if (field.key.kind !== "subtype") {
      return [field];
    }
    if (field.type.kind !== "block") {
      return [];
    }
    const predicate = `${field.key.negated ? "not " : ""}\`${field.key.name}\``;
    return flatten(field.type.fields, typeName).map((inner) => ({
      ...inner,
      cardinality: { min: 0, max: inner.cardinality.max },
      docs: [...inner.docs, `Only when ${typeName} subtype ${predicate} applies.`],
    }));
  });
}

function mergeByName(fields: readonly RuleField[], typeName: string): Map<string, RuleField[]> {
  const grouped = new Map<string, RuleField[]>();
  for (const field of flatten(fields, typeName)) {
    if (field.key.kind !== "name") {
      continue;
    }
    grouped.set(field.key.name, [...(grouped.get(field.key.name) ?? []), field]);
  }
  return grouped;
}

function constantCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function indefiniteArticle(name: string): "A" | "An" {
  return /^[aeiou]/i.test(name) ? "An" : "A";
}

function conversionFor(value: TsValue): "identity" | "ref" {
  return value.toScalar("x") === "x" ? "identity" : "ref";
}

function arrayType(type: string): string {
  return type.includes(" | ") ? `(${type})[]` : `${type}[]`;
}

function metadata(
  field: RuleField,
  name: string,
  shape: string,
  extras: readonly string[] = []
): string {
  const members = [
    `key: ${JSON.stringify(name)}`,
    `member: ${JSON.stringify(camelCase(name))}`,
    `shape: ${JSON.stringify(shape)}`,
    ...extras,
  ];
  if (isRepeated(field.cardinality) && shape !== "valueList") {
    members.push("repeated: true");
  }
  return `{ ${members.join(", ")} }`;
}

function lowerValue(
  emitter: Emitter,
  field: RuleField,
  name: string,
  widening: string | undefined
): LoweredField | null {
  const value = emitter.valueFor(field.type);
  if (value === null) {
    return null;
  }
  const repeated = isRepeated(field.cardinality);
  const literalType =
    field.type.kind === "literal" && field.type.text === "yes"
      ? "true"
      : field.type.kind === "literal" && field.type.text === "no"
        ? "false"
        : value.type;
  const base = literalType + (widening === undefined ? "" : ` | ${widening}`);
  return {
    memberType: repeated ? arrayType(base) : base,
    metadata: metadata(field, name, "value", [
      `conversion: ${JSON.stringify(conversionFor(value))}`,
    ]),
  };
}

function lowerValueList(
  emitter: Emitter,
  field: RuleField,
  name: string,
  widening: string | undefined,
  quoted: boolean
): LoweredField | null {
  const bare = bareValuesOf(field.type);
  if (bare === null) {
    return null;
  }
  const value = emitter.unionFor(bare);
  if (value === null) {
    return null;
  }
  const listType = arrayType(value.type);
  return {
    memberType: listType + (widening === undefined ? "" : ` | ${widening}`),
    metadata: metadata(field, name, "valueList", [
      `conversion: ${JSON.stringify(conversionFor(value))}`,
      ...(quoted ? ["quoted: true"] : []),
    ]),
  };
}

/**
 * Lowers an anonymous, identity-less block field: the fallback that
 * generalizes shape 3 ("repeated siblings with no id") down to whatever
 * cardinality CWT actually declares, so a singular fixed-shape block like
 * `forbidden_peace_offers` is just the N=0..1 case of the same mechanism.
 *
 * Recurses through the ordinary field pipeline for the struct's own members,
 * so a struct nested inside a struct (`agreement_preset.term_data.discrete_terms`
 * inside `term_data`) falls out for free rather than needing its own case.
 */
function lowerStruct(
  emitter: Emitter,
  field: RuleField,
  name: string,
  path: string,
  inheritedScope: ScopeContext | null
): LoweredField | null {
  const located = structBlockOf(field.type);
  if (located === null) {
    return null;
  }
  const { block, wrapped } = located;
  if (block.fields.some((inner) => inner.key.kind !== "name")) {
    // A splice (alias_name), subtype, or computed key inside the block means
    // some of its content is invisible to mergeByName. Emitting a struct from
    // only the ordinary fields would silently drop the rest, so decline
    // rather than guess — the caller reports this path as unsupported.
    return null;
  }
  const grouped = mergeByName(block.fields, pascalCase(name));
  if (grouped.size === 0) {
    return null;
  }
  const typeName = pascalCase(path);
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const extraCode: string[] = [];
  const unsupported: string[] = [];
  for (const [fieldName, group] of grouped) {
    const fieldPath = `${path}.${fieldName}`;
    const lowered = pickOrdinary(
      emitter,
      group,
      fieldName,
      inheritedScope,
      CONTENT_FIELD_OVERRIDES.get(fieldPath),
      FIELD_WIDENINGS.get(fieldPath)?.extraType,
      fieldPath
    );
    if (lowered === null) {
      unsupported.push(`${fieldPath} (no declaration the emitter can lower)`);
      continue;
    }
    const optional = group.every((inner) => isOptional(inner.cardinality));
    members.push(
      docComment([...new Set(group.flatMap((inner) => inner.docs))], "  ") +
        `  ${camelCase(fieldName)}${optional ? "?" : ""}: ${lowered.memberType};\n`
    );
    fieldMetadata.push(lowered.metadata);
    if (lowered.code !== undefined) {
      extraCode.push(lowered.code);
    }
    if (lowered.unsupported !== undefined) {
      unsupported.push(...lowered.unsupported);
    }
  }
  if (members.length === 0) {
    return null;
  }
  const fieldsConstant = `${constantCase(typeName)}_FIELDS`;
  const repeated = wrapped || isRepeated(field.cardinality);
  const code =
    extraCode.join("") +
    `export interface ${typeName} {\n` +
    members.join("") +
    "}\n\n" +
    `export const ${fieldsConstant}: readonly ContentField[] = [\n` +
    fieldMetadata.map((entry) => `  ${entry},\n`).join("") +
    "];\n\n";
  const metadataMembers = [
    `key: ${JSON.stringify(name)}`,
    `member: ${JSON.stringify(camelCase(name))}`,
    `shape: "struct"`,
    `fields: ${fieldsConstant}`,
    ...(wrapped ? ["wrapped: true"] : []),
    ...(repeated ? ["repeated: true"] : []),
  ];
  return {
    memberType: repeated ? arrayType(typeName) : typeName,
    metadata: `{ ${metadataMembers.join(", ")} }`,
    code,
    unsupported,
  };
}

function lowerOrdinary(
  emitter: Emitter,
  field: RuleField,
  name: string,
  inheritedScope: ScopeContext | null,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  const requested = override?.shape;
  if (requested === "modifierBlock") {
    const scope = scopeType(emitter, field, inheritedScope);
    return {
      memberType: `ModifierClosure<${scope}>`,
      metadata: metadata(field, name, "modifierBlock"),
    };
  }
  if (requested === "weightBlock") {
    const scope = scopeType(emitter, field, inheritedScope);
    return {
      memberType: `WeightBlock<${scope}>`,
      metadata: metadata(field, name, "weightBlock"),
    };
  }
  if (requested === "weightBlockWithLoc") {
    const scope = scopeType(emitter, field, inheritedScope);
    return {
      memberType: `WeightBlockWithLoc<${scope}>`,
      metadata: metadata(field, name, "weightBlockWithLoc"),
    };
  }
  if (requested === "aliasStruct") {
    const category = override!.category!;
    const memberType = `${pascalCase(category)}Block`;
    return {
      memberType: isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
      metadata: metadata(field, name, "aliasStruct", [`category: ${JSON.stringify(category)}`]),
    };
  }
  if (requested === "valueList") {
    return lowerValueList(emitter, field, name, widening, override?.quoted ?? false);
  }
  const category = spliceCategory(field.type);
  if (requested === "trigger" || (requested === undefined && category === "trigger")) {
    const scope = scopeType(emitter, field, inheritedScope);
    return {
      memberType: `Trigger<${scope}>`,
      metadata: metadata(field, name, "trigger"),
    };
  }
  if (requested === "effect" || (requested === undefined && category === "effect")) {
    const scope = scopeType(emitter, field, inheritedScope);
    return {
      memberType: `EffectBlock<${scope}>`,
      metadata: metadata(field, name, "effect"),
    };
  }
  if (requested === undefined && category === "modifier_rule") {
    const scope = scopeType(emitter, field, inheritedScope);
    return {
      memberType: `WeightBlock<${scope}>`,
      metadata: metadata(field, name, "weightBlock"),
    };
  }
  if (requested === undefined && category === "modifier_rule_with_loc") {
    const scope = scopeType(emitter, field, inheritedScope);
    return {
      memberType: `WeightBlockWithLoc<${scope}>`,
      metadata: metadata(field, name, "weightBlockWithLoc"),
    };
  }
  if (requested === undefined && category !== null) {
    const members = aliasScalarFields(emitter, category);
    if (members !== null) {
      return lowerStruct(
        emitter,
        { ...field, type: { kind: "block", fields: members, bare: [] } },
        name,
        path,
        inheritedScope
      );
    }
  }
  if (requested === "economicResources") {
    const scope = scopeType(emitter, field, inheritedScope);
    const memberType = `EconomicResourceBlock<${scope}>`;
    return {
      memberType: isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
      metadata: metadata(field, name, "economicResources"),
    };
  }
  if (requested === "triggeredModifierBlock") {
    const scope = scopeType(emitter, field, inheritedScope);
    const memberType = `TriggeredModifier<${scope}>`;
    return {
      memberType: isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
      metadata: metadata(field, name, "triggeredModifierBlock"),
    };
  }
  if (requested === "value") {
    return lowerValue(emitter, field, name, widening);
  }
  if (requested === "struct") {
    return lowerStruct(emitter, field, name, path, inheritedScope);
  }
  if (requested === "weightedEvents") {
    if (field.type.kind !== "block") {
      return null;
    }
    // `int = 0` is the nothing-happens arm, authored by omitting `event`; the
    // remaining computed-key declarations carry the firable event types.
    const eventTypes = field.type.fields
      .filter((inner) => inner.key.kind === "computed" && inner.key.type.kind === "int")
      .map((inner) => inner.type)
      .filter((type) => type.kind !== "literal");
    const value = eventTypes.length === 0 ? null : emitter.unionFor(eventTypes);
    if (value === null) {
      return null;
    }
    return {
      memberType: `readonly { weight: number; event?: ${value.type} }[]`,
      metadata: metadata(field, name, "weightedEvents", [
        `conversion: ${JSON.stringify(conversionFor(value))}`,
      ]),
    };
  }
  const bare = bareValuesOf(field.type);
  if (bare !== null) {
    // A single bare block, rather than a bare scalar, is the "wrapped" spelling
    // of a repeated struct (see structBlockOf) — try that before treating it as
    // a scalar list, and don't fall through to a scalar reading if it declines,
    // since that would misread the block as an empty/invalid scalar list.
    if (bare.length === 1 && bare[0]!.kind === "block") {
      return lowerStruct(emitter, field, name, path, inheritedScope);
    }
    const asList = lowerValueList(emitter, field, name, widening, false);
    if (asList !== null) {
      return asList;
    }
  }
  const struct = lowerStruct(emitter, field, name, path, inheritedScope);
  if (struct !== null) {
    return struct;
  }
  return lowerValue(emitter, field, name, widening);
}

/**
 * A field CWT declares twice — once as a bare scalar and once as a
 * modifier_rule block — accepts both forms, lowered at runtime by which one
 * the author passes. Picking either declaration alone is wrong in one
 * direction: vanilla writes `stages.end = 100` 254 times against 1 block,
 * while `opinion_modifier.opinion` needs the block's gated adjustments.
 */
function lowerDualWeight(
  emitter: Emitter,
  group: readonly RuleField[],
  name: string,
  inheritedScope: ScopeContext | null
): LoweredField | null {
  const weightArms = group.filter((field) => spliceCategory(field.type) === "modifier_rule");
  const scalarArms = group.filter((field) => field.type.kind !== "block");
  if (weightArms.length === 0 || scalarArms.length === 0) {
    return null;
  }
  if (weightArms.length + scalarArms.length !== group.length) {
    return null;
  }
  if (group.some((field) => isRepeated(field.cardinality))) {
    return null;
  }
  const value = emitter.unionFor(scalarArms.map((field) => field.type));
  if (value === null) {
    return null;
  }
  const scope = scopeType(emitter, weightArms[0]!, inheritedScope);
  return {
    memberType: `${value.type} | WeightBlock<${scope}>`,
    metadata: metadata(scalarArms[0]!, name, "valueOrWeightBlock", [
      `conversion: ${JSON.stringify(conversionFor(value))}`,
    ]),
  };
}

/**
 * A field declared several times as scalars is one field accepting the union —
 * `progress_direction` is `monodirectional` in one subtype and `bidirectional`
 * in the other, and first-wins picking made the second unreachable.
 */
function lowerScalarUnion(
  emitter: Emitter,
  group: readonly RuleField[],
  name: string,
  widening: string | undefined
): LoweredField | null {
  const boolish = (type: RuleType): boolean =>
    type.kind === "literal" && (type.text === "yes" || type.text === "no");
  if (group.some((field) => field.type.kind === "block" || boolish(field.type))) {
    return null;
  }
  const repeated = group.map((field) => isRepeated(field.cardinality));
  if (new Set(repeated).size > 1) {
    return null;
  }
  const value = emitter.unionFor(group.map((field) => field.type));
  if (value === null) {
    return null;
  }
  const base = value.type + (widening === undefined ? "" : ` | ${widening}`);
  return {
    memberType: repeated[0]! ? arrayType(base) : base,
    metadata: metadata(group[0]!, name, "value", [
      `conversion: ${JSON.stringify(conversionFor(value))}`,
    ]),
  };
}

function pickOrdinary(
  emitter: Emitter,
  group: readonly RuleField[],
  name: string,
  inheritedScope: ScopeContext | null,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  if (override?.shape === undefined && group.length > 1) {
    const dual = lowerDualWeight(emitter, group, name, inheritedScope);
    if (dual !== null) {
      return dual;
    }
    const union = lowerScalarUnion(emitter, group, name, widening);
    if (union !== null) {
      return union;
    }
  }
  for (const field of group) {
    const lowered = lowerOrdinary(emitter, field, name, inheritedScope, override, widening, path);
    if (lowered !== null) {
      return lowered;
    }
  }
  return null;
}

interface LocalisationPlan {
  readonly entries: ContentType["localisation"];
  readonly aliases: readonly string[];
}

/**
 * The identity-localisation convention for a repeated-struct field with no
 * vendored `type[...]` of its own: the record key doubles as a required
 * localisation key (`$`), with an optional `<key>_desc` (`$_desc`). Shaped as
 * a `ContentType` so it flows through `planLocalisation`/`localisationMembers`
 * unchanged rather than needing a second code path.
 */
function syntheticIdentityLocalisation(typeName: string): ContentType {
  return {
    name: typeName,
    path: null,
    nameField: null,
    keyFilter: null,
    subtypes: [],
    localisation: [
      { key: "name", pattern: "$", required: true },
      { key: "desc", pattern: "$_desc", required: false },
    ],
  };
}

/**
 * Collapses declared localisation entries onto one member per TS field name.
 *
 * A pattern with no `$` id placeholder is not a static `<id>`-keyed slot at
 * all — CWT also uses this position for data-path pointers like `job`'s
 * `condition_string = swappable_data/default/condition_string`, meaning "read
 * this nested field's value instead of a localisation key". The SDK's writer
 * only knows how to substitute an id into `$`, so those entries are excluded
 * outright rather than emitted as a member no definition could satisfy
 * correctly.
 *
 * Two distinct collisions occur among what remains: the same *pattern*
 * declared under two keys (`council_agenda_name` and `name` both writing
 * `council_agenda_$_name`), and the same *member* name declared with two
 * patterns. Emitting one interface member per surviving entry means either
 * collision left standing would be a duplicate TypeScript property, so the
 * first-declared entry wins and the rest collapse to aliases.
 */
function planLocalisation(type: ContentType): LocalisationPlan {
  const byPattern = new Map<string, ContentType["localisation"][number]>();
  const byMember = new Map<string, ContentType["localisation"][number]>();
  const aliases: string[] = [];
  const collapse = (
    dropped: ContentType["localisation"][number],
    canonical: ContentType["localisation"][number]
  ): void => {
    aliases.push(
      `${type.name}.localisation.${dropped.key} (${dropped.pattern}) duplicates ` +
        `${canonical.key} at ${canonical.pattern}`
    );
  };

  for (const entry of type.localisation) {
    if (!entry.pattern.includes("$")) {
      aliases.push(
        `${type.name}.localisation.${entry.key} (${entry.pattern}) has no ` +
          "`$` id placeholder — not a static <id>-keyed slot, excluded"
      );
      continue;
    }
    const member = camelCase(entry.key);
    const patternMatch = byPattern.get(entry.pattern);
    if (patternMatch !== undefined) {
      collapse(entry, patternMatch);
      continue;
    }
    const memberMatch = byMember.get(member);
    if (memberMatch !== undefined) {
      collapse(entry, memberMatch);
      continue;
    }
    byPattern.set(entry.pattern, entry);
    byMember.set(member, entry);
  }
  return { entries: [...byMember.values()], aliases };
}

function localisationMembers(type: ContentType, plan = planLocalisation(type)): string {
  return plan.entries
    .map((entry) => {
      const field = camelCase(entry.key);
      const required = entry.required || REQUIRED_LOCALISATION.has(`${type.name}.${field}`);
      const pattern = entry.pattern.replace("$", "<id>");
      return (
        docComment([`English text emitted to localization under \`${pattern}\`.`], "  ") +
        `  ${field}${required ? "" : "?"}: string;\n`
      );
    })
    .join("");
}

function localisationMetadata(type: ContentType, plan = planLocalisation(type)): string {
  return (
    "[\n" +
    plan.entries
      .map((entry) => {
        const member = camelCase(entry.key);
        const required = entry.required || REQUIRED_LOCALISATION.has(`${type.name}.${member}`);
        return (
          `  { member: ${JSON.stringify(member)}, pattern: ${JSON.stringify(entry.pattern)}, ` +
          `required: ${required} },\n`
        );
      })
      .join("") +
    "]"
  );
}

/**
 * Lowers an overlay-configured repeated-struct field: a named, ordered
 * collection whose name is both identity and localization key (shapes 1 and 2
 * — the same distinction `name_field` draws for top-level registries, one
 * level down). Authors as `Readonly<Record<Id, ${typeName}Fields>>` rather
 * than an array carrying its own `id`, so the id cannot be omitted, cannot
 * collide, and the mod prefix applies at one point — exactly like a top-level
 * definition's id.
 */
function repeatedStructEmission(
  emitter: Emitter,
  ownerField: RuleField,
  ownerPath: string,
  config: RepeatedStructDefinition,
  inheritedScope: ScopeContext | null
): {
  readonly code: string;
  readonly fieldsConstant: string;
  readonly localisationConstant: string;
  readonly memberType: string;
  readonly metadata: string;
  /** Refused outright by CONTENT_DECLINED_FIELDS, each with its reason. */
  readonly declinedFields: readonly string[];
  /** Present in the struct's rules but not expressible, or a member-name collision. */
  readonly unsupported: readonly string[];
  /** Dotted paths successfully lowered, e.g. `situation.stages.icon`. */
  readonly emittedFields: readonly string[];
  readonly localisationAliases: readonly string[];
} | null {
  if (ownerField.type.kind !== "block") {
    return null;
  }
  const keying = config.keying ?? "siblings";
  if (keying === "siblings" && config.identityKey === undefined) {
    return null;
  }
  // "container" (`stages = { stage_1 = { ... } }`) has no sibling fields of
  // its own to merge — the record's per-entry shape lives one level further
  // in, behind the wildcard key CWT uses to say "any key maps to this block".
  const bodyType = keying === "container" ? wildcardBlockOf(ownerField.type) : ownerField.type;
  if (bodyType === null) {
    return null;
  }
  const grouped = mergeByName(bodyType.fields, config.typeName);
  // The record key already carries the identity value — written into
  // identityKey inside each sibling block, or (for "container") the block's
  // own key — so it is not an ordinary member, the same reason the top level
  // drops its nameField before iterating.
  if (config.identityKey !== undefined) {
    grouped.delete(config.identityKey);
  }

  const typeName = config.typeName;
  // Some repeated-struct fields have their own vendored `type[...]` carrying
  // the identity's localisation patterns (tradition_swap borrows
  // `type[swapped_tradition]`). Others — situations' `stages` and `approach`
  // — have no such type; CWT only ever types the identity value itself as
  // `localisation` inline, never as a sibling `type[...]` block. Falling back
  // to the same `$` required / `$_desc` optional convention the vendored
  // types themselves use keeps this generic rather than situations-specific:
  // any future repeated-struct field lacking a dedicated type gets the same
  // convention `99_README_SITUATIONS.txt` documents for both of situations'.
  const localisationType =
    config.localisationType === undefined
      ? syntheticIdentityLocalisation(typeName)
      : emitter.rules.contentTypes.get(config.localisationType);
  const localisationPlan =
    localisationType === undefined ? null : planLocalisation(localisationType);
  // A struct field can share a name with the struct's own localisation slot
  // without meaning the same thing, exactly the collision the top level
  // guards against — the localisation member wins and the body field is
  // reported instead of silently duplicating a TS property.
  const localisationMemberNames = new Set(
    (localisationPlan?.entries ?? []).map((entry) => camelCase(entry.key))
  );

  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const declinedFields: string[] = [];
  const unsupported: string[] = [];
  const emittedFields: string[] = [];
  const extraCode: string[] = [];

  // Everything the struct's rules declare is emitted, in the rules'
  // declaration order — the same loop shape the top level uses, one level
  // down. A nested field is absent only because the emitter cannot express
  // it or CONTENT_DECLINED_FIELDS refuses it outright.
  for (const [name, group] of grouped) {
    const fieldPath = `${ownerPath}.${name}`;
    const declined = CONTENT_DECLINED_FIELDS.get(fieldPath);
    if (declined !== undefined) {
      declinedFields.push(`${fieldPath} — ${declined}`);
      continue;
    }
    if (localisationMemberNames.has(camelCase(name))) {
      unsupported.push(`${fieldPath} (collides with the "${camelCase(name)}" localization slot)`);
      continue;
    }
    const lowering = pickOrdinary(
      emitter,
      group,
      name,
      inheritedScope,
      REPEATED_STRUCT_FIELD_OVERRIDES.get(fieldPath),
      undefined,
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
    emittedFields.push(fieldPath);
  }

  if (localisationType === undefined) {
    unsupported.push(`${ownerPath} (missing type[${config.localisationType}] localization)`);
  }
  const constantPrefix = constantCase(typeName);
  const fieldsConstant = `${constantPrefix}_FIELDS`;
  const localisationConstant = `${constantPrefix}_LOCALISATION`;
  const locMembers =
    localisationType === undefined ? "" : localisationMembers(localisationType, localisationPlan!);
  const locMetadata =
    localisationType === undefined
      ? "[]"
      : localisationMetadata(localisationType, localisationPlan!);
  const localisationAliases: readonly string[] = localisationPlan?.aliases ?? [];
  const code =
    extraCode.join("") +
    `export interface ${typeName}Fields {\n` +
    locMembers +
    members.join("") +
    "}\n\n" +
    `export const ${fieldsConstant}: readonly ContentField[] = [\n` +
    fieldMetadata.map((entry) => `  ${entry},\n`).join("") +
    "];\n\n" +
    `export const ${localisationConstant}: readonly ContentLocalisation[] = ${locMetadata};\n\n`;

  const metadataValue = metadata(
    ownerField,
    ownerField.key.kind === "name" ? ownerField.key.name : "",
    "repeatedStruct",
    [
      `keying: ${JSON.stringify(keying)}`,
      ...(keying === "siblings" ? [`identityKey: ${JSON.stringify(config.identityKey)}`] : []),
      `fields: ${fieldsConstant}`,
      `localisation: ${localisationConstant}`,
    ]
  );
  return {
    code,
    fieldsConstant,
    localisationConstant,
    memberType: `Readonly<Record<Id, ${typeName}Fields>>`,
    metadata: metadataValue,
    declinedFields,
    unsupported,
    emittedFields,
    localisationAliases,
  };
}

export function emitContentType(
  emitter: Emitter,
  cwtType: ContentType,
  body: ContentBody,
  registry: string = cwtType.name
): ContentEmission {
  // One CWT type can back several registries — three keywords share
  // `type[component_template]`. Renaming once here makes every downstream
  // name, allowlist key, and overlay path follow the registry instead.
  const type: ContentType = registry === cwtType.name ? cwtType : { ...cwtType, name: registry };
  const grouped = mergeByName(body.fields, type.name);
  // CWT lists the name field among the body's fields, but the writer emits it
  // from the definition's id. Dropping it here keeps it out of the authoring
  // interface, where it would be a second, contradictable way to set the id.
  if (type.nameField !== null) {
    grouped.delete(type.nameField);
  }
  const emittedFields: string[] = [];
  const nestedEmittedFields: string[] = [];
  const declinedFields: string[] = [];
  const unsupported: string[] = [];
  const extraCode: string[] = [];
  const localisationAliases: string[] = [];
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  // Only a repeatedStruct field's Readonly<Record<Id, ...>> member type actually
  // references Id — a plain struct field (no identity) never does, so the owner
  // type should not carry an unused Id generic just because a struct happened
  // to be present.
  let needsId = false;
  const localisationPlan = planLocalisation(type);
  // A body field can share a name with a localization slot without meaning the
  // same thing — `building.desc` (`single_alias_right[triggered_desc_clause]`,
  // a repeated trigger+text struct) is unrelated to the `desc` flavor text the
  // type's own localisation table already claims for the TS member `desc`. Both
  // succeeding would emit the same interface property twice with different
  // types, so the localization slot — already load-bearing everywhere it
  // appears — wins, and the colliding body field is reported instead of
  // silently overwritten.
  const localisationMemberNames = new Set(
    localisationPlan.entries.map((entry) => camelCase(entry.key))
  );

  // Everything the emitter can lower is emitted, in the rules' own declaration
  // order. The SDK's promise is that a mod author does not run out of API, so a
  // field is in unless something objects: either the emitter cannot express it,
  // or CONTENT_DECLINED_FIELDS refuses it outright.
  for (const [name, group] of grouped) {
    const path = `${type.name}.${name}`;
    const declined = CONTENT_DECLINED_FIELDS.get(path);
    if (declined !== undefined) {
      declinedFields.push(`${path} — ${declined}`);
      continue;
    }
    const override = CONTENT_FIELD_OVERRIDES.get(path);
    const member = override?.member ?? camelCase(name);
    if (localisationMemberNames.has(member)) {
      unsupported.push(`${name} (collides with the "${member}" localization slot)`);
      continue;
    }
    if (override?.shape === "repeatedStruct") {
      const config = REPEATED_STRUCT_DEFINITIONS.get(path);
      const nested =
        config === undefined
          ? null
          : repeatedStructEmission(emitter, group[0]!, path, config, body.scope);
      if (nested === null) {
        unsupported.push(`${name} (repeated-struct overlay is incomplete)`);
        continue;
      }
      const optional = group.every((field) => isOptional(field.cardinality));
      members.push(
        docComment([...new Set(group.flatMap((field) => field.docs))], "  ") +
          `  ${camelCase(name)}${optional ? "?" : ""}: ${nested.memberType};\n`
      );
      extraCode.push(nested.code);
      fieldMetadata.push(nested.metadata);
      needsId = true;
      declinedFields.push(...nested.declinedFields);
      unsupported.push(...nested.unsupported);
      nestedEmittedFields.push(...nested.emittedFields);
      localisationAliases.push(...nested.localisationAliases);
      emittedFields.push(name);
      continue;
    }
    const widening = FIELD_WIDENINGS.get(path);
    const lowered = pickOrdinary(
      emitter,
      group,
      name,
      body.scope,
      override,
      widening?.extraType,
      path
    );
    if (lowered === null) {
      unsupported.push(`${name} (no declaration the emitter can lower)`);
      continue;
    }
    const optional = group.every((field) => isOptional(field.cardinality));
    members.push(
      docComment([...new Set(group.flatMap((field) => field.docs))], "  ") +
        `  ${member}${optional ? "?" : ""}: ${lowered.memberType};\n`
    );
    fieldMetadata.push(
      override?.member === undefined
        ? lowered.metadata
        : lowered.metadata.replace(
            `member: ${JSON.stringify(camelCase(name))}`,
            `member: ${JSON.stringify(member)}`
          )
    );
    if (lowered.code !== undefined) {
      extraCode.push(lowered.code);
    }
    if (lowered.unsupported !== undefined) {
      unsupported.push(...lowered.unsupported);
    }
    emittedFields.push(name);
  }

  const typeName = pascalCase(type.name);
  const fieldsConstant = `${type.name.toUpperCase()}_FIELDS`;
  const localisationConstant = `${type.name.toUpperCase()}_LOCALISATION`;
  const fieldsGeneric = needsId ? "<Id extends string = string>" : "";
  const fieldsReference = needsId ? `${typeName}Fields<Id>` : typeName + "Fields";
  const code =
    extraCode.join("") +
    docComment([
      `${indefiniteArticle(type.name)} ${type.name}, as the game's rules describe it.`,
      "",
      `Generated from \`type[${cwtType.name}]\` at \`${type.path}\`.`,
    ]) +
    `export interface ${typeName}Fields${fieldsGeneric} {\n` +
    localisationMembers(type, localisationPlan) +
    members.join("") +
    "}\n\n" +
    `export interface ${typeName}Def<Id extends string = string> extends ${fieldsReference} {\n` +
    "  /** Full content id, including the mod prefix. */\n" +
    "  id: Id;\n" +
    "}\n\n" +
    `export type Defined${typeName}<Id extends string = string> = DefinedContent<\n` +
    `  ${JSON.stringify(type.name)},\n` +
    `  ${typeName}Def<Id>\n` +
    ">;\n\n" +
    `export const ${fieldsConstant}: readonly ContentField[] = [\n` +
    fieldMetadata.map((entry) => `  ${entry},\n`).join("") +
    "];\n\n" +
    `export const ${localisationConstant}: readonly ContentLocalisation[] = ` +
    `${localisationMetadata(type, localisationPlan)};\n`;

  return {
    code,
    typeName,
    fieldsConstant,
    localisationConstant,
    emittedFields,
    nestedEmittedFields,
    declinedFields: declinedFields.sort(),
    machineryBacklog: [...unsupported].sort(),
    unsupported,
    localisationAliases: [...localisationPlan.aliases, ...localisationAliases],
  };
}

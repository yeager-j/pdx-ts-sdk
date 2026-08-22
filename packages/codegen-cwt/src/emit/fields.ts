/**
 * Lowers one CWT rule field to an authoring member, its runtime metadata, and
 * the shape description the corpus gate measures it against.
 *
 * This is the half of content emission that knows nothing about registries.
 * Given a field's declarations, an overlay row and a scope context, it picks a
 * shape and returns the three things every caller needs. `content-type.ts`
 * drives it over a `type[...]` body and over each repeated-struct field one
 * level down; the alias emitters drive it over an alias category's members.
 * Keeping the loop here is what lets those callers share one lowering instead
 * of growing parallel ones that disagree.
 */

import { contentShape } from "../content-shape.ts";
import type { DescentNode } from "../corpus.ts";
import { isOptional, isRepeated, type RuleField, type RuleType } from "../cwt/model.ts";
import { camelCase, constantCase, pascalCase } from "../naming.ts";
import {
  ASSET_PATH_FIELDS,
  CONTENT_FIELD_OVERRIDES,
  FIELD_WIDENINGS,
  type ContentFieldOverride,
  type FieldWidening,
} from "../overlay.ts";
import { formOfShape } from "./authored-form.ts";
import type { DocTable, FieldOmissionRow, MemberDocRow } from "./field-rows.ts";
import {
  aliasScalarFields,
  bareValuesOf,
  derivedClauseShape,
  economicResourceOperationParts,
  enumKeyedEntryOf,
  spliceCategory,
  structBlockOf,
  structuralSpliceOf,
  triggeredModifierPotential,
  triggerStructOf,
  wildcardBlockOf,
  type AliasNameField,
  type BlockType,
  type EnumKeyedEntry,
} from "./rule-shapes.ts";
import {
  containerContext,
  contravariantScopeType,
  effectBlockArgs,
  scopeArg,
  scopeType,
  splitRootMetadata,
  withFrom,
  type FieldContext,
  type FieldScope,
} from "./scope-context.ts";
import { Emitter, type TsValue } from "./types.ts";
import { constArray, conversionFor, refTypesEntries, member as renderMember } from "./writer.ts";

/**
 * One lowered field, described in the terms a real PDXScript value can be
 * measured against: block or scalar, repeatable or not, which scalars it
 * admits, which scope its closures run in.
 *
 * The corpus gate used to see field *names* only, which is what limited it to
 * presence checking — `stages.end` could be block-typed against 254 scalar
 * writes and still report full coverage.
 */
export interface EmittedField {
  /** The game's own key, or a dotted path for one lowered inside a struct. */
  readonly field: string;
  /** Authored member path owning this field, preserved through nested lowering. */
  readonly authoredPath?: readonly string[];
  /** The runtime shape name, the same token the field metadata carries. */
  readonly shape: string;
  /** True when the authoring member lets the key repeat at the sibling level. */
  readonly repeated: boolean;
  /**
   * A `struct` whose repetition is nested inside the key, so its block holds
   * bare anonymous blocks rather than named entries. The interior form check
   * needs it for the same reason `valueList` is exempt there: "no named keys"
   * is what this shape writes, not evidence that the lowering is wrong.
   */
  readonly wrapped?: boolean;
  /** Every scalar the member admits, when the lowering closed the set. */
  readonly literals?: readonly string[];
  /**
   * What scope this field's closures run in:
   *
   * - a list of canonical scopes — the rules or an overlay row pinned it
   * - `"any"` — nothing pinned it. A contravariant lowering widens that to
   *   `Trigger<never>`, which admits every rule and checks none; any other
   *   lowering keeps `ScopeName`, which admits only rules legal in *every*
   *   scope, which is almost none
   * - `{ parameter }` — the definition declares which of these it is, so a rule
   *   legal in any one of them is writable by some definition
   */
  readonly scope?: readonly string[] | "any" | { readonly parameter: readonly string[] };
  /**
   * Set when the field's block holds trigger or effect rules, so a consumer
   * knows the keys inside it are scoped rules rather than struct members or
   * modifier names. The emitter knows this from the splice category it lowered;
   * nothing downstream should try to re-derive it from a shape name.
   */
  readonly clause?: "trigger" | "effect";
}
/**
 * The literals a doc row may carry: the admitted set, except where lowering
 * changes the authored representation. `admits.literals` speaks the game's
 * tokens because the corpus gate measures shipped files, but boolean fields
 * author as `true`/`false` while admitting `yes`/`no` — printing those tokens
 * in a docs table tells an author to pass strings that do not type-check.
 * Booleans are the only conversion with that mismatch, and their admitted
 * sets are exactly the subsets of `{yes, no}`, so those are omitted; the
 * member type `boolean` already says everything the row would.
 */
export function authoredLiterals(literals: readonly string[] | undefined): {
  readonly literals?: readonly string[];
} {
  if (literals === undefined || literals.every((token) => token === "yes" || token === "no")) {
    return {};
  }
  return { literals };
}

export interface LoweredField {
  readonly memberType: string;
  readonly metadata: string;
  /**
   * What the lowering admits, for the corpus gate. Carries the same `shape` and
   * `repeated` the metadata does, so the two cannot describe different things.
   */
  readonly admits: Omit<EmittedField, "field">;
  /**
   * A `struct` whose repetition is nested inside one key. Decides whether the
   * authoring member is an array — which is what tells two dual arms apart —
   * and rides into `admits` so the gate knows the block holds bare blocks.
   */
  readonly wrapped?: boolean;
  /**
   * Doc lines the lowering itself contributes, beyond the rules' own `###`
   * comments — how an overlay decision that weakens a type explains itself on
   * the member a modder hovers.
   */
  readonly docs?: readonly string[];
  /** Extra top-level declarations a nested struct level needed, prepended by the caller. */
  readonly code?: string;
  /** Rows bubbled up from a nested struct level, their paths already prefixed. */
  readonly unsupported?: readonly FieldOmissionRow[];
  /**
   * Documentation rows for every field table {@link code} declares, one
   * {@link DocTable} per emitted `..._FIELDS` constant, bubbled unchanged —
   * the table constant names the rows, so no path arithmetic rides along.
   */
  readonly docTables?: readonly DocTable[];
  /**
   * What the block's own members admit, at their dotted paths and at every
   * level below — the interior the corpus gate would otherwise measure nothing
   * against, since `admits` describes only the outer key.
   */
  readonly nested?: readonly EmittedField[];
  /**
   * How the corpus reader reaches that interior. Produced beside {@link nested}
   * from one lowering so the two cannot describe different trees: a descent
   * without its emitted fields manufactures unexpressed paths, and emitted
   * fields without their descent are measured against nothing.
   */
  readonly descents?: readonly DescentNode[];
}

/**
 * The keys a `modifier` row spends on arithmetic or display rather than on
 * gating: `modifier_rule.cwt`'s two maths enums, plus `desc`.
 *
 * What remains in a row is the spliced `alias_name[trigger]`, so this set is
 * exactly what turns a shipped row into the conditions the emitted `Trigger<S>`
 * has to hold. A missing enum throws rather than degrading to an empty set: the
 * corpus reader would then record `add` and `factor` as trigger keys, and every
 * weight block in the game would report a scope mismatch against them.
 */
function weightRowOperations(emitter: Emitter): ReadonlySet<string> {
  const members = (name: string): readonly string[] => {
    const values = emitter.rules.enums.get(name);
    if (values === undefined || values.length === 0) {
      throw new Error(
        `The rules declare no members for enum[${name}], so a weight block's modifier rows ` +
          "cannot be stripped down to the conditions that gate them"
      );
    }
    return values;
  };
  return new Set([...members("complex_maths_enum"), ...members("simple_maths_enum"), "desc"]);
}

/**
 * A weight block's `modifier` rows, as one emitted field and one descent.
 *
 * Every other block shape describes its interior through `structShape`, off a
 * CWT fields table. A weight block has none — `modifier_rule` is an alias
 * category, and the authoring shape is the SDK's own `WeightBlock<S>` — so the
 * one interior worth measuring is stated here instead: the row's gating
 * condition, at the holder's own scope, which is where `Modifier.when`'s
 * `Trigger<S>` is instantiated.
 */
function weightInterior(
  emitter: Emitter,
  name: string,
  path: string,
  scope: FieldScope
): Pick<LoweredField, "nested" | "descents"> {
  return {
    nested: [
      {
        field: `${path}.modifier`,
        shape: "weightModifier",
        // `modifiers` is an array and the writer emits one `modifier` block per
        // row, so the key repeats inside the weight block.
        repeated: true,
        clause: "trigger",
        scope: scope.scopes,
      },
    ],
    descents: [
      {
        field: name,
        mode: "weightModifiers",
        strippedKeys: weightRowOperations(emitter),
        children: [],
      },
    ],
  };
}

/** The potential condition and its emitter-owned corpus descent. */
function triggeredModifierInterior(
  name: string,
  path: string,
  potentialScope: FieldScope
): Pick<LoweredField, "nested" | "descents"> {
  return {
    nested: [
      {
        field: `${path}.potential`,
        shape: "trigger",
        repeated: false,
        clause: "trigger",
        scope: potentialScope.scopes,
      },
    ],
    descents: [{ field: name, mode: "triggeredModifierPotential", children: [] }],
  };
}

/** The direct trigger interior owned by `EconomicResourceOperation<S>`. */
function economicResourceOperationInterior(
  name: string,
  path: string,
  scope: FieldScope
): Pick<LoweredField, "nested" | "descents"> {
  return {
    nested: [
      {
        field: `${path}.trigger`,
        shape: "trigger",
        repeated: false,
        clause: "trigger",
        scope: scope.scopes,
      },
    ],
    descents: [{ field: name, mode: "economicResourceOperationTrigger", children: [] }],
  };
}

/**
 * Declares the imports one overlay widening's `extraType` needs.
 *
 * The row states its own symbols ({@link FieldWidening.symbols}) because the
 * text is free-form TypeScript the overlay writes and the emitter only splices.
 * Applied where the row is read, which is the point the widening joins the
 * member's admitted forms.
 */
export function useWideningSymbols(emitter: Emitter, widening: FieldWidening | undefined): void {
  for (const symbol of widening?.symbols ?? []) {
    emitter.use(symbol);
  }
}

export function flatten(fields: readonly RuleField[], typeName: string): RuleField[] {
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

export function mergeByName(
  fields: readonly RuleField[],
  typeName: string
): Map<string, RuleField[]> {
  const grouped = new Map<string, RuleField[]>();
  for (const field of flatten(fields, typeName)) {
    if (field.key.kind !== "name") {
      continue;
    }
    grouped.set(field.key.name, [...(grouped.get(field.key.name) ?? []), field]);
  }
  return grouped;
}

/**
 * The alias categories a definition body splices unkeyed at its own top level.
 *
 * `static_modifier` is declared `{ alias_name[modifier] = alias_match_left[modifier]
 * icon = filepath … }` — the modifier grammar *is* the body, so vanilla writes
 * `empire_base = { max_rivalries = 3 }` with the modifier names at the block
 * root, beside the metadata keys. {@link mergeByName} keeps only `name` keys,
 * so without this the splice is invisible to the field model and the registry
 * would emit a definition that can set an icon but never a modifier.
 */
export function topLevelSplices(fields: readonly RuleField[], typeName: string): AliasNameField[] {
  return flatten(fields, typeName).filter(
    (field): field is AliasNameField => field.key.kind === "aliasName"
  );
}

export interface LoweredSplice {
  readonly member: string;
  readonly memberType: string;
  readonly metadata: string;
  readonly docs: readonly string[];
  /**
   * The block key the writer emits each entry under, for a splice whose entries
   * are keyed blocks rather than bare rows. Absent for `inlineModifiers`, whose
   * whole point is that its rows carry no enclosing key — which is also why
   * that one contributes no {@link EmittedField}.
   */
  readonly key?: string;
  /** What the lowering admits, for the corpus gate. Set whenever `key` is. */
  readonly admits?: Omit<EmittedField, "field">;
}

/**
 * Lowers a structural splice to one authoring member holding an ordered array
 * of that category's blocks. `structuralSpliceOf` (`rule-shapes.ts`) is the
 * recognizer that confirms a category is this shape; this is its one
 * lowering.
 *
 * The array is unconditional, and so is its optionality: the cardinality on the
 * `alias_name` line is ignored. A splice is a grammar production rather than a
 * field — the block is legal absent and legal repeated wherever the category is
 * spliced — and CWT annotates the two ends inconsistently anyway. The top-level
 * `alias_name[planet_initializer]` carries `0..inf`, but the recursive ones
 * inside `planet` and `moon` carry nothing at all, which `cardinalityOf` reads
 * as required — and would make every planet demand a sub-planet, forever.
 * {@link aliasScalarFields} already reasons this way for the scalar case.
 */
export function lowerStructuralSplice(
  emitter: Emitter,
  category: string,
  docs: readonly string[]
): LoweredSplice | null {
  const splice = structuralSpliceOf(emitter, category);
  if (splice === null) {
    return null;
  }
  const member = camelCase(splice.memberKey);
  const shape = { shape: "aliasStruct", repeated: true } as const;
  return {
    member,
    key: splice.memberKey,
    memberType: arrayType(emitter.useAliasCategory(category, spliceTypeName(category))),
    metadata:
      `{ key: ${JSON.stringify(splice.memberKey)}, member: ${JSON.stringify(member)}, ` +
      `shape: "aliasStruct", form: ${JSON.stringify(formOfShape(shape))}, ` +
      `category: ${JSON.stringify(category)}, repeated: true }`,
    admits: shape,
    docs: [...docs, ...splice.declaration.docs],
  };
}

/** The interface one structural alias category's blocks are authored as. */
export function spliceTypeName(category: string): string {
  return `${pascalCase(category)}Fields`;
}

/**
 * Lowers one top-level splice to a single authoring member whose entries the
 * writer emits at the block root rather than under a key.
 *
 * Two kinds lower. `modifier` becomes `ModifierClosure` — the same closure every
 * keyed `modifier = { ... }` field already authors, spliced instead of wrapped,
 * exactly as `TriggeredModifier.modifiers` already does one level down. A
 * *structural* category (see {@link lowerStructuralSplice}) becomes an ordered
 * array of its own block interface.
 *
 * Everything else returns `null` and is reported: the remaining categories a
 * body splices this way (`game_rule`'s `trigger`, `script_value`'s
 * `modifier_rule`, `deposit`'s `resources_template_optional`) belong to types
 * the manifest does not expose, and naming a member for one would be inventing
 * an authoring surface rather than lowering a declared one.
 */
export function lowerTopLevelSplice(
  emitter: Emitter,
  field: AliasNameField,
  ctx: FieldContext
): LoweredSplice | null {
  if (field.key.category !== "modifier") {
    return lowerStructuralSplice(emitter, field.key.category, field.docs);
  }
  const scope = scopeType(emitter, field, ctx);
  return {
    member: "modifiers",
    memberType: `${emitter.use("ModifierClosure")}<${scopeArg(emitter, scope)}>`,
    metadata: `{ member: "modifiers", shape: "inlineModifiers" }`,
    docs: [
      "Modifiers written directly into the definition body, with no enclosing key.",
      ...field.docs,
    ],
  };
}

/**
 * The scalar-lowering half of a field's metadata: how to turn the authored
 * value into an id, and — when the rules say every admitted form is a
 * reference — which registries that id must come from. The second half is what
 * lets `buildMod` hold an own-prefixed reference to the registry it names.
 */
function scalarMetadata(value: TsValue): string[] {
  return [`conversion: ${JSON.stringify(conversionFor(value))}`, ...refTypesEntries(value)];
}

function arrayType(type: string): string {
  return type.includes(" | ") ? `(${type})[]` : `${type}[]`;
}

/**
 * Whether the key itself may appear more than once in a definition body.
 *
 * A `valueList` is the exception: its member is an array, but the writer emits
 * one key holding a brace list rather than repeated siblings.
 */
export function repeatsSiblings(field: RuleField, shape: string): boolean {
  return isRepeated(field.cardinality) && shape !== "valueList";
}

/** One evidence-backed optionality decision, shared by every generated member. */
export function memberOptional(
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined
): boolean {
  return override?.optional === true || group.every((field) => isOptional(field.cardinality));
}

export function metadata(
  field: RuleField,
  name: string,
  shape: string,
  extras: readonly string[] = []
): string {
  const repeated = repeatsSiblings(field, shape);
  const members = [
    `key: ${JSON.stringify(name)}`,
    `member: ${JSON.stringify(camelCase(name))}`,
    `shape: ${JSON.stringify(shape)}`,
    `form: ${JSON.stringify(formOfShape({ shape: contentShape(shape), repeated }))}`,
    ...extras,
  ];
  if (repeated) {
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
  // `field.type.kind === "localisation"` is CWT's own way of typing a plain
  // body field as "this value is a localisation key, not free text" — the
  // same RuleType `job.condition_string` and `global_ship_design`'s name_field
  // pointer both use. It lowers to the same `string`, `conversion: "identity"`
  // shape ordinary scalars do (`emit/types.ts`'s `valueFor`), so nothing
  // downstream can otherwise tell "raw key" from "any other string field" —
  // `locKey: true` is that signal, consumed by the runtime's
  // `onLocKeyLooksLikeText` check (SDK-50).
  const locKeyExtra = field.type.kind === "localisation" ? ["locKey: true"] : [];
  emitter.useValue(value);
  return {
    memberType: repeated ? arrayType(base) : base,
    metadata: metadata(field, name, "value", [...scalarMetadata(value), ...locKeyExtra]),
    // A widening opens the set: it exists precisely to admit forms the rules do
    // not name, so the closed arm no longer describes everything legal.
    admits: admitsScalars(field, "value", widening === undefined ? value : null),
  };
}

/** The descriptor for a shape whose whole value is one scalar the rules type. */
function admitsScalars(
  field: RuleField,
  shape: string,
  value: TsValue | null
): Omit<EmittedField, "field"> {
  return {
    shape,
    repeated: repeatsSiblings(field, shape),
    ...(value?.literals === undefined ? {} : { literals: value.literals }),
  };
}

/** The descriptor for a block shape, carrying the scope its closures run in. */
function admitsBlock(
  field: RuleField,
  shape: string,
  scope?: FieldScope,
  clause?: "trigger" | "effect"
): Omit<EmittedField, "field"> {
  return {
    shape,
    repeated: repeatsSiblings(field, shape),
    ...(scope === undefined ? {} : { scope: scope.scopes }),
    ...(clause === undefined ? {} : { clause }),
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
  const listType = arrayType(emitter.useValue(value).type);
  return {
    memberType: listType + (widening === undefined ? "" : ` | ${widening}`),
    metadata: metadata(field, name, "valueList", [
      ...scalarMetadata(value),
      ...(quoted ? ["quoted: true"] : []),
    ]),
    admits: admitsScalars(field, "valueList", widening === undefined ? value : null),
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
interface StructShape {
  readonly typeName: string;
  /** The name authors use, including an enclosing scope parameter where needed. */
  readonly memberType: string;
  readonly fieldsConstant: string;
  /** The interface and field-table declarations, for the caller to prepend. */
  readonly code: string;
  readonly unsupported: readonly FieldOmissionRow[];
  /** Doc rows for the struct's own table and every table nested inside it. */
  readonly docTables: readonly DocTable[];
  /** Each member's admits at `${path}.${name}`, plus whatever they nest in turn. */
  readonly nested: readonly EmittedField[];
  /** Descent nodes for the members that are themselves blocks worth walking. */
  readonly children: readonly DescentNode[];
}

/** The same interior, re-rooted under one of the keys that shares it. */
function reroot(fields: readonly EmittedField[], from: string, to: string): EmittedField[] {
  return fields.map((field) => ({ ...field, field: to + field.field.slice(from.length) }));
}

/**
 * Expands an enum-keyed block declaration into one authoring member per enum
 * value, all sharing a single entry interface.
 *
 * A `Record` keyed by the enum would be the obvious lowering and is the wrong
 * one: every other key in the SDK reaches its member in camelCase (`inherit_icon`
 * is `inheritIcon`), and a record's keys would be the game's spelling —
 * `diplo_action` beside `hidePrereqForDesc` in the same object literal. Naming
 * the members instead invents nothing, since every name comes from the enum, and
 * leaves the block's ordinary named siblings (`hide_prereq_for_desc`) exactly
 * where the rules put them rather than displacing them into a wrapper.
 *
 * One interface, not one per key: the rules declare one shape, and emitting six
 * structurally identical `…Ship`/`…Custom` interfaces would put that duplication
 * in the public API. The corpus reader still records each key's interior at its
 * own path, so the shared interior is {@link reroot}ed once per key.
 *
 * Every member is optional and each carries the declaration's own repetition:
 * `## cardinality = 0..4` bounds how many entries the block may hold in total,
 * not how often one key may be written, so it can neither require a key nor
 * cap one — and vanilla does write `custom` three times inside a single
 * `prereqfor_desc`.
 */
interface EnumKeyedMembers extends Pick<
  StructShape,
  "code" | "unsupported" | "nested" | "children" | "docTables"
> {
  /** One interface member per enum value, already indented and documented. */
  readonly members: readonly string[];
  readonly fieldMetadata: readonly string[];
  /** One doc row per enum value, for the owning block's own table. */
  readonly memberDocs: Readonly<Record<string, MemberDocRow>>;
}

function enumKeyedMembers(
  emitter: Emitter,
  keyed: EnumKeyedEntry,
  name: string,
  path: string,
  ctx: FieldContext
): EnumKeyedMembers | null {
  const entryPath = `${path}.entry`;
  const entry = structShape(
    emitter,
    keyed.block,
    name,
    entryPath,
    containerContext(keyed.declaration, ctx)
  );
  if (entry === null) {
    return null;
  }
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const nested: EmittedField[] = [];
  const children: DescentNode[] = [];
  const memberDocs: Record<string, MemberDocRow> = {};
  for (const value of keyed.values) {
    const memberPath = `${path}.${value}`;
    const field: RuleField = {
      ...keyed.declaration,
      key: { kind: "name", name: value },
      cardinality: { ...keyed.declaration.cardinality, min: 0 },
    };
    const repeated = repeatsSiblings(field, "struct");
    const memberType = repeated ? arrayType(entry.typeName) : entry.typeName;
    members.push(
      renderMember({
        name: camelCase(value),
        type: memberType,
        optional: true,
        docs: keyed.declaration.docs,
      })
    );
    memberDocs[camelCase(value)] = { optional: true, docs: keyed.declaration.docs, memberType };
    fieldMetadata.push(metadata(field, value, "struct", [`fields: ${entry.fieldsConstant}`]));
    nested.push(
      { field: memberPath, shape: "struct", repeated },
      ...reroot(entry.nested, entryPath, memberPath)
    );
    children.push({ field: value, mode: "struct", children: entry.children });
  }
  return {
    members,
    fieldMetadata,
    memberDocs,
    code: entry.code,
    unsupported: entry.unsupported,
    nested,
    children,
    docTables: entry.docTables,
  };
}

/**
 * Builds the interface and runtime field table for one anonymous block's named
 * members, recursing through the ordinary field pipeline so a struct nested
 * inside a struct falls out for free.
 *
 * Declines a block holding a splice (`alias_name`), subtype, or wildcard key:
 * those are invisible to `mergeByName`, so emitting only the ordinary fields
 * would silently drop the rest. The caller reports the path as unsupported. An
 * *enum*-keyed block is the one computed key that does not decline, because its
 * key set is closed and named — see {@link enumKeyedMembers}.
 *
 * Shared by every shape whose value is an anonymous block — `lowerStruct` and
 * `lowerStructMap` differ only in how they find that block and what they wrap
 * the resulting type in.
 */
function structShape(
  emitter: Emitter,
  block: BlockType,
  name: string,
  path: string,
  ctx: FieldContext,
  inlineTrigger?: FieldScope,
  typeNameOverride?: string
): StructShape | null {
  const keyed = enumKeyedEntryOf(emitter, block);
  const ordinary =
    keyed === null ? block.fields : block.fields.filter((inner) => inner !== keyed.declaration);
  if (ordinary.some((inner) => inner.key.kind !== "name")) {
    return null;
  }
  const grouped = mergeByName(ordinary, pascalCase(name));
  if (grouped.size === 0 && keyed === null) {
    return null;
  }
  const typeName = typeNameOverride ?? pascalCase(path);
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const extraCode: string[] = [];
  const unsupported: FieldOmissionRow[] = [];
  const nested: EmittedField[] = [];
  const children: DescentNode[] = [];
  const memberDocs: Record<string, MemberDocRow> = {};
  const docTables: DocTable[] = [];
  for (const [fieldName, group] of grouped) {
    const fieldPath = `${path}.${fieldName}`;
    const override = CONTENT_FIELD_OVERRIDES.get(fieldPath);
    if (override !== undefined) {
      emitter.overlayAudit.applied("CONTENT_FIELD_OVERRIDES", fieldPath);
    }
    const widening = FIELD_WIDENINGS.get(fieldPath);
    if (widening !== undefined) {
      emitter.overlayAudit.applied("FIELD_WIDENINGS", fieldPath);
      useWideningSymbols(emitter, widening);
    }
    const lowered = pickOrdinary(
      emitter,
      group,
      fieldName,
      ctx,
      override,
      widening?.extraType,
      fieldPath
    );
    if (lowered === null) {
      unsupported.push({
        path: fieldPath,
        kind: "unsupported",
        reason: "no declaration the emitter can lower",
      });
      continue;
    }
    const optional = memberOptional(group, override);
    const docLines = [
      ...new Set([...group.flatMap((inner) => inner.docs), ...(lowered.docs ?? [])]),
    ];
    members.push(
      renderMember({
        name: camelCase(fieldName),
        type: lowered.memberType,
        optional,
        docs: docLines,
      })
    );
    memberDocs[camelCase(fieldName)] = {
      optional,
      docs: docLines,
      memberType: lowered.memberType,
      ...authoredLiterals(lowered.admits.literals),
    };
    docTables.push(...(lowered.docTables ?? []));
    fieldMetadata.push(lowered.metadata);
    if (lowered.code !== undefined) {
      extraCode.push(lowered.code);
    }
    if (lowered.unsupported !== undefined) {
      unsupported.push(...lowered.unsupported);
    }
    const member = camelCase(fieldName);
    nested.push(
      { field: fieldPath, authoredPath: [member], ...lowered.admits },
      ...(lowered.nested ?? []).map((field) => ({
        ...field,
        authoredPath: [member, ...(field.authoredPath ?? [])],
      }))
    );
    children.push(...(lowered.descents ?? []));
  }
  if (keyed !== null) {
    // Two ways the expansion could collide with the block's own named fields,
    // both declining rather than emitting a duplicate: a sibling that is also
    // an enum value would author as one member holding two shapes, and a
    // sibling named `entry` would take the interface name the shared entry
    // shape claims. Neither occurs in the vendored rules; the point is that
    // hitting one reports the block instead of generating a broken file.
    const taken = new Set([...grouped.keys()].map(camelCase));
    const collides =
      grouped.has("entry") || keyed.values.some((value) => taken.has(camelCase(value)));
    const expanded = collides ? null : enumKeyedMembers(emitter, keyed, name, path, ctx);
    if (expanded === null) {
      return null;
    }
    members.push(...expanded.members);
    fieldMetadata.push(...expanded.fieldMetadata);
    Object.assign(memberDocs, expanded.memberDocs);
    extraCode.push(expanded.code);
    unsupported.push(...expanded.unsupported);
    nested.push(...expanded.nested);
    children.push(...expanded.children);
    docTables.push(...expanded.docTables);
  }
  if (inlineTrigger !== undefined) {
    const whenType = withFrom(
      emitter,
      `${emitter.use("Trigger")}<${scopeArg(emitter, inlineTrigger)}>`,
      inlineTrigger
    );
    members.push(`  when?: ${whenType};\n`);
    memberDocs.when = { optional: true, docs: [], memberType: whenType };
    fieldMetadata.push('{ member: "when", shape: "inlineTrigger" }');
    nested.push({
      field: `${path}.when`,
      shape: "trigger",
      repeated: false,
      clause: "trigger",
      scope: inlineTrigger.scopes,
    });
  }
  if (members.length === 0) {
    return null;
  }
  const fieldsConstant = `${constantCase(typeName)}_FIELDS`;
  const generic = inlineTrigger === undefined ? undefined : ctx.nestedTypeParameter;
  return {
    typeName,
    memberType: generic === undefined ? typeName : `${typeName}<${generic.argument}>`,
    fieldsConstant,
    nested,
    children,
    docTables: [{ constant: fieldsConstant, members: memberDocs }, ...docTables],
    code:
      extraCode.join("") +
      `export interface ${typeName}${generic?.declaration ?? ""} {\n` +
      members.join("") +
      "}\n\n" +
      constArray(
        fieldsConstant,
        emitter.use("ContentField"),
        fieldMetadata.map((entry) => `  ${entry},\n`).join("")
      ),
    unsupported,
  };
}

/**
 * Lowers a map whose keys are engine names rather than ids the mod invents:
 * `section_slots = { mid = { locator = ... } }`.
 *
 * The CWT shape is the wildcard-keyed block `repeatedStruct`'s "container"
 * keying also matches, and the rules carry nothing that tells them apart — so
 * this is requested by the overlay, never inferred. See the `structMap` doc
 * there for why the identity rules must not apply to these keys.
 */
function lowerStructMap(
  emitter: Emitter,
  field: RuleField,
  name: string,
  path: string,
  ctx: FieldContext,
  typeNameOverride?: string
): LoweredField | null {
  const block = wildcardBlockOf(field.type);
  if (block === null) {
    return null;
  }
  const shape = structShape(
    emitter,
    block,
    name,
    path,
    containerContext(field, ctx),
    undefined,
    typeNameOverride
  );
  if (shape === null) {
    return null;
  }
  return {
    memberType: `Readonly<Record<string, ${shape.typeName}>>`,
    metadata: metadata(field, name, "structMap", [`fields: ${shape.fieldsConstant}`]),
    admits: { shape: "structMap", repeated: repeatsSiblings(field, "structMap") },
    code: shape.code,
    unsupported: shape.unsupported,
    docTables: shape.docTables,
    nested: shape.nested,
    // One field table serves every engine key, so the key itself never enters
    // the path the reader records — see `structMap` in {@link DescentNode}.
    descents: [{ field: name, mode: "structMap", children: shape.children }],
  };
}

/**
 * Lowers the scalar-valued form: `min_upgrade_cost = { <resource> = float }`.
 *
 * Keys stay `string` — `TypedRef` is a branded object and cannot type a
 * `Record` key, the same reason an economic block's `amounts` is
 * `Record<string, number>`.
 */
function lowerScalarMap(emitter: Emitter, field: RuleField, name: string): LoweredField | null {
  if (field.type.kind !== "block") {
    return null;
  }
  const values = field.type.fields.filter((inner) => inner.key.kind === "computed");
  if (values.length === 0 || values.length !== field.type.fields.length) {
    return null;
  }
  const value = emitter.unionFor(values.map((inner) => inner.type));
  if (value === null) {
    return null;
  }
  return {
    memberType: `Readonly<Record<string, ${emitter.useValue(value).type}>>`,
    metadata: metadata(field, name, "scalarMap"),
    admits: { shape: "scalarMap", repeated: repeatsSiblings(field, "scalarMap") },
  };
}

function lowerStruct(
  emitter: Emitter,
  field: RuleField,
  name: string,
  path: string,
  ctx: FieldContext
): LoweredField | null {
  const located = structBlockOf(field.type);
  if (located === null) {
    return null;
  }
  const { block, wrapped } = located;
  const shape = structShape(emitter, block, name, path, containerContext(field, ctx));
  if (shape === null) {
    return null;
  }
  const { typeName, fieldsConstant, code, unsupported } = shape;
  // `wrapped` nests the repetition inside one key, so the key itself only
  // repeats when CWT's own cardinality says so — matching `admits.repeated`
  // below, which the form calculation must agree with.
  const structRepeated = isRepeated(field.cardinality);
  const repeated = wrapped || structRepeated;
  const metadataMembers = [
    `key: ${JSON.stringify(name)}`,
    `member: ${JSON.stringify(camelCase(name))}`,
    `shape: "struct"`,
    `form: ${JSON.stringify(formOfShape({ shape: "struct", repeated: structRepeated, wrapped }))}`,
    `fields: ${fieldsConstant}`,
    ...(wrapped ? ["wrapped: true"] : []),
    ...(repeated ? ["repeated: true"] : []),
  ];
  return {
    memberType: repeated ? arrayType(typeName) : typeName,
    metadata: `{ ${metadataMembers.join(", ")} }`,
    admits: { shape: "struct", repeated: structRepeated, ...(wrapped ? { wrapped } : {}) },
    wrapped,
    code,
    unsupported,
    docTables: shape.docTables,
    nested: shape.nested,
    // `wrapped` is exactly the reader's distinction too: the container holds
    // bare anonymous blocks rather than being one.
    descents: [
      { field: name, mode: wrapped ? "wrappedStruct" : "struct", children: shape.children },
    ],
  };
}

function lowerTriggerStruct(
  emitter: Emitter,
  field: RuleField,
  name: string,
  path: string,
  ctx: FieldContext
): LoweredField | null {
  const located = triggerStructOf(field.type);
  if (located === null) {
    return null;
  }
  const container = containerContext(field, ctx);
  const triggerScope = contravariantScopeType(emitter, located.trigger, container);
  const shape = structShape(emitter, located.block, name, path, container, triggerScope);
  if (shape === null) {
    return null;
  }
  const repeated = isRepeated(field.cardinality);
  return {
    memberType: repeated ? arrayType(shape.memberType) : shape.memberType,
    metadata:
      `{ key: ${JSON.stringify(name)}, member: ${JSON.stringify(camelCase(name))}, ` +
      `shape: "triggerStruct", form: ${JSON.stringify(formOfShape({ shape: "triggerStruct", repeated }))}, ` +
      `fields: ${shape.fieldsConstant}${repeated ? ", repeated: true" : ""} }`,
    admits: { shape: "triggerStruct", repeated },
    code: shape.code,
    unsupported: shape.unsupported,
    docTables: shape.docTables,
    nested: shape.nested,
    descents: [
      {
        field: name,
        mode: "triggerStruct",
        ordinaryKeys: located.ordinaryKeys,
        children: shape.children,
      },
    ],
  };
}

function lowerOrdinary(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  const requested = override?.shape ?? derivedClauseShape(field);
  if (requested === "modifierBlock") {
    const scope = scopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: `${emitter.use("ModifierClosure")}<${scopeArg(emitter, scope)}>`,
      metadata: metadata(field, name, "modifierBlock"),
      admits: admitsBlock(field, "modifierBlock", scope),
    };
  }
  if (requested === "weightBlock") {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(
        emitter,
        `${emitter.use("WeightBlock")}<${scopeArg(emitter, scope)}>`,
        scope
      ),
      metadata: metadata(field, name, "weightBlock"),
      admits: admitsBlock(field, "weightBlock", scope),
      ...weightInterior(emitter, name, path, scope),
    };
  }
  if (requested === "weightBlockWithLoc") {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(
        emitter,
        `${emitter.use("WeightBlockWithLoc")}<${scopeArg(emitter, scope)}>`,
        scope
      ),
      metadata: metadata(field, name, "weightBlockWithLoc"),
      admits: admitsBlock(field, "weightBlockWithLoc", scope),
      ...weightInterior(emitter, name, path, scope),
    };
  }
  if (requested === "aliasStruct") {
    const category = override!.category!;
    const memberType = emitter.useAliasCategory(category, `${pascalCase(category)}Block`);
    return {
      memberType: isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
      metadata: metadata(field, name, "aliasStruct", [`category: ${JSON.stringify(category)}`]),
      admits: admitsBlock(field, "aliasStruct"),
    };
  }
  if (requested === "valueList") {
    return lowerValueList(emitter, field, name, widening, override?.quoted ?? false);
  }
  if (requested === undefined) {
    const triggerStruct = lowerTriggerStruct(emitter, field, name, path, ctx);
    if (triggerStruct !== null) {
      return triggerStruct;
    }
  }
  const category = spliceCategory(field.type);
  if (requested === "trigger" || (requested === undefined && category === "trigger")) {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(
        emitter,
        `${emitter.use("Trigger")}<${scopeArg(emitter, scope)}>`,
        scope
      ),
      metadata: metadata(field, name, "trigger"),
      admits: admitsBlock(field, "trigger", scope, "trigger"),
    };
  }
  if (requested === "effect" || (requested === undefined && category === "effect")) {
    const scope = scopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: `${emitter.use("EffectBlock")}<${effectBlockArgs(emitter, scope)}>`,
      metadata: metadata(field, name, "effect", splitRootMetadata(scope)),
      admits: admitsBlock(field, "effect", scope, "effect"),
    };
  }
  if (requested === undefined && category === "modifier_rule") {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(
        emitter,
        `${emitter.use("WeightBlock")}<${scopeArg(emitter, scope)}>`,
        scope
      ),
      metadata: metadata(field, name, "weightBlock"),
      admits: admitsBlock(field, "weightBlock", scope),
      ...weightInterior(emitter, name, path, scope),
    };
  }
  if (requested === undefined && category === "modifier_rule_with_loc") {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(
        emitter,
        `${emitter.use("WeightBlockWithLoc")}<${scopeArg(emitter, scope)}>`,
        scope
      ),
      metadata: metadata(field, name, "weightBlockWithLoc"),
      admits: admitsBlock(field, "weightBlockWithLoc", scope),
      ...weightInterior(emitter, name, path, scope),
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
        ctx
      );
    }
  }
  if (requested === "economicResources") {
    const scope = scopeType(emitter, field, ctx, override?.scope);
    const memberType = `${emitter.use("EconomicResourceBlock")}<${scopeArg(emitter, scope)}>`;
    return {
      memberType: withFrom(
        emitter,
        isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
        scope
      ),
      metadata: metadata(field, name, "economicResources"),
      admits: admitsBlock(field, "economicResources", scope),
    };
  }
  if (requested === "economicResourceOperation") {
    const parts = economicResourceOperationParts(field);
    const triggerScope = contravariantScopeType(
      emitter,
      parts.trigger,
      containerContext(field, ctx)
    );
    const memberType =
      `${emitter.use("EconomicResourceOperation")}` + `<${scopeArg(emitter, triggerScope)}>`;
    return {
      memberType: withFrom(
        emitter,
        isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
        triggerScope
      ),
      metadata: metadata(field, name, "economicResourceOperation"),
      admits: admitsBlock(field, "economicResourceOperation", triggerScope),
      ...economicResourceOperationInterior(name, path, triggerScope),
    };
  }
  if (requested === "economicResourcesNoProduce") {
    const scope = scopeType(emitter, field, ctx, override?.scope);
    const memberType =
      `${emitter.use("EconomicResourceBlockNoProduce")}` + `<${scopeArg(emitter, scope)}>`;
    return {
      memberType: withFrom(
        emitter,
        isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
        scope
      ),
      metadata: metadata(field, name, "economicResourcesNoProduce"),
      admits: admitsBlock(field, "economicResourcesNoProduce", scope),
    };
  }
  if (requested === "triggeredModifierBlock") {
    const modifierScope = scopeType(emitter, field, ctx, override?.scope);
    const potentialScope = scopeType(
      emitter,
      triggeredModifierPotential(field),
      containerContext(field, ctx)
    );
    const memberType =
      modifierScope.type === potentialScope.type
        ? `${emitter.use("TriggeredModifier")}<${scopeArg(emitter, modifierScope)}>`
        : `${emitter.use("TriggeredModifier")}<${scopeArg(emitter, modifierScope)}, ` +
          `${scopeArg(emitter, potentialScope)}>`;
    return {
      memberType: withFrom(
        emitter,
        isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
        modifierScope
      ),
      metadata: metadata(field, name, "triggeredModifierBlock"),
      admits: admitsBlock(field, "triggeredModifierBlock", modifierScope),
      ...triggeredModifierInterior(name, path, potentialScope),
    };
  }
  if (requested === "value") {
    return lowerValue(emitter, field, name, widening);
  }
  if (requested === "struct") {
    return lowerStruct(emitter, field, name, path, ctx);
  }
  if (requested === "structMap") {
    return lowerStructMap(emitter, field, name, path, ctx, override?.nestedTypeName);
  }
  if (requested === "scalarMap") {
    return lowerScalarMap(emitter, field, name);
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
    emitter.useValue(value);
    return {
      memberType: `readonly { weight: number; event?: ${value.type} }[]`,
      metadata: metadata(field, name, "weightedEvents", scalarMetadata(value)),
      admits: admitsBlock(field, "weightedEvents"),
    };
  }
  const bare = bareValuesOf(field.type);
  if (bare !== null) {
    // A single bare block, rather than a bare scalar, is the "wrapped" spelling
    // of a repeated struct (see structBlockOf) — try that before treating it as
    // a scalar list, and don't fall through to a scalar reading if it declines,
    // since that would misread the block as an empty/invalid scalar list.
    if (bare.length === 1 && bare[0]!.kind === "block") {
      return lowerStruct(emitter, field, name, path, ctx);
    }
    const asList = lowerValueList(emitter, field, name, widening, false);
    if (asList !== null) {
      return asList;
    }
  }
  const struct = lowerStruct(emitter, field, name, path, ctx);
  if (struct !== null) {
    return struct;
  }
  return lowerValue(emitter, field, name, widening);
}

/**
 * A field CWT declares both as a scalar and as a block accepts both, lowered at
 * runtime by whichever form the author passes.
 *
 * Picking one declaration is wrong in whichever direction that registry's
 * corpus leans, and the shipped game writes both: vanilla writes
 * `stages.end = 100` 254 times against 1 block, while `opinion_modifier.opinion`
 * needs the block's gated adjustments; `starbase_level.picture` is a bare
 * `<sprite>` in 18 definitions and a trigger-gated block in 9. Whichever arm
 * first-wins picking dropped became a form no author could produce, and a
 * presence-only corpus check could not see it.
 *
 * Both arms lower through the ordinary pipeline, so the pairing is not limited
 * to any particular combination: a scalar beside a weight block, a struct, a
 * trigger, or a bare list all fall out the same way.
 */
function lowerDual(
  emitter: Emitter,
  group: readonly RuleField[],
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  const scalarArms = group.filter((field) => field.type.kind !== "block");
  const blockArms = group.filter((field) => field.type.kind === "block");
  if (scalarArms.length === 0 || blockArms.length === 0) {
    return null;
  }
  const scalar = pickOrdinary(emitter, scalarArms, name, ctx, undefined, widening, path);
  const block = pickOrdinary(emitter, blockArms, name, ctx, override, widening, path);
  if (scalar === null || block === null) {
    return null;
  }
  // Declaration order, so the emitted union reads in the order the rules do.
  const arms =
    group.indexOf(scalarArms[0]!) < group.indexOf(blockArms[0]!)
      ? [scalar, block]
      : [block, scalar];
  // Both arms share one key and one authoring member, so the writer can only
  // tell them apart by what the author passed. Two arms accepting the same form
  // — a repeated bool beside a bare value list, both arrays — are
  // indistinguishable, and declining is the honest answer. Where the *arity* is
  // what makes them collide rather than the shapes, an `arity` assertion fixes
  // it upstream of here.
  const forms = arms.map((arm) =>
    formOfShape({
      shape: contentShape(arm.admits.shape),
      repeated: arm.admits.repeated,
      wrapped: arm.wrapped,
    })
  );
  if (new Set(forms).size !== forms.length) {
    return null;
  }
  return {
    memberType: arms.map((arm) => arm.memberType).join(" | "),
    metadata:
      `{ key: ${JSON.stringify(name)}, member: ${JSON.stringify(camelCase(name))}, ` +
      `shape: "dual", arms: [${arms.map((arm) => arm.metadata).join(", ")}] }`,
    admits: {
      shape: "dual",
      // The key repeats if any arm lets it: `situation_type.picture` is one
      // scalar or N trigger-gated blocks.
      repeated: arms.some((arm) => arm.admits.repeated),
      ...(scalar.admits.literals === undefined ? {} : { literals: scalar.admits.literals }),
      ...(block.admits.scope === undefined ? {} : { scope: block.admits.scope }),
      ...(block.admits.clause === undefined ? {} : { clause: block.admits.clause }),
    },
    code: arms.map((arm) => arm.code ?? "").join(""),
    unsupported: arms.flatMap((arm) => arm.unsupported ?? []),
    docTables: arms.flatMap((arm) => arm.docTables ?? []),
    // The block arm alone: a scalar arm has no interior, and both arms share
    // the one key the reader descends from.
    ...(block.nested === undefined ? {} : { nested: block.nested }),
    ...(block.descents === undefined ? {} : { descents: block.descents }),
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
  const base = emitter.useValue(value).type + (widening === undefined ? "" : ` | ${widening}`);
  return {
    memberType: repeated[0]! ? arrayType(base) : base,
    metadata: metadata(group[0]!, name, "value", scalarMetadata(value)),
    admits: admitsScalars(group[0]!, "value", widening === undefined ? value : null),
  };
}

/**
 * Applies an overlay arity assertion by correcting the declared cardinality.
 *
 * Everything downstream — the member type, the field metadata's `repeated`, the
 * shape descriptor — already reads the cardinality, so correcting it once here
 * is what keeps the three from disagreeing about whether the key repeats. The
 * minimum is left alone in both directions: how often a key may be written is a
 * different claim from whether it must be.
 */
function assertedArity(
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined
): readonly RuleField[] {
  const max = override?.arity === "single" ? 1 : override?.arity === "repeated" ? null : undefined;
  if (max === undefined) {
    return group;
  }
  return group.map((field) => ({ ...field, cardinality: { ...field.cardinality, max } }));
}

/**
 * Applies `uncheckedString` by rewriting the declaration itself: a `<type>`
 * reference becomes a plain `scalar`, which is already how CWT spells "any
 * string" and which every emitter below already knows how to lower.
 *
 * Rewriting the rule rather than patching the lowered result is what keeps the
 * member type, the metadata's `conversion`, the absent `refTypes` and the
 * corpus gate's view of the field from having to be corrected one by one. The
 * doc line rides on the same field, so it reaches the generated comment through
 * the ordinary path.
 *
 * The guard is the point of the lever being narrow: every declaration in the
 * group must be a bare `<type>` reference and the row must request no shape.
 * Anything else and this would be erasing a check nobody asked it to.
 */
function assertedUncheckedString(
  emitter: Emitter,
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined,
  path: string
): { readonly group: readonly RuleField[]; readonly docs: readonly string[] } {
  if (override?.uncheckedString !== true) {
    return { group, docs: [] };
  }
  const targets = group.map((field) => field.type);
  if (override.shape !== undefined || targets.some((type) => type.kind !== "typeRef")) {
    const spelled = targets.map((type) => type.kind).join(", ");
    throw new Error(
      `The overlay marks ${path} uncheckedString, but its lowering is not a plain type ` +
        `reference (shape: ${override.shape ?? "none"}, declarations: ${spelled}). The lever ` +
        "only weakens a reference check; it must not erase any other checking."
    );
  }
  const docs = targets.flatMap((type) => {
    const name = (type as Extract<RuleType, { kind: "typeRef" }>).name;
    const target = emitter.rules.contentTypes.get(name);
    const where =
      target?.path == null
        ? "outside the SDK's typed registries"
        : `in \`${target.pathExtension ?? ".txt"}\` files under ` +
          `\`${target.path.replace(/^game\//, "")}\``;
    return [
      "Not checked: any string is accepted here.",
      `The \`<${name}>\` ids this names live ${where},`,
      "which the SDK carries as opaque Assets rather than as a typed registry,",
      "so there is no id set to check a spelling against.",
    ];
  });
  return { group: group.map((field) => ({ ...field, type: { kind: "scalar" } })), docs };
}

/**
 * Applies an `ASSET_PATH_FIELDS` row: the member accepts a captured Asset as
 * well as a string, and the metadata says so, so the writer unwraps the Item to
 * its declared logical path and the fold checks whichever form arrived.
 *
 * Applied to the lowered result rather than by rewriting the rule, because
 * unlike `uncheckedString` there is no CWT spelling that already means this —
 * the rules type the field `filepath` and are right to; what the row adds is
 * the SDK's own knowledge that this particular path is one a mod can ship.
 *
 * The guards are what keep the row honest. A `filepath` declaration is required
 * because the row asserts the value is a path; a `value` shape is required
 * because an Item is one scalar; and a widening is refused because the union
 * arms would then be unclear about which of them an Item satisfies.
 *
 * Presence — every `ASSET_PATH_FIELDS` row reaching a real consumption site —
 * is tracked through `emitter.overlayAudit`, the same SDK-255 mechanism every
 * other path-keyed overlay table uses (`index.ts`'s `assertAllApplied("ASSET_PATH_FIELDS",
 * ...)` closes the loop); this function's own throw above is the *shape* check
 * beyond presence, that a row marked here actually lowers as one mod-root path
 * scalar, which `OverlayAudit` cannot express and stays here.
 */
function assertedAssetPath(
  emitter: Emitter,
  lowered: LoweredField | null,
  group: readonly RuleField[],
  name: string,
  widening: string | undefined,
  path: string
): LoweredField | null {
  if (!ASSET_PATH_FIELDS.has(path)) {
    return lowered;
  }
  emitter.overlayAudit.applied("ASSET_PATH_FIELDS", path);
  const spelled = group.map((field) => field.type.kind).join(", ");
  if (
    lowered === null ||
    lowered.admits.shape !== "value" ||
    widening !== undefined ||
    !group.every((field) => field.type.kind === "filepath")
  ) {
    throw new Error(
      `The overlay marks ${path} an asset path, but it does not lower as one (shape: ` +
        `${lowered?.admits.shape ?? "none"}, declarations: ${spelled}, widening: ` +
        `${widening ?? "none"}). The row asserts the value is one mod-root path scalar.`
    );
  }
  const base = `${emitter.use("AssetFileItem")} | string`;
  const field = group[0]!;
  return {
    ...lowered,
    memberType: repeatsSiblings(field, "value") ? arrayType(base) : base,
    metadata: metadata(field, name, "value", ['conversion: "assetPath"']),
    docs: [
      ...(lowered.docs ?? []),
      "A path from the mod root. An Asset file placed in a Feature lowers to its declared",
      "logical path; a plain string is written as it stands and checked at build time against",
      "the paths this mod captures and the vanilla file inventory, as a warning rather than an",
      "error — a DLC or third-party path is legitimate here.",
    ],
  };
}

export function pickOrdinary(
  emitter: Emitter,
  declared: readonly RuleField[],
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  return assertedAssetPath(
    emitter,
    pickLowering(emitter, declared, name, ctx, override, widening, path),
    declared,
    name,
    widening,
    path
  );
}

function pickLowering(
  emitter: Emitter,
  declared: readonly RuleField[],
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  const unchecked = assertedUncheckedString(
    emitter,
    assertedArity(declared, override),
    override,
    path
  );
  const group = unchecked.group;
  const documented = (lowered: LoweredField | null): LoweredField | null =>
    lowered === null || unchecked.docs.length === 0
      ? lowered
      : { ...lowered, docs: unchecked.docs };
  if (override?.shape === undefined && group.length > 1) {
    const dual = lowerDual(emitter, group, name, ctx, override, widening, path);
    if (dual !== null) {
      return documented(dual);
    }
    const union = lowerScalarUnion(emitter, group, name, widening);
    if (union !== null) {
      return documented(union);
    }
  }
  for (const field of group) {
    const lowered = lowerOrdinary(emitter, field, name, ctx, override, widening, path);
    if (lowered !== null) {
      return documented(lowered);
    }
  }
  return null;
}

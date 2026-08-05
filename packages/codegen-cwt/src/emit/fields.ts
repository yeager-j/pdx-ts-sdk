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

import type { DescentNode } from "../corpus.ts";
import {
  isOptional,
  isRepeated,
  type FieldKey,
  type RuleField,
  type RuleType,
  type ScopeContext,
} from "../cwt/model.ts";
import type { AliasDecl } from "../cwt/rules.ts";
import { camelCase, docComment, indefiniteArticle, isPlainName, pascalCase } from "../naming.ts";
import { CONTENT_FIELD_OVERRIDES, FIELD_WIDENINGS, type ContentFieldOverride } from "../overlay.ts";
import { formOfShape } from "./authored-form.ts";
import { Emitter, type TsValue } from "./types.ts";

/**
 * One lowered field, described in the terms a real PDXScript value can be
 * measured against: block or scalar, repeatable or not, which scalars it
 * admits, which scope its closures run in.
 *
 * The corpus gate used to see field *names* only, which is what limited it to
 * presence checking — `stages.end` could be block-typed against 254 scalar
 * writes and still report full coverage. See `docs/roadmap.md`'s "Shape
 * conformance".
 */
export interface EmittedField {
  /** The game's own key, or a dotted path for one lowered inside a struct. */
  readonly field: string;
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
  /** Extra top-level declarations a nested struct level needed, prepended by the caller. */
  readonly code?: string;
  /** Paths bubbled up from a nested struct level, already prefixed. */
  readonly unsupported?: readonly string[];
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

/**
 * The scope a field's closures run in.
 *
 * `asserted` is an overlay row's declared scope, which wins over the rules —
 * see `ContentFieldOverride.scope` for when that is legitimate. A bad scope
 * name there throws rather than falling back to `ScopeName`: silently widening
 * would turn a typo into a field that accepts nothing useful, which is the very
 * failure the row exists to fix.
 */
/**
 * What a field's lowering needs to know about the definition enclosing it.
 *
 * `unpinned` is the type an unannotated scope lowers to. Normally `ScopeName`,
 * which admits only rules legal in every scope; for a registry whose scope is a
 * parameter of the definition (see `CONTENT_SCOPE_PARAMETERS`) it is that
 * parameter instead, so the clauses follow whatever the definition declared.
 *
 * `scope` is the effective `ScopeContext` in force at this point in the
 * recursion — the type's own top-level scope at the root, and, beneath a
 * struct field that itself carries a `field.scope` (`## replace_scopes`/
 * `## push_scope` on the struct field, not on the leaf), that field's scope
 * merged onto whatever was in force above it. `containerContext` builds that
 * merge and `structShape` recurses with the result, so a leaf with no
 * annotation of its own (`governments.cwt`'s `modification.add`/`remove`,
 * scoped only by the enclosing `modification` container) still resolves the
 * container's scope through the same `field.scope?.this ?? ctx.scope?.this`
 * fallback `scopeType`/`fromType` use for a leaf's own annotation.
 */
export interface FieldContext {
  readonly scope: ScopeContext | null;
  readonly unpinned: string;
}

interface FieldScope {
  /** The TS type parameter: one canonical scope literal, or the unpinned type. */
  readonly type: string;
  /** The same thing as data, `"any"` where nothing pinned it. */
  readonly scopes: readonly string[] | "any";
  /**
   * The scope FROM holds inside this block, as a TS literal type, when the
   * rules name one. `null` where they do not — including their `from = any`,
   * which names no scope and must stay unreadable rather than lower to
   * something an author could navigate through.
   *
   * Read from the rules even when `asserted` overrides `this`: an overlay row
   * corrects the scope a block *runs* in, which says nothing about what the
   * game hands it as FROM.
   */
  readonly from: string | null;
}

/**
 * The scope FROM holds inside one field's block.
 *
 * A field's own `replace_scopes` states the whole context, so a FROM it leaves
 * out is cleared rather than inherited — unlike `this`, which every annotation
 * names. Only a `push_scope` (or no annotation at all) leaves the enclosing
 * definition's FROM standing.
 */
function fromType(emitter: Emitter, field: RuleField, ctx: FieldContext): string | null {
  const declared =
    field.scope?.replaces === true ? field.scope.from : (field.scope?.from ?? ctx.scope?.from);
  if (declared === undefined || declared === null) {
    return null;
  }
  const canonical = emitter.canonicalScope(declared);
  return canonical === null ? null : JSON.stringify(canonical);
}

function scopeType(
  emitter: Emitter,
  field: RuleField,
  ctx: FieldContext,
  asserted?: string
): FieldScope {
  const from = fromType(emitter, field, ctx);
  if (asserted !== undefined) {
    const canonical = emitter.canonicalScope(asserted);
    if (canonical === null) {
      throw new Error(`Overlay asserts unknown scope "${asserted}"`);
    }
    return { type: JSON.stringify(canonical), scopes: [canonical], from };
  }
  const unpinned: FieldScope = { type: ctx.unpinned, scopes: "any", from };
  const declared = field.scope?.this ?? ctx.scope?.this;
  if (declared === undefined || declared === null) {
    return unpinned;
  }
  const canonical = emitter.canonicalScope(declared);
  return canonical === null
    ? unpinned
    : { type: JSON.stringify(canonical), scopes: [canonical], from };
}

/**
 * `EffectBlock`'s type arguments: the block's own scope, plus the scope its
 * closure's `ctx.from` holds where the rules declare one. A block with no
 * declared FROM emits the one-argument form, so the default keeps FROM
 * unreadable there rather than admitting a ref the game will not honour.
 */
function effectBlockArgs(scope: FieldScope): string {
  return scope.from === null ? scope.type : `${scope.type}, ${scope.from}`;
}

/**
 * Wraps a declarative member type in `WithFrom` where the rules give the block
 * a FROM, adding the closure form that can reach it.
 *
 * A trigger and a weight block are values rather than closures, so unlike an
 * effect field there is no argument list to hand FROM to — the closure form is
 * that argument list. Only fields with a FROM get it: the plain form stays the
 * only way to write a condition that has no FROM to name.
 */
function withFrom(inner: string, scope: FieldScope): string {
  return scope.from === null ? inner : `WithFrom<${inner}, ${scope.type}, ${scope.from}>`;
}

/**
 * The `ScopeContext` a struct field's own children run in, given the field's
 * own annotation (if any) and whatever scope was already in force above it.
 *
 * `## replace_scope(s)` states the whole context, so `root`/`from` it leaves
 * out are cleared rather than inherited — `scopeOf` already returns them as
 * `null` in that case, which is what `replaces: true` here passes through
 * unchanged. `## push_scope` states only `this` (`scopeOf` always reports its
 * `root`/`from` as `null`, `replaces: false`), so those two carry over from
 * the parent instead of clearing.
 */
function pushedScope(fieldScope: ScopeContext, parentScope: ScopeContext | null): ScopeContext {
  return fieldScope.replaces
    ? fieldScope
    : {
        this: fieldScope.this,
        root: parentScope?.root ?? null,
        from: parentScope?.from ?? null,
        replaces: false,
      };
}

/**
 * The `ctx` a struct field's own body recurses with.
 *
 * `structShape` types every one of a container's fields against the `ctx`
 * built here: a container that itself carries a `field.scope`
 * (`governments.cwt`'s `modification`, `## replace_scopes = { this = country
 * root = country }`) folds that annotation into `ctx.scope` via
 * {@link pushedScope}, so `add`/`remove` beneath it — themselves unannotated —
 * resolve "country" through the same fallback an annotated leaf uses. A field
 * with no `field.scope` passes `ctx` through unchanged, leaving whatever scope
 * was already in force (including one folded in by an enclosing container)
 * standing.
 */
function containerContext(field: RuleField, ctx: FieldContext): FieldContext {
  return field.scope === null ? ctx : { ...ctx, scope: pushedScope(field.scope, ctx.scope) };
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

/**
 * As {@link scopeType}, for shapes whose scope parameter reaches a
 * `Trigger<S>` contravariantly — a trigger field itself, and a weight block,
 * whose rows carry `when: Trigger<S>`.
 *
 * `Trigger<in S>` is contravariant, so the unpinned literal `ScopeName`
 * ("valid in every scope") types the field as accepting only conditions
 * legal in every scope — for most fields none, which makes the field
 * unwritable rather than unchecked. `never` is the top of that lattice:
 * substituting it is what "the rules did not say" should mean, the same way
 * an unknown reference target lowers to `| string` rather than to something
 * nothing can satisfy. Only the truly-unpinned case changes — a field a
 * `CONTENT_SCOPE_PARAMETERS` row threads through as `NoInfer<S>`, or one an
 * override, the rules themselves, or an enclosing container (see
 * {@link containerContext}) pin to a real scope, is untouched: any of those
 * already leave `scope.type` at something other than `ScopeName`, so the
 * widen below never fires for them.
 */
function contravariantScopeType(
  emitter: Emitter,
  field: RuleField,
  ctx: FieldContext,
  asserted?: string
): FieldScope {
  const scope = scopeType(emitter, field, ctx, asserted);
  return scope.type === "ScopeName" ? { ...scope, type: "never" } : scope;
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

export type AliasNameField = RuleField & { readonly key: Extract<FieldKey, { kind: "aliasName" }> };

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

/**
 * Lowers a structural splice to one authoring member holding an ordered array
 * of that category's blocks.
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
    memberType: arrayType(spliceTypeName(category)),
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
    memberType: `ModifierClosure<${scope.type}>`,
    metadata: `{ member: "modifiers", shape: "inlineModifiers" }`,
    docs: [
      "Modifiers written directly into the definition body, with no enclosing key.",
      ...field.docs,
    ],
  };
}

export function constantCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/** The sentence-initial form; the rule itself lives in naming.ts. */
export function capitalizedArticle(name: string): "A" | "An" {
  return indefiniteArticle(name) === "an" ? "An" : "A";
}

function conversionFor(value: TsValue): "identity" | "ref" {
  return value.toScalar("x") === "x" ? "identity" : "ref";
}

/**
 * The scalar-lowering half of a field's metadata: how to turn the authored
 * value into an id, and — when the rules say every admitted form is a
 * reference — which registries that id must come from. The second half is what
 * lets `buildMod` hold an own-prefixed reference to the registry it names.
 */
function scalarMetadata(value: TsValue): string[] {
  return [
    `conversion: ${JSON.stringify(conversionFor(value))}`,
    ...(value.refTypes === undefined ? [] : [`refTypes: ${JSON.stringify(value.refTypes)}`]),
  ];
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
    `form: ${JSON.stringify(formOfShape({ shape, repeated }))}`,
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
  const listType = arrayType(value.type);
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
  readonly fieldsConstant: string;
  /** The interface and field-table declarations, for the caller to prepend. */
  readonly code: string;
  readonly unsupported: readonly string[];
  /** Each member's admits at `${path}.${name}`, plus whatever they nest in turn. */
  readonly nested: readonly EmittedField[];
  /** Descent nodes for the members that are themselves blocks worth walking. */
  readonly children: readonly DescentNode[];
}

/**
 * Builds the interface and runtime field table for one anonymous block's named
 * members, recursing through the ordinary field pipeline so a struct nested
 * inside a struct falls out for free.
 *
 * Declines a block holding a splice (`alias_name`), subtype, or computed key:
 * those are invisible to `mergeByName`, so emitting only the ordinary fields
 * would silently drop the rest. The caller reports the path as unsupported.
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
  ctx: FieldContext
): StructShape | null {
  if (block.fields.some((inner) => inner.key.kind !== "name")) {
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
  const nested: EmittedField[] = [];
  const children: DescentNode[] = [];
  for (const [fieldName, group] of grouped) {
    const fieldPath = `${path}.${fieldName}`;
    const lowered = pickOrdinary(
      emitter,
      group,
      fieldName,
      ctx,
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
    nested.push({ field: fieldPath, ...lowered.admits }, ...(lowered.nested ?? []));
    children.push(...(lowered.descents ?? []));
  }
  if (members.length === 0) {
    return null;
  }
  const fieldsConstant = `${constantCase(typeName)}_FIELDS`;
  return {
    typeName,
    fieldsConstant,
    nested,
    children,
    code:
      extraCode.join("") +
      `export interface ${typeName} {\n` +
      members.join("") +
      "}\n\n" +
      `export const ${fieldsConstant}: readonly ContentField[] = [\n` +
      fieldMetadata.map((entry) => `  ${entry},\n`).join("") +
      "];\n\n",
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
  ctx: FieldContext
): LoweredField | null {
  const block = wildcardBlockOf(field.type);
  if (block === null) {
    return null;
  }
  const shape = structShape(emitter, block, name, path, containerContext(field, ctx));
  if (shape === null) {
    return null;
  }
  return {
    memberType: `Readonly<Record<string, ${shape.typeName}>>`,
    metadata: metadata(field, name, "structMap", [`fields: ${shape.fieldsConstant}`]),
    admits: { shape: "structMap", repeated: repeatsSiblings(field, "structMap") },
    code: shape.code,
    unsupported: shape.unsupported,
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
    memberType: `Readonly<Record<string, ${value.type}>>`,
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
    nested: shape.nested,
    // `wrapped` is exactly the reader's distinction too: the container holds
    // bare anonymous blocks rather than being one.
    descents: [
      { field: name, mode: wrapped ? "wrappedStruct" : "struct", children: shape.children },
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
  const requested = override?.shape;
  if (requested === "modifierBlock") {
    const scope = scopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: `ModifierClosure<${scope.type}>`,
      metadata: metadata(field, name, "modifierBlock"),
      admits: admitsBlock(field, "modifierBlock", scope),
    };
  }
  if (requested === "weightBlock") {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(`WeightBlock<${scope.type}>`, scope),
      metadata: metadata(field, name, "weightBlock"),
      admits: admitsBlock(field, "weightBlock", scope),
      ...weightInterior(emitter, name, path, scope),
    };
  }
  if (requested === "weightBlockWithLoc") {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(`WeightBlockWithLoc<${scope.type}>`, scope),
      metadata: metadata(field, name, "weightBlockWithLoc"),
      admits: admitsBlock(field, "weightBlockWithLoc", scope),
      ...weightInterior(emitter, name, path, scope),
    };
  }
  if (requested === "aliasStruct") {
    const category = override!.category!;
    const memberType = `${pascalCase(category)}Block`;
    return {
      memberType: isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
      metadata: metadata(field, name, "aliasStruct", [`category: ${JSON.stringify(category)}`]),
      admits: admitsBlock(field, "aliasStruct"),
    };
  }
  if (requested === "valueList") {
    return lowerValueList(emitter, field, name, widening, override?.quoted ?? false);
  }
  const category = spliceCategory(field.type);
  if (requested === "trigger" || (requested === undefined && category === "trigger")) {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(`Trigger<${scope.type}>`, scope),
      metadata: metadata(field, name, "trigger"),
      admits: admitsBlock(field, "trigger", scope, "trigger"),
    };
  }
  if (requested === "effect" || (requested === undefined && category === "effect")) {
    const scope = scopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: `EffectBlock<${effectBlockArgs(scope)}>`,
      metadata: metadata(field, name, "effect"),
      admits: admitsBlock(field, "effect", scope, "effect"),
    };
  }
  if (requested === undefined && category === "modifier_rule") {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(`WeightBlock<${scope.type}>`, scope),
      metadata: metadata(field, name, "weightBlock"),
      admits: admitsBlock(field, "weightBlock", scope),
      ...weightInterior(emitter, name, path, scope),
    };
  }
  if (requested === undefined && category === "modifier_rule_with_loc") {
    const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
    return {
      memberType: withFrom(`WeightBlockWithLoc<${scope.type}>`, scope),
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
    const memberType = `EconomicResourceBlock<${scope.type}>`;
    return {
      memberType: withFrom(
        isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
        scope
      ),
      metadata: metadata(field, name, "economicResources"),
      admits: admitsBlock(field, "economicResources", scope),
    };
  }
  if (requested === "economicResourcesNoProduce") {
    const scope = scopeType(emitter, field, ctx, override?.scope);
    const memberType = `EconomicResourceBlockNoProduce<${scope.type}>`;
    return {
      memberType: withFrom(
        isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
        scope
      ),
      metadata: metadata(field, name, "economicResourcesNoProduce"),
      admits: admitsBlock(field, "economicResourcesNoProduce", scope),
    };
  }
  if (requested === "triggeredModifierBlock") {
    const scope = scopeType(emitter, field, ctx, override?.scope);
    const memberType = `TriggeredModifier<${scope.type}>`;
    return {
      memberType: withFrom(
        isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
        scope
      ),
      metadata: metadata(field, name, "triggeredModifierBlock"),
      admits: admitsBlock(field, "triggeredModifierBlock", scope),
    };
  }
  if (requested === "value") {
    return lowerValue(emitter, field, name, widening);
  }
  if (requested === "struct") {
    return lowerStruct(emitter, field, name, path, ctx);
  }
  if (requested === "structMap") {
    return lowerStructMap(emitter, field, name, path, ctx);
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
 * presence-only corpus check could not see it — see `docs/roadmap.md`'s
 * "Shape conformance".
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
    formOfShape({ shape: arm.admits.shape, repeated: arm.admits.repeated, wrapped: arm.wrapped })
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
  const base = value.type + (widening === undefined ? "" : ` | ${widening}`);
  return {
    memberType: repeated[0]! ? arrayType(base) : base,
    metadata: metadata(group[0]!, name, "value", scalarMetadata(value)),
    admits: admitsScalars(group[0]!, "value", widening === undefined ? value : null),
  };
}

/**
 * Applies an overlay arity assertion by narrowing the declared cardinality.
 *
 * Everything downstream — the member type, the field metadata's `repeated`, the
 * shape descriptor — already reads the cardinality, so correcting it once here
 * is what keeps the three from disagreeing about whether the key repeats.
 */
function assertedArity(
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined
): readonly RuleField[] {
  if (override?.arity !== "single") {
    return group;
  }
  return group.map((field) => ({ ...field, cardinality: { ...field.cardinality, max: 1 } }));
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
  const group = assertedArity(declared, override);
  if (override?.shape === undefined && group.length > 1) {
    const dual = lowerDual(emitter, group, name, ctx, override, widening, path);
    if (dual !== null) {
      return dual;
    }
    const union = lowerScalarUnion(emitter, group, name, widening);
    if (union !== null) {
      return union;
    }
  }
  for (const field of group) {
    const lowered = lowerOrdinary(emitter, field, name, ctx, override, widening, path);
    if (lowered !== null) {
      return lowered;
    }
  }
  return null;
}

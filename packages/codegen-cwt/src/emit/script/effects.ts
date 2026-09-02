/**
 * Emits the effect scope interfaces and the recorder's metadata table.
 *
 * Two outputs, one design:
 *
 * - `effects.ts` — TYPES only. Effects and scope-link paths independently
 *   cluster by the exact set of scopes they are valid in; each distinct set
 *   becomes one interface carrying its members once, and the per-scope
 *   interfaces are `extends` compositions.
 * - `effect-meta.ts` — DATA. One entry per method telling the runtime
 *   recorder (`packages/sdk/src/script/effects/recorder.ts`, a single scope-agnostic
 *   Proxy) how to serialize the call. The Proxy throws on names missing from this table.
 *   Serialized by the sibling `effect-meta.ts` emitter over the clusters this
 *   file builds.
 *
 * Scopes come from the rules' `## scopes` with the game dump as fallback,
 * exactly like triggers. Nothing is dropped silently: every effect the
 * emitter cannot type is skipped with a named reason and reported.
 */

import type { Cardinality, RuleField, RuleType } from "../../cwt/model.ts";
import { Emitter, type TsValue } from "../../emit/typescript.ts";
import type { DocEntry } from "../../logs/trigger-docs.ts";
import type { ClassifiedLink } from "../../lower/links.ts";
import {
  loweredRuleConflictSkips,
  type LoweredRule,
  type LoweredRuleBlock,
} from "../../lower/lowered-rule.ts";
import {
  aliasListMembers,
  canonicalScopeSet,
  clauseScopeContext,
  expandAliasFields,
  mergeBlock,
  pureSpliceCategory,
  skippedRule,
  skipReason,
  type ArgField,
  type ArgValue,
  type ClauseCategory,
  type MapValue,
  type SkippedRule,
  type SkipReason,
} from "../../lower/script-shape.ts";
import {
  camelCase,
  compareStrings,
  docComment,
  isPlainName,
  pascalCase,
  safeIdentifier,
} from "../../naming.ts";
import {
  EFFECT_EXTENSION_SEAMS,
  EFFECT_FIELD_ADDITIONS,
  EFFECT_FIELD_CARDINALITY_OVERRIDES,
  EFFECT_FIELD_TYPE_OVERRIDES,
  EFFECT_VALUE_TYPE_OVERRIDES,
  EXTRA_ALIAS_CATEGORIES,
  SCRIPT_ALIAS_CATEGORIES,
  type AliasCategoryScriptList,
  type EffectFieldAddition,
  type EffectFieldCardinalityOverride,
} from "../../overlay/index.ts";
import type { EffectPolicy } from "../../policy/effects.ts";
import { member as renderMember } from "../../render/writer.ts";
import { aliasStructTypeName } from "../content/alias-struct.ts";
import { canonicalThisScope, scopeUnionType } from "../scope-context.ts";
import { canonicalScopes } from "../support.ts";
import { effectMetaCode } from "./effect-meta.ts";
import type { ScriptEffectReferenceRow, ScriptScopeLinkReferenceRow } from "./script-reference.ts";
import { tsDoc } from "./triggers.ts";
import { cardinalityArrayType, mapType, repeatedMemberType } from "./type-projection.ts";

const EFFECT_CLAUSES = new Set<ClauseCategory>(["trigger", "effect", "modifier_rule"]);

/** The occurrence count an overlay row asserts when it says a field repeats. */
const UNBOUNDED: Cardinality = { min: 0, max: null };

/**
 * What an effect argument block may splice: the nested clause categories, plus
 * every loaded alias category the overlay gives a script authoring surface.
 * Triggers pass their own, narrower set, so an alias list stays out of a
 * surface that has no way to write one.
 */
const EFFECT_SPLICES = new Set<string>([...EFFECT_CLAUSES, ...SCRIPT_ALIAS_CATEGORIES]);

/** One spliced alias category's lowered members and the type they are authored as. */
interface AliasListSurface extends AliasCategoryScriptList {
  /** The category's members, lowered as ordinary argument fields. */
  readonly members: readonly ArgField[];
}

/**
 * Lowers every alias category the overlay lists as a script list.
 *
 * A row promises an authoring surface, so a member the field model cannot
 * lower fails generation here rather than silently removing an action from the
 * emitted union.
 */
function aliasListSurfaces(emitter: Emitter): Map<string, AliasListSurface> {
  const surfaces = new Map<string, AliasListSurface>();
  for (const [category, row] of EXTRA_ALIAS_CATEGORIES) {
    if (row.scriptList === undefined) {
      continue;
    }
    const members = aliasListMembers(emitter, category, EFFECT_SPLICES);
    if (!Array.isArray(members)) {
      throw new Error(
        `EXTRA_ALIAS_CATEGORIES gives "${category}" a script list, but its members do not ` +
          `lower (${members.detail}) — retire the row or fix the lowering`
      );
    }
    surfaces.set(category, { ...row.scriptList, members });
  }
  return surfaces;
}

/** Generated effect modules, report totals, and script-reference projections. */
export interface EffectEmission {
  /** Complete generated `effects.ts` interface text. */
  readonly interfaces: string;
  /** Complete generated `effect-meta.ts` module text. */
  readonly meta: string;
  /** Number of effect rules represented by generated methods. */
  readonly emitted: number;
  /** Emitted effect count grouped by lowered argument shape. */
  readonly byShape: ReadonlyMap<string, number>;
  /** Effect rules excluded from generation, with stable reasons. */
  readonly skipped: readonly SkippedRule[];
  /** Number of distinct generated effect scope clusters. */
  readonly clusterCount: number;
  /**
   * Type parameters declared by the universal effect cluster, empty when it
   * declares none. A module augmentation of that interface has to repeat them
   * exactly, so it reads them here rather than restating the rule.
   */
  readonly universalParameters: string;
  /** `EFFECT_FIELD_TYPE_OVERRIDES` rows applied, with the reason each states. */
  readonly fieldTypeOverrides: readonly string[];
  /** `EFFECT_FIELD_ADDITIONS` rows applied, with their evidence and rationale. */
  readonly fieldAdditions: readonly string[];
  /** `EFFECT_FIELD_CARDINALITY_OVERRIDES` rows applied, with their evidence and rationale. */
  readonly fieldCardinalityOverrides: readonly string[];
  /** Scope-link path properties emitted from the shared link table. */
  readonly linkEmitted: number;
  /** Machine-readable rows projected from the post-overlay effect clusters. */
  readonly references: readonly ScriptEffectReferenceRow[];
  /** Machine-readable rows projected from the post-classification link clusters. */
  readonly scopeLinkReferences: readonly ScriptScopeLinkReferenceRow[];
}

/**
 * Serializable argument shape shared by an effect's type and recorder metadata.
 * Each variant determines the generated method parameters and the runtime encoding contract.
 */
type ScalarEffectShape =
  | {
      /** Identifies an optional boolean-toggle argument. */
      readonly kind: "bool";
    }
  | {
      /** Identifies one required scalar argument. */
      readonly kind: "value";
      /** Scalar type and conversion used by the signature and recorder. */
      readonly value: TsValue;
    };

type BlockEffectShape =
  | {
      /** Identifies an effect-splice closure, optionally preceded by named arguments. */
      readonly kind: "wrapper";
      /** Canonical closure scopes, or `null` when it preserves the receiving scope. */
      readonly scope: readonly string[] | null;
      /** Runtime identity transition for the callback body. */
      readonly transition: "same" | "push" | "replace" | "unknown";
      /** Named arguments before the closure, or `null` when the closure is the only argument. */
      readonly fields: readonly ArgField[] | null;
    }
  | {
      /** Identifies one object argument composed from named rule fields. */
      readonly kind: "fields";
      /** Named fields represented by the generated argument object. */
      readonly fields: readonly ArgField[];
    }
  | {
      /** Identifies one ordered list of tagged alias-category members. */
      readonly kind: "aliasList";
      /** The spliced CWT alias category. */
      readonly category: string;
      /** Canonical scopes the members run in, or `null` for the receiving scope. */
      readonly scope: readonly string[] | null;
    }
  | {
      /** Identifies one object argument whose keys the script itself supplies. */
      readonly kind: "map";
      /** Keys and values represented by the generated map argument. */
      readonly map: MapValue;
    };

export type EffectShape =
  | ScalarEffectShape
  | BlockEffectShape
  | {
      /** Identifies one effect with independent scalar and block call forms. */
      readonly kind: "scalarOrBlock";
      /** The scalar call form, retained without widening. */
      readonly scalar: ScalarEffectShape;
      /** The block call form. */
      readonly block: BlockEffectShape;
    };

type FieldEffectShape = Extract<EffectShape, { readonly kind: "fields" | "wrapper" }>;

function fieldShapeForOverlays(key: string, shape: EffectShape): FieldEffectShape {
  if (shape.kind !== "fields" && shape.kind !== "wrapper") {
    throw new Error(
      `Effect field overlay names "${key}", but that effect does not emit an args block`
    );
  }
  return shape;
}

function applyCardinalityOverride(
  key: string,
  field: ArgField,
  override: EffectFieldCardinalityOverride
): ArgField {
  if (
    override.optional === undefined &&
    override.repeated === undefined &&
    override.valueList === undefined
  ) {
    throw new Error(
      `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}.${field.name}" without a change`
    );
  }
  let resolved = field;
  if (override.optional !== undefined) {
    if (field.optional === override.optional) {
      throw new Error(
        `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}.${field.name}", but CWT already ` +
          `makes it ${override.optional ? "optional" : "required"} — retire that override`
      );
    }
    resolved = { ...resolved, optional: override.optional };
  }
  if (override.repeated !== undefined) {
    if ((field.repeated !== undefined) === override.repeated) {
      throw new Error(
        `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}.${field.name}", but lowering already ` +
          `makes it ${override.repeated ? "repeated" : "singular"} — retire that override`
      );
    }
    // The row states that the key repeats, not how often: a field CWT leaves
    // unannotated has no documented maximum to carry over.
    resolved = { ...resolved, repeated: override.repeated ? UNBOUNDED : undefined };
  }
  if (override.valueList !== undefined) {
    if (field.value.kind !== "valueList") {
      throw new Error(
        `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}.${field.name}" as a value list, ` +
          "but the field does not lower to one"
      );
    }
    if (
      field.value.cardinality.min === override.valueList.min &&
      field.value.cardinality.max === override.valueList.max
    ) {
      throw new Error(
        `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}.${field.name}", but CWT already ` +
          "declares that value-list cardinality — retire that override"
      );
    }
    resolved = {
      ...resolved,
      value: { ...field.value, cardinality: override.valueList },
    };
  }
  return resolved;
}

function applyCardinalityOverrides(
  key: string,
  fields: readonly ArgField[],
  overrides: readonly EffectFieldCardinalityOverride[]
): ArgField[] {
  const appliedCardinality = new Set<string>();
  const resolved = fields.map((field) => {
    const override = overrides.find((candidate) => candidate.name === field.name);
    if (override === undefined) {
      return field;
    }
    appliedCardinality.add(field.name);
    return applyCardinalityOverride(key, field, override);
  });
  for (const override of overrides) {
    if (!appliedCardinality.has(override.name)) {
      throw new Error(
        `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}.${override.name}", which no ` +
          "emitted effect field matches — retire the overlay row or fix its key"
      );
    }
  }
  return resolved;
}

function addedFields(
  emitter: Emitter,
  key: string,
  fields: readonly ArgField[],
  additions: readonly EffectFieldAddition[]
): ArgField[] {
  const names = new Set(fields.map((field) => field.name));
  return additions.map((addition): ArgField => {
    if (names.has(addition.name)) {
      throw new Error(
        `EFFECT_FIELD_ADDITIONS names "${key}.${addition.name}", which CWT now declares — ` +
          "retire the overlay row"
      );
    }
    names.add(addition.name);
    const value = emitter.valueFor(addition.type);
    if (value === null) {
      throw new Error(
        `EFFECT_FIELD_ADDITIONS names "${key}.${addition.name}" with an unsupported ` +
          `field type (${addition.type.kind})`
      );
    }
    return {
      name: addition.name,
      value: { kind: "scalar", value },
      optional: addition.optional,
      docs: [],
    };
  });
}

function insertFieldsBeforeClauses(
  fields: readonly ArgField[],
  additions: readonly ArgField[]
): ArgField[] {
  const firstClause = fields.findIndex((field) => field.value.kind === "clause");
  const insertion = firstClause === -1 ? fields.length : firstClause;
  return [...fields.slice(0, insertion), ...additions, ...fields.slice(insertion)];
}

function applyFieldOverlays(emitter: Emitter, key: string, shape: EffectShape): EffectShape {
  const additions = EFFECT_FIELD_ADDITIONS.get(key) ?? [];
  const cardinalityOverrides = EFFECT_FIELD_CARDINALITY_OVERRIDES.get(key) ?? [];
  if (additions.length === 0 && cardinalityOverrides.length === 0) {
    return shape;
  }
  const target = shape.kind === "scalarOrBlock" ? shape.block : shape;
  const fieldShape = fieldShapeForOverlays(key, target);
  const fields = applyCardinalityOverrides(key, fieldShape.fields ?? [], cardinalityOverrides);
  const added = addedFields(emitter, key, fields, additions);
  const resolved = {
    ...fieldShape,
    fields: insertFieldsBeforeClauses(fields, added),
  };
  return shape.kind === "scalarOrBlock" ? { ...shape, block: resolved } : resolved;
}

/** One generated effect method after rule lowering and overlay application. */
export interface EmittedEffect {
  /** TypeScript method name exposed on effect scope interfaces. */
  readonly method: string;
  /** PDXScript key recorded by the method. */
  readonly key: string;
  /** Post-overlay argument shape used by both emitted modules. */
  readonly shape: EffectShape;
  /** Documentation lines attached to the generated method. */
  readonly docs: readonly string[];
}

/** One scope-navigation property represented on the effect recorder. */
export interface EmittedScopeLink {
  /** TypeScript property name exposed on effect paths. */
  readonly method: string;
  /** PDXScript navigation key recorded by the path. */
  readonly key: string;
  /** Canonical scope reached by the navigation. */
  readonly outputScope: string;
  /** Generated navigation always enters a new game scope. */
  readonly transition: "push";
  /** Documentation lines attached to the generated property. */
  readonly docs: readonly string[];
}

/** Effects sharing one exact scope set, emitted as one interface. */
export interface EffectCluster {
  /** Exact receiving scope set shared by every method in the cluster. */
  readonly scopes: readonly string[] | "universal";
  /** Methods emitted on the cluster interface. */
  readonly effects: EmittedEffect[];
}

/** Scope-link paths sharing one exact scope set, emitted as one interface. */
export interface ScopeLinkCluster {
  /** Exact source scope set shared by every path in the cluster. */
  readonly scopes: readonly string[] | "universal";
  /** Navigation properties emitted on the cluster interface. */
  readonly links: EmittedScopeLink[];
}

function isBooleanToggle(type: RuleType): boolean {
  return type.kind === "bool" || (type.kind === "literal" && type.text === "yes");
}

function scalarShapeOf(emitter: Emitter, rule: LoweredRule): ScalarEffectShape | SkipReason {
  const scalars = rule.scalars;
  if (
    scalars.some((scalar) => scalar.type.kind === "literal" && scalar.type.text.startsWith("$"))
  ) {
    return skipReason("parameterised-placeholder", "parameterised placeholder rule");
  }
  if (scalars.every((declaration) => isBooleanToggle(declaration.type))) {
    return { kind: "bool" };
  }
  const value = emitter.unionFor(scalars.map((declaration) => declaration.type));
  if (value === null) {
    return skipReason(
      "unsupported-value",
      `unsupported value type (${scalars.map((scalar) => scalar.type.kind).join(", ")})`
    );
  }
  return { kind: "value", value };
}

/**
 * Whether one lowered value keys nested clauses. Only trigger builders render
 * that shape today: an effect's clauses are recorded closures, which
 * `EFFECT_META` and the recorder have no key/clause pair form for.
 */
function holdsKeyedClauses(value: ArgValue): boolean {
  switch (value.kind) {
    case "keyedClauses":
      return true;
    case "fields":
      return value.fields.some((field) => holdsKeyedClauses(field.value));
    case "scalarOrBlock":
      return holdsKeyedClauses(value.block);
    case "valueList":
      return value.fields?.some((field) => holdsKeyedClauses(field.value)) ?? false;
    default:
      return false;
  }
}

function blockShapeOf(emitter: Emitter, block: LoweredRuleBlock): BlockEffectShape | SkipReason {
  const body = block.type;
  if (body.bare.length > 0) {
    return skipReason("bare-value-block", "block with bare values");
  }
  const spliced = pureSpliceCategory(body);
  const inherited = clauseScopeContext(block.declaration.scope);
  if (inherited.transition === "unknown") {
    return skipReason("unknown-push-scope", "push_scope does not state THIS");
  }
  if (spliced !== null && EXTRA_ALIAS_CATEGORIES.get(spliced)?.scriptList !== undefined) {
    const pushed = inherited.scope;
    const scope =
      pushed === null ? null : canonicalThisScope(emitter, pushed, `Alias list "${spliced}"`);
    return { kind: "aliasList", category: spliced, scope };
  }
  const categories = new Set(
    block.splices.flatMap((field) => (field.key.kind === "aliasName" ? [field.key.category] : []))
  );
  if (categories.has("modifier_rule")) {
    return skipReason("unsupported-alias-splice", "contains a modifier_rule splice");
  }
  if (categories.has("trigger")) {
    return skipReason("unsupported-alias-splice", "contains a bare trigger splice");
  }
  const argumentFields = body.fields.filter(
    (field) => field.key.kind !== "aliasName" || field.key.category !== "effect"
  );
  const named = expandAliasFields(emitter, argumentFields);
  if (!Array.isArray(named)) {
    return named;
  }
  const pushedRaw = inherited.scope;
  const merged =
    named.length === 0
      ? ({ kind: "fields", fields: [] } as const)
      : mergeBlock(emitter, named, inherited, EFFECT_SPLICES);
  if ("detail" in merged) {
    return merged;
  }
  if (merged.kind === "fields" && merged.fields.some((field) => holdsKeyedClauses(field.value))) {
    return skipReason(
      "computed-field-key",
      "block keys nested clauses, which the effect recorder cannot serialize"
    );
  }

  if (categories.has("effect")) {
    if (merged.kind === "map") {
      return skipReason(
        "computed-field-key",
        "effect wrapper whose named arguments are an open-keyed block"
      );
    }
    let scope: readonly string[] | null = null;
    if (pushedRaw !== null) {
      scope = canonicalThisScope(emitter, pushedRaw, "Effect wrapper");
    }
    return {
      kind: "wrapper",
      scope,
      transition: inherited.transition,
      fields: merged.fields.length === 0 ? null : merged.fields,
    };
  }
  if (merged.kind === "map") {
    return { kind: "map", map: merged.map };
  }
  if (merged.fields.length === 0) {
    return skipReason("empty-block", "block with no typeable fields");
  }
  return { kind: "fields", fields: merged.fields };
}

function equivalentBlockShapeOf(
  emitter: Emitter,
  blocks: readonly LoweredRuleBlock[]
): BlockEffectShape | SkipReason {
  const [first, ...rest] = blocks;
  if (first === undefined) {
    throw new Error("equivalentBlockShapeOf requires at least one block declaration");
  }
  const contract = blockContract(first);
  if (rest.some((block) => JSON.stringify(blockContract(block)) !== JSON.stringify(contract))) {
    return skipReason("multiple-block-forms", "multiple block declarations");
  }
  return blockShapeOf(emitter, {
    ...first,
    type: {
      ...first.type,
      fields: first.type.fields.flatMap((_, index) =>
        blocks.map((block) => block.type.fields[index]!)
      ),
    },
  });
}

/** The non-scalar structure two block declarations must share before their leaf types may union. */
function blockContract(block: LoweredRuleBlock): unknown {
  return {
    inheritedScope: block.inheritedScope,
    fields: block.type.fields.map(fieldContract),
    bare: block.type.bare.map((value) => ({
      cardinality: value.cardinality,
      scope: value.scope,
      type: valueContract(value.type),
    })),
  };
}

function fieldContract(field: RuleField): unknown {
  return {
    key: field.key,
    cardinality: field.cardinality,
    scope: field.scope,
    comparison: field.comparison,
    type: valueContract(field.type),
  };
}

function valueContract(type: RuleType): unknown {
  return type.kind === "block"
    ? {
        kind: type.kind,
        fields: type.fields.map(fieldContract),
        bare: type.bare.map((value) => ({
          cardinality: value.cardinality,
          scope: value.scope,
          type: valueContract(value.type),
        })),
      }
    : { kind: type.kind };
}

function shapeOf(emitter: Emitter, rule: LoweredRule): EffectShape | SkipReason {
  if (rule.comparison) {
    return skipReason("comparison-effect", "declared with a comparison operator");
  }
  if (rule.blocks.length === 0) {
    return scalarShapeOf(emitter, rule);
  }
  const block = equivalentBlockShapeOf(emitter, rule.blocks);
  if ("detail" in block) {
    return block;
  }
  if (rule.scalars.length > 0) {
    const scalar = scalarShapeOf(emitter, {
      ...rule,
      declarations: rule.scalars,
      comparison: false,
      blocks: [],
    });
    if ("detail" in scalar) {
      return scalar;
    }
    return { kind: "scalarOrBlock", scalar, block };
  }
  return block;
}

/** The overlay row that permits one category to be authored as an ordered list. */
function scriptListOf(category: string): AliasCategoryScriptList {
  const list = EXTRA_ALIAS_CATEGORIES.get(category)?.scriptList;
  if (list === undefined) {
    throw new Error(
      `"${category}" lowered to an alias list without an EXTRA_ALIAS_CATEGORIES scriptList row`
    );
  }
  return list;
}

/**
 * The type text one spliced alias list is authored as. The list's own pushed
 * scope fixes the type argument; without one the members run in the scope
 * enclosing the list, which is the scope text the caller is emitting under.
 */
function aliasListType(
  category: string,
  scope: readonly string[] | null,
  outerScope: string
): string {
  const item = scriptListOf(category).typeName;
  return `readonly ${item}<${scope === null ? outerScope : scopeUnionType(scope)}>[]`;
}

/** The type text a lowered value contributes before field-level wrapping or overrides. */
function baseMemberType(
  emitter: Emitter,
  value: ArgValue,
  outerScope: string,
  effectKey: string
): string {
  switch (value.kind) {
    case "scalar":
      return emitter.useValue(value.value).type;
    case "fields":
      return argsType(emitter, value.fields, outerScope, effectKey);
    case "map":
      return mapType(emitter, value.map);
    case "scalarOrBlock":
      return (
        `${emitter.useValue(value.scalar).type} | ` +
        `${baseMemberType(emitter, value.block, outerScope, effectKey)}`
      );
    case "valueList": {
      const arms = [
        value.scalar === null ? undefined : emitter.useValue(value.scalar).type,
        value.fields === null ? null : argsType(emitter, value.fields, outerScope, effectKey),
      ].filter((arm): arm is string => arm !== null && arm !== undefined);
      return cardinalityArrayType(arms.join(" | "), value.cardinality);
    }
    case "clause": {
      const scope = value.scope === null ? outerScope : scopeUnionType(value.scope);
      if (value.category === "trigger") {
        return `${emitter.use("Trigger")}<${scope}>`;
      }
      if (value.category === "modifier_rule") {
        return `readonly ${emitter.use("Modifier")}<${scope}>[]`;
      }
      return value.transition === "same"
        ? `() => void`
        : `(scope: ${scopeInterfaceName(value.scope)}) => void`;
    }
    case "keyedClauses":
      throw new Error(
        `Effect "${effectKey}" keys nested clauses, which the shape pass skips before ` +
          "any signature is rendered"
      );
    case "aliasList":
      return aliasListType(value.category, value.scope, outerScope);
    case "aliasStruct":
      return emitter.useAliasCategory(value.category, aliasStructTypeName(value.category));
    case "comparison": {
      const literals = value.literals.map((literal) => JSON.stringify(literal));
      const scalar = emitter.useValue(value.value).type;
      return [scalar, `readonly [${emitter.use("PdxOp")}, ${scalar}]`, ...literals].join(" | ");
    }
  }
}

/**
 * The type text one args member emits, after the overlay and repetition policy apply.
 * `effectKey` lets an override target one effect field rather than every same-named field.
 */
function memberType(
  emitter: Emitter,
  field: ArgField,
  outerScope: string,
  effectKey: string
): string {
  const override = EFFECT_FIELD_TYPE_OVERRIDES.get(`${effectKey}.${field.name}`);
  if (override !== undefined) {
    return override.type;
  }
  const single = baseMemberType(emitter, field.value, outerScope, effectKey);
  return field.repeated === undefined
    ? single
    : repeatedMemberType(emitter, field.value, single, field.repeated);
}

/**
 * The type parameter a cluster generic over its receiving scope declares. The
 * member types name it wherever a clause runs in that scope.
 */
const RECEIVING_SCOPE = "S";

function clauseRunsInReceivingScope(value: ArgValue): boolean {
  switch (value.kind) {
    case "clause":
      return value.transition === "same";
    case "aliasList":
      return value.scope === null;
    case "fields":
      return value.fields.some((field) => clauseRunsInReceivingScope(field.value));
    case "scalarOrBlock":
      return clauseRunsInReceivingScope(value.block);
    case "valueList":
      return value.fields?.some((field) => clauseRunsInReceivingScope(field.value)) ?? false;
    default:
      return false;
  }
}

/**
 * Whether one effect's arguments hold a clause typed by the scope it is called
 * in. An alias list is one: its members' own clauses run in the scope the list
 * runs in, which without a `## push_scope` is the enclosing one.
 */
function takesReceivingScope(effect: EmittedEffect): boolean {
  if (EFFECT_EXTENSION_SEAMS.get(effect.key)?.receivingScope === true) {
    return true;
  }
  const shape = effect.shape.kind === "scalarOrBlock" ? effect.shape.block : effect.shape;
  if (shape.kind === "aliasList") {
    return shape.scope === null;
  }
  if (shape.kind !== "fields" && shape.kind !== "wrapper") {
    return false;
  }
  return (shape.fields ?? []).some((field) => clauseRunsInReceivingScope(field.value));
}

/**
 * Whether a cluster's methods must be generic over the scope receiving them.
 *
 * A clause that runs in the enclosing scope is typed by the scope the method
 * is called in. A one-scope cluster names that scope directly; a wider one
 * would name every scope it covers, and `Trigger` and the closure parameter
 * are contravariant, so each caller's own scope would then be rejected.
 */
function clusterTakesReceivingScope(cluster: EffectCluster): boolean {
  const spansOneScope = cluster.scopes !== "universal" && cluster.scopes.length === 1;
  return !spansOneScope && cluster.effects.some(takesReceivingScope);
}

/** The type parameter list a cluster interface declares, empty when it takes none. */
function clusterParameters(cluster: EffectCluster): string {
  return clusterTakesReceivingScope(cluster)
    ? `<${RECEIVING_SCOPE} extends ${outerScopeText(cluster.scopes)}>`
    : "";
}

function scopeInterfaceName(scope: readonly string[] | null): string {
  return scope === null ? "this" : scope.map((member) => `${pascalCase(member)}Scope`).join(" | ");
}

/**
 * One member of an inline object type, carrying whatever the rules document
 * about it. The doc comment goes on the property rather than beside the object,
 * so an editor shows it where the member is written.
 */
function inlineMember(field: ArgField, type: string): string {
  const member = `${camelCase(field.name)}${field.optional ? "?" : ""}: ${type}`;
  const doc = docComment(field.docs);
  // The doc has to open its own line. Left at the end of the previous member's
  // line it is a trailing comment, which the formatter keeps attached to that
  // member instead of this one.
  return doc === "" ? member : `\n${doc}${member}`;
}

function argsType(
  emitter: Emitter,
  fields: readonly ArgField[],
  outerScope: string,
  effectKey: string
): string {
  const members = fields.map((field) =>
    inlineMember(field, memberType(emitter, field, outerScope, effectKey))
  );
  return `{ ${members.join("; ")} }`;
}

function methodSignature(emitter: Emitter, effect: EmittedEffect, outerScope: string): string {
  const doc = docComment(effect.docs, "  ");
  return doc + methodSignatureText(emitter, effect, outerScope);
}

function methodSignatureText(emitter: Emitter, effect: EmittedEffect, outerScope: string): string {
  const { method, key, shape } = effect;
  switch (shape.kind) {
    case "bool":
      return `  ${method}(value?: boolean): void;\n`;
    case "value":
      return `  ${method}(value: ${EFFECT_VALUE_TYPE_OVERRIDES.get(key)?.type ?? emitter.useValue(shape.value).type}): void;\n`;
    case "fields":
      return `  ${method}(args: ${argsType(emitter, shape.fields, outerScope, key)}): void;\n`;
    case "map":
      return `  ${method}(values: ${mapType(emitter, shape.map)}): void;\n`;
    case "wrapper": {
      const body =
        shape.transition === "same"
          ? "body: () => void"
          : `body: (scope: ${scopeInterfaceName(shape.scope)}) => void`;
      return shape.fields === null
        ? `  ${method}(${body}): void;\n`
        : `  ${method}(args: ${argsType(emitter, shape.fields, outerScope, key)}, ${body}): void;\n`;
    }
    case "aliasList": {
      const list = aliasListType(shape.category, shape.scope, outerScope);
      return `  ${method}(${scriptListOf(shape.category).memberName}: ${list}): void;\n`;
    }
    case "scalarOrBlock": {
      const scalar = methodSignatureText(emitter, { ...effect, shape: shape.scalar }, outerScope);
      const block = methodSignatureText(emitter, { ...effect, shape: shape.block }, outerScope);
      return scalar + block;
    }
  }
}

function extensionArgsName(effect: EmittedEffect): string {
  return `${pascalCase(camelCase(effect.key))}Args`;
}

function extensionFallbackSignature(
  emitter: Emitter,
  effect: EmittedEffect,
  outerScope: string
): string {
  if (effect.shape.kind === "fields") {
    return `  ${effect.method}(args: ${extensionArgsName(effect)}): void;\n`;
  }
  return methodSignatureText(emitter, effect, outerScope);
}

/**
 * Drops the member doc comments {@link inlineMember} writes into an args
 * object. A reference row's signature is one line of display text, and the row
 * carries the documentation it needs in its own `docs`.
 */
function withoutMemberDocs(signature: string): string {
  return signature.replaceAll(/\n\/\*\*[\s\S]*?\*\/\n/g, "");
}

function referenceSignature(emitter: Emitter, effect: EmittedEffect, outerScope: string): string {
  const seam = EFFECT_EXTENSION_SEAMS.get(effect.key);
  if (seam === undefined) {
    return withoutMemberDocs(methodSignatureText(emitter, effect, outerScope)).trim();
  }
  return (
    `${seam.referenceSignature}\n` +
    `${withoutMemberDocs(extensionFallbackSignature(emitter, effect, outerScope)).trim()}`
  );
}

/**
 * Deterministic short tag for long scope sets, stable across runs.
 *
 * Exported for {@link registerClusterName}'s tests: the 4 hex digits kept
 * here are only 16 bits, so a birthday-bound search over a few hundred
 * synthetic scope sets reliably finds two that collide, which is the fault
 * {@link registerClusterName} exists to catch.
 */
export function hashTag(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 4);
}

/**
 * Returns the stable interface name for one exact effect scope set.
 * Long sets use {@link hashTag}; callers must register the result to detect truncated-hash collisions.
 */
export function clusterName(scopes: readonly string[] | "universal"): string {
  if (scopes === "universal") {
    return "UniversalEffects";
  }
  if (scopes.length <= 3) {
    return `EffectsIn${scopes.map(pascalCase).join("")}`;
  }
  return `EffectsIn${scopes.length}Scopes${hashTag(scopes.join("|"))}`;
}

function pathClusterName(scopes: readonly string[] | "universal"): string {
  return clusterName(scopes).replace("Effects", "EffectPaths");
}

/**
 * Guards `hashTag`'s 4-hex truncation. Two different scope sets can hash to
 * the same tag, and `clusterName`/`pathClusterName` would then mint the same
 * `export interface` name for both — a fault TypeScript never reports: two
 * same-named interface declarations merge, so every scope in either cluster
 * silently gains the union of both clusters' methods.
 *
 * `minted` is created fresh per emission pass by the caller rather than held
 * here, so two pipeline runs in one process (several test files do this)
 * cannot see each other's names, and a name minted twice for the *same*
 * scope set — legitimate, since nothing currently dedupes clusters across
 * the effect and link-cluster loops — is not an error.
 */
export function registerClusterName(
  minted: Map<string, string>,
  name: string,
  scopes: readonly string[] | "universal"
): void {
  const signature = scopes === "universal" ? "universal" : scopes.join("|");
  const existing = minted.get(name);
  if (existing !== undefined && existing !== signature) {
    throw new Error(
      `Cluster name "${name}" was minted for scope set [${existing}] and again for a ` +
        `different scope set [${signature}] — hashTag's 4-hex digest collided; widen the ` +
        "tag or rename the cluster."
    );
  }
  minted.set(name, signature);
}

function pathProperty(link: EmittedScopeLink): string {
  return renderMember({
    name: link.method,
    type: `EffectPathOf<${JSON.stringify(link.outputScope)}, "push">`,
    optional: false,
    readonly: true,
    docs: link.docs,
  });
}

/** The type text of a cluster's outer scope: a literal union, or every scope. */
function outerScopeText(scopes: readonly string[] | "universal"): string {
  return scopes === "universal"
    ? "ScopeName"
    : scopes.map((scope) => JSON.stringify(scope)).join(" | ");
}

interface ClusteredEffects {
  readonly clusters: Map<string, EffectCluster>;
  readonly skipped: SkippedRule[];
  readonly byShape: Map<string, number>;
  readonly appliedFieldAdditions: ReadonlySet<string>;
  readonly appliedFieldCardinalityOverrides: ReadonlySet<string>;
}

interface GeneratedEffectRule {
  readonly key: string;
  readonly rule: LoweredRule;
  readonly scopes: readonly string[] | "universal";
}

interface LoweredEffect {
  readonly effect: EmittedEffect;
  readonly appliesFieldAdditions: boolean;
  readonly appliesFieldCardinalityOverrides: boolean;
}

function generatedEffectRule(
  key: string,
  rule: LoweredRule,
  policy: EffectPolicy
): GeneratedEffectRule | SkippedRule {
  const ownership = policy.byKey.get(key.toLowerCase());
  if (ownership?.owner !== "generated") {
    const firedByEvents = ownership?.owner === "fire";
    const owningPolicy = firedByEvents
      ? "the event-fire emitter"
      : "hand-written structural effect policy";
    if (rule.removed) {
      throw new Error(
        `${key}: the rules declare the effect removed (## api_status = removed), ` +
          `but ${owningPolicy} still owns it`
      );
    }
    return skippedRule(
      key,
      firedByEvents ? "event-fire-effect" : "structural-effect",
      firedByEvents
        ? "typed by the event-fire emitter"
        : `hand-written structural effect${ownership?.reason === undefined ? "" : `: ${ownership.reason}`}`
    );
  }
  if (key === "<scripted_effect>") {
    return skippedRule(key, "abstract-placeholder", "abstract scripted-effect placeholder");
  }
  if (!isPlainName(key)) {
    return skippedRule(key, "invalid-rule-name", "not a plain rule name");
  }
  if (rule.removed) {
    return skippedRule(
      key,
      "removed-api",
      "declared removed by the rules (## api_status = removed)"
    );
  }
  if (rule.supportedScopes.length === 0) {
    return skippedRule(
      key,
      "missing-rule-scope",
      "no scopes in either the rules or the game's dump"
    );
  }
  if (rule.scopes === null) {
    return skippedRule(key, "unknown-scope", `unknown scope in ${rule.supportedScopes.join(" ")}`);
  }
  return { key, rule, scopes: rule.scopes };
}

function lowersNameAliasUsage(rule: LoweredRule): boolean {
  return rule.blocks.some((block) =>
    block.splices.some((field) => field.key.kind === "aliasName" && field.key.category === "name")
  );
}

function lowerEffect(
  emitter: Emitter,
  docs: ReadonlyMap<string, DocEntry>,
  candidate: GeneratedEffectRule
): LoweredEffect | SkipReason {
  const { key, rule } = candidate;
  const isolatesNameAliasUsage = lowersNameAliasUsage(rule);
  const ruleEmitter = isolatesNameAliasUsage ? new Emitter(emitter.rules) : emitter;
  const shape = shapeOf(ruleEmitter, rule);
  if ("detail" in shape) {
    return shape;
  }
  if (isolatesNameAliasUsage) {
    emitter.absorb(ruleEmitter);
  }
  return {
    effect: {
      method: safeIdentifier(camelCase(key)),
      key,
      shape: applyFieldOverlays(emitter, key, shape),
      docs: tsDoc(rule.declarations, docs.get(key)),
    },
    appliesFieldAdditions: EFFECT_FIELD_ADDITIONS.has(key),
    appliesFieldCardinalityOverrides: EFFECT_FIELD_CARDINALITY_OVERRIDES.has(key),
  };
}

function addEffectToCluster(
  clusters: Map<string, EffectCluster>,
  scopes: readonly string[] | "universal",
  effect: EmittedEffect
): void {
  const clusterKey = scopes === "universal" ? "universal" : scopes.join("|");
  const cluster = clusters.get(clusterKey) ?? { scopes, effects: [] };
  cluster.effects.push(effect);
  clusters.set(clusterKey, cluster);
}

/** The rule loop: lowers each generated-owned effect and clusters it by scope set. */
function clusterEffects(
  emitter: Emitter,
  docs: ReadonlyMap<string, DocEntry>,
  rules: ReadonlyMap<string, LoweredRule>,
  policy: EffectPolicy
): ClusteredEffects {
  const skipped: SkippedRule[] = [];
  const appliedFieldAdditions = new Set<string>();
  const appliedFieldCardinalityOverrides = new Set<string>();
  const byShape = new Map<string, number>();
  const clusters = new Map<string, EffectCluster>();

  for (const key of [...rules.keys()].sort()) {
    const rule = rules.get(key)!;
    const candidate = generatedEffectRule(key, rule, policy);
    if ("category" in candidate) {
      skipped.push(candidate);
      continue;
    }
    if (candidate.rule.conflicts.length > 0) {
      skipped.push(...loweredRuleConflictSkips(candidate.rule));
      continue;
    }
    const lowered = lowerEffect(emitter, docs, candidate);
    if ("detail" in lowered) {
      skipped.push({ name: key, ...lowered });
      continue;
    }
    if (lowered.appliesFieldAdditions) {
      appliedFieldAdditions.add(key);
    }
    if (lowered.appliesFieldCardinalityOverrides) {
      appliedFieldCardinalityOverrides.add(key);
    }
    addEffectToCluster(clusters, candidate.scopes, lowered.effect);
    byShape.set(lowered.effect.shape.kind, (byShape.get(lowered.effect.shape.kind) ?? 0) + 1);
  }

  return {
    clusters,
    skipped,
    byShape,
    appliedFieldAdditions,
    appliedFieldCardinalityOverrides,
  };
}

/**
 * An override row naming a field no emitted effect has is a lie the emitted
 * types would not show: it would read as an audited departure while changing
 * nothing. A rules bump that renames or drops the field has to be noticed
 * here rather than quietly turning the row into decoration.
 */
function assertFieldOverlayRowsMatched(clustered: ClusteredEffects): void {
  const fieldKeys = new Set(
    [...clustered.clusters.values()].flatMap((cluster) =>
      cluster.effects.flatMap((effect) =>
        effectFields(effect.shape).map((field) => `${effect.key}.${field.name}`)
      )
    )
  );
  for (const key of EFFECT_FIELD_TYPE_OVERRIDES.keys()) {
    if (!fieldKeys.has(key)) {
      throw new Error(
        `EFFECT_FIELD_TYPE_OVERRIDES names "${key}", which no emitted effect field matches — ` +
          "retire the overlay row or fix its key"
      );
    }
  }
  const effects = [...clustered.clusters.values()].flatMap((cluster) => cluster.effects);
  for (const key of EFFECT_VALUE_TYPE_OVERRIDES.keys()) {
    const effect = effects.find((candidate) => candidate.key === key);
    if (effect === undefined || scalarShapeOfEffect(effect.shape)?.kind !== "value") {
      throw new Error(
        `EFFECT_VALUE_TYPE_OVERRIDES names "${key}", which is not an emitted scalar effect — ` +
          "retire the overlay row or fix its key"
      );
    }
  }
  for (const key of EFFECT_FIELD_ADDITIONS.keys()) {
    if (!clustered.appliedFieldAdditions.has(key)) {
      throw new Error(
        `EFFECT_FIELD_ADDITIONS names "${key}", which no emitted effect matches — ` +
          "retire the overlay row or fix its key"
      );
    }
  }
  for (const key of EFFECT_FIELD_CARDINALITY_OVERRIDES.keys()) {
    if (!clustered.appliedFieldCardinalityOverrides.has(key)) {
      throw new Error(
        `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}", which no emitted effect ` +
          "matches — retire the overlay row or fix its key"
      );
    }
  }
}

/** The named fields an effect shape exposes, including a scalar/block block arm. */
function effectFields(shape: EffectShape): readonly ArgField[] {
  const target = shape.kind === "scalarOrBlock" ? shape.block : shape;
  return target.kind === "fields" || target.kind === "wrapper" ? (target.fields ?? []) : [];
}

/** The scalar arm of a shape, when the effect exposes one. */
function scalarShapeOfEffect(shape: EffectShape): ScalarEffectShape | undefined {
  if (shape.kind === "bool" || shape.kind === "value") {
    return shape;
  }
  return shape.kind === "scalarOrBlock" ? shape.scalar : undefined;
}

/**
 * Scope links use their own recursive property clusters. A name collision is
 * a hard error, not a skip: the property would merge with an effect method,
 * and the Proxy would have no unambiguous dispatch for that authoring name.
 */
function clusterScopeLinks(
  links: readonly ClassifiedLink[],
  scopeIndex: ReadonlyMap<string, string>,
  takenMethods: ReadonlySet<string>
): Map<string, ScopeLinkCluster> {
  const linkClusters = new Map<string, ScopeLinkCluster>();
  for (const link of links) {
    if (takenMethods.has(link.method)) {
      throw new Error(
        `scope link "${link.key}" would emit property "${link.method}", which the effect ` +
          "surface already carries — rename via the overlay before generating"
      );
    }
    const scopes = canonicalScopeSet(link.inputScopes, scopeIndex);
    if (scopes === null) {
      throw new Error(`scope link "${link.key}" passed classification with an unknown scope`);
    }
    const emitted: EmittedScopeLink = {
      method: link.method,
      key: link.key,
      outputScope: link.outputScope,
      transition: "push",
      docs: link.docs,
    };
    const clusterKey = scopes === "universal" ? "universal" : scopes.join("|");
    const cluster = linkClusters.get(clusterKey) ?? { scopes, links: [] };
    cluster.links.push(emitted);
    linkClusters.set(clusterKey, cluster);
  }
  return linkClusters;
}

/**
 * Each seam is emitted as its own interface before the cluster that owns the
 * effect, so the hand-written overload merges onto a name the rules cannot
 * rename. An effect that leaves the rules fails here rather than silently
 * detaching its overload.
 */
function extensionSeamInterfaces(emitter: Emitter, clusters: readonly EffectCluster[]): string[] {
  const chunks: string[] = [];
  for (const [key, seam] of EFFECT_EXTENSION_SEAMS) {
    const cluster = clusters.find((candidate) =>
      candidate.effects.some((effect) => effect.key === key)
    );
    const effect = cluster?.effects.find((candidate) => candidate.key === key);
    if (cluster === undefined || effect === undefined) {
      throw new Error(`effects.cwt no longer emits ${key}`);
    }
    if (takesReceivingScope(effect) && seam.receivingScope !== true) {
      throw new Error(
        `${key} now takes a clause in its receiving scope, which its hand-written ` +
          `${seam.interfaceName} overload has to declare before the seam can carry it`
      );
    }
    // The args go out under their own name as well: the hand-written overload
    // narrows two members of this object and has no business restating the
    // rest, which are the rules' to change.
    const receivingScopeType =
      seam.receivingScopeType === undefined
        ? outerScopeText(cluster.scopes)
        : emitter.useFrom(seam.receivingScopeType.module, seam.receivingScopeType.type, "type");
    const scopeParameter = seam.receivingScope === true ? `<S extends ${receivingScopeType}>` : "";
    const signatureScope =
      seam.receivingScope === true ? RECEIVING_SCOPE : outerScopeText(cluster.scopes);
    const argsName = extensionArgsName(effect);
    const args =
      effect.shape.kind === "fields"
        ? docComment([`The arguments \`${camelCase(key)}\` takes, as the rules declare them.`]) +
          `export type ${argsName} = ` +
          `${argsType(emitter, effect.shape.fields, signatureScope, key)};\n`
        : "";
    const signature =
      effect.shape.kind === "fields"
        ? `${docComment(effect.docs, "  ")}` +
          `${extensionFallbackSignature(emitter, effect, signatureScope)}`
        : methodSignature(emitter, effect, signatureScope);
    chunks.push(
      args +
        docComment([
          `Stable extension seam for the hand-written ${camelCase(key)} overload.`,
          `The generated cluster containing ${key} inherits this interface.`,
          seam.reason,
        ]) +
        `export interface ${seam.interfaceName}${scopeParameter} {\n${signature}}\n`
    );
  }
  return chunks;
}

/**
 * One exported union per spliced alias list: an item is an object naming
 * exactly one member of the category, so a member may repeat and the list
 * keeps the order it is written in.
 */
function aliasListTypes(
  emitter: Emitter,
  surfaces: ReadonlyMap<string, AliasListSurface>
): string[] {
  return [...surfaces].map(([category, surface]) => {
    const arms = surface.members.map(
      (member) =>
        `  | { ${inlineMember(member, memberType(emitter, member, RECEIVING_SCOPE, category))} }`
    );
    return (
      docComment([
        `One member of the \`${category}\` alias category, as the \`${surface.memberName}\``,
        "list holds it. Each item names exactly one member.",
      ]) +
      `export type ${surface.typeName}<${RECEIVING_SCOPE} extends ${emitter.use("ScopeName")}> =\n` +
      `${arms.join("\n")};\n`
    );
  });
}

/** Every spliced alias category the emitted effect surface actually authors. */
function authoredAliasCategories(clusters: readonly EffectCluster[]): Set<string> {
  const categories = new Set<string>();
  const walk = (value: ArgValue): void => {
    switch (value.kind) {
      case "aliasList":
      case "aliasStruct":
        categories.add(value.category);
        return;
      case "fields":
        value.fields.forEach((field) => walk(field.value));
        return;
      case "scalarOrBlock":
        walk(value.block);
        return;
      case "valueList":
        value.fields?.forEach((field) => walk(field.value));
        return;
      default:
        return;
    }
  };
  for (const cluster of clusters) {
    for (const { shape } of cluster.effects) {
      if (shape.kind === "aliasList") {
        categories.add(shape.category);
        continue;
      }
      if (shape.kind === "fields" || shape.kind === "wrapper") {
        (shape.fields ?? []).forEach((field) => walk(field.value));
      } else if (shape.kind === "scalarOrBlock") {
        if (shape.block.kind === "aliasList") {
          categories.add(shape.block.category);
        } else if (shape.block.kind === "fields" || shape.block.kind === "wrapper") {
          (shape.block.fields ?? []).forEach((field) => walk(field.value));
        }
      }
    }
  }
  return categories;
}

/**
 * A script-surface row nothing splices would publish an authoring type no
 * emitted method accepts, so it fails generation the same way a stale field
 * override does.
 */
function assertAliasCategoryRowsMatched(authored: ReadonlySet<string>): void {
  for (const category of SCRIPT_ALIAS_CATEGORIES) {
    if (!authored.has(category)) {
      throw new Error(
        `EXTRA_ALIAS_CATEGORIES gives "${category}" a script authoring surface, which no ` +
          "emitted effect splices — retire the row or fix the category"
      );
    }
  }
}

/** One interface per cluster, its methods declared once for its exact scope set. */
function clusterInterfaces(
  emitter: Emitter,
  clusters: readonly EffectCluster[],
  minted: Map<string, string>
): string[] {
  return clusters.map((cluster) => {
    const name = clusterName(cluster.scopes);
    registerClusterName(minted, name, cluster.scopes);
    const parameter = clusterParameters(cluster);
    const outerScope = parameter === "" ? outerScopeText(cluster.scopes) : RECEIVING_SCOPE;
    const heading =
      cluster.scopes === "universal"
        ? ["Effects valid in every scope."]
        : [`Effects valid in: ${cluster.scopes.join(", ")}.`];
    const methods = cluster.effects
      .filter((effect) => !EFFECT_EXTENSION_SEAMS.has(effect.key))
      .map((effect) => methodSignature(emitter, effect, outerScope))
      .join("\n");
    const seams = cluster.effects
      .flatMap((effect) => {
        const seam = EFFECT_EXTENSION_SEAMS.get(effect.key);
        return seam === undefined
          ? []
          : [seam.interfaceName + (seam.receivingScope === true ? `<${outerScope}>` : "")];
      })
      .sort();
    const parents = seams.length === 0 ? "" : ` extends ${seams.join(", ")}`;
    return `${docComment(heading)}export interface ${name}${parameter}${parents} {\n${methods}}\n`;
  });
}

/** One interface per link cluster, carrying its scope-link path properties. */
function pathClusterInterfaces(
  clusters: readonly ScopeLinkCluster[],
  minted: Map<string, string>
): string[] {
  return clusters.map((cluster) => {
    const name = pathClusterName(cluster.scopes);
    registerClusterName(minted, name, cluster.scopes);
    const heading =
      cluster.scopes === "universal"
        ? ["Effect scope paths valid in every scope."]
        : [`Effect scope paths valid in: ${cluster.scopes.join(", ")}.`];
    return `${docComment(heading)}export interface ${name} {\n${cluster.links.map(pathProperty).join("\n")}}\n`;
  });
}

/** The per-scope `XScope` interfaces composing every cluster valid there. */
function scopeInterfaces(
  emitter: Emitter,
  allScopes: readonly string[],
  clusters: readonly EffectCluster[],
  linkClusters: readonly ScopeLinkCluster[]
): string[] {
  return allScopes.map((scope) => {
    const parents = [
      `${emitter.use("StructuralEffects")}<${JSON.stringify(scope)}>`,
      ...clusters
        .filter((cluster) => cluster.scopes === "universal" || cluster.scopes.includes(scope))
        .map((cluster) =>
          clusterTakesReceivingScope(cluster)
            ? `${clusterName(cluster.scopes)}<${JSON.stringify(scope)}>`
            : clusterName(cluster.scopes)
        ),
      ...linkClusters
        .filter((cluster) => cluster.scopes === "universal" || cluster.scopes.includes(scope))
        .map((cluster) => pathClusterName(cluster.scopes)),
    ];
    return (
      docComment([`The effects recordable in ${scope} scope.`]) +
      `export interface ${pascalCase(scope)}Scope extends ${parents.join(", ")} {}\n`
    );
  });
}

/** The per-scope `XEffectPath` interfaces composing the link clusters valid there. */
function effectPathInterfaces(
  emitter: Emitter,
  allScopes: readonly string[],
  linkClusters: readonly ScopeLinkCluster[]
): string[] {
  return allScopes.map((scope) => {
    const parents = [
      `${emitter.use("EffectPath")}<${JSON.stringify(scope)}, Transition>`,
      ...linkClusters
        .filter((cluster) => cluster.scopes === "universal" || cluster.scopes.includes(scope))
        .map((cluster) => pathClusterName(cluster.scopes)),
    ];
    return (
      docComment([`An effect-block path whose current scope is ${scope}.`]) +
      `export interface ${pascalCase(scope)}EffectPath<Transition extends ${emitter.use("EffectPathTransition")} = "push"> extends ${parents.join(", ")} {}\n`
    );
  });
}

/** The `ScopeMap`/`EffectPathMap` indices from scope name to those interfaces. */
function scopeMapCode(emitter: Emitter, allScopes: readonly string[]): string {
  return (
    docComment(["Scope name -> the interface of effects recordable there."]) +
    `export interface ScopeMap {\n` +
    allScopes.map((scope) => `  ${JSON.stringify(scope)}: ${pascalCase(scope)}Scope;\n`).join("") +
    `}\n\n` +
    docComment(["The effects recordable in one named scope."]) +
    `export type ScopeObjOf<S extends ${emitter.use("ScopeName")}> = ScopeMap[S];\n\n` +
    docComment(["Scope name -> a composable effect-block path at that scope."]) +
    `export interface EffectPathMap<Transition extends ${emitter.use("EffectPathTransition")}> {\n` +
    allScopes
      .map((scope) => `  ${JSON.stringify(scope)}: ${pascalCase(scope)}EffectPath<Transition>;\n`)
      .join("") +
    `}\n\n` +
    docComment(["A composable effect-block path at one named scope."]) +
    `export type EffectPathOf<S extends ${emitter.use("ScopeName")}, Transition extends ${emitter.use("EffectPathTransition")} = "push"> = EffectPathMap<Transition>[S];\n`
  );
}

function effectReferenceRows(
  emitter: Emitter,
  clusters: readonly EffectCluster[]
): ScriptEffectReferenceRow[] {
  return clusters.flatMap((cluster) => {
    const availability = cluster.scopes;
    const outerScope = outerScopeText(availability);
    return cluster.effects.map((effect): ScriptEffectReferenceRow => ({
      method: effect.method,
      key: effect.key,
      kind: "effect",
      availability:
        availability === "universal"
          ? { kind: "universal" }
          : { kind: "scopes", scopes: availability },
      signature: referenceSignature(emitter, effect, outerScope),
      docs: effect.docs,
    }));
  });
}

function scopeLinkReferenceRows(
  emitter: Emitter,
  clusters: readonly ScopeLinkCluster[]
): ScriptScopeLinkReferenceRow[] {
  return clusters.flatMap((cluster): ScriptScopeLinkReferenceRow[] =>
    cluster.links.map((link) => ({
      member: link.method,
      fromScopes:
        cluster.scopes === "universal" ? canonicalScopes(emitter.rules.scopes) : cluster.scopes,
      toScope: link.outputScope,
      docs: link.docs,
    }))
  );
}

function fieldTypeOverrideReport(): string[] {
  return [...EFFECT_FIELD_TYPE_OVERRIDES, ...EFFECT_VALUE_TYPE_OVERRIDES].map(
    ([key, override]) => `${key} → ${override.type} — ${override.reason}`
  );
}

function fieldAdditionReport(): string[] {
  return [...EFFECT_FIELD_ADDITIONS].flatMap(([key, additions]) =>
    additions.map((addition) => `${key}.${addition.name} ← ${addition.source} — ${addition.reason}`)
  );
}

function fieldCardinalityOverrideReport(): string[] {
  return [...EFFECT_FIELD_CARDINALITY_OVERRIDES].flatMap(([key, overrides]) =>
    overrides.map((override) => {
      const changes = [
        override.optional === undefined ? null : override.optional ? "optional" : "required",
        override.repeated === undefined ? null : override.repeated ? "repeated" : "singular",
        override.valueList === undefined
          ? null
          : `value-list ${override.valueList.min}..${override.valueList.max ?? "inf"}`,
      ].filter((change): change is string => change !== null);
      return `${key}.${override.name} → ${changes.join(", ")} ← ${override.source} — ${override.reason}`;
    })
  );
}

/**
 * Emits the typed effect interfaces, recorder metadata, and reference rows from lowered rules.
 * Unsupported rules and overlay mismatches remain explicit report entries or generation errors.
 * Throws when hand-written or event-fire policy owns a rule the rules declare removed.
 */
export function emitEffects(
  emitter: Emitter,
  docs: ReadonlyMap<string, DocEntry>,
  scopeIndex: ReadonlyMap<string, string>,
  rules: ReadonlyMap<string, LoweredRule>,
  policy: EffectPolicy,
  links: readonly ClassifiedLink[]
): EffectEmission {
  const aliasLists = aliasListSurfaces(emitter);
  const clustered = clusterEffects(emitter, docs, rules, policy);
  assertFieldOverlayRowsMatched(clustered);
  const effects = [...clustered.clusters.values()];
  const authoredCategories = authoredAliasCategories(effects);
  assertAliasCategoryRowsMatched(authoredCategories);
  const aliasStructCategories = [...authoredCategories]
    .filter((category) => EXTRA_ALIAS_CATEGORIES.get(category)?.scriptBlock !== undefined)
    .sort();
  const takenMethods = new Set([
    "effects",
    "then",
    ...policy.publicMethods,
    ...effects.flatMap((cluster) => cluster.effects.map((effect) => effect.method)),
  ]);
  const linkClusters = clusterScopeLinks(links, scopeIndex, takenMethods);

  const sortedClusters = effects.sort((left, right) =>
    compareStrings(clusterName(left.scopes), clusterName(right.scopes))
  );
  const sortedLinkClusters = [...linkClusters.values()].sort((left, right) =>
    compareStrings(pathClusterName(left.scopes), pathClusterName(right.scopes))
  );

  // Local to this pass, not module state: see registerClusterName's doc
  // comment for why. Shared between the two cluster-emission folds below
  // because both mint into the same file's export namespace.
  const mintedClusterNames = new Map<string, string>();
  const interfaceChunks = [
    ...aliasListTypes(emitter, aliasLists),
    ...extensionSeamInterfaces(emitter, sortedClusters),
    ...clusterInterfaces(emitter, sortedClusters, mintedClusterNames),
    ...pathClusterInterfaces(sortedLinkClusters, mintedClusterNames),
  ];

  const universalCluster = sortedClusters.find((cluster) => cluster.scopes === "universal");
  const allScopes = canonicalScopes(emitter.rules.scopes);
  const interfaces =
    interfaceChunks.join("\n") +
    "\n" +
    scopeInterfaces(emitter, allScopes, sortedClusters, sortedLinkClusters).join("\n") +
    "\n" +
    effectPathInterfaces(emitter, allScopes, sortedLinkClusters).join("\n") +
    "\n" +
    scopeMapCode(emitter, allScopes);

  return {
    interfaces,
    meta: effectMetaCode(sortedClusters, sortedLinkClusters, aliasLists, aliasStructCategories),
    emitted: sortedClusters.reduce((sum, cluster) => sum + cluster.effects.length, 0),
    byShape: clustered.byShape,
    skipped: clustered.skipped,
    clusterCount: sortedClusters.length,
    universalParameters: universalCluster === undefined ? "" : clusterParameters(universalCluster),
    fieldTypeOverrides: fieldTypeOverrideReport(),
    fieldAdditions: fieldAdditionReport(),
    fieldCardinalityOverrides: fieldCardinalityOverrideReport(),
    linkEmitted: links.length,
    references: effectReferenceRows(emitter, sortedClusters),
    scopeLinkReferences: scopeLinkReferenceRows(emitter, sortedLinkClusters),
  };
}

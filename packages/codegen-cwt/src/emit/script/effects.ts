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

import type { RuleType } from "../../cwt/model.ts";
import type { DocEntry } from "../../logs/trigger-docs.ts";
import type { LoweredRule } from "../../lower/lowered-rule.ts";
import {
  canonicalScopeSet,
  cardinalityArrayType,
  expandAliasFields,
  mergeFields,
  repeatedMemberType,
  skippedRule,
  skipReason,
  type ArgField,
  type ClauseCategory,
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
  type EffectFieldAddition,
  type EffectFieldCardinalityOverride,
} from "../../overlay/index.ts";
import type { EffectPolicy } from "../../policy/effects.ts";
import { Emitter, type TsValue } from "../../render/emitter.ts";
import { member as renderMember } from "../../render/writer.ts";
import { canonicalScopes } from "../support.ts";
import { effectMetaCode } from "./effect-meta.ts";
import type { ClassifiedLink } from "./links.ts";
import type { ScriptEffectReferenceRow, ScriptScopeLinkReferenceRow } from "./script-reference.ts";
import { tsDoc } from "./triggers.ts";

const EFFECT_CLAUSES = new Set<ClauseCategory>(["trigger", "effect", "modifier_rule"]);

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
  /** Rules overloaded between a block and a scalar, emitted scalar-only. */
  readonly scalarOnly: readonly string[];
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
export type EffectShape =
  | {
      /** Identifies an optional boolean-toggle argument. */
      readonly kind: "bool";
    }
  | {
      /** Identifies one required scalar argument. */
      readonly kind: "value";
      /** Scalar type and conversion used by the signature and recorder. */
      readonly value: TsValue;
    }
  | {
      /** Identifies an effect-splice closure, optionally preceded by named arguments. */
      readonly kind: "wrapper";
      /** Canonical closure scope, or `null` when it preserves the receiving scope. */
      readonly scope: string | null;
      /** Named arguments before the closure, or `null` when the closure is the only argument. */
      readonly fields: readonly ArgField[] | null;
    }
  | {
      /** Identifies one object argument composed from named rule fields. */
      readonly kind: "fields";
      /** Named fields represented by the generated argument object. */
      readonly fields: readonly ArgField[];
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
    if (field.repeated === override.repeated) {
      throw new Error(
        `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}.${field.name}", but lowering already ` +
          `makes it ${override.repeated ? "repeated" : "singular"} — retire that override`
      );
    }
    resolved = { ...resolved, repeated: override.repeated };
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
  const fieldShape = fieldShapeForOverlays(key, shape);
  const fields = applyCardinalityOverrides(key, fieldShape.fields ?? [], cardinalityOverrides);
  const added = addedFields(emitter, key, fields, additions);
  return {
    ...fieldShape,
    fields: insertFieldsBeforeClauses(fields, added),
  };
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

function scalarShapeOf(emitter: Emitter, rule: LoweredRule): EffectShape | SkipReason {
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

function blockShapeOf(emitter: Emitter, rule: LoweredRule): EffectShape | SkipReason {
  const block = rule.blocks[0]!;
  const body = block.type;
  if (body.bare.length > 0) {
    return skipReason("bare-value-block", "block with bare values");
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
  const pushedRaw = block.inheritedScope;
  const merged = named.length === 0 ? [] : mergeFields(emitter, named, pushedRaw, EFFECT_CLAUSES);
  if (!Array.isArray(merged)) {
    return merged;
  }

  if (categories.has("effect")) {
    let scope: string | null = null;
    if (pushedRaw !== null) {
      scope = emitter.canonicalScope(pushedRaw);
      if (scope === null) {
        return skipReason("unknown-push-scope", `push_scope names no known scope (${pushedRaw})`);
      }
    }
    return { kind: "wrapper", scope, fields: merged.length === 0 ? null : merged };
  }
  if (merged.length === 0) {
    return skipReason("empty-block", "block with no typeable fields");
  }
  return { kind: "fields", fields: merged };
}

function shapeOf(
  emitter: Emitter,
  rule: LoweredRule
): EffectShape | SkipReason | { readonly scalarOnly: EffectShape } {
  if (rule.comparison) {
    return skipReason("comparison-effect", "declared with a comparison operator");
  }
  if (rule.blocks.length === 0) {
    return scalarShapeOf(emitter, rule);
  }
  if (rule.scalars.length > 0) {
    // Overloaded between a block and a scalar (`log` is both an effect clause
    // and a message). Emit the scalar form so the common case survives; the
    // dropped block form is counted, not silent.
    const fallback = scalarShapeOf(emitter, {
      ...rule,
      declarations: rule.scalars,
      comparison: false,
      blocks: [],
    });
    if ("kind" in fallback) {
      return { scalarOnly: fallback };
    }
    return skipReason("scalar-block-overload", "overloaded between a block and a scalar");
  }
  if (rule.blocks.length > 1) {
    return skipReason("multiple-block-forms", "multiple block declarations");
  }
  return blockShapeOf(emitter, rule);
}

/** The type text a lowered value contributes before field-level wrapping or overrides. */
function baseMemberType(
  emitter: Emitter,
  value: ArgField["value"],
  outerScope: string,
  effectKey: string
): string {
  switch (value.kind) {
    case "scalar":
      return emitter.useValue(value.value).type;
    case "fields":
      return argsType(emitter, value.fields, outerScope, effectKey);
    case "scalarOrFields":
      return (
        `${emitter.useValue(value.scalar).type} | ` +
        `${argsType(emitter, value.fields, outerScope, effectKey)}`
      );
    case "valueList": {
      const arms = [
        value.scalar === null ? undefined : emitter.useValue(value.scalar).type,
        value.fields === null ? null : argsType(emitter, value.fields, outerScope, effectKey),
      ].filter((arm): arm is string => arm !== null && arm !== undefined);
      const item =
        arms.length === 1 && !arms[0]!.includes(" | ") ? arms[0]! : `(${arms.join(" | ")})`;
      return cardinalityArrayType(item, value.cardinality);
    }
    case "clause": {
      const scope = value.scope === null ? outerScope : JSON.stringify(value.scope);
      if (value.category === "trigger") {
        return `${emitter.use("Trigger")}<${scope}>`;
      }
      if (value.category === "modifier_rule") {
        return `readonly ${emitter.use("Modifier")}<${scope}>[]`;
      }
      return value.scope === null
        ? `(scope: ScopeObjOf<${scope}>) => void`
        : `(scope: ${scopeInterfaceName(value.scope)}) => void`;
    }
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
  return field.repeated === true ? repeatedMemberType(emitter, field.value, single) : single;
}

function scopeInterfaceName(scope: string | null): string {
  return scope === null ? "this" : `${pascalCase(scope)}Scope`;
}

function argsType(
  emitter: Emitter,
  fields: readonly ArgField[],
  outerScope: string,
  effectKey: string
): string {
  const members = fields.map(
    (field) =>
      `${camelCase(field.name)}${field.optional ? "?" : ""}: ${memberType(emitter, field, outerScope, effectKey)}`
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
      return `  ${method}(value: ${emitter.useValue(shape.value).type}): void;\n`;
    case "fields":
      return `  ${method}(args: ${argsType(emitter, shape.fields, outerScope, key)}): void;\n`;
    case "wrapper": {
      const body = `body: (scope: ${scopeInterfaceName(shape.scope)}) => void`;
      return shape.fields === null
        ? `  ${method}(${body}): void;\n`
        : `  ${method}(args: ${argsType(emitter, shape.fields, outerScope, key)}, ${body}): void;\n`;
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

function referenceSignature(emitter: Emitter, effect: EmittedEffect, outerScope: string): string {
  const seam = EFFECT_EXTENSION_SEAMS.get(effect.key);
  if (seam === undefined) {
    return methodSignatureText(emitter, effect, outerScope).trim();
  }
  return (
    `${seam.referenceSignature}\n` +
    `${extensionFallbackSignature(emitter, effect, outerScope).trim()}`
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
    type: `EffectPathOf<${JSON.stringify(link.outputScope)}>`,
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
  readonly scalarOnly: string[];
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
  readonly scalarOnly: boolean;
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
  if (rule.scopes === null || rule.scopeType === null) {
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
  if ("category" in shape) {
    return shape;
  }
  if (isolatesNameAliasUsage) {
    emitter.absorb(ruleEmitter);
  }
  const base = "scalarOnly" in shape ? shape.scalarOnly : shape;
  return {
    effect: {
      method: safeIdentifier(camelCase(key)),
      key,
      shape: applyFieldOverlays(emitter, key, base),
      docs: tsDoc(rule.declarations, docs.get(key)),
    },
    scalarOnly: "scalarOnly" in shape,
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
  const scalarOnly: string[] = [];
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
    const lowered = lowerEffect(emitter, docs, candidate);
    if ("category" in lowered) {
      skipped.push({ name: key, ...lowered });
      continue;
    }
    if (lowered.appliesFieldAdditions) {
      appliedFieldAdditions.add(key);
    }
    if (lowered.appliesFieldCardinalityOverrides) {
      appliedFieldCardinalityOverrides.add(key);
    }
    if (lowered.scalarOnly) {
      scalarOnly.push(key);
    }
    addEffectToCluster(clusters, candidate.scopes, lowered.effect);
    byShape.set(lowered.effect.shape.kind, (byShape.get(lowered.effect.shape.kind) ?? 0) + 1);
  }

  return {
    clusters,
    skipped,
    scalarOnly,
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
        effect.shape.kind === "fields" || effect.shape.kind === "wrapper"
          ? (effect.shape.fields ?? []).map((field) => `${effect.key}.${field.name}`)
          : []
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
    // The args go out under their own name as well: the hand-written overload
    // narrows two members of this object and has no business restating the
    // rest, which are the rules' to change.
    const argsName = extensionArgsName(effect);
    const args =
      effect.shape.kind === "fields"
        ? docComment([`The arguments \`${camelCase(key)}\` takes, as the rules declare them.`]) +
          `export type ${argsName} = ` +
          `${argsType(emitter, effect.shape.fields, outerScopeText(cluster.scopes), key)};\n`
        : "";
    const signature =
      effect.shape.kind === "fields"
        ? `${docComment(effect.docs, "  ")}` +
          `${extensionFallbackSignature(emitter, effect, outerScopeText(cluster.scopes))}`
        : methodSignature(emitter, effect, outerScopeText(cluster.scopes));
    chunks.push(
      args +
        docComment([
          `Stable extension seam for the hand-written ${camelCase(key)} overload.`,
          `The generated cluster containing ${key} inherits this interface.`,
          seam.reason,
        ]) +
        `export interface ${seam.interfaceName} {\n${signature}}\n`
    );
  }
  return chunks;
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
    const outerScope = outerScopeText(cluster.scopes);
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
        return seam === undefined ? [] : [seam.interfaceName];
      })
      .sort();
    const parents = seams.length === 0 ? "" : ` extends ${seams.join(", ")}`;
    return `${docComment(heading)}export interface ${name}${parents} {\n${methods}}\n`;
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
        .map((cluster) => clusterName(cluster.scopes)),
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
      `${emitter.use("EffectPath")}<${JSON.stringify(scope)}>`,
      ...linkClusters
        .filter((cluster) => cluster.scopes === "universal" || cluster.scopes.includes(scope))
        .map((cluster) => pathClusterName(cluster.scopes)),
    ];
    return (
      docComment([`An effect-block path whose current scope is ${scope}.`]) +
      `export interface ${pascalCase(scope)}EffectPath extends ${parents.join(", ")} {}\n`
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
    `export type ScopeObjOf<S extends ${emitter.use("ScopeName")}> = ScopeMap[S];\n\n` +
    docComment(["Scope name -> a composable effect-block path at that scope."]) +
    `export interface EffectPathMap {\n` +
    allScopes
      .map((scope) => `  ${JSON.stringify(scope)}: ${pascalCase(scope)}EffectPath;\n`)
      .join("") +
    `}\n\n` +
    `export type EffectPathOf<S extends ${emitter.use("ScopeName")}> = EffectPathMap[S];\n`
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
  return [...EFFECT_FIELD_TYPE_OVERRIDES].map(
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
  const clustered = clusterEffects(emitter, docs, rules, policy);
  assertFieldOverlayRowsMatched(clustered);

  const effects = [...clustered.clusters.values()];
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
    ...extensionSeamInterfaces(emitter, sortedClusters),
    ...clusterInterfaces(emitter, sortedClusters, mintedClusterNames),
    ...pathClusterInterfaces(sortedLinkClusters, mintedClusterNames),
  ];

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
    meta: effectMetaCode(sortedClusters, sortedLinkClusters),
    emitted: sortedClusters.reduce((sum, cluster) => sum + cluster.effects.length, 0),
    byShape: clustered.byShape,
    skipped: clustered.skipped,
    clusterCount: sortedClusters.length,
    scalarOnly: clustered.scalarOnly,
    fieldTypeOverrides: fieldTypeOverrideReport(),
    fieldAdditions: fieldAdditionReport(),
    fieldCardinalityOverrides: fieldCardinalityOverrideReport(),
    linkEmitted: links.length,
    references: effectReferenceRows(emitter, sortedClusters),
    scopeLinkReferences: scopeLinkReferenceRows(emitter, sortedLinkClusters),
  };
}

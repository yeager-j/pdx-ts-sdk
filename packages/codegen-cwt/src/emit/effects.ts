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
 *   recorder (`src/script/effects/recorder.ts`, a single scope-agnostic Proxy) how to
 *   serialize the call. The Proxy throws on names missing from this table.
 *
 * Scopes come from the rules' `## scopes` with the game dump as fallback,
 * exactly like triggers. Nothing is dropped silently: every effect the
 * emitter cannot type is skipped with a named reason and reported.
 */

import type { RuleType } from "../cwt/model.ts";
import type { AliasDecl } from "../cwt/rules.ts";
import type { EffectPolicy } from "../effect-policy.ts";
import type { DocEntry } from "../logs/trigger-docs.ts";
import type { LoweredRule } from "../lowered-rule.ts";
import { camelCase, docComment, isPlainName, pascalCase, safeIdentifier } from "../naming.ts";
import {
  EFFECT_EXTENSION_SEAMS,
  EFFECT_FIELD_ADDITIONS,
  EFFECT_FIELD_CARDINALITY_OVERRIDES,
  EFFECT_FIELD_TYPE_OVERRIDES,
} from "../overlay.ts";
import type { ClassifiedLink } from "./links.ts";
import type { ScriptEffectReferenceRow, ScriptScopeLinkReferenceRow } from "./script-reference.ts";
import {
  canonicalScopeSet,
  cardinalityArrayType,
  expandAliasFields,
  mergeFields,
  skippedRule,
  skipReason,
  type ArgField,
  type ClauseCategory,
  type SkippedRule,
  type SkipReason,
} from "./shape.ts";
import { canonicalScopes } from "./support.ts";
import { Emitter, type TsValue } from "./types.ts";

const EFFECT_CLAUSES = new Set<ClauseCategory>(["trigger", "effect", "modifier_rule"]);

export interface EffectEmission {
  readonly interfaces: string;
  readonly meta: string;
  readonly emitted: number;
  readonly byShape: ReadonlyMap<string, number>;
  readonly skipped: readonly SkippedRule[];
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

type EffectShape =
  | { readonly kind: "bool" }
  | { readonly kind: "value"; readonly value: TsValue }
  /** Effect-splice block: closure body, pushed scope (null = same scope). */
  | {
      readonly kind: "wrapper";
      readonly scope: string | null;
      readonly fields: readonly ArgField[] | null;
    }
  | { readonly kind: "fields"; readonly fields: readonly ArgField[] };

function applyFieldOverlays(emitter: Emitter, key: string, shape: EffectShape): EffectShape {
  const additions = EFFECT_FIELD_ADDITIONS.get(key) ?? [];
  const cardinalityOverrides = EFFECT_FIELD_CARDINALITY_OVERRIDES.get(key) ?? [];
  if (additions.length === 0 && cardinalityOverrides.length === 0) {
    return shape;
  }
  if (shape.kind !== "fields" && shape.kind !== "wrapper") {
    throw new Error(
      `Effect field overlay names "${key}", but that effect does not emit an args block`
    );
  }
  let fields = shape.fields ?? [];
  const appliedCardinality = new Set<string>();
  fields = fields.map((field) => {
    const override = cardinalityOverrides.find((candidate) => candidate.name === field.name);
    if (override === undefined) {
      return field;
    }
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
    appliedCardinality.add(field.name);
    return resolved;
  });
  for (const override of cardinalityOverrides) {
    if (!appliedCardinality.has(override.name)) {
      throw new Error(
        `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}.${override.name}", which no ` +
          "emitted effect field matches — retire the overlay row or fix its key"
      );
    }
  }
  const names = new Set(fields.map((field) => field.name));
  const added = additions.map((addition): ArgField => {
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
  const firstClause = fields.findIndex((field) => field.value.kind === "clause");
  const insertion = firstClause === -1 ? fields.length : firstClause;
  return {
    ...shape,
    fields: [...fields.slice(0, insertion), ...added, ...fields.slice(insertion)],
  };
}

interface EmittedEffect {
  readonly method: string;
  readonly key: string;
  readonly shape: EffectShape;
  readonly docs: readonly string[];
}

interface EmittedScopeLink {
  readonly method: string;
  readonly key: string;
  readonly outputScope: string;
  readonly docs: readonly string[];
}

function shapeOf(
  emitter: Emitter,
  rule: LoweredRule
): EffectShape | SkipReason | { readonly scalarOnly: EffectShape } {
  if (rule.comparison) {
    return skipReason("comparison-effect", "declared with a comparison operator");
  }
  const blocks = rule.blocks;
  const scalars = rule.scalars;

  if (blocks.length === 0) {
    if (scalars.some((s) => s.type.kind === "literal" && s.type.text.startsWith("$"))) {
      return skipReason("parameterised-placeholder", "parameterised placeholder rule");
    }
    // Effects spell booleans `destroy_colony = yes`, which classifies as the
    // literal `yes` rather than a bool — both mean the same toggle.
    const boolish = (type: RuleType): boolean =>
      type.kind === "bool" || (type.kind === "literal" && type.text === "yes");
    if (scalars.every((declaration) => boolish(declaration.type))) {
      return { kind: "bool" };
    }
    const value = emitter.unionFor(scalars.map((declaration) => declaration.type));
    if (value === null) {
      return skipReason(
        "unsupported-value",
        `unsupported value type (${scalars.map((s) => s.type.kind).join(", ")})`
      );
    }
    return { kind: "value", value };
  }

  if (scalars.length > 0) {
    // Overloaded between a block and a scalar (`log` is both an effect clause
    // and a message). Emit the scalar form so the common case survives; the
    // dropped block form is counted, not silent.
    const fallback = shapeOf(emitter, {
      ...rule,
      declarations: scalars,
      comparison: false,
      blocks: [],
    });
    if ("kind" in fallback) {
      return { scalarOnly: fallback };
    }
    return skipReason("scalar-block-overload", "overloaded between a block and a scalar");
  }
  if (blocks.length > 1) {
    return skipReason("multiple-block-forms", "multiple block declarations");
  }

  const block = blocks[0]!;
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

/**
 * The type text one args member emits, after the overlay has had its say.
 *
 * `owner` is the effect key the field belongs to, so an override row can name
 * one field of one effect rather than every field spelled that way.
 */
function memberType(field: ArgField, outerScope: string, owner: string): string {
  const override = EFFECT_FIELD_TYPE_OVERRIDES.get(`${owner}.${field.name}`);
  if (override !== undefined) {
    return override.type;
  }
  const value = field.value;
  const type = (() => {
    switch (value.kind) {
      case "scalar":
        return value.value.type;
      case "fields":
        return argsType(value.fields, outerScope, owner);
      case "scalarOrFields":
        return `${value.scalar.type} | ${argsType(value.fields, outerScope, owner)}`;
      case "valueList": {
        const arms = [
          value.scalar?.type,
          value.fields === null ? null : argsType(value.fields, outerScope, owner),
        ].filter((arm): arm is string => arm !== null && arm !== undefined);
        const item =
          arms.length === 1 && !arms[0]!.includes(" | ") ? arms[0]! : `(${arms.join(" | ")})`;
        return cardinalityArrayType(item, value.cardinality);
      }
      case "clause": {
        const scope = value.scope === null ? outerScope : JSON.stringify(value.scope);
        if (value.category === "trigger") {
          return `Trigger<${scope}>`;
        }
        if (value.category === "modifier_rule") {
          return `readonly Modifier<${scope}>[]`;
        }
        return value.scope === null
          ? `(scope: ScopeObjOf<${scope}>) => void`
          : `(scope: ${scopeInterfaceName(value.scope)}) => void`;
      }
      case "comparison": {
        const literals = value.literals.map((literal) => JSON.stringify(literal));
        return [value.value.type, `readonly [PdxOp, ${value.value.type}]`, ...literals].join(" | ");
      }
    }
  })();
  if (field.repeated !== true) {
    return type;
  }
  return `readonly ${type.includes(" | ") ? `(${type})` : type}[]`;
}

function scopeInterfaceName(scope: string | null): string {
  return scope === null ? "this" : `${pascalCase(scope)}Scope`;
}

function argsType(fields: readonly ArgField[], outerScope: string, owner: string): string {
  const members = fields.map(
    (field) =>
      `${camelCase(field.name)}${field.optional ? "?" : ""}: ${memberType(field, outerScope, owner)}`
  );
  return `{ ${members.join("; ")} }`;
}

function methodSignature(effect: EmittedEffect, outerScope: string): string {
  const { method, key, shape } = effect;
  const doc = docComment(effect.docs, "  ");
  return doc + methodSignatureText(effect, outerScope);
}

function methodSignatureText(effect: EmittedEffect, outerScope: string): string {
  const { method, key, shape } = effect;
  switch (shape.kind) {
    case "bool":
      return `  ${method}(value?: boolean): void;\n`;
    case "value":
      return `  ${method}(value: ${shape.value.type}): void;\n`;
    case "fields":
      return `  ${method}(args: ${argsType(shape.fields, outerScope, key)}): void;\n`;
    case "wrapper": {
      const body = `body: (scope: ${scopeInterfaceName(shape.scope)}) => void`;
      return shape.fields === null
        ? `  ${method}(${body}): void;\n`
        : `  ${method}(args: ${argsType(shape.fields, outerScope, key)}, ${body}): void;\n`;
    }
  }
}

function extensionArgsName(effect: EmittedEffect): string {
  return `${pascalCase(camelCase(effect.key))}Args`;
}

function extensionFallbackSignature(effect: EmittedEffect, outerScope: string): string {
  if (effect.shape.kind === "fields") {
    return `  ${effect.method}(args: ${extensionArgsName(effect)}): void;\n`;
  }
  return methodSignatureText(effect, outerScope);
}

function referenceSignature(effect: EmittedEffect, outerScope: string): string {
  const seam = EFFECT_EXTENSION_SEAMS.get(effect.key);
  if (seam === undefined) {
    return methodSignatureText(effect, outerScope).trim();
  }
  return `${seam.referenceSignature}\n${extensionFallbackSignature(effect, outerScope).trim()}`;
}

/** `refTypes: [...]`, when every form the value admits is a `<type>` reference.
 * One non-reference arm and it is omitted: an id-shaped value would then be
 * legal for reasons no registry can see. */
function refTypesMeta(value: TsValue | undefined): string {
  return value?.refTypes === undefined ? "" : `, refTypes: ${JSON.stringify(value.refTypes)}`;
}

function booleanLiteralsMeta(value: TsValue | undefined): string {
  return value?.booleanLiterals === undefined
    ? ""
    : `, booleanLiterals: ${JSON.stringify(value.booleanLiterals)}`;
}

function scalarMeta(value: TsValue): string {
  const members = [
    value.refTypes === undefined ? null : `refTypes: ${JSON.stringify(value.refTypes)}`,
    value.booleanLiterals === undefined
      ? null
      : `booleanLiterals: ${JSON.stringify(value.booleanLiterals)}`,
    value.objectKinds === undefined ? null : `objectKinds: ${JSON.stringify(value.objectKinds)}`,
  ].filter((member): member is string => member !== null);
  return members.length === 0 ? "{}" : `{ ${members.join(", ")} }`;
}

function fieldMeta(field: ArgField): string {
  const repeated = field.repeated === true ? ", repeated: true" : "";
  if (field.value.kind === "fields") {
    return `{ prop: ${JSON.stringify(camelCase(field.name))}, key: ${JSON.stringify(field.name)}, kind: "fields", fields: [${field.value.fields.map(fieldMeta).join(", ")}]${repeated} }`;
  }
  if (field.value.kind === "scalarOrFields") {
    return `{ prop: ${JSON.stringify(camelCase(field.name))}, key: ${JSON.stringify(field.name)}, kind: "scalar-or-fields", scalar: ${scalarMeta(field.value.scalar)}, fields: [${field.value.fields.map(fieldMeta).join(", ")}]${repeated} }`;
  }
  if (field.value.kind === "valueList") {
    const scalar = field.value.scalar;
    const fields = field.value.fields;
    return `{ prop: ${JSON.stringify(camelCase(field.name))}, key: ${JSON.stringify(field.name)}, kind: "value-list"${scalar === null ? "" : `, scalar: ${scalarMeta(scalar)}`}${fields === null ? "" : `, fields: [${fields.map(fieldMeta).join(", ")}]`}${repeated} }`;
  }
  const kind =
    field.value.kind === "scalar"
      ? "value"
      : field.value.kind === "comparison"
        ? "comparison"
        : field.value.category === "trigger"
          ? "trigger"
          : field.value.category === "modifier_rule"
            ? "modifiers"
            : "effect";
  const refTypes = refTypesMeta(field.value.kind === "scalar" ? field.value.value : undefined);
  const booleanLiterals = booleanLiteralsMeta(
    field.value.kind === "scalar" ? field.value.value : undefined
  );
  return `{ prop: ${JSON.stringify(camelCase(field.name))}, key: ${JSON.stringify(field.name)}, kind: ${JSON.stringify(kind)}${refTypes}${booleanLiterals}${repeated} }`;
}

function metaEntry(effect: EmittedEffect): string {
  const { method, key, shape } = effect;
  const fieldsOf = (fields: readonly ArgField[] | null): string =>
    fields === null ? "null" : `[${fields.map(fieldMeta).join(", ")}]`;
  switch (shape.kind) {
    case "bool":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "bool" } },\n`;
    case "value":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "value"${refTypesMeta(shape.value)}${booleanLiteralsMeta(shape.value)} } },\n`;
    case "fields":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "fields", fields: ${fieldsOf(shape.fields)} } },\n`;
    case "wrapper":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "wrapper", fields: ${fieldsOf(shape.fields)} } },\n`;
  }
}

function scopeLinkMetaEntry(link: EmittedScopeLink): string {
  return `  ${link.method}: { key: ${JSON.stringify(link.key)}, shape: { kind: "scope-link" } },\n`;
}

/** Deterministic short tag for long scope sets, stable across runs. */
function hashTag(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 4);
}

function clusterName(scopes: readonly string[] | "universal"): string {
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

function pathProperty(link: EmittedScopeLink): string {
  return (
    docComment(link.docs, "  ") +
    `  readonly ${link.method}: EffectPathOf<${JSON.stringify(link.outputScope)}>;\n`
  );
}

function tsDoc(declarations: readonly AliasDecl[], doc: DocEntry | undefined): string[] {
  const summary = declarations.flatMap((declaration) => declaration.docs)[0] ?? doc?.summary ?? "";
  const lines = [summary];
  if (doc !== undefined && doc.usage !== "") {
    lines.push("", "```", ...doc.usage.split("\n"), "```");
  }
  return lines;
}

export function emitEffects(
  emitter: Emitter,
  docs: ReadonlyMap<string, DocEntry>,
  scopeIndex: ReadonlyMap<string, string>,
  rules: ReadonlyMap<string, LoweredRule>,
  policy: EffectPolicy,
  links: readonly ClassifiedLink[]
): EffectEmission {
  const skipped: SkippedRule[] = [];
  const scalarOnly: string[] = [];
  const appliedFieldAdditions = new Set<string>();
  const appliedFieldCardinalityOverrides = new Set<string>();
  const byShape = new Map<string, number>();
  interface Cluster {
    readonly scopes: readonly string[] | "universal";
    readonly effects: EmittedEffect[];
  }
  interface LinkCluster {
    readonly scopes: readonly string[] | "universal";
    readonly links: EmittedScopeLink[];
  }
  const clusters = new Map<string, Cluster>();
  const linkClusters = new Map<string, LinkCluster>();

  for (const key of [...rules.keys()].sort()) {
    const rule = rules.get(key)!;
    const declarations = rule.declarations;
    const ownership = policy.byKey.get(key.toLowerCase());
    if (ownership?.owner !== "generated") {
      skipped.push(
        skippedRule(
          key,
          ownership?.owner === "fire" ? "event-fire-effect" : "structural-effect",
          ownership?.owner === "fire"
            ? "typed by the event-fire emitter"
            : `hand-written structural effect${ownership?.reason === undefined ? "" : `: ${ownership.reason}`}`
        )
      );
      continue;
    }
    if (key === "<scripted_effect>") {
      skipped.push(
        skippedRule(key, "abstract-placeholder", "abstract scripted-effect placeholder")
      );
      continue;
    }
    if (!isPlainName(key)) {
      skipped.push(skippedRule(key, "invalid-rule-name", "not a plain rule name"));
      continue;
    }
    const doc = docs.get(key);
    if (rule.supportedScopes.length === 0) {
      skipped.push(
        skippedRule(key, "missing-rule-scope", "no scopes in either the rules or the game's dump")
      );
      continue;
    }
    const scopes = rule.scopes;
    const outerScope = rule.scopeType;
    if (scopes === null || outerScope === null) {
      skipped.push(
        skippedRule(key, "unknown-scope", `unknown scope in ${rule.supportedScopes.join(" ")}`)
      );
      continue;
    }
    const isolatesNameAliasUsage = rule.blocks.some((block) =>
      block.splices.some((field) => field.key.kind === "aliasName" && field.key.category === "name")
    );
    const ruleEmitter = isolatesNameAliasUsage ? new Emitter(emitter.rules) : emitter;
    const shape = shapeOf(ruleEmitter, rule);
    if ("category" in shape) {
      skipped.push({ name: key, ...shape });
      continue;
    }
    if (isolatesNameAliasUsage) {
      emitter.absorb(ruleEmitter);
    }
    const base = "scalarOnly" in shape ? shape.scalarOnly : shape;
    const resolved = applyFieldOverlays(emitter, key, base);
    if (EFFECT_FIELD_ADDITIONS.has(key)) {
      appliedFieldAdditions.add(key);
    }
    if (EFFECT_FIELD_CARDINALITY_OVERRIDES.has(key)) {
      appliedFieldCardinalityOverrides.add(key);
    }
    if ("scalarOnly" in shape) {
      scalarOnly.push(key);
    }

    const effect: EmittedEffect = {
      method: safeIdentifier(camelCase(key)),
      key,
      shape: resolved,
      docs: tsDoc(declarations, doc),
    };
    const clusterKey = scopes === "universal" ? "universal" : scopes.join("|");
    const cluster = clusters.get(clusterKey) ?? { scopes, effects: [] };
    cluster.effects.push(effect);
    clusters.set(clusterKey, cluster);
    byShape.set(resolved.kind, (byShape.get(resolved.kind) ?? 0) + 1);
  }

  // An override row naming a field no emitted effect has is a lie the emitted
  // types would not show: it would read as an audited departure while changing
  // nothing. A rules bump that renames or drops the field has to be noticed
  // here rather than quietly turning the row into decoration.
  const fieldKeys = new Set(
    [...clusters.values()].flatMap((cluster) =>
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
    if (!appliedFieldAdditions.has(key)) {
      throw new Error(
        `EFFECT_FIELD_ADDITIONS names "${key}", which no emitted effect matches — ` +
          "retire the overlay row or fix its key"
      );
    }
  }
  for (const key of EFFECT_FIELD_CARDINALITY_OVERRIDES.keys()) {
    if (!appliedFieldCardinalityOverrides.has(key)) {
      throw new Error(
        `EFFECT_FIELD_CARDINALITY_OVERRIDES names "${key}", which no emitted effect ` +
          "matches — retire the overlay row or fix its key"
      );
    }
  }

  // Scope links use their own recursive property clusters. A name collision is
  // a hard error, not a skip: the property would merge with an effect method,
  // and the Proxy would have no unambiguous dispatch for that authoring name.
  const effectCount = [...clusters.values()].reduce(
    (sum, cluster) => sum + cluster.effects.length,
    0
  );

  const takenMethods = new Set([
    "effects",
    "then",
    ...policy.publicMethods,
    ...[...clusters.values()].flatMap((cluster) => cluster.effects.map((effect) => effect.method)),
  ]);
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

  const sortedClusters = [...clusters.values()].sort((left, right) =>
    clusterName(left.scopes).localeCompare(clusterName(right.scopes))
  );
  const sortedLinkClusters = [...linkClusters.values()].sort((left, right) =>
    pathClusterName(left.scopes).localeCompare(pathClusterName(right.scopes))
  );

  const interfaceChunks: string[] = [];
  const clusterScope = (cluster: Cluster): string =>
    cluster.scopes === "universal"
      ? "ScopeName"
      : cluster.scopes.map((scope) => JSON.stringify(scope)).join(" | ");
  // Each seam is emitted as its own interface before the cluster that owns the
  // effect, so the hand-written overload merges onto a name the rules cannot
  // rename. An effect that leaves the rules fails here rather than silently
  // detaching its overload.
  for (const [key, seam] of EFFECT_EXTENSION_SEAMS) {
    const owner = sortedClusters.find((cluster) =>
      cluster.effects.some((effect) => effect.key === key)
    );
    const effect = owner?.effects.find((candidate) => candidate.key === key);
    if (owner === undefined || effect === undefined) {
      throw new Error(`effects.cwt no longer emits ${key}`);
    }
    // The args go out under their own name as well: the hand-written overload
    // narrows two members of this object and has no business restating the
    // rest, which are the rules' to change.
    const argsName = extensionArgsName(effect);
    const args =
      effect.shape.kind === "fields"
        ? docComment([`The arguments \`${camelCase(key)}\` takes, as the rules declare them.`]) +
          `export type ${argsName} = ${argsType(effect.shape.fields, clusterScope(owner), key)};\n`
        : "";
    const signature =
      effect.shape.kind === "fields"
        ? `${docComment(effect.docs, "  ")}${extensionFallbackSignature(effect, clusterScope(owner))}`
        : methodSignature(effect, clusterScope(owner));
    interfaceChunks.push(
      args +
        docComment([
          `Stable extension seam for the hand-written ${camelCase(key)} overload.`,
          `The generated cluster containing ${key} inherits this interface.`,
          seam.reason,
        ]) +
        `export interface ${seam.interfaceName} {\n${signature}}\n`
    );
  }
  for (const cluster of sortedClusters) {
    const name = clusterName(cluster.scopes);
    const outerScope = clusterScope(cluster);
    const heading =
      cluster.scopes === "universal"
        ? ["Effects valid in every scope."]
        : [`Effects valid in: ${cluster.scopes.join(", ")}.`];
    const methods = cluster.effects
      .filter((effect) => !EFFECT_EXTENSION_SEAMS.has(effect.key))
      .map((effect) => methodSignature(effect, outerScope))
      .join("\n");
    const seams = cluster.effects
      .flatMap((effect) => {
        const seam = EFFECT_EXTENSION_SEAMS.get(effect.key);
        return seam === undefined ? [] : [seam.interfaceName];
      })
      .sort();
    const parents = seams.length === 0 ? "" : ` extends ${seams.join(", ")}`;
    interfaceChunks.push(
      `${docComment(heading)}export interface ${name}${parents} {\n${methods}}\n`
    );
  }

  for (const cluster of sortedLinkClusters) {
    const name = pathClusterName(cluster.scopes);
    const heading =
      cluster.scopes === "universal"
        ? ["Effect scope paths valid in every scope."]
        : [`Effect scope paths valid in: ${cluster.scopes.join(", ")}.`];
    interfaceChunks.push(
      `${docComment(heading)}export interface ${name} {\n${cluster.links.map(pathProperty).join("\n")}}\n`
    );
  }

  const allScopes = canonicalScopes(emitter.rules.scopes);
  const scopeChunks = allScopes.map((scope) => {
    const parents = [
      `StructuralEffects<${JSON.stringify(scope)}>`,
      ...sortedClusters
        .filter((cluster) => cluster.scopes === "universal" || cluster.scopes.includes(scope))
        .map((cluster) => clusterName(cluster.scopes)),
      ...sortedLinkClusters
        .filter((cluster) => cluster.scopes === "universal" || cluster.scopes.includes(scope))
        .map((cluster) => pathClusterName(cluster.scopes)),
    ];
    return (
      docComment([`The effects recordable in ${scope} scope.`]) +
      `export interface ${pascalCase(scope)}Scope extends ${parents.join(", ")} {}\n`
    );
  });

  const pathChunks = allScopes.map((scope) => {
    const parents = [
      `EffectPath<${JSON.stringify(scope)}>`,
      ...sortedLinkClusters
        .filter((cluster) => cluster.scopes === "universal" || cluster.scopes.includes(scope))
        .map((cluster) => pathClusterName(cluster.scopes)),
    ];
    return (
      docComment([`An effect-block path whose current scope is ${scope}.`]) +
      `export interface ${pascalCase(scope)}EffectPath extends ${parents.join(", ")} {}\n`
    );
  });

  const scopeMap =
    docComment(["Scope name -> the interface of effects recordable there."]) +
    `export interface ScopeMap {\n` +
    allScopes.map((scope) => `  ${JSON.stringify(scope)}: ${pascalCase(scope)}Scope;\n`).join("") +
    `}\n\n` +
    `export type ScopeObjOf<S extends ScopeName> = ScopeMap[S];\n\n` +
    docComment(["Scope name -> a composable effect-block path at that scope."]) +
    `export interface EffectPathMap {\n` +
    allScopes
      .map((scope) => `  ${JSON.stringify(scope)}: ${pascalCase(scope)}EffectPath;\n`)
      .join("") +
    `}\n\n` +
    `export type EffectPathOf<S extends ScopeName> = EffectPathMap[S];\n`;

  const interfaces =
    interfaceChunks.join("\n") +
    "\n" +
    scopeChunks.join("\n") +
    "\n" +
    pathChunks.join("\n") +
    "\n" +
    scopeMap;

  const metaEntries = [
    ...sortedClusters
      .flatMap((cluster) => cluster.effects)
      .map((effect) => ({ method: effect.method, entry: metaEntry(effect) })),
    ...sortedLinkClusters
      .flatMap((cluster) => cluster.links)
      .map((link) => ({ method: link.method, entry: scopeLinkMetaEntry(link) })),
  ]
    .sort((left, right) => left.method.localeCompare(right.method))
    .map(({ entry }) => entry)
    .join("");
  const meta =
    "export type EffectFieldKind = " +
    '"value" | "comparison" | "trigger" | "effect" | "modifiers" | "fields" | "scalar-or-fields" | "value-list";\n\n' +
    "export interface EffectFieldMeta {\n" +
    "  readonly prop: string;\n" +
    "  readonly key: string;\n" +
    "  readonly kind: EffectFieldKind;\n" +
    docComment(
      [
        "The registries an id in this field may name, when every form the",
        "field admits is a `<type>` reference. Undefined the moment one arm is",
        "not — an id-shaped value would then prove nothing about any registry.",
        "`buildMod` resolves what the recorder reports against the built ids.",
      ],
      "  "
    ) +
    "  readonly refTypes?: readonly string[];\n" +
    "  /** Literal yes/no arms that lower to PDXScript booleans rather than strings. */\n" +
    '  readonly booleanLiterals?: readonly ("yes" | "no")[];\n' +
    "  /** Object-backed scalar forms accepted by a mixed scalar/block field. */\n" +
    '  readonly objectKinds?: readonly ("scope-ref" | "typed-ref")[];\n' +
    "  /** Whether the field accepts repeated entries under the same script key. */\n" +
    "  readonly repeated?: boolean;\n" +
    "  /** Scalar and structured-block arms for an overloaded field. */\n" +
    '  readonly scalar?: Pick<EffectFieldMeta, "refTypes" | "booleanLiterals" | "objectKinds">;\n' +
    "  readonly fields?: readonly EffectFieldMeta[];\n" +
    "}\n\n" +
    "export type EffectShapeMeta =\n" +
    '  | { readonly kind: "bool" }\n' +
    '  | { readonly kind: "value"; readonly refTypes?: readonly string[]; readonly booleanLiterals?: readonly ("yes" | "no")[] }\n' +
    '  | { readonly kind: "fields"; readonly fields: readonly EffectFieldMeta[] | null }\n' +
    '  | { readonly kind: "wrapper"; readonly fields: readonly EffectFieldMeta[] | null }\n' +
    '  | { readonly kind: "scope-link" };\n\n' +
    "export interface EffectMeta {\n" +
    "  readonly key: string;\n" +
    "  readonly shape: EffectShapeMeta;\n" +
    "}\n\n" +
    docComment([
      "How the recorder serializes each effect method. The Proxy in",
      "`src/script/effects/recorder.ts` throws on names missing from this table, so a",
      "typo in an untyped position fails loudly instead of recording garbage.",
    ]) +
    "export const EFFECT_META: Record<string, EffectMeta | undefined> = {\n" +
    metaEntries +
    "};\n";

  const references = sortedClusters.flatMap((cluster) => {
    const availability = cluster.scopes;
    const outerScope =
      availability === "universal"
        ? "ScopeName"
        : availability.map((scope) => JSON.stringify(scope)).join(" | ");
    return cluster.effects.map((effect): ScriptEffectReferenceRow => ({
      method: effect.method,
      key: effect.key,
      kind: "effect",
      availability:
        availability === "universal"
          ? { kind: "universal" }
          : { kind: "scopes", scopes: availability },
      signature: referenceSignature(effect, outerScope),
      docs: effect.docs,
    }));
  });
  const scopeLinkReferences = sortedLinkClusters.flatMap((cluster): ScriptScopeLinkReferenceRow[] =>
    cluster.links.map((link) => ({
      member: link.method,
      fromScopes:
        cluster.scopes === "universal" ? canonicalScopes(emitter.rules.scopes) : cluster.scopes,
      toScope: link.outputScope,
      docs: link.docs,
    }))
  );

  return {
    interfaces,
    meta,
    emitted: effectCount,
    byShape,
    skipped,
    clusterCount: sortedClusters.length,
    scalarOnly,
    fieldTypeOverrides: [...EFFECT_FIELD_TYPE_OVERRIDES].map(
      ([key, override]) => `${key} → ${override.type} — ${override.reason}`
    ),
    fieldAdditions: [...EFFECT_FIELD_ADDITIONS].flatMap(([key, additions]) =>
      additions.map(
        (addition) => `${key}.${addition.name} ← ${addition.source} — ${addition.reason}`
      )
    ),
    fieldCardinalityOverrides: [...EFFECT_FIELD_CARDINALITY_OVERRIDES].flatMap(([key, overrides]) =>
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
    ),
    linkEmitted: links.length,
    references,
    scopeLinkReferences,
  };
}

/**
 * Emits the effect scope interfaces and the recorder's metadata table.
 *
 * Two outputs, one design (validated by `design/effects-probe/`, see
 * `docs/verdict-effects-probe.md`):
 *
 * - `effects.ts` — TYPES only. Effects cluster by the exact set of scopes
 *   they are valid in; each distinct set becomes one interface carrying its
 *   method signatures once, and the per-scope interfaces (`CountryScope`)
 *   are `extends` compositions. ~1000 signatures total instead of 38 × 560.
 * - `effect-meta.ts` — DATA. One entry per method telling the runtime
 *   recorder (`src/effect-core.ts`, a single scope-agnostic Proxy) how to
 *   serialize the call. The Proxy throws on names missing from this table.
 *
 * Scopes come from the rules' `## scopes` with the game dump as fallback,
 * exactly like triggers. Nothing is dropped silently: every effect the
 * emitter cannot type is skipped with a named reason and reported.
 */

import type { RuleType } from "../cwt/model.ts";
import type { AliasDecl } from "../cwt/rules.ts";
import type { DocEntry } from "../logs/trigger-docs.ts";
import { camelCase, docComment, isPlainName, pascalCase, safeIdentifier } from "../naming.ts";
import { FIRE_EFFECTS, HAND_WRITTEN_EFFECTS } from "../overlay.ts";
import {
  canonicalScopeSet,
  mergeFields,
  scopeType,
  type ArgField,
  type ClauseCategory,
  type SkippedRule,
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

interface EmittedEffect {
  readonly method: string;
  readonly key: string;
  readonly shape: EffectShape;
  readonly docs: readonly string[];
}

function spliceCategories(body: RuleType & { kind: "block" }): Set<string> {
  return new Set(
    body.fields.flatMap((field) => (field.key.kind === "aliasName" ? [field.key.category] : []))
  );
}

function shapeOf(
  emitter: Emitter,
  declarations: readonly AliasDecl[]
): EffectShape | { readonly reason: string } | { readonly scalarOnly: EffectShape } {
  if (declarations.some((declaration) => declaration.comparison)) {
    return { reason: "declared with a comparison operator" };
  }
  const blocks = declarations.filter(
    (declaration): declaration is AliasDecl & { type: RuleType & { kind: "block" } } =>
      declaration.type.kind === "block"
  );
  const scalars = declarations.filter((declaration) => declaration.type.kind !== "block");

  if (blocks.length === 0) {
    if (scalars.some((s) => s.type.kind === "literal" && s.type.text.startsWith("$"))) {
      return { reason: "parameterised placeholder rule" };
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
      return {
        reason: `unsupported value type (${scalars.map((s) => s.type.kind).join(", ")})`,
      };
    }
    return { kind: "value", value };
  }

  if (scalars.length > 0) {
    // Overloaded between a block and a scalar (`log` is both an effect clause
    // and a message). Emit the scalar form so the common case survives; the
    // dropped block form is counted, not silent.
    const fallback = shapeOf(emitter, scalars);
    if ("kind" in fallback) {
      return { scalarOnly: fallback };
    }
    return { reason: "overloaded between a block and a scalar" };
  }
  if (blocks.length > 1) {
    return { reason: "multiple block declarations" };
  }

  const declaration = blocks[0]!;
  const body = declaration.type;
  if (body.bare.length > 0) {
    return { reason: "block with bare values" };
  }
  const categories = spliceCategories(body);
  if (categories.has("modifier_rule")) {
    return { reason: "contains a modifier_rule splice" };
  }
  if (categories.has("trigger")) {
    return { reason: "contains a bare trigger splice" };
  }
  if (categories.size > 0 && !categories.has("effect")) {
    return { reason: `splices a category the emitter cannot type (${[...categories].join(", ")})` };
  }

  const named = body.fields.filter((field) => field.key.kind !== "aliasName");
  const pushedRaw = declaration.scope?.this ?? null;
  const merged = named.length === 0 ? [] : mergeFields(emitter, named, pushedRaw, EFFECT_CLAUSES);
  if (typeof merged === "string") {
    return { reason: merged };
  }

  if (categories.has("effect")) {
    let scope: string | null = null;
    if (pushedRaw !== null) {
      scope = emitter.canonicalScope(pushedRaw);
      if (scope === null) {
        return { reason: `push_scope names no known scope (${pushedRaw})` };
      }
    }
    return { kind: "wrapper", scope, fields: merged.length === 0 ? null : merged };
  }
  if (merged.length === 0) {
    return { reason: "block with no typeable fields" };
  }
  return { kind: "fields", fields: merged };
}

function memberType(field: ArgField, outerScope: string): string {
  const value = field.value;
  switch (value.kind) {
    case "scalar":
      return value.value.type;
    case "clause": {
      const scope = value.scope === null ? outerScope : JSON.stringify(value.scope);
      if (value.category === "trigger") {
        return `Trigger<${scope}>`;
      }
      if (value.category === "modifier_rule") {
        return `readonly Modifier<${scope}>[]`;
      }
      // `this` is illegal inside a nested object type, so same-scope effect
      // closures in an args object get the cluster's scope union instead.
      return value.scope === null
        ? `(scope: ScopeObjOf<${scope}>) => void`
        : `(scope: ${scopeInterfaceName(value.scope)}) => void`;
    }
    case "comparison": {
      const literals = value.literals.map((literal) => JSON.stringify(literal));
      return ["number", "readonly [PdxOp, number]", ...literals].join(" | ");
    }
  }
}

function scopeInterfaceName(scope: string | null): string {
  return scope === null ? "this" : `${pascalCase(scope)}Scope`;
}

function argsType(fields: readonly ArgField[], outerScope: string): string {
  const members = fields.map(
    (field) =>
      `${camelCase(field.name)}${field.optional ? "?" : ""}: ${memberType(field, outerScope)}`
  );
  return `{ ${members.join("; ")} }`;
}

function methodSignature(effect: EmittedEffect, outerScope: string): string {
  const { method, shape } = effect;
  const doc = docComment(effect.docs, "  ");
  switch (shape.kind) {
    case "bool":
      return `${doc}  ${method}(value?: boolean): void;\n`;
    case "value":
      return `${doc}  ${method}(value: ${shape.value.type}): void;\n`;
    case "fields":
      return `${doc}  ${method}(args: ${argsType(shape.fields, outerScope)}): void;\n`;
    case "wrapper": {
      const body = `body: (scope: ${scopeInterfaceName(shape.scope)}) => void`;
      return shape.fields === null
        ? `${doc}  ${method}(${body}): void;\n`
        : `${doc}  ${method}(args: ${argsType(shape.fields, outerScope)}, ${body}): void;\n`;
    }
  }
}

function fieldMeta(field: ArgField): string {
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
  return `{ prop: ${JSON.stringify(camelCase(field.name))}, key: ${JSON.stringify(field.name)}, kind: ${JSON.stringify(kind)} }`;
}

function metaEntry(effect: EmittedEffect): string {
  const { method, key, shape } = effect;
  const fieldsOf = (fields: readonly ArgField[] | null): string =>
    fields === null ? "null" : `[${fields.map(fieldMeta).join(", ")}]`;
  switch (shape.kind) {
    case "bool":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "bool" } },\n`;
    case "value":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "value" } },\n`;
    case "fields":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "fields", fields: ${fieldsOf(shape.fields)} } },\n`;
    case "wrapper":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "wrapper", fields: ${fieldsOf(shape.fields)} } },\n`;
  }
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
  scopeIndex: ReadonlyMap<string, string>
): EffectEmission {
  const skipped: SkippedRule[] = [];
  const scalarOnly: string[] = [];
  const byShape = new Map<string, number>();
  interface Cluster {
    readonly scopes: readonly string[] | "universal";
    readonly effects: EmittedEffect[];
  }
  const clusters = new Map<string, Cluster>();

  for (const key of [...emitter.rules.effects.keys()].sort()) {
    const declarations = emitter.rules.effects.get(key)!;
    if (HAND_WRITTEN_EFFECTS.has(key.toLowerCase())) {
      skipped.push({ name: key, reason: "hand-written structural effect" });
      continue;
    }
    if (FIRE_EFFECTS.has(key.toLowerCase())) {
      skipped.push({ name: key, reason: "fire effect awaiting the event system" });
      continue;
    }
    if (!isPlainName(key)) {
      skipped.push({ name: key, reason: "not a plain rule name" });
      continue;
    }
    const doc = docs.get(key);
    const declared = declarations.flatMap((declaration) => declaration.supportedScopes ?? []);
    const supported = declared.length > 0 ? declared : (doc?.scopes ?? []);
    if (supported.length === 0) {
      skipped.push({ name: key, reason: "no scopes in either the rules or the game's dump" });
      continue;
    }
    const scopes = canonicalScopeSet(supported, scopeIndex);
    const outerScope = scopeType(supported, scopeIndex);
    if (scopes === null || outerScope === null) {
      skipped.push({ name: key, reason: `unknown scope in ${supported.join(" ")}` });
      continue;
    }
    const shape = shapeOf(emitter, declarations);
    if ("reason" in shape) {
      skipped.push({ name: key, reason: shape.reason });
      continue;
    }
    const resolved = "scalarOnly" in shape ? shape.scalarOnly : shape;
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

  const sortedClusters = [...clusters.values()].sort((left, right) =>
    clusterName(left.scopes).localeCompare(clusterName(right.scopes))
  );

  const interfaceChunks: string[] = [];
  for (const cluster of sortedClusters) {
    const name = clusterName(cluster.scopes);
    const outerScope =
      cluster.scopes === "universal"
        ? "ScopeName"
        : cluster.scopes.map((scope) => JSON.stringify(scope)).join(" | ");
    const heading =
      cluster.scopes === "universal"
        ? ["Effects valid in every scope."]
        : [`Effects valid in: ${cluster.scopes.join(", ")}.`];
    const methods = cluster.effects.map((effect) => methodSignature(effect, outerScope)).join("\n");
    interfaceChunks.push(`${docComment(heading)}export interface ${name} {\n${methods}}\n`);
  }

  const allScopes = canonicalScopes(emitter.rules.scopes);
  const scopeChunks = allScopes.map((scope) => {
    const parents = [
      `StructuralEffects<${JSON.stringify(scope)}>`,
      ...sortedClusters
        .filter((cluster) => cluster.scopes === "universal" || cluster.scopes.includes(scope))
        .map((cluster) => clusterName(cluster.scopes)),
    ];
    return (
      docComment([`The effects recordable in ${scope} scope.`]) +
      `export interface ${pascalCase(scope)}Scope extends ${parents.join(", ")} {}\n`
    );
  });

  const scopeMap =
    docComment(["Scope name -> the interface of effects recordable there."]) +
    `export interface ScopeMap {\n` +
    allScopes.map((scope) => `  ${JSON.stringify(scope)}: ${pascalCase(scope)}Scope;\n`).join("") +
    `}\n\n` +
    `export type ScopeObjOf<S extends ScopeName> = ScopeMap[S];\n`;

  const interfaces = interfaceChunks.join("\n") + "\n" + scopeChunks.join("\n") + "\n" + scopeMap;

  const metaEntries = sortedClusters
    .flatMap((cluster) => cluster.effects)
    .sort((left, right) => left.method.localeCompare(right.method))
    .map(metaEntry)
    .join("");
  const meta =
    "export type EffectFieldKind = " +
    '"value" | "comparison" | "trigger" | "effect" | "modifiers";\n\n' +
    "export interface EffectFieldMeta {\n" +
    "  readonly prop: string;\n" +
    "  readonly key: string;\n" +
    "  readonly kind: EffectFieldKind;\n" +
    "}\n\n" +
    "export type EffectShapeMeta =\n" +
    '  | { readonly kind: "bool" }\n' +
    '  | { readonly kind: "value" }\n' +
    '  | { readonly kind: "fields"; readonly fields: readonly EffectFieldMeta[] | null }\n' +
    '  | { readonly kind: "wrapper"; readonly fields: readonly EffectFieldMeta[] | null };\n\n' +
    "export interface EffectMeta {\n" +
    "  readonly key: string;\n" +
    "  readonly shape: EffectShapeMeta;\n" +
    "}\n\n" +
    docComment([
      "How the recorder serializes each effect method. The Proxy in",
      "`src/effect-core.ts` throws on names missing from this table, so a",
      "typo in an untyped position fails loudly instead of recording garbage.",
    ]) +
    "export const EFFECT_META: Record<string, EffectMeta | undefined> = {\n" +
    metaEntries +
    "};\n";

  const emitted = sortedClusters.reduce((sum, cluster) => sum + cluster.effects.length, 0);
  return {
    interfaces,
    meta,
    emitted,
    byShape,
    skipped,
    clusterCount: sortedClusters.length,
    scalarOnly,
  };
}

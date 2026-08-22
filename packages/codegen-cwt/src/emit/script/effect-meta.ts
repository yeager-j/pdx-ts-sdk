/**
 * Serializes the `effect-meta.ts` output: one `EFFECT_META` entry per method
 * telling the runtime recorder (`src/script/effects/recorder.ts`, a single
 * scope-agnostic Proxy) how to serialize the call. The Proxy throws on names
 * missing from this table. The sibling `effects.ts` emitter builds the typed
 * interfaces over the same per-effect record.
 */

import type { ArgField } from "../../lower/script-shape.ts";
import { camelCase, compareStrings, docComment } from "../../naming.ts";
import type { TsValue } from "../../render/emitter.ts";
import { refTypesSuffix } from "../../render/writer.ts";
import type {
  EffectCluster,
  EmittedEffect,
  EmittedScopeLink,
  ScopeLinkCluster,
} from "./effects.ts";

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
  const refTypes = refTypesSuffix(field.value.kind === "scalar" ? field.value.value : undefined);
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
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "value"${refTypesSuffix(shape.value)}${booleanLiteralsMeta(shape.value)} } },\n`;
    case "fields":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "fields", fields: ${fieldsOf(shape.fields)} } },\n`;
    case "wrapper":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "wrapper", fields: ${fieldsOf(shape.fields)} } },\n`;
  }
}

function scopeLinkMetaEntry(link: EmittedScopeLink): string {
  return `  ${link.method}: { key: ${JSON.stringify(link.key)}, shape: { kind: "scope-link" } },\n`;
}

/** The whole `effect-meta.ts` module: the meta types and the `EFFECT_META` table. */
export function effectMetaCode(
  clusters: readonly EffectCluster[],
  linkClusters: readonly ScopeLinkCluster[]
): string {
  const metaEntries = [
    ...clusters
      .flatMap((cluster) => cluster.effects)
      .map((effect) => ({ method: effect.method, entry: metaEntry(effect) })),
    ...linkClusters
      .flatMap((cluster) => cluster.links)
      .map((link) => ({ method: link.method, entry: scopeLinkMetaEntry(link) })),
  ]
    .sort((left, right) => compareStrings(left.method, right.method))
    .map(({ entry }) => entry)
    .join("");
  return (
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
    "};\n"
  );
}

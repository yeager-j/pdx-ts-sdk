/**
 * Serializes the `effect-meta.ts` output: one `EFFECT_META` entry per method
 * telling the runtime recorder (`packages/sdk/src/script/effects/recorder.ts`, a
 * single scope-agnostic Proxy) how to serialize the call. The Proxy throws on
 * names missing from this table. The sibling `effects.ts` emitter builds the
 * typed interfaces over the same per-effect record.
 */

import type { ArgField, BlockValue, MapValue } from "../../lower/script-shape.ts";
import { camelCase, compareStrings, docComment } from "../../naming.ts";
import { aliasCategoryModule, type TsValue } from "../../render/emitter.ts";
import type {
  EffectCluster,
  EffectShape,
  EmittedEffect,
  EmittedScopeLink,
  ScopeLinkCluster,
} from "./effects.ts";

function scalarMetaMembers(value: TsValue): string[] {
  return [
    value.refTypes === undefined ? null : `refTypes: ${JSON.stringify(value.refTypes)}`,
    value.booleanLiterals === undefined
      ? null
      : `booleanLiterals: ${JSON.stringify(value.booleanLiterals)}`,
    value.objectKinds === undefined ? null : `objectKinds: ${JSON.stringify(value.objectKinds)}`,
    value.localizationInput === true ? "locInput: true" : null,
    value.localizationLiterals === undefined
      ? null
      : `locLiterals: ${JSON.stringify(value.localizationLiterals)}`,
  ].filter((member): member is string => member !== null);
}

function scalarMeta(value: TsValue): string {
  const members = scalarMetaMembers(value);
  return members.length === 0 ? "{}" : `{ ${members.join(", ")} }`;
}

function scalarMetaSuffix(value: TsValue): string {
  const members = scalarMetaMembers(value);
  return members.length === 0 ? "" : `, ${members.join(", ")}`;
}

function fieldKind(field: ArgField): string {
  const value = field.value;
  switch (value.kind) {
    case "scalar":
      return "value";
    case "comparison":
      return "comparison";
    case "aliasList":
      return "alias-list";
    case "aliasStruct":
      return "alias-struct";
    case "clause":
      switch (value.category) {
        case "trigger":
          return "trigger";
        case "modifier_rule":
          return "modifiers";
        case "effect":
          return "effect";
      }
    default:
      throw new Error(`Field ${field.name} has no scalar metadata kind`);
  }
}

/** The alias category and splice flags a spliced field carries into its meta. */
function spliceMeta(value: ArgField["value"]): string {
  if (value.kind === "aliasStruct") {
    return `, category: ${JSON.stringify(value.category)}`;
  }
  if (value.kind === "aliasList") {
    return `, category: ${JSON.stringify(value.category)}${value.splice ? ", splice: true" : ""}`;
  }
  return value.kind === "clause" && value.splice ? ", splice: true" : "";
}

function mapMeta(map: MapValue): string {
  const members = [
    map.keyRefTypes === undefined ? null : `keyRefTypes: ${JSON.stringify(map.keyRefTypes)}`,
    `value: ${scalarMeta(map.value)}`,
    map.comparison === true ? "comparison: true" : null,
    `min: ${map.cardinality.min}`,
    map.splice ? "splice: true" : null,
  ].filter((member): member is string => member !== null);
  return `{ ${members.join(", ")} }`;
}

/** The metadata for the block half of a field overloaded with a scalar. */
function fieldBlockMeta(block: BlockValue): string {
  switch (block.kind) {
    case "fields":
      return `{ kind: "fields", fields: [${block.fields.map(fieldMeta).join(", ")}] }`;
    case "map":
      return `{ kind: "map", map: ${mapMeta(block.map)} }`;
    case "valueList": {
      const scalar = block.scalar === null ? "" : `, scalar: ${scalarMeta(block.scalar)}`;
      const fields =
        block.fields === null ? "" : `, fields: [${block.fields.map(fieldMeta).join(", ")}]`;
      return `{ kind: "value-list"${scalar}${fields} }`;
    }
  }
}

function fieldMeta(field: ArgField): string {
  const repeated = field.repeated === undefined ? "" : ", repeated: true";
  const identity = `prop: ${JSON.stringify(camelCase(field.name))}, key: ${JSON.stringify(field.name)}`;
  if (field.value.kind === "fields") {
    return `{ ${identity}, kind: "fields", fields: [${field.value.fields.map(fieldMeta).join(", ")}]${repeated} }`;
  }
  if (field.value.kind === "map") {
    return `{ ${identity}, kind: "map", map: ${mapMeta(field.value.map)}${repeated} }`;
  }
  if (field.value.kind === "scalarOrBlock") {
    return `{ ${identity}, kind: "scalar-or-block", scalar: ${scalarMeta(field.value.scalar)}, block: ${fieldBlockMeta(field.value.block)}${repeated} }`;
  }
  if (field.value.kind === "valueList") {
    const scalar = field.value.scalar;
    const fields = field.value.fields;
    return `{ ${identity}, kind: "value-list"${scalar === null ? "" : `, scalar: ${scalarMeta(scalar)}`}${fields === null ? "" : `, fields: [${fields.map(fieldMeta).join(", ")}]`}${repeated} }`;
  }
  const kind = fieldKind(field);
  const transition =
    field.value.kind === "clause" && field.value.category === "effect"
      ? `, transition: ${JSON.stringify(field.value.transition)}`
      : "";
  const scalarMeta = field.value.kind === "scalar" ? scalarMetaSuffix(field.value.value) : "";
  return `{ ${identity}, kind: ${JSON.stringify(kind)}${transition}${scalarMeta}${spliceMeta(field.value)}${repeated} }`;
}

function scalarShapeMeta(shape: Extract<EffectShape, { readonly kind: "bool" | "value" }>): string {
  return shape.kind === "bool"
    ? '{ kind: "bool" }'
    : `{ kind: "value"${scalarMetaSuffix(shape.value)} }`;
}

function blockShapeMeta(
  shape: Exclude<EffectShape, { readonly kind: "bool" | "value" | "scalarOrBlock" }>
): string {
  switch (shape.kind) {
    case "fields":
      return `{ kind: "fields", fields: [${shape.fields.map(fieldMeta).join(", ")}] }`;
    case "map":
      return `{ kind: "map", map: ${mapMeta(shape.map)} }`;
    case "wrapper":
      return `{ kind: "wrapper", transition: ${JSON.stringify(shape.transition)}, fields: ${shape.fields === null ? "null" : `[${shape.fields.map(fieldMeta).join(", ")}]`} }`;
    case "aliasList":
      return `{ kind: "alias-list", category: ${JSON.stringify(shape.category)} }`;
  }
}

function metaEntry(effect: EmittedEffect): string {
  const { method, key, shape } = effect;
  const fieldsOf = (fields: readonly ArgField[] | null): string =>
    fields === null ? "null" : `[${fields.map(fieldMeta).join(", ")}]`;
  switch (shape.kind) {
    case "bool":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "bool" } },\n`;
    case "value":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: ${scalarShapeMeta(shape)} },\n`;
    case "fields":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "fields", fields: ${fieldsOf(shape.fields)} } },\n`;
    case "map":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "map", map: ${mapMeta(shape.map)} } },\n`;
    case "wrapper":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "wrapper", transition: ${JSON.stringify(shape.transition)}, fields: ${fieldsOf(shape.fields)} } },\n`;
    case "aliasList":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "alias-list", category: ${JSON.stringify(shape.category)} } },\n`;
    case "scalarOrBlock":
      return `  ${method}: { key: ${JSON.stringify(key)}, shape: { kind: "scalar-or-block", scalar: ${scalarShapeMeta(shape.scalar)}, block: ${blockShapeMeta(shape.block)} } },\n`;
  }
}

function scopeLinkMetaEntry(link: EmittedScopeLink): string {
  return `  ${link.method}: { key: ${JSON.stringify(link.key)}, shape: { kind: "scope-link", transition: "push" } },\n`;
}

/** One spliced alias category's member table, as the recorder reads it. */
function aliasListMetaEntry(category: string, members: readonly ArgField[]): string {
  return `  ${JSON.stringify(category)}: [${members.map(fieldMeta).join(", ")}],\n`;
}

/** The whole `effect-meta.ts` module: the meta types and the `EFFECT_META` table. */
export function effectMetaCode(
  clusters: readonly EffectCluster[],
  linkClusters: readonly ScopeLinkCluster[],
  aliasLists: ReadonlyMap<string, { readonly members: readonly ArgField[] }>,
  aliasStructCategories: readonly string[]
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
    // An alias-struct field is written through the content-side field table its
    // own generated module registers, so this module — the one the recorder
    // loads — is what has to pull that registration in.
    aliasStructCategories
      .map((category) => `import ${JSON.stringify(aliasCategoryModule(category))};\n`)
      .join("") +
    (aliasStructCategories.length === 0 ? "" : "\n") +
    "export type EffectFieldKind = " +
    '"value" | "comparison" | "trigger" | "effect" | "modifiers" | "fields" | "map" | "scalar-or-block" | "value-list" | "alias-list" | "alias-struct";\n\n' +
    "/** How one scalar-valued position lowers to a PDXScript scalar. */\n" +
    "export type EffectScalarMeta = " +
    'Pick<EffectFieldMeta, "refTypes" | "booleanLiterals" | "objectKinds" | "locInput" | "locLiterals">;\n\n' +
    docComment([
      "A block whose keys the script itself supplies, written as one object.",
      "Entries keep authoring order; `splice` writes them beside the enclosing",
      "block's own keys rather than under the field's key.",
    ]) +
    "export interface EffectMapMeta {\n" +
    "  /** The registries a key may name, when every key form is a `<type>` reference. */\n" +
    "  readonly keyRefTypes?: readonly string[];\n" +
    "  /** How one entry's value lowers to a scalar. */\n" +
    "  readonly value: EffectScalarMeta;\n" +
    "  /** Whether entries are written as comparisons rather than assignments. */\n" +
    "  readonly comparison?: true;\n" +
    "  /** The fewest entries the rules admit. */\n" +
    "  readonly min: number;\n" +
    "  /** Whether entries are written beside the enclosing block's own keys. */\n" +
    "  readonly splice?: true;\n" +
    "}\n\n" +
    "/** The block half of a field overloaded between a scalar and a block. */\n" +
    "export type EffectBlockMeta =\n" +
    '  | { readonly kind: "fields"; readonly fields: readonly EffectFieldMeta[] }\n' +
    '  | { readonly kind: "map"; readonly map: EffectMapMeta }\n' +
    '  | { readonly kind: "value-list"; readonly scalar?: EffectScalarMeta; ' +
    "readonly fields?: readonly EffectFieldMeta[] };\n\n" +
    "export interface EffectFieldMeta {\n" +
    "  readonly prop: string;\n" +
    "  readonly key: string;\n" +
    "  readonly kind: EffectFieldKind;\n" +
    "  /** How a nested effect closure changes scope identity. */\n" +
    '  readonly transition?: "same" | "push" | "replace" | "unknown";\n' +
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
    '  readonly objectKinds?: readonly ("scope-ref" | "typed-ref" | "localization-ref" | "localized-text" | "literal-text")[];\n' +
    docComment(
      [
        "Whether the rules type this position as a localisation key, so the",
        "recorder lowers it through `localizationScalar`: a reference emits its",
        "key, and inline display text defers one until a splice supplies an",
        "owner.",
      ],
      "  "
    ) +
    "  readonly locInput?: true;\n" +
    "  /** Engine sentinels that pass through instead of becoming display text. */\n" +
    "  readonly locLiterals?: readonly string[];\n" +
    "  /** Whether the field accepts repeated entries under the same script key. */\n" +
    "  readonly repeated?: boolean;\n" +
    "  /** The spliced alias category an alias-list or alias-struct field authors. */\n" +
    "  readonly category?: string;\n" +
    docComment(
      [
        "Whether the field's entries are written bare into the enclosing block",
        "rather than under `key`. An unkeyed CWT splice is the block's own",
        "content, so the key exists only to name the authoring member.",
      ],
      "  "
    ) +
    "  readonly splice?: boolean;\n" +
    "  /** The scalar arm of a field overloaded between a scalar and a block. */\n" +
    "  readonly scalar?: EffectScalarMeta;\n" +
    "  /** The members of a structured field, or of a value list's object arm. */\n" +
    "  readonly fields?: readonly EffectFieldMeta[];\n" +
    "  /** The keys and values of an open-keyed field. */\n" +
    "  readonly map?: EffectMapMeta;\n" +
    "  /** The block arm of a field overloaded between a scalar and a block. */\n" +
    "  readonly block?: EffectBlockMeta;\n" +
    "}\n\n" +
    "/** One scalar call form of an effect. */\n" +
    "export type EffectScalarShapeMeta =\n" +
    '  | { readonly kind: "bool" }\n' +
    '  | { readonly kind: "value"; readonly refTypes?: readonly string[]; readonly booleanLiterals?: readonly ("yes" | "no")[]; readonly objectKinds?: readonly ("scope-ref" | "typed-ref" | "localization-ref" | "localized-text" | "literal-text")[]; readonly locInput?: true; readonly locLiterals?: readonly string[] };\n\n' +
    "/** One block call form of an effect. */\n" +
    "export type EffectBlockShapeMeta =\n" +
    '  | { readonly kind: "fields"; readonly fields: readonly EffectFieldMeta[] }\n' +
    '  | { readonly kind: "map"; readonly map: EffectMapMeta }\n' +
    '  | { readonly kind: "wrapper"; readonly transition: "same" | "push" | "replace" | "unknown"; readonly fields: readonly EffectFieldMeta[] | null }\n' +
    '  | { readonly kind: "alias-list"; readonly category: string };\n\n' +
    "export type EffectShapeMeta =\n" +
    "  | EffectScalarShapeMeta\n" +
    '  | { readonly kind: "fields"; readonly fields: readonly EffectFieldMeta[] | null }\n' +
    '  | { readonly kind: "map"; readonly map: EffectMapMeta }\n' +
    '  | { readonly kind: "wrapper"; readonly transition: "same" | "push" | "replace" | "unknown"; readonly fields: readonly EffectFieldMeta[] | null }\n' +
    '  | { readonly kind: "alias-list"; readonly category: string }\n' +
    '  | { readonly kind: "scalar-or-block"; readonly scalar: EffectScalarShapeMeta; readonly block: EffectBlockShapeMeta }\n' +
    '  | { readonly kind: "scope-link"; readonly transition: "push" | "replace" | "unknown" };\n\n' +
    "export interface EffectMeta {\n" +
    "  readonly key: string;\n" +
    "  readonly shape: EffectShapeMeta;\n" +
    "}\n\n" +
    docComment([
      "The members of each spliced alias category, by category name. An item of",
      "an alias list names exactly one of them, and the recorder writes it as it",
      "writes any other field.",
    ]) +
    "export const ALIAS_LIST_META: Record<string, readonly EffectFieldMeta[] | undefined> = {\n" +
    [...aliasLists]
      .map(([category, surface]) => aliasListMetaEntry(category, surface.members))
      .join("") +
    "};\n\n" +
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

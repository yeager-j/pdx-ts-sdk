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
import { camelCase, docComment, pascalCase } from "../naming.ts";
import {
  CONTENT_EMITTED_FIELDS,
  CONTENT_FIELD_OVERRIDES,
  FIELD_WIDENINGS,
  NESTED_CONTENT_DEFINITIONS,
  NESTED_FIELD_OVERRIDES,
  REQUIRED_LOCALISATION,
  type ContentFieldOverride,
  type NestedContentDefinition,
} from "../overlay.ts";
import { Emitter, type TsValue } from "./types.ts";

export interface ContentEmission {
  readonly code: string;
  readonly typeName: string;
  readonly fieldsConstant: string;
  readonly localisationConstant: string;
  readonly emittedFields: readonly string[];
  readonly unemittedFields: readonly string[];
  readonly unsupported: readonly string[];
  readonly localisationAliases: readonly string[];
}

interface LoweredField {
  readonly memberType: string;
  readonly metadata: string;
}

function bareValuesOf(type: RuleType): readonly RuleType[] | null {
  return type.kind === "block" && type.bare.length > 0 ? type.bare : null;
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

function lowerOrdinary(
  emitter: Emitter,
  field: RuleField,
  name: string,
  inheritedScope: ScopeContext | null,
  override: ContentFieldOverride | undefined,
  widening: string | undefined
): LoweredField | null {
  const requested = override?.shape;
  if (requested === "modifierBlock") {
    return {
      memberType: "ModifierBlock",
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
  const bare = bareValuesOf(field.type);
  if (bare !== null) {
    return lowerValueList(emitter, field, name, widening, false);
  }
  return lowerValue(emitter, field, name, widening);
}

function pickOrdinary(
  emitter: Emitter,
  group: readonly RuleField[],
  name: string,
  inheritedScope: ScopeContext | null,
  override: ContentFieldOverride | undefined,
  widening: string | undefined
): LoweredField | null {
  for (const field of group) {
    const lowered = lowerOrdinary(emitter, field, name, inheritedScope, override, widening);
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

function planLocalisation(type: ContentType): LocalisationPlan {
  const byPattern = new Map<string, ContentType["localisation"][number]>();
  const aliases: string[] = [];
  for (const entry of type.localisation) {
    const canonical = byPattern.get(entry.pattern);
    if (canonical === undefined) {
      byPattern.set(entry.pattern, entry);
      continue;
    }
    aliases.push(
      `${type.name}.localisation.${entry.key} duplicates ${canonical.key} at ${entry.pattern}`
    );
  }
  return { entries: [...byPattern.values()], aliases };
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

function nestedEmission(
  emitter: Emitter,
  ownerField: RuleField,
  ownerPath: string,
  config: NestedContentDefinition,
  inheritedScope: ScopeContext | null
): {
  readonly code: string;
  readonly fieldsConstant: string;
  readonly localisationConstant: string;
  readonly memberType: string;
  readonly metadata: string;
  readonly unemitted: readonly string[];
  readonly unsupported: readonly string[];
  readonly localisationAliases: readonly string[];
} | null {
  if (ownerField.type.kind !== "block") {
    return null;
  }
  const grouped = mergeByName(ownerField.type.fields, config.typeName);
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const emitted = new Set<string>([config.identityKey]);
  const unsupported: string[] = [];

  for (const name of config.fields) {
    const group = grouped.get(name);
    if (group === undefined) {
      unsupported.push(`${ownerPath}.${name} (no such nested rule field)`);
      continue;
    }
    const lowering = pickOrdinary(
      emitter,
      group,
      name,
      inheritedScope,
      NESTED_FIELD_OVERRIDES.get(`${ownerPath}.${name}`),
      undefined
    );
    if (lowering === null) {
      unsupported.push(`${ownerPath}.${name} (no declaration the emitter can lower)`);
      continue;
    }
    const optional = group.every((field) => isOptional(field.cardinality));
    members.push(
      docComment(
        group.flatMap((field) => field.docs),
        "  "
      ) + `  ${camelCase(name)}${optional ? "?" : ""}: ${lowering.memberType};\n`
    );
    fieldMetadata.push(lowering.metadata);
    emitted.add(name);
  }

  const localisationType = emitter.rules.contentTypes.get(config.localisationType);
  if (localisationType === undefined) {
    unsupported.push(`${ownerPath} (missing type[${config.localisationType}] localization)`);
  }
  const typeName = config.typeName;
  const constantPrefix = constantCase(typeName);
  const fieldsConstant = `${constantPrefix}_FIELDS`;
  const localisationConstant = `${constantPrefix}_LOCALISATION`;
  let locMembers = "";
  let locMetadata = "[]";
  let localisationAliases: readonly string[] = [];
  if (localisationType !== undefined) {
    const plan = planLocalisation(localisationType);
    locMembers = localisationMembers(localisationType, plan);
    locMetadata = localisationMetadata(localisationType, plan);
    localisationAliases = plan.aliases;
  }
  const code =
    `export interface ${typeName}Def<Id extends string = string> {\n` +
    "  /** Prefixed identity emitted through the nested definition's name field. */\n" +
    "  id: Id;\n" +
    locMembers +
    members.join("") +
    "}\n\n" +
    `export const ${fieldsConstant}: readonly ContentField[] = [\n` +
    fieldMetadata.map((entry) => `  ${entry},\n`).join("") +
    "];\n\n" +
    `export const ${localisationConstant}: readonly ContentLocalisation[] = ${locMetadata};\n\n`;

  const unemitted = [...grouped.keys()]
    .filter((name) => !emitted.has(name))
    .map((name) => `${ownerPath}.${name}`)
    .sort();
  const metadataValue = metadata(
    ownerField,
    ownerField.key.kind === "name" ? ownerField.key.name : "",
    "nested",
    [
      `identityKey: ${JSON.stringify(config.identityKey)}`,
      `fields: ${fieldsConstant}`,
      `localisation: ${localisationConstant}`,
    ]
  );
  return {
    code,
    fieldsConstant,
    localisationConstant,
    memberType: `${typeName}Def<Id>[]`,
    metadata: metadataValue,
    unemitted,
    unsupported,
    localisationAliases,
  };
}

export function emitContentType(
  emitter: Emitter,
  type: ContentType,
  body: ContentBody
): ContentEmission {
  const grouped = mergeByName(body.fields, type.name);
  const allowlist = CONTENT_EMITTED_FIELDS[type.name];
  if (allowlist === undefined) {
    throw new Error(`No curated field allowlist for type[${type.name}]`);
  }
  const emittedFields: string[] = [];
  const unsupported: string[] = [];
  const nestedUnemitted: string[] = [];
  const nestedCode: string[] = [];
  const localisationAliases: string[] = [];
  const members: string[] = [];
  const fieldMetadata: string[] = [];

  for (const name of allowlist) {
    const group = grouped.get(name);
    if (group === undefined) {
      unsupported.push(`${name} (no such rule field)`);
      continue;
    }
    const path = `${type.name}.${name}`;
    const override = CONTENT_FIELD_OVERRIDES.get(path);
    if (override?.shape === "nested") {
      const config = NESTED_CONTENT_DEFINITIONS.get(path);
      const nested =
        config === undefined ? null : nestedEmission(emitter, group[0]!, path, config, body.scope);
      if (nested === null) {
        unsupported.push(`${name} (nested definition overlay is incomplete)`);
        continue;
      }
      const optional = group.every((field) => isOptional(field.cardinality));
      members.push(
        docComment(
          group.flatMap((field) => field.docs),
          "  "
        ) + `  ${camelCase(name)}${optional ? "?" : ""}: ${nested.memberType};\n`
      );
      nestedCode.push(nested.code);
      fieldMetadata.push(nested.metadata);
      nestedUnemitted.push(...nested.unemitted);
      unsupported.push(...nested.unsupported);
      localisationAliases.push(...nested.localisationAliases);
      emittedFields.push(name);
      continue;
    }
    const widening = FIELD_WIDENINGS.get(path);
    const lowered = pickOrdinary(emitter, group, name, body.scope, override, widening?.extraType);
    if (lowered === null) {
      unsupported.push(`${name} (no declaration the emitter can lower)`);
      continue;
    }
    const optional = group.every((field) => isOptional(field.cardinality));
    members.push(
      docComment(
        group.flatMap((field) => field.docs),
        "  "
      ) + `  ${camelCase(name)}${optional ? "?" : ""}: ${lowered.memberType};\n`
    );
    fieldMetadata.push(lowered.metadata);
    emittedFields.push(name);
  }

  const typeName = pascalCase(type.name);
  const fieldsConstant = `${type.name.toUpperCase()}_FIELDS`;
  const localisationConstant = `${type.name.toUpperCase()}_LOCALISATION`;
  const fieldsGeneric = nestedCode.length === 0 ? "" : "<Id extends string = string>";
  const fieldsReference = nestedCode.length === 0 ? typeName + "Fields" : `${typeName}Fields<Id>`;
  const localisationPlan = planLocalisation(type);
  const code =
    nestedCode.join("") +
    docComment([
      `${indefiniteArticle(type.name)} ${type.name}, as the game's rules describe it.`,
      "",
      `Generated from \`type[${type.name}]\` at \`${type.path}\`.`,
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

  const unemitted = [
    ...[...grouped.keys()]
      .filter((name) => !allowlist.includes(name))
      .map((name) => `${type.name}.${name}`),
    ...nestedUnemitted,
  ].sort();
  return {
    code,
    typeName,
    fieldsConstant,
    localisationConstant,
    emittedFields,
    unemittedFields: unemitted,
    unsupported,
    localisationAliases: [...localisationPlan.aliases, ...localisationAliases],
  };
}

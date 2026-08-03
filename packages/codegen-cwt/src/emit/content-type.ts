/**
 * Emits one content registry's authoring types and runtime field metadata.
 *
 * Registry-specific judgment lives in overlay rows. This module only lowers
 * rule shapes that the runtime content writer understands; the per-field
 * lowering itself lives in `fields.ts`, shared with the alias emitters.
 */

import { isOptional, type RuleField } from "../cwt/model.ts";
import type { ContentBody, ContentType } from "../cwt/rules.ts";
import { camelCase, docComment, indefiniteArticle, pascalCase } from "../naming.ts";
import {
  CONDITIONALLY_REQUIRED_LOCALISATION,
  CONTENT_DECLINED_FIELDS,
  CONTENT_FIELD_OVERRIDES,
  CONTENT_SCOPE_PARAMETERS,
  FIELD_WIDENINGS,
  REPEATED_STRUCT_DEFINITIONS,
  REPEATED_STRUCT_FIELD_OVERRIDES,
  REQUIRED_LOCALISATION,
  type RepeatedStructDefinition,
} from "../overlay.ts";
import {
  capitalizedArticle,
  constantCase,
  flatten,
  lowerTopLevelSplice,
  mergeByName,
  metadata,
  pickOrdinary,
  repeatsSiblings,
  wildcardBlockOf,
  type EmittedField,
  type FieldContext,
} from "./fields.ts";
import { Emitter } from "./types.ts";

export interface ContentEmission {
  readonly code: string;
  readonly typeName: string;
  readonly fieldsConstant: string;
  readonly localisationConstant: string;
  readonly emittedFields: readonly EmittedField[];
  /**
   * Fields lowered inside a repeated-struct field, e.g.
   * `tradition_swap.on_enabled` — invisible to `emittedFields`, which only
   * names the owning field itself (`tradition_swap`). Their paths carry the
   * registry prefix; `emittedFields` names are bare.
   */
  readonly nestedEmittedFields: readonly EmittedField[];
  /** Refused outright by CONTENT_DECLINED_FIELDS, each with its reason. */
  readonly declinedFields: readonly string[];
  /**
   * Alias categories spliced unkeyed at the definition's top level, each
   * lowered to one authoring member. Their legal keys are the category's
   * members rather than anything `emittedFields` can name, so a consumer
   * measuring coverage has to resolve the category itself.
   */
  readonly inlineSplices: readonly string[];
  /** Present in the rules but not expressible: blocked on emitter machinery. */
  readonly machineryBacklog: readonly string[];
  readonly unsupported: readonly string[];
  readonly localisationAliases: readonly string[];
  /**
   * Set when the registry's unpinned scopes are a parameter of the definition,
   * so the definer emitter can thread S and strip the `scope` member.
   */
  readonly scopeParameter: ScopeParameter | null;
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
        const conditional = CONDITIONALLY_REQUIRED_LOCALISATION.get(`${type.name}.${member}`);
        const requiredUnless =
          conditional === undefined
            ? ""
            : `, requiredUnless: ${JSON.stringify(conditional.unless)}`;
        return (
          `  { member: ${JSON.stringify(member)}, pattern: ${JSON.stringify(entry.pattern)}, ` +
          `required: ${required}${requiredUnless} },\n`
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
 * level down). Authors as `Readonly<Record<string, ${typeName}Fields>>` rather
 * than an array carrying its own `id`, so the id cannot be omitted, cannot
 * collide, and the mod prefix applies at one point — exactly like a top-level
 * definition's id.
 *
 * The record key is `string`, not the owning definition's `Id`. A nested id is
 * its own name (`stage_1`), unrelated to the definition's; keying the record by
 * `Id` only looked sound under the class API's `PrefixedId<P>` pattern type,
 * where both sides happened to be the same wide pattern. Against a literal id —
 * what the pure API's definers preserve — it would demand every stage key equal
 * the definition id. The prefix and duplicate checks on these keys are runtime
 * checks in `ContentAuthoring` either way.
 */
function repeatedStructEmission(
  emitter: Emitter,
  ownerField: RuleField,
  ownerPath: string,
  config: RepeatedStructDefinition,
  ctx: FieldContext
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
  /** Fields successfully lowered, under dotted paths like `situation.stages.icon`. */
  readonly emittedFields: readonly EmittedField[];
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
  const emittedFields: EmittedField[] = [];
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
      ctx,
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
    emittedFields.push({ field: fieldPath, ...lowering.admits });
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
    memberType: `Readonly<Record<string, ${typeName}Fields>>`,
    metadata: metadataValue,
    declinedFields,
    unsupported,
    emittedFields,
    localisationAliases,
  };
}

/** The scope parameter this registry declares, with its scopes canonicalised. */
function scopeParameterOf(emitter: Emitter, registry: string): ScopeParameter | null {
  const row = CONTENT_SCOPE_PARAMETERS.get(registry);
  if (row === undefined) {
    return null;
  }
  // An unknown scope name fails codegen rather than degrading, the same rule
  // the `scope` assertion follows: silently widening on a typo would recreate
  // the unfillable field the row exists to fix.
  const canonical = (name: string): string => {
    const scope = emitter.canonicalScope(name);
    if (scope === null) {
      throw new Error(`Overlay scope parameter for ${registry} names unknown scope "${name}"`);
    }
    return scope;
  };
  const scopes = row.scopes.map(canonical);
  const fallback = canonical(row.fallback);
  if (!scopes.includes(fallback)) {
    throw new Error(`Overlay scope parameter for ${registry} defaults outside its own scope list`);
  }
  return { typeName: `${pascalCase(registry)}Scope`, scopes, fallback };
}

/**
 * Re-describes an unpinned scope as the definition's parameter, for the corpus
 * gate. `"any"` and a parameter emit the same `NoInfer<S>`, but they are
 * opposite claims about fillability: one field admits only universal rules, the
 * other admits anything legal in a scope some definition can declare.
 */
function underParameter(
  admits: Omit<EmittedField, "field">,
  parameter: ScopeParameter | null
): Omit<EmittedField, "field"> {
  if (parameter === null || admits.scope !== "any") {
    return admits;
  }
  return { ...admits, scope: { parameter: parameter.scopes } };
}

interface ScopeParameter {
  readonly typeName: string;
  readonly scopes: readonly string[];
  readonly fallback: string;
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
  const parameter = scopeParameterOf(emitter, type.name);
  const fieldContext: FieldContext = {
    scope: body.scope,
    // `NoInfer` makes the `scope` member the sole inference site for S. Without
    // it TypeScript would also infer from the `Trigger<S>` positions, which are
    // contravariant, and land somewhere unrelated to what the author declared.
    unpinned: parameter === null ? "ScopeName" : "NoInfer<S>",
  };
  const emittedFields: EmittedField[] = [];
  const nestedEmittedFields: EmittedField[] = [];
  const declinedFields: string[] = [];
  const inlineSplices: string[] = [];
  const unsupported: string[] = [];
  const extraCode: string[] = [];
  const localisationAliases: string[] = [];
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const emittedMembers = new Set<string>();
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
  //
  // Named fields and top-level splices share this one pass, because a splice
  // can be *positional*. Inside a solar system initializer's `planet`,
  // `change_orbit` advances the orbit cursor and is declared before the `moon`
  // blocks it applies to, so emitting splice members first would describe
  // different geometry. Iterating the flattened declarations also collapses a
  // splice that several subtype arms each declare — the planet tree is declared
  // twice, once per subtype — which a second pass would instead report as a
  // member-name collision.
  const seenNames = new Set<string>();
  const seenCategories = new Set<string>();
  for (const declaration of flatten(body.fields, type.name)) {
    const key = declaration.key;
    if (key.kind === "aliasName") {
      const category = key.category;
      if (seenCategories.has(category)) {
        continue;
      }
      seenCategories.add(category);
      // Rebuilt with the narrowed key: `AliasNameField` is an intersection, and
      // narrowing `declaration.key` does not re-type `declaration` itself.
      const lowered = lowerTopLevelSplice(emitter, { ...declaration, key }, fieldContext);
      if (lowered === null) {
        unsupported.push(
          `alias_name[${category}] (spliced unkeyed at the top level; that category has ` +
            "no authoring member)"
        );
        continue;
      }
      if (emittedMembers.has(lowered.member) || localisationMemberNames.has(lowered.member)) {
        unsupported.push(
          `alias_name[${category}] (spliced unkeyed at the top level; its "${lowered.member}" ` +
            "member is already taken)"
        );
        continue;
      }
      members.push(
        docComment(lowered.docs, "  ") + `  ${lowered.member}?: ${lowered.memberType};\n`
      );
      fieldMetadata.push(lowered.metadata);
      emittedMembers.add(lowered.member);
      inlineSplices.push(category);
      // A structural splice names a real key the corpus can be measured
      // against; `inlineModifiers` does not, since its rows carry no key.
      if (lowered.key !== undefined) {
        emittedFields.push({ field: lowered.key, ...lowered.admits! });
      }
      continue;
    }
    if (key.kind !== "name") {
      continue;
    }
    const name = key.name;
    if (seenNames.has(name)) {
      continue;
    }
    seenNames.add(name);
    const group = grouped.get(name);
    // Absent only for the name field, dropped above: the writer emits it from
    // the definition's id, so it is not an authoring member.
    if (group === undefined) {
      continue;
    }
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
          : repeatedStructEmission(emitter, group[0]!, path, config, fieldContext);
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
      declinedFields.push(...nested.declinedFields);
      unsupported.push(...nested.unsupported);
      nestedEmittedFields.push(...nested.emittedFields);
      localisationAliases.push(...nested.localisationAliases);
      emittedMembers.add(camelCase(name));
      emittedFields.push({
        field: name,
        shape: "repeatedStruct",
        repeated: repeatsSiblings(group[0]!, "repeatedStruct"),
      });
      continue;
    }
    const widening = FIELD_WIDENINGS.get(path);
    const lowered = pickOrdinary(
      emitter,
      group,
      name,
      fieldContext,
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
        : // replaceAll, not replace: a dual repeats the member on each arm, and
          // the writer resolves an arm by its own member name.
          lowered.metadata.replaceAll(
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
    emittedMembers.add(member);
    emittedFields.push({ field: name, ...underParameter(lowered.admits, parameter) });
  }

  const typeName = pascalCase(type.name);
  const fieldsConstant = `${type.name.toUpperCase()}_FIELDS`;
  const localisationConstant = `${type.name.toUpperCase()}_LOCALISATION`;
  // A parameterised registry carries S on both interfaces and one extra
  // authoring member. `Defined${typeName}` deliberately does NOT take it: the
  // item a definer returns is a reference brand, and `Trigger<S>` is
  // contravariant, so letting S leak there would make a `"ship"` definition
  // unassignable to the registry's own item union.
  const generic =
    parameter === null
      ? ""
      : `<S extends ${parameter.typeName} = ${JSON.stringify(parameter.fallback)}>`;
  const scopeMember =
    parameter === null
      ? ""
      : docComment(
          [
            "The scope this definition's own clauses run in.",
            "",
            "Emits nothing — it names a fact the game already knows and the rules",
            `decline to state (\`this = any\`). Defaults to \`${parameter.fallback}\`.`,
          ],
          "  "
        ) + "  scope?: S;\n";
  const scopeType_ =
    parameter === null
      ? ""
      : docComment([`The scopes ${indefiniteArticle(type.name)} ${type.name} may declare.`]) +
        `export type ${parameter.typeName} = ` +
        `${parameter.scopes.map((scope) => JSON.stringify(scope)).join(" | ")};\n\n`;
  const code =
    extraCode.join("") +
    scopeType_ +
    docComment([
      `${capitalizedArticle(type.name)} ${type.name}, as the game's rules describe it.`,
      "",
      `Generated from \`type[${cwtType.name}]\` at \`${type.path}\`.`,
    ]) +
    `export interface ${typeName}Fields${generic} {\n` +
    scopeMember +
    localisationMembers(type, localisationPlan) +
    members.join("") +
    "}\n\n" +
    (parameter === null
      ? `export interface ${typeName}Def<Id extends string = string> extends ${typeName}Fields {\n`
      : `export interface ${typeName}Def<\n  Id extends string = string,\n` +
        `  S extends ${parameter.typeName} = ${JSON.stringify(parameter.fallback)},\n` +
        `> extends ${typeName}Fields<S> {\n`) +
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
    inlineSplices,
    machineryBacklog: [...unsupported].sort(),
    unsupported,
    scopeParameter: parameter,
    localisationAliases: [...localisationPlan.aliases, ...localisationAliases],
  };
}

/**
 * Emits one content registry's authoring types and runtime field metadata.
 *
 * Registry-specific judgment lives in overlay rows. This module only lowers
 * rule shapes that the runtime content writer understands; the per-field
 * lowering itself lives in `fields.ts`, shared with the alias emitters.
 */

import type { DescentNode } from "../corpus.ts";
import { isOptional, type RuleField } from "../cwt/model.ts";
import type { ContentBody, ContentType } from "../cwt/rules.ts";
import { camelCase, docComment, indefiniteArticle, pascalCase } from "../naming.ts";
import {
  CONTENT_DECLINED_FIELDS,
  CONTENT_FIELD_OVERRIDES,
  CONTENT_PATCH_REGISTRIES,
  CONTENT_SCOPE_PARAMETERS,
  FIELD_WIDENINGS,
  PATCH_WIDENINGS,
  REPEATED_STRUCT_DEFINITIONS,
  REPEATED_STRUCT_FIELD_OVERRIDES,
  REQUIRED_LOCALISATION,
  SYNTHETIC_LOCALISATION,
  type ContentScopeParameter,
  type RepeatedStructDefinition,
} from "../overlay.ts";
import {
  capitalizedArticle,
  constantCase,
  flatten,
  lowerTopLevelSplice,
  memberOptional,
  mergeByName,
  metadata,
  pickOrdinary,
  repeatsSiblings,
  wildcardBlockOf,
  type EmittedField,
  type FieldContext,
} from "./fields.ts";
import { partitionSubtypeFields } from "./subtype-partition.ts";
import { Emitter } from "./types.ts";

export interface ContentEmission {
  readonly code: string;
  readonly typeName: string;
  readonly fieldsConstant: string;
  readonly localisationConstant: string;
  readonly emittedFields: readonly EmittedField[];
  /**
   * Fields lowered inside a block-valued field, e.g. `tradition_swap.on_enabled`
   * or `term_data.discrete_terms.key` — invisible to `emittedFields`, which only
   * names the owning field itself (`tradition_swap`). Their paths carry the
   * registry prefix; `emittedFields` names are bare.
   */
  readonly nestedEmittedFields: readonly EmittedField[];
  /**
   * How the corpus reader reaches those interiors, from the same lowerings.
   * The reader's configuration is emission-derived rather than a second table
   * to keep in step: a walk the emitter did not lower would report interiors
   * nothing ever claimed to author.
   */
  readonly corpusDescents: readonly DescentNode[];
  /** Refused outright by CONTENT_DECLINED_FIELDS, each with its reason. */
  readonly declinedFields: readonly string[];
  /**
   * Alias categories spliced unkeyed at the definition's top level, each
   * lowered to one authoring member. Their legal keys are the category's
   * members rather than anything `emittedFields` can name, so a consumer
   * measuring coverage has to resolve the category itself.
   */
  readonly inlineSplices: readonly string[];
  /**
   * Present in the rules but not expressible: blocked on emitter machinery,
   * each with what stopped the lowering. The only reason a declared field is
   * absent from the authoring surface other than `declinedFields`.
   */
  readonly unsupported: readonly string[];
  readonly localisationAliases: readonly string[];
  /**
   * Body fields whose mechanical member name was already a localization slot,
   * each with the `conditional<Name>` spelling it authors under instead.
   */
  readonly localisationRenames: readonly string[];
  /**
   * Set when the registry's unpinned scopes are a parameter of the definition,
   * so the definer emitter can thread S and strip the `scope` member.
   */
  readonly scopeParameter: ScopeParameter | null;
  /**
   * Emitted fields a `CONTENT_PATCH_REGISTRIES` patch cannot carry, each with
   * the mechanical reason. Empty for a registry with no patch surface, since
   * nothing was left out of one.
   */
  readonly patchExclusions: readonly string[];
  /** The patch member widenings applied, each with its reason. */
  readonly patchWidenings: readonly string[];
  /**
   * The localisation slots a patch may rewrite, each with the vanilla key its
   * text replaces. Derived from the registry's own declared localisation
   * table, so a slot the definition can author is a slot a patch can rename.
   */
  readonly patchLocMembers: readonly string[];
}

/** One member of the emitted patch type, in the rules' declaration order. */
interface PatchMember {
  readonly member: string;
  readonly docs: string;
  readonly memberType: string;
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
      { key: "name", pattern: "$", required: true, optional: false, subtype: null },
      { key: "desc", pattern: "$_desc", required: false, optional: true, subtype: null },
    ],
  };
}

/**
 * The sibling boolean member that waives a localisation slot, for a slot the
 * rules require only of the definitions one subtype covers.
 *
 * `swapped_tradition`'s `name = "$"` is declared inside
 * `subtype[not_inheriting_name]`, whose own body — `## cardinality = 0..0
 * inherit_name = yes` — says the subtype covers every swap that does *not*
 * write `inherit_name`. So the slot is required unless `inheritName` is set,
 * which is neither CWT's unconditional `## required` nor the plain optional a
 * flattened reading of the same table produces. `readLocalisation` keeps the
 * provenance and `absentUnless` states the discriminator; this joins them.
 *
 * A slot the rules explicitly mark `## optional` states its own requiredness
 * and is left alone — `flavor` and `effects` sit in the same subtype blocks.
 *
 * The shipped data agrees with the reading: of 195 vanilla `tradition_swap`
 * blocks, 131 write no `inherit_name` and all 131 carry a `name`; 6 of 9
 * ascension-perk swaps likewise. Nothing shipped omits the slot while
 * requiring it — the failure this closes is the SDK writing a raw key to the
 * game with no warning when an author does.
 */
function conditionalRequirement(
  type: ContentType,
  entry: ContentType["localisation"][number]
): string | null {
  if (entry.subtype === null || entry.optional) {
    return null;
  }
  const subtype = type.subtypes.find((candidate) => candidate.name === entry.subtype);
  if (subtype?.absentUnless == null) {
    return null;
  }
  return camelCase(subtype.absentUnless);
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
 *
 * {@link SYNTHETIC_LOCALISATION} adds slots the rules never declare at all,
 * after the rules-derived collapse — a synthetic row never displaces a real
 * declared slot, it only fills a gap one leaves.
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
  for (const [path, synthetic] of SYNTHETIC_LOCALISATION) {
    const [typeName, member] = path.split(".");
    if (typeName !== type.name || byMember.has(member!)) {
      continue;
    }
    byMember.set(member!, {
      key: member!,
      pattern: synthetic.pattern,
      required: false,
      optional: true,
      subtype: null,
    });
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

/**
 * `pointers` maps a localisation member to the body member the game actually
 * reads its text through, for the synthetic slots that have one. Passed in
 * rather than looked up, because it is a *result* of lowering the body: the
 * pointer is the renamed body field, and the rename is only known once the
 * field loop has run. See {@link renamedOffLocalisation}.
 */
function localisationMetadata(
  type: ContentType,
  plan = planLocalisation(type),
  pointers: ReadonlyMap<string, string> = new Map()
): string {
  return (
    "[\n" +
    plan.entries
      .map((entry) => {
        const member = camelCase(entry.key);
        const required = entry.required || REQUIRED_LOCALISATION.has(`${type.name}.${member}`);
        const conditional = conditionalRequirement(type, entry);
        const requiredUnless =
          conditional === null ? "" : `, requiredUnless: ${JSON.stringify(conditional)}`;
        const pointer = pointers.get(member);
        const pointerMember =
          pointer === undefined ? "" : `, pointerMember: ${JSON.stringify(pointer)}`;
        return (
          `  { member: ${JSON.stringify(member)}, pattern: ${JSON.stringify(entry.pattern)}, ` +
          `required: ${required}${requiredUnless}${pointerMember} },\n`
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
  /**
   * Fields successfully lowered, under dotted paths like `situation.stages.icon`
   * — including those lowered inside one of those (`…stages.chance.modifier`).
   */
  readonly emittedFields: readonly EmittedField[];
  /** How the corpus reader reaches the interiors of the entry's own block fields. */
  readonly children: readonly DescentNode[];
  readonly localisationAliases: readonly string[];
  /** Where the record key lives, read off the field's own declaration. */
  readonly keying: "siblings" | "container";
  /** The body field carrying the record key, for `"siblings"` keying. */
  readonly identityKey: string | undefined;
} | null {
  if (ownerField.type.kind !== "block") {
    return null;
  }
  // The declaration says which keying it is. "container"
  // (`stages = { stage_1 = { ... } }`) is the wildcard-key shape: one computed
  // key standing for "any key maps to this block", which is exactly the record
  // the authoring type emits. "siblings" (`approach = { name = ... }` repeated)
  // declares its entry's fields directly, so there is no wildcard to find.
  const container = wildcardBlockOf(ownerField.type);
  const keying = container === null ? "siblings" : "container";
  // Some repeated-struct fields have their own vendored `type[...]` carrying
  // the identity's localisation patterns (tradition_swap borrows
  // `type[swapped_tradition]`). Others — situations' `stages` and `approach`
  // — have no such type; CWT only ever types the identity value itself as
  // `localisation` inline, never as a sibling `type[...]` block. Falling back
  // to the same `$` required / `$_desc` optional convention the vendored
  // types themselves use keeps this generic rather than situations-specific:
  // any future repeated-struct field lacking a dedicated type gets the same
  // convention `99_README_SITUATIONS.txt` documents for both of situations'.
  const declaredType =
    config.localisationType === undefined
      ? undefined
      : emitter.rules.contentTypes.get(config.localisationType);
  // `name_field` is the same statement one level down that it is at the top
  // level: the id is the value of that body field, not the block's key. A
  // struct borrowing a vendored `type[...]` therefore already declares its own
  // identity key, and the overlay only supplies one for a struct CWT gives no
  // type at all (`situation_type.approach`).
  const identityKey = declaredType?.nameField ?? config.identityKey;
  if (keying === "siblings" && identityKey === undefined) {
    return null;
  }
  const bodyType = container ?? ownerField.type;
  const grouped = mergeByName(bodyType.fields, config.typeName);
  // The record key already carries the identity value — written into
  // identityKey inside each sibling block, or (for "container") the block's
  // own key — so it is not an ordinary member, the same reason the top level
  // drops its nameField before iterating.
  if (identityKey !== undefined) {
    grouped.delete(identityKey);
  }

  const typeName = config.typeName;
  const localisationType =
    config.localisationType === undefined ? syntheticIdentityLocalisation(typeName) : declaredType;
  const localisationPlan =
    localisationType === undefined ? null : planLocalisation(localisationType);
  // A struct field can share a name with the struct's own localisation slot
  // without meaning the same thing, exactly the collision the top level
  // guards against — the localisation member wins and the body field is
  // reported instead of silently duplicating a TS property.
  //
  // Deliberately still a report rather than the top level's `conditional<Name>`
  // rename: no nested field collides today, so a rename here would name a
  // member nothing has ever asked for. The report is what would say otherwise.
  const localisationMemberNames = new Set(
    (localisationPlan?.entries ?? []).map((entry) => camelCase(entry.key))
  );

  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const declinedFields: string[] = [];
  const unsupported: string[] = [];
  const emittedFields: EmittedField[] = [];
  const children: DescentNode[] = [];
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
    const optional = memberOptional(group, REPEATED_STRUCT_FIELD_OVERRIDES.get(fieldPath));
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
    // `nested` arrives already rooted at `fieldPath`, so the registry prefix
    // `ownerPath` carries appears exactly once — the same single prefix the
    // top-level loop's nested fields carry, which the reader strips once.
    const member = camelCase(name);
    emittedFields.push(
      { field: fieldPath, authoredPath: [member], ...lowering.admits },
      ...(lowering.nested ?? []).map((field) => ({
        ...field,
        authoredPath: [member, ...(field.authoredPath ?? [])],
      }))
    );
    children.push(...(lowering.descents ?? []));
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
      ...(keying === "siblings" ? [`identityKey: ${JSON.stringify(identityKey)}`] : []),
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
    children,
    localisationAliases,
    keying,
    identityKey,
  };
}

/**
 * The declared-FROM parameter, with the admissible scopes read off the rules'
 * own scope group rather than restated in the overlay.
 *
 * The group the row names is checked against the one the starting effect's own
 * argument is declared with, so "cannot drift apart" is enforced rather than
 * asserted: a rules bump that retypes the argument fails codegen here instead
 * of emitting a declaration union and a hand-written overload that quietly
 * disagree with the generated signature beneath them.
 */
function declaredFromOf(
  emitter: Emitter,
  registry: string,
  row: NonNullable<ContentScopeParameter["declaredFrom"]>
): DeclaredFrom {
  const declared = effectArgumentScopeGroup(emitter, row.effect, row.argument);
  if (declared !== row.scopeGroup) {
    throw new Error(
      `Overlay declared FROM for ${registry} names scope group "${row.scopeGroup}", but ` +
        `${row.effect}.${row.argument} is declared ` +
        `${declared === null ? "with no scope group" : `"${declared}"`} — ` +
        "the declaration must be typed by the argument that supplies it"
    );
  }
  const members = emitter.rules.scopeGroups.get(row.scopeGroup);
  if (members === undefined) {
    throw new Error(
      `Overlay declared FROM for ${registry} names unknown scope group "${row.scopeGroup}"`
    );
  }
  const scopes = members.map((member) => {
    const scope = emitter.canonicalScope(member);
    if (scope === null) {
      throw new Error(
        `Scope group "${row.scopeGroup}" names unknown scope "${member}" for ${registry}`
      );
    }
    return scope;
  });
  return {
    member: row.member,
    typeName: `${pascalCase(registry)}${pascalCase(row.member)}`,
    scopes: [...new Set(scopes)].sort(),
    members: row.members,
    effect: row.effect,
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
  const selector = row.selector;
  if (selector !== undefined) {
    if (!Object.values(selector.scopes).every((scope) => scopes.includes(canonical(scope)))) {
      throw new Error(`Overlay scope selector for ${registry} maps outside its own scope list`);
    }
    return {
      typeName: `${pascalCase(registry)}Scope`,
      scopes,
      fallback,
      parameterName: "E",
      parameterType: selector.typeName,
      parameterFallback: selector.fallback,
      selector,
      ...(row.declaredFrom === undefined
        ? {}
        : { declaredFrom: declaredFromOf(emitter, registry, row.declaredFrom) }),
    };
  }
  return {
    typeName: `${pascalCase(registry)}Scope`,
    scopes,
    fallback,
    parameterName: "S",
    parameterType: `${pascalCase(registry)}Scope`,
    parameterFallback: fallback,
  };
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

/**
 * The context one member of a selector-parameterised registry lowers against.
 *
 * `fieldContext.unpinned` carries the selected scope, so which member is being
 * lowered decides where that type lands: the member the selector scopes gets it
 * as its own scope — plus the declared FROM, where the registry has one — a
 * member the selector supplies as FROM gets it there and runs in the registry's
 * fallback scope instead, and everything else is the fallback with no FROM. A
 * registry with no selector lowers every member the same way and passes through
 * untouched.
 */
function selectedContext(
  fieldContext: FieldContext,
  parameter: ScopeParameter | null,
  member: string
): FieldContext {
  const selector = parameter === null ? undefined : parameter.selector;
  if (parameter === null || selector === undefined) {
    return fieldContext;
  }
  const declaredFrom = parameter.declaredFrom;
  if (selector.scopedMembers.includes(member)) {
    return declaredFrom?.members.includes(member) === true
      ? { ...fieldContext, assertedFrom: "NoInfer<L>" }
      : fieldContext;
  }
  const fallback = JSON.stringify(parameter.fallback);
  return selector.fromMembers?.includes(member) === true
    ? { ...fieldContext, unpinned: fallback, assertedFrom: fieldContext.unpinned }
    : { ...fieldContext, unpinned: fallback };
}

/**
 * The `scope_group` one named argument of one effect is declared with, or
 * `null` where the effect, the argument, or a group on it is absent — each of
 * which is a reason for the caller to fail rather than a shape to work around.
 */
function effectArgumentScopeGroup(
  emitter: Emitter,
  effect: string,
  argument: string
): string | null {
  const declarations = emitter.rules.effects.get(effect) ?? [];
  for (const declaration of declarations) {
    if (declaration.type.kind !== "block") {
      continue;
    }
    for (const field of declaration.type.fields) {
      if (field.key.kind !== "name" || field.key.name !== argument) {
        continue;
      }
      if (field.type.kind === "scopeGroup") {
        return field.type.name;
      }
    }
  }
  return null;
}

/** `a`, `b` and `c` — a prose list of member names for a doc comment. */
function listed(members: readonly string[]): string {
  const quoted = members.map((member) => `\`${member}\``);
  return quoted.length < 2
    ? (quoted[0] ?? "")
    : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/** A {@link ContentScopeParameter.declaredFrom} row, resolved against the rules. */
export interface DeclaredFrom {
  readonly member: string;
  /** The emitted union of scopes the declaration may name. */
  readonly typeName: string;
  readonly scopes: readonly string[];
  readonly members: readonly string[];
  readonly effect: string;
}

interface ScopeParameter {
  readonly typeName: string;
  readonly scopes: readonly string[];
  readonly fallback: string;
  readonly parameterName: "S" | "E";
  readonly parameterType: string;
  readonly parameterFallback: string;
  readonly selector?: NonNullable<ContentScopeParameter["selector"]>;
  readonly declaredFrom?: DeclaredFrom;
}

/**
 * The whole patch surface of a `CONTENT_PATCH_REGISTRIES` registry: one
 * optional member per field the transform can splice, plus the two aliases the
 * item vocabulary names.
 *
 * Membership is derived, never curated. A patch keeps vanilla's identity, so
 * `id` is absent — the override must target the vanilla key to win. Everything
 * else the definition itself admits, the patch admits, in the same forms:
 * `PatchInput` only adds the ways a shipped definition's own values come back
 * in.
 *
 * The localisation slots are members too, read off the same declared table the
 * definition's own text members come from, and always optional here: a patch
 * that renames nothing is the ordinary case. Their text is a *replacement*,
 * emitted under vanilla's own key for the slot, so unlike every other member
 * they are not body fields and never reach the splice.
 */
function patchTypes(
  type: ContentType,
  typeName: string,
  generic: string,
  patchMembers: readonly PatchMember[],
  localisationPlan: LocalisationPlan,
  patchWidenings: string[],
  patchLocMembers: string[]
): string {
  const parsed = `Parsed${typeName}`;
  const locMembers = localisationPlan.entries.map((entry) => {
    const member = camelCase(entry.key);
    const pattern = entry.pattern.replace("$", "<vanilla id>");
    patchLocMembers.push(`${type.name}.${member} — replacement text under \`${pattern}\``);
    return (
      docComment(
        [
          `Replacement English text for vanilla's own \`${pattern}\` key.`,
          "",
          "Emitted to `localisation/replace/`, the layer the game resolves ahead",
          "of the ordinary one — a rename, not a new key.",
        ],
        "  "
      ) + `  readonly ${member}?: string;\n`
    );
  });
  const members = patchMembers.map((entry) => {
    const widening = PATCH_WIDENINGS.get(`${type.name}.${entry.member}`);
    if (widening !== undefined) {
      patchWidenings.push(
        `${type.name}.${entry.member} also admits ${widening.extraType} — ${widening.reason}`
      );
    }
    const extra = widening === undefined ? "" : `, ${widening.extraType}`;
    return `${entry.docs}  readonly ${entry.member}?: PatchInput<${entry.memberType}${extra}>;\n`;
  });
  for (const [path, widening] of PATCH_WIDENINGS) {
    const [registry, member] = path.split(".");
    if (registry !== type.name || patchMembers.some((entry) => entry.member === member)) {
      continue;
    }
    throw new Error(
      `PATCH_WIDENINGS widens ${path}, but the patch type has no "${member}" member: ` +
        `${widening.reason}`
    );
  }
  return (
    docComment([
      `What a patch of a vanilla ${type.name} may change.`,
      "",
      "Closed, so a typo is a compile error, and `id`-less: a patched definition",
      "keeps vanilla's identity, because the override has to target the vanilla",
      "key to win.",
    ]) +
    `export interface ${typeName}Patch${generic} {\n` +
    locMembers.join("") +
    members.join("") +
    "}\n\n" +
    docComment([`A patched vanilla ${type.name}, ready for the win engine.`]) +
    `export type Patched${typeName} = PatchedContent<${parsed}>;\n\n` +
    docComment([`A patched vanilla ${type.name} placed into a capability feature.`]) +
    `export type ${typeName}PatchItem = ContentPatchItem<${parsed}>;\n\n`
  );
}

/**
 * The body fields belonging to a registry that is one subtype of a shared CWT
 * type, rather than a whole type of its own.
 *
 * Mirrors `referenceNameOf`'s guard in `index.ts`: an `as` rename that names no
 * subtype has no rules behind it, and emitting the whole shared body under that
 * name would silently hand the registry every other subtype's fields.
 */
function registryFields(
  cwtType: ContentType,
  registry: string,
  fields: readonly RuleField[]
): readonly RuleField[] {
  if (registry === cwtType.name) {
    return fields;
  }
  const self = cwtType.subtypes.find((candidate) => candidate.name === registry);
  if (self === undefined) {
    const declared = cwtType.subtypes.map((candidate) => candidate.name).join(", ");
    throw new Error(
      `The manifest renames type[${cwtType.name}] to "${registry}", but that names no subtype ` +
        "of it, so there is no subtype whose fields the registry could be cut down to. " +
        `Declared subtypes: ${declared}`
    );
  }
  return partitionSubtypeFields(fields, self, cwtType.subtypes);
}

export function emitContentType(
  emitter: Emitter,
  cwtType: ContentType,
  body: ContentBody,
  registry: string = cwtType.name
): ContentEmission {
  // One CWT type can back several registries — three keywords share
  // `type[component_template]`. Renaming once here makes every downstream
  // name, allowlist key, and overlay path follow the registry instead, and
  // partitioning here makes the body follow it too: the shared body carries
  // every subtype's arm, and only this registry's are its own.
  const type: ContentType = registry === cwtType.name ? cwtType : { ...cwtType, name: registry };
  const fields = registryFields(cwtType, registry, body.fields);
  const grouped = mergeByName(fields, type.name);
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
    unpinned:
      parameter === null
        ? "ScopeName"
        : parameter.selector === undefined
          ? "NoInfer<S>"
          : `NoInfer<${pascalCase(type.name)}ScopeOf<E>>`,
    ...(parameter === null
      ? {}
      : {
          nestedTypeParameter: {
            declaration:
              `<${parameter.parameterName} extends ${parameter.parameterType} = ` +
              `${JSON.stringify(parameter.parameterFallback)}>`,
            argument: parameter.parameterName,
          },
        }),
  };
  // {@link underParameter} over a field that carries its own path. A nested
  // field's scope is the definition's parameter exactly as a top-level one's
  // is, so the two must not be re-described differently one level down.
  const parameterised = (emitted: EmittedField): EmittedField => {
    const { field, ...admits } = emitted;
    return { field, ...underParameter(admits, parameter) };
  };
  const emittedFields: EmittedField[] = [];
  const nestedEmittedFields: EmittedField[] = [];
  const corpusDescents: DescentNode[] = [];
  const declinedFields: string[] = [];
  const inlineSplices: string[] = [];
  const unsupported: string[] = [];
  const extraCode: string[] = [];
  const localisationAliases: string[] = [];
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const emittedMembers = new Set<string>();
  const patchMembers: PatchMember[] = [];
  const patchExclusions: string[] = [];
  const patchWidenings: string[] = [];
  const patchLocMembers: string[] = [];
  const localisationRenames: string[] = [];
  const localisationPointers = new Map<string, string>();
  const localisationPlan = planLocalisation(type);
  const localisationMemberNames = new Set(
    localisationPlan.entries.map((entry) => camelCase(entry.key))
  );
  /**
   * The authoring member for a body field, renamed when the mechanical one is
   * already a localization slot.
   *
   * A body field can share a name with a localization slot without meaning the
   * same thing — `building.desc` (`single_alias_right[triggered_desc_clause]`,
   * a repeated trigger+text struct) is unrelated to the `desc` flavor text the
   * type's own localisation table claims for the TS member `desc`. Both would
   * emit the same interface property twice with different types, and both are
   * real authoring paths, so the colliding body field takes the
   * `conditional<Name>` spelling rather than either one losing.
   *
   * The slot set is `planLocalisation`'s, which includes the synthetic slots —
   * so `archaeological_site_type.desc`, whose collision exists only because
   * {@link SYNTHETIC_LOCALISATION} manufactured the slot, derives from the same
   * rule as the four the rules collide on their own.
   *
   * A synthetic slot's text has no route into the definition body except that
   * renamed field: the SDK invented the key, so it must also write the pointer
   * the game reads it through. `pointerMember` is therefore recorded here, from
   * the rename, rather than being a second hand-written spelling of it. A
   * *declared* slot needs no pointer — `situation_type`'s `desc = "$_desc"` is
   * the game's own key — so only synthetic slots take one.
   */
  const renamedOffLocalisation = (name: string): string => {
    const declared = camelCase(name);
    if (!localisationMemberNames.has(declared)) {
      return declared;
    }
    const renamed = `conditional${pascalCase(name)}`;
    localisationRenames.push(
      `${type.name}.${name} — "${declared}" is a localization slot member, ` +
        `so the body field authors as "${renamed}"`
    );
    if (SYNTHETIC_LOCALISATION.has(`${type.name}.${declared}`)) {
      localisationPointers.set(declared, renamed);
    }
    return renamed;
  };

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
  for (const declaration of flatten(fields, type.name)) {
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
      // A splice the game reads at the block root writes no key of its own, so
      // a patch has no slot in the parsed body to substitute for it.
      if (lowered.key === undefined) {
        patchExclusions.push(
          `${type.name}.${lowered.member} — spliced unkeyed into the definition's own body, ` +
            "so a patch has no key to replace"
        );
      } else {
        patchMembers.push({
          member: lowered.member,
          docs: docComment(lowered.docs, "  "),
          memberType: lowered.memberType,
        });
      }
      // A structural splice names a real key the corpus can be measured
      // against; `inlineModifiers` does not, since its rows carry no key.
      if (lowered.key !== undefined) {
        emittedFields.push({
          field: lowered.key,
          authoredPath: [lowered.member],
          ...lowered.admits!,
        });
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
    const member = renamedOffLocalisation(name);
    if (override?.shape === "repeatedStruct") {
      const config = REPEATED_STRUCT_DEFINITIONS.get(path);
      const nested =
        config === undefined
          ? null
          : repeatedStructEmission(emitter, group[0]!, path, config, fieldContext);
      if (config === undefined || nested === null) {
        unsupported.push(`${name} (repeated-struct overlay is incomplete)`);
        continue;
      }
      const optional = memberOptional(group, override);
      const docs = docComment([...new Set(group.flatMap((field) => field.docs))], "  ");
      members.push(`${docs}  ${member}${optional ? "?" : ""}: ${nested.memberType};\n`);
      patchMembers.push({ member, docs, memberType: nested.memberType });
      extraCode.push(nested.code);
      fieldMetadata.push(nested.metadata);
      declinedFields.push(...nested.declinedFields);
      unsupported.push(...nested.unsupported);
      const repeatedMember = member;
      nestedEmittedFields.push(
        ...nested.emittedFields.map(parameterised).map((field) => ({
          ...field,
          authoredPath: [repeatedMember, ...(field.authoredPath ?? [])],
        }))
      );
      localisationAliases.push(...nested.localisationAliases);
      emittedMembers.add(member);
      emittedFields.push({
        field: name,
        authoredPath: [repeatedMember],
        shape: "repeatedStruct",
        repeated: repeatsSiblings(group[0]!, "repeatedStruct"),
      });
      // The emission's own derived keying, so the reader's and the authoring
      // shape's cannot disagree about where the record key lives.
      corpusDescents.push({
        field: name,
        mode: "repeatedStruct",
        keying: nested.keying,
        ...(nested.identityKey === undefined ? {} : { identityKey: nested.identityKey }),
        children: nested.children,
      });
      continue;
    }
    const widening = FIELD_WIDENINGS.get(path);
    const loweredContext = selectedContext(fieldContext, parameter, member);
    const lowered = pickOrdinary(
      emitter,
      group,
      name,
      loweredContext,
      override,
      widening?.extraType,
      path
    );
    if (lowered === null) {
      unsupported.push(`${name} (no declaration the emitter can lower)`);
      continue;
    }
    const optional = memberOptional(group, override);
    const docs = docComment([...new Set(group.flatMap((field) => field.docs))], "  ");
    const memberType =
      parameter?.selector?.member === member ? parameter.parameterName : lowered.memberType;
    members.push(`${docs}  ${member}${optional ? "?" : ""}: ${memberType};\n`);
    patchMembers.push({ member, docs, memberType });
    fieldMetadata.push(
      member === camelCase(name)
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
    emittedFields.push({
      field: name,
      authoredPath: [member],
      ...underParameter(lowered.admits, parameter),
    });
    nestedEmittedFields.push(
      ...(lowered.nested ?? []).map(parameterised).map((field) => ({
        ...field,
        authoredPath: [member, ...(field.authoredPath ?? [])],
      }))
    );
    corpusDescents.push(...(lowered.descents ?? []));
  }

  const typeName = pascalCase(type.name);
  const fieldsName =
    parameter?.selector === undefined ? `${typeName}Fields` : `${typeName}FieldsBase`;
  const fieldsConstant = `${type.name.toUpperCase()}_FIELDS`;
  const localisationConstant = `${type.name.toUpperCase()}_LOCALISATION`;
  // A parameterised registry carries S on both interfaces and one extra
  // authoring member. `Defined${typeName}` deliberately does NOT take it: the
  // item a definer returns is a reference brand, and `Trigger<S>` is
  // contravariant, so letting S leak there would make a `"ship"` definition
  // unassignable to the registry's own item union.
  // A declared FROM rides along as a second parameter, defaulting to
  // `undefined` — the sentinel `EffectBlock` already reads as "no FROM here" —
  // so a definition that declares none is typed exactly as it was before the
  // registry grew the declaration.
  const declaredFrom = parameter?.declaredFrom;
  const declaredFromParameter =
    declaredFrom === undefined
      ? ""
      : `, L extends ${declaredFrom.typeName} | undefined = undefined`;
  const generic =
    parameter === null
      ? ""
      : `<${parameter.parameterName} extends ${parameter.parameterType} = ` +
        `${JSON.stringify(parameter.parameterFallback)}${declaredFromParameter}>`;
  const scopeMember =
    parameter === null || parameter.selector !== undefined
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
  const declaredFromMember =
    declaredFrom === undefined
      ? ""
      : docComment(
          [
            `The scope \`${declaredFrom.effect}\` is handed as this definition's`,
            "location, and the FROM its callbacks are given.",
            "Emits nothing — the game learns it from the call site, not from the",
            "definition. Declaring it types `ctx.from` in",
            `${listed(declaredFrom.members)}, and holds every`,
            `\`${camelCase(declaredFrom.effect)}\` call for this definition to a`,
            "location of the same scope. Omitted, FROM stays unreadable and the",
            "call sites stay unchecked.",
          ],
          "  "
        ) + `  ${declaredFrom.member}?: L;\n`;
  const scopeType_ =
    parameter === null
      ? ""
      : docComment([`The scopes ${indefiniteArticle(type.name)} ${type.name} may declare.`]) +
        `export type ${parameter.typeName} = ` +
        `${parameter.scopes.map((scope) => JSON.stringify(scope)).join(" | ")};\n\n` +
        (parameter.selector === undefined
          ? ""
          : `export type ${pascalCase(type.name)}ScopeOf<E extends ${parameter.parameterType}> =\n` +
            Object.entries(parameter.selector.scopes)
              .map(
                ([eventScope, scope]) =>
                  `  E extends ${JSON.stringify(eventScope)} ? ${JSON.stringify(scope)} :`
              )
              .join("\n") +
            `\n  never;\n\n`) +
        (declaredFrom === undefined
          ? ""
          : docComment([
              `The scopes ${indefiniteArticle(type.name)} ${type.name} may declare as its`,
              "location — the rules' own `scope_group` for the argument, so the",
              "declaration and the effect that takes it cannot drift apart.",
            ]) +
            `export type ${declaredFrom.typeName} = ` +
            `${declaredFrom.scopes.map((scope) => JSON.stringify(scope)).join(" | ")};\n\n`);
  const patchCode = CONTENT_PATCH_REGISTRIES.has(type.name)
    ? patchTypes(
        type,
        typeName,
        generic,
        patchMembers,
        localisationPlan,
        patchWidenings,
        patchLocMembers
      )
    : "";
  const code =
    extraCode.join("") +
    scopeType_ +
    docComment([
      `${capitalizedArticle(type.name)} ${type.name}, as the game's rules describe it.`,
      "",
      `Generated from \`type[${cwtType.name}]\` at \`${type.path}\`.`,
    ]) +
    `export interface ${fieldsName}${generic} {\n` +
    scopeMember +
    declaredFromMember +
    localisationMembers(type, localisationPlan) +
    members.join("") +
    "}\n\n" +
    (parameter?.selector === undefined
      ? ""
      : `export type ${typeName}Fields<E extends ${parameter.parameterType} = ` +
        `${parameter.parameterType}${declaredFromParameter}> = ` +
        `E extends ${parameter.parameterType} ? ` +
        `${fieldsName}<E${declaredFrom === undefined ? "" : ", L"}> : never;\n\n`) +
    (parameter === null
      ? `export interface ${typeName}Def<Id extends string = string> extends ${typeName}Fields {\n`
      : `export interface ${typeName}Def<\n  Id extends string = string,\n` +
        `  ${parameter.parameterName} extends ${parameter.parameterType} = ` +
        `${JSON.stringify(parameter.parameterFallback)},\n` +
        (declaredFrom === undefined
          ? ""
          : `  L extends ${declaredFrom.typeName} | undefined = undefined,\n`) +
        `> extends ${fieldsName}<${parameter.parameterName}` +
        `${declaredFrom === undefined ? "" : ", L"}> {\n`) +
    "  /** Full content id, including the mod prefix. */\n" +
    "  id: Id;\n" +
    "}\n\n" +
    `export type Defined${typeName}<Id extends string = string> = DefinedContent<\n` +
    `  ${JSON.stringify(type.name)},\n` +
    `  ${typeName}Def<Id>\n` +
    ">;\n\n" +
    patchCode +
    `export const ${fieldsConstant}: readonly ContentField[] = [\n` +
    fieldMetadata.map((entry) => `  ${entry},\n`).join("") +
    "];\n\n" +
    `export const ${localisationConstant}: readonly ContentLocalisation[] = ` +
    `${localisationMetadata(type, localisationPlan, localisationPointers)};\n`;

  return {
    code,
    typeName,
    fieldsConstant,
    localisationConstant,
    emittedFields,
    nestedEmittedFields,
    corpusDescents,
    declinedFields: declinedFields.sort(),
    inlineSplices,
    unsupported,
    scopeParameter: parameter,
    localisationAliases: [...localisationPlan.aliases, ...localisationAliases],
    localisationRenames,
    patchExclusions: patchCode === "" ? [] : patchExclusions,
    patchWidenings: patchCode === "" ? [] : patchWidenings,
    patchLocMembers: patchCode === "" ? [] : patchLocMembers,
  };
}

/**
 * Emits one content registry's authoring types and runtime field metadata.
 *
 * Registry-specific judgment lives in overlay rows. This module only lowers
 * rule shapes that the runtime content writer understands; the per-field
 * lowering itself lives in `fields.ts`, shared with the alias emitters.
 */

import type { DescentNode } from "../../corpus/observations.ts";
import type { RuleField } from "../../cwt/model.ts";
import type { ContentBody, ContentType } from "../../cwt/rules.ts";
import {
  authoredLiterals,
  flatten,
  lowerTopLevelSplice,
  memberOptional,
  mergeByName,
  pickOrdinary,
  repeatsSiblings,
  useWideningSymbols,
  type EmittedField,
} from "../../lower/fields.ts";
import type { FieldContext } from "../../lower/scope-context.ts";
import { partitionSubtypeFields } from "../../lower/subtype-partition.ts";
import {
  camelCase,
  capitalizedArticle,
  constantCase,
  docComment,
  indefiniteArticle,
  pascalCase,
} from "../../naming.ts";
import {
  CONTENT_DECLINED_FIELDS,
  CONTENT_FIELD_OVERRIDES,
  CONTENT_PATCH_REGISTRIES,
  FIELD_WIDENINGS,
  PATCH_WIDENINGS,
  REPEATED_STRUCT_DEFINITIONS,
  SYNTHETIC_LOCALISATION,
} from "../../overlay/index.ts";
import { Emitter } from "../../render/emitter.ts";
import {
  omissionLine,
  type DocTable,
  type FieldOmissionRow,
  type MemberDocRow,
} from "../../render/field-rows.ts";
import { constArray, member as renderMember } from "../../render/writer.ts";
import {
  localisationMembers,
  localisationMetadata,
  planLocalisation,
  type LocalisationPlan,
} from "./localisation.ts";
import { repeatedStructEmission } from "./repeated-struct.ts";
import {
  listed,
  scopeParameterOf,
  selectedContext,
  underParameter,
  type ScopeParameter,
} from "./scope-parameters.ts";

/**
 * Where the parsed view of a shipped definition lives. Not a `KNOWN_SYMBOLS`
 * row because the name is per registry (`ParsedTechnology`), so only the module
 * is a constant.
 */
const PARSED_CONTENT_MODULE = "../stellaris/vanilla/view.ts";

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
  /**
   * Every declined, unsupported, and collapsed row, structured. The three
   * prose lists below are projections of these rows ({@link omissionLine});
   * the generated field-docs ledger is the other projection.
   */
  readonly omissions: readonly FieldOmissionRow[];
  /**
   * Documentation rows for every field table the emission declares — the
   * registry's own and each nested one — keyed by the emitted constant's
   * name, for the generated field-docs ledger.
   */
  readonly docTables: readonly DocTable[];
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
  readonly docs: readonly string[];
  readonly memberType: string;
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
  emitter: Emitter,
  type: ContentType,
  typeName: string,
  generic: string,
  patchMembers: readonly PatchMember[],
  localisationPlan: LocalisationPlan,
  patchWidenings: string[],
  patchLocMembers: string[]
): string {
  const parsed = emitter.useFrom(PARSED_CONTENT_MODULE, `Parsed${typeName}`, "type");
  const locMembers = localisationPlan.entries.map((entry) => {
    const member = camelCase(entry.key);
    const pattern = entry.pattern.replace("$", "<vanilla id>");
    patchLocMembers.push(`${type.name}.${member} — replacement text under \`${pattern}\``);
    return renderMember({
      name: member,
      type: "string",
      optional: true,
      readonly: true,
      docs: [
        `Replacement English text for vanilla's own \`${pattern}\` key.`,
        "",
        "Emitted to `localisation/replace/`, the layer the game resolves ahead",
        "of the ordinary one — a rename, not a new key.",
      ],
    });
  });
  const members = patchMembers.map((entry) => {
    const widening = PATCH_WIDENINGS.get(`${type.name}.${entry.member}`);
    if (widening !== undefined) {
      patchWidenings.push(
        `${type.name}.${entry.member} also admits ${widening.extraType} — ${widening.reason}`
      );
    }
    for (const symbol of widening?.symbols ?? []) {
      emitter.use(symbol);
    }
    const extra = widening === undefined ? "" : `, ${widening.extraType}`;
    return renderMember({
      name: entry.member,
      type: `${emitter.use("PatchInput")}<${entry.memberType}${extra}>`,
      optional: true,
      readonly: true,
      docs: entry.docs,
    });
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
    `export type Patched${typeName} = ${emitter.use("PatchedContent")}<${parsed}>;\n\n` +
    docComment([`A patched vanilla ${type.name} placed into a capability feature.`]) +
    `export type ${typeName}PatchItem = ${emitter.use("ContentPatchItem")}<${parsed}>;\n\n`
  );
}

/**
 * The body fields belonging to a registry that is one subtype of a shared CWT
 * type, rather than a whole type of its own.
 *
 * Mirrors `referenceNameOf`'s guard in `index.ts`: a manifest `as` that names
 * no subtype has no rules behind it, and emitting the whole shared body under
 * that name would silently hand the registry every other subtype's fields.
 */
function registryFields(
  cwtType: ContentType,
  subtype: string | undefined,
  fields: readonly RuleField[]
): readonly RuleField[] {
  if (subtype === undefined) {
    return fields;
  }
  const self = cwtType.subtypes.find((candidate) => candidate.name === subtype);
  if (self === undefined) {
    const declared = cwtType.subtypes.map((candidate) => candidate.name).join(", ");
    throw new Error(
      `The manifest narrows type[${cwtType.name}] to subtype "${subtype}", but that names no ` +
        "subtype of it, so there is no subtype whose fields the registry could be cut down to. " +
        `Declared subtypes: ${declared}`
    );
  }
  return partitionSubtypeFields(fields, self, cwtType.subtypes);
}

export function emitContentType(
  emitter: Emitter,
  cwtType: ContentType,
  body: ContentBody,
  registry: string = cwtType.name,
  /**
   * The CWT subtype this registry is, when it is one — the manifest's `as`.
   *
   * Deliberately not the registry name. The two coincided while every renamed
   * registry was named after its subtype, but `spriteType` is `subtype[normal]`
   * of `type[sprite]`, and reading the selector off the name would look for a
   * `subtype[spriteType]` that does not exist.
   */
  subtype?: string
): ContentEmission {
  // One CWT type can back several registries — three keywords share
  // `type[component_template]`. Renaming once here makes every downstream
  // name, allowlist key, and overlay path follow the registry instead, and
  // partitioning by the subtype makes the body follow it too: the shared body
  // carries every subtype's arm, and only this registry's are its own.
  const type: ContentType = registry === cwtType.name ? cwtType : { ...cwtType, name: registry };
  const fields = registryFields(cwtType, subtype, body.fields);
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
    // A parameterised registry's unpinned type is the definition's own type
    // parameter, which is declared in this file and imports nothing.
    ...(parameter === null ? { unpinnedSymbol: "ScopeName" } : {}),
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
  const declinedFields: FieldOmissionRow[] = [];
  const inlineSplices: string[] = [];
  const unsupported: FieldOmissionRow[] = [];
  const extraCode: string[] = [];
  const localisationAliases: FieldOmissionRow[] = [];
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const memberDocs: Record<string, MemberDocRow> = {};
  const docTables: DocTable[] = [];
  const emittedMembers = new Set<string>();
  const patchMembers: PatchMember[] = [];
  const patchExclusions: string[] = [];
  const patchWidenings: string[] = [];
  const patchLocMembers: string[] = [];
  const localisationRenames: string[] = [];
  const localisationPointers = new Map<string, string>();
  const localisationPlan = planLocalisation(emitter, type);
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
        unsupported.push({
          path: `alias_name[${category}]`,
          kind: "unsupported",
          reason: "spliced unkeyed at the top level; that category has no authoring member",
        });
        continue;
      }
      if (emittedMembers.has(lowered.member) || localisationMemberNames.has(lowered.member)) {
        unsupported.push({
          path: `alias_name[${category}]`,
          kind: "unsupported",
          reason: `spliced unkeyed at the top level; its "${lowered.member}" member is already taken`,
        });
        continue;
      }
      members.push(
        renderMember({
          name: lowered.member,
          type: lowered.memberType,
          optional: true,
          docs: lowered.docs,
        })
      );
      memberDocs[lowered.member] = {
        optional: true,
        docs: lowered.docs,
        memberType: lowered.memberType,
      };
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
          docs: lowered.docs,
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
      emitter.overlayAudit.applied("CONTENT_DECLINED_FIELDS", path);
      declinedFields.push({ path, kind: "declined", reason: declined });
      continue;
    }
    const override = CONTENT_FIELD_OVERRIDES.get(path);
    if (override !== undefined) {
      emitter.overlayAudit.applied("CONTENT_FIELD_OVERRIDES", path);
    }
    const member = renamedOffLocalisation(name);
    if (override?.shape === "repeatedStruct") {
      const config = REPEATED_STRUCT_DEFINITIONS.get(path);
      if (config !== undefined) {
        emitter.overlayAudit.applied("REPEATED_STRUCT_DEFINITIONS", path);
      }
      const nested =
        config === undefined
          ? null
          : repeatedStructEmission(emitter, group[0]!, path, config, fieldContext);
      if (config === undefined || nested === null) {
        unsupported.push({
          path: name,
          kind: "unsupported",
          reason: "repeated-struct overlay is incomplete",
        });
        continue;
      }
      const optional = memberOptional(group, override);
      const docLines = [...new Set(group.flatMap((field) => field.docs))];
      members.push(
        renderMember({ name: member, type: nested.memberType, optional, docs: docLines })
      );
      memberDocs[member] = { optional, docs: docLines, memberType: nested.memberType };
      docTables.push(...nested.docTables);
      patchMembers.push({ member, docs: docLines, memberType: nested.memberType });
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
    if (widening !== undefined) {
      emitter.overlayAudit.applied("FIELD_WIDENINGS", path);
      useWideningSymbols(emitter, widening);
    }
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
      unsupported.push({
        path: name,
        kind: "unsupported",
        reason: "no declaration the emitter can lower",
      });
      continue;
    }
    const optional = memberOptional(group, override);
    const docLines = [
      ...new Set([...group.flatMap((field) => field.docs), ...(lowered.docs ?? [])]),
    ];
    const memberType =
      parameter?.selector?.member === member ? parameter.parameterName : lowered.memberType;
    members.push(renderMember({ name: member, type: memberType, optional, docs: docLines }));
    memberDocs[member] = {
      optional,
      docs: docLines,
      memberType,
      ...authoredLiterals(lowered.admits.literals),
    };
    docTables.push(...(lowered.docTables ?? []));
    patchMembers.push({ member, docs: docLines, memberType });
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
  // Off the emitted type name rather than the registry, so a camelCase registry
  // name splits at its humps the way every nested constant in the same file
  // already does — `SPRITE_TYPE_FIELDS` beside `SPRITE_TYPE_ANIMATION_FIELDS`,
  // not `SPRITETYPE_FIELDS`. Identical for every snake_case registry.
  const fieldsConstant = `${constantCase(typeName)}_FIELDS`;
  const localisationConstant = `${constantCase(typeName)}_LOCALISATION`;
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
        emitter,
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
    localisationMembers(emitter, type, localisationPlan) +
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
    `export type Defined${typeName}<Id extends string = string> = ` +
    `${emitter.use("DefinedContent")}<\n` +
    `  ${JSON.stringify(type.name)},\n` +
    `  ${typeName}Def<Id>\n` +
    ">;\n\n" +
    patchCode +
    constArray(
      fieldsConstant,
      emitter.use("ContentField"),
      fieldMetadata.map((entry) => `  ${entry},\n`).join("")
    ) +
    `export const ${localisationConstant}: readonly ${emitter.use("ContentLocalisation")}[] = ` +
    `${localisationMetadata(emitter, type, localisationPlan, localisationPointers)};\n`;

  // The prose lists are projections of the same rows the ledger carries, so
  // the report and the generated field docs cannot drift apart. Sorting by the
  // printed line keeps the report's historical order.
  const declinedRows = [...declinedFields].sort((a, b) => {
    const lineA = omissionLine(a);
    const lineB = omissionLine(b);
    return lineA < lineB ? -1 : lineA > lineB ? 1 : 0;
  });
  const collapsedRows = [...localisationPlan.aliases, ...localisationAliases];
  return {
    code,
    typeName,
    fieldsConstant,
    localisationConstant,
    emittedFields,
    nestedEmittedFields,
    corpusDescents,
    omissions: [...declinedRows, ...unsupported, ...collapsedRows],
    docTables: [{ constant: fieldsConstant, members: memberDocs }, ...docTables],
    declinedFields: declinedRows.map(omissionLine),
    inlineSplices,
    unsupported: unsupported.map(omissionLine),
    scopeParameter: parameter,
    localisationAliases: collapsedRows.map(omissionLine),
    localisationRenames,
    patchExclusions: patchCode === "" ? [] : patchExclusions,
    patchWidenings: patchCode === "" ? [] : patchWidenings,
    patchLocMembers: patchCode === "" ? [] : patchLocMembers,
  };
}

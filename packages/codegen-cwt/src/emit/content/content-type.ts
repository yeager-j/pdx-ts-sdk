/**
 * Emits one content registry's authoring types and runtime field metadata.
 *
 * Registry-specific judgment lives in overlay rows. This module only projects
 * rule shapes that the runtime content writer understands; the per-field
 * projection itself lives in `field-projection.ts`, shared with the alias emitters.
 */

import type { DescentNode } from "../../corpus/observations.ts";
import type { RuleField } from "../../cwt/model.ts";
import type { ContentBody, ContentType } from "../../cwt/rules.ts";
import { Emitter } from "../../emit/typescript.ts";
import type { EmittedField } from "../../lower/content-model.ts";
import type { AliasNameField } from "../../lower/rule-shapes.ts";
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
  CONTENT_FIELD_DOCS,
  CONTENT_FIELD_OVERRIDES,
  CONTENT_PATCH_REGISTRIES,
  CONTENT_WITNESSES,
  FIELD_WIDENINGS,
  FLAT_SUBTYPE_ARMS,
  PATCH_WIDENINGS,
  REPEATED_STRUCT_DEFINITIONS,
  SYNTHETIC_LOCALISATION,
  type ContentFieldOverride,
} from "../../overlay/index.ts";
import { constArray, member as renderMember } from "../../render/writer.ts";
import type { FieldContext } from "../scope-context.ts";
import {
  authoredLiterals,
  emittedMemberType,
  fieldDocs,
  flatten,
  memberOptional,
  mergeByName,
  pickOrdinary,
  projectTopLevelSplice,
  repeatsSiblings,
  useWideningSymbols,
} from "./field-projection.ts";
import {
  omissionLine,
  type DocTable,
  type FieldOmissionRow,
  type MemberDocRow,
} from "./field-rows.ts";
import {
  localisationMembers,
  localisationMetadata,
  localisationRefType,
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
import {
  planSubtypeUnions,
  renderSubtypeArm,
  type ClaimableMember,
  type SubtypeUnionsPlan,
} from "./subtype-unions.ts";

/**
 * Where the parsed view of a shipped definition lives. Not a `KNOWN_SYMBOLS`
 * row because the name is per registry (`ParsedTechnology`), so only the module
 * is a constant.
 */
const PARSED_CONTENT_MODULE = "../installation/vanilla/parsed-definitions.ts";

/** Generated module text and coverage evidence for one content registry. */
export interface ContentEmission {
  /** Complete generated module text for the registry. */
  readonly code: string;
  /**
   * Every name {@link ContentEmission.code} declares as an export, which the
   * public barrel checks the names it publishes against.
   */
  readonly exportedNames: readonly string[];
  /** Pascal-cased base name shared by the registry's generated declarations. */
  readonly typeName: string;
  /**
   * The type names an author can name, for the generated public barrel: the
   * authoring and definition types, the scope unions the registry declares,
   * its patch vocabulary, and its repeated-struct interfaces. Everything else
   * the module exports is projection machinery.
   */
  readonly publicTypes: readonly string[];
  /** Name of the registry's generated runtime field table. */
  readonly fieldsConstant: string;
  /** Name of the registry's generated localisation descriptor table. */
  readonly localisationConstant: string;
  /**
   * Name of the registry's generated `loc` reference type, or `null` where the
   * registry declares no localisation slots and its items carry the shared
   * empty surface instead.
   */
  readonly locTypeName: string | null;
  /** Top-level fields represented by the authoring interface. */
  readonly emittedFields: readonly EmittedField[];
  /**
   * Fields projected inside a block-valued field, e.g. `tradition_swap.on_enabled`
   * or `term_data.discrete_terms.key` — invisible to `emittedFields`, which only
   * names the owning field itself (`tradition_swap`). Their paths carry the
   * registry prefix; `emittedFields` names are bare.
   */
  readonly nestedEmittedFields: readonly EmittedField[];
  /**
   * How the corpus reader reaches those interiors, from the same projections.
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
   * projected to one authoring member. Their legal keys are the category's
   * members rather than anything `emittedFields` can name, so a consumer
   * measuring coverage has to resolve the category itself.
   */
  readonly inlineSplices: readonly string[];
  /**
   * Present in the rules but not expressible: blocked on emitter machinery,
   * each with what stopped the projection. The only reason a declared field is
   * absent from the authoring surface other than `declinedFields`.
   */
  readonly unsupported: readonly string[];
  /** Localisation slots collapsed onto an earlier canonical slot. */
  readonly localisationAliases: readonly string[];
  /** Subtypes emitted as union arms, each with the selector that picks it. */
  readonly subtypeUnions: readonly string[];
  /**
   * Members a subtype arm requires that the authoring surface leaves optional,
   * each with why the arm could not become a union.
   */
  readonly subtypeCollapses: readonly string[];
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
): { readonly code: string; readonly exportedNames: readonly string[] } {
  const parsed = emitter.useFrom(PARSED_CONTENT_MODULE, `Parsed${typeName}`, "type");
  const locMembers = localisationPlan.entries.map((entry) => {
    const member = camelCase(entry.key);
    const pattern = entry.pattern.replace("$", "<vanilla id>");
    patchLocMembers.push(`${type.name}.${member} — replacement text under \`${pattern}\``);
    return renderMember({
      name: member,
      type: emitter.use("LocalizedText"),
      optional: true,
      readonly: true,
      docs: [
        `Replacement text for vanilla's own \`${pattern}\` key.`,
        "",
        "Emitted to `localisation/replace/`, the layer the game resolves ahead",
        "of the ordinary one — a rename, not a new key. English is always",
        "supplied, so a rename replaces the original English text too.",
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
  return {
    exportedNames: [`${typeName}Patch`, `Patched${typeName}`, `${typeName}PatchItem`],
    code:
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
      `export type ${typeName}PatchItem = ${emitter.use("ContentPatchItem")}<${parsed}>;\n\n`,
  };
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

/**
 * The declaration loop's working state: everything one registry's loop
 * accumulates toward the emitted code, the runtime field tables, and the
 * report. {@link emitContentType} folds it into {@link ContentEmission} once
 * the loop has run.
 */
interface ContentTypeDraft {
  /** The base interface's members in declaration order, rendered by the code assembler. */
  readonly members: DraftMember[];
  /** The ordinary body fields, for the subtype-union planner to claim. */
  readonly fieldMembers: ClaimableMember[];
  readonly fieldMetadata: string[];
  readonly memberDocs: Record<string, MemberDocRow>;
  readonly docTables: DocTable[];
  readonly extraCode: string[];
  /** Every name {@link ContentTypeDraft.extraCode} exports. */
  readonly exportedNames: string[];
  readonly emittedFields: EmittedField[];
  readonly nestedEmittedFields: EmittedField[];
  readonly corpusDescents: DescentNode[];
  readonly declinedFields: FieldOmissionRow[];
  readonly inlineSplices: string[];
  readonly unsupported: FieldOmissionRow[];
  /** Required arm declarations authored optional, from this level and every nested one. */
  readonly collapsed: FieldOmissionRow[];
  readonly localisationAliases: FieldOmissionRow[];
  readonly localisationRenames: string[];
  readonly localisationPointers: Map<string, string>;
  readonly patchMembers: PatchMember[];
  readonly patchExclusions: string[];
  readonly emittedMembers: Set<string>;
  /** Interfaces emitted for `REPEATED_STRUCT_DEFINITIONS` fields, which authors name. */
  readonly repeatedStructTypes: string[];
}

/** One member of the base interface, kept structured so a union can claim it. */
interface DraftMember {
  readonly member: string;
  readonly type: string;
  readonly optional: boolean;
  readonly docs: readonly string[];
}

/** Files bubbled rows under the draft list their kind names. */
function absorbOmissions(draft: ContentTypeDraft, rows: readonly FieldOmissionRow[]): void {
  for (const row of rows) {
    (row.kind === "collapsed" ? draft.collapsed : draft.unsupported).push(row);
  }
}

function contentTypeDraft(): ContentTypeDraft {
  return {
    members: [],
    fieldMembers: [],
    fieldMetadata: [],
    memberDocs: {},
    docTables: [],
    extraCode: [],
    exportedNames: [],
    emittedFields: [],
    nestedEmittedFields: [],
    corpusDescents: [],
    declinedFields: [],
    inlineSplices: [],
    unsupported: [],
    collapsed: [],
    localisationAliases: [],
    localisationRenames: [],
    localisationPointers: new Map(),
    patchMembers: [],
    patchExclusions: [],
    emittedMembers: new Set(),
    repeatedStructTypes: [],
  };
}

/** The context every field of this registry projects against. */
function scopeFieldContext(
  scope: ContentBody["scope"],
  registry: string,
  parameter: ScopeParameter | null
): FieldContext {
  return {
    scope,
    // `NoInfer` makes the `scope` member the sole inference site for S. Without
    // it TypeScript would also infer from the `Trigger<S>` positions, which are
    // contravariant, and land somewhere unrelated to what the author declared.
    unpinned:
      parameter === null
        ? "ScopeName"
        : parameter.selector === undefined
          ? "NoInfer<S>"
          : `NoInfer<${pascalCase(registry)}ScopeOf<E>>`,
    // A parameterised registry's unpinned type is the definition's own type
    // parameter, which is declared in this file and imports nothing.
    ...(parameter === null ? { unpinnedSymbol: "ScopeName" } : {}),
    ...(parameter === null
      ? {}
      : {
          nestedTypeParameter: {
            declaration:
              `<${parameter.parameterName} extends ${parameter.parameterType} = ` +
              `${parameter.parameterDefault}>`,
            argument: parameter.parameterName,
          },
        }),
  };
}

/**
 * {@link underParameter} over a field that carries its own path. A nested
 * field's scope is the definition's parameter exactly as a top-level one's
 * is, so the two must not be re-described differently one level down.
 */
function parameterised(emitted: EmittedField, parameter: ScopeParameter | null): EmittedField {
  const { field, ...admits } = emitted;
  return { field, ...underParameter(admits, parameter) };
}

/** One named body field, as the declaration loop dispatches it to an arm. */
interface FieldDeclaration {
  readonly name: string;
  /** The authoring member, renamed off a colliding localisation slot. */
  readonly member: string;
  /** The overlay path, `<registry>.<field>`. */
  readonly path: string;
  readonly group: readonly RuleField[];
  readonly override: ContentFieldOverride | undefined;
}

/**
 * Projects one alias category spliced unkeyed at the definition's top level
 * into a single authoring member, or records why it has none.
 */
function declareSplice(
  emitter: Emitter,
  declaration: AliasNameField,
  fieldContext: FieldContext,
  type: ContentType,
  localisationMemberNames: ReadonlySet<string>,
  draft: ContentTypeDraft
): void {
  const category = declaration.key.category;
  const projected = projectTopLevelSplice(emitter, declaration, fieldContext);
  if (projected === null) {
    draft.unsupported.push({
      path: `alias_name[${category}]`,
      kind: "unsupported",
      reason: "spliced unkeyed at the top level; that category has no authoring member",
    });
    return;
  }
  if (draft.emittedMembers.has(projected.member) || localisationMemberNames.has(projected.member)) {
    draft.unsupported.push({
      path: `alias_name[${category}]`,
      kind: "unsupported",
      reason: `spliced unkeyed at the top level; its "${projected.member}" member is already taken`,
    });
    return;
  }
  draft.members.push({
    member: projected.member,
    type: projected.memberType,
    optional: true,
    docs: projected.docs,
  });
  draft.memberDocs[projected.member] = {
    optional: true,
    docs: projected.docs,
    memberType: projected.memberType,
  };
  draft.fieldMetadata.push(projected.metadata);
  draft.emittedMembers.add(projected.member);
  draft.inlineSplices.push(category);
  // A splice the game reads at the block root writes no key of its own, so
  // a patch has no slot in the parsed body to substitute for it.
  if (projected.key === undefined) {
    draft.patchExclusions.push(
      `${type.name}.${projected.member} — spliced unkeyed into the definition's own body, ` +
        "so a patch has no key to replace"
    );
  } else {
    draft.patchMembers.push({
      member: projected.member,
      docs: projected.docs,
      memberType: projected.memberType,
    });
  }
  // A structural splice names a real key the corpus can be measured
  // against; `inlineModifiers` does not, since its rows carry no key.
  if (projected.key !== undefined) {
    draft.emittedFields.push({
      field: projected.key,
      authoredPath: [projected.member],
      ...projected.admits!,
    });
  }
}

/**
 * Projects an overlay-configured repeated-struct field through its own nested
 * emission and records the member, the nested tables, and the corpus descent.
 */
function declareRepeatedStruct(
  emitter: Emitter,
  field: FieldDeclaration,
  fieldContext: FieldContext,
  parameter: ScopeParameter | null,
  draft: ContentTypeDraft
): void {
  const { name, member, path, group, override } = field;
  const config = REPEATED_STRUCT_DEFINITIONS.get(path);
  if (config !== undefined) {
    emitter.overlayAudit.applied("REPEATED_STRUCT_DEFINITIONS", path);
  }
  const nested =
    config === undefined
      ? null
      : repeatedStructEmission(emitter, group[0]!, path, config, fieldContext);
  if (config === undefined || nested === null) {
    draft.unsupported.push({
      path: name,
      kind: "unsupported",
      reason: "repeated-struct overlay is incomplete",
    });
    return;
  }
  const optional = memberOptional(group, override);
  const docLines = [...new Set(group.flatMap(fieldDocs))];
  draft.members.push({ member, type: nested.memberType, optional, docs: docLines });
  draft.memberDocs[member] = { optional, docs: docLines, memberType: nested.memberType };
  draft.docTables.push(...nested.docTables);
  draft.patchMembers.push({ member, docs: docLines, memberType: nested.memberType });
  draft.extraCode.push(nested.code);
  draft.exportedNames.push(...nested.exportedNames);
  draft.repeatedStructTypes.push(`${config.typeName}Fields`);
  draft.fieldMetadata.push(nested.metadata(member));
  draft.declinedFields.push(...nested.declinedFields);
  absorbOmissions(draft, nested.omissions);
  draft.nestedEmittedFields.push(
    ...nested.emittedFields
      .map((emitted) => parameterised(emitted, parameter))
      .map((emitted) => ({
        ...emitted,
        authoredPath: [member, ...(emitted.authoredPath ?? [])],
      }))
  );
  draft.localisationAliases.push(...nested.localisationAliases);
  draft.emittedMembers.add(member);
  draft.emittedFields.push({
    field: name,
    authoredPath: [member],
    shape: "repeatedStruct",
    repeated: repeatsSiblings(group[0]!, "repeatedStruct"),
  });
  // The emission's own derived keying, so the reader's and the authoring
  // shape's cannot disagree about where the record key lives.
  draft.corpusDescents.push(
    nested.keying === "container"
      ? { field: name, mode: "repeatedStruct", keying: "container", children: nested.children }
      : {
          field: name,
          mode: "repeatedStruct",
          keying: "siblings",
          identityKey: nested.identityKey,
          children: nested.children,
        }
  );
}

/** Projects one ordinary body field and records its member, docs, and tables. */
function declareOrdinaryField(
  emitter: Emitter,
  field: FieldDeclaration,
  fieldContext: FieldContext,
  parameter: ScopeParameter | null,
  draft: ContentTypeDraft
): void {
  const { name, member, path, group, override } = field;
  const widening = FIELD_WIDENINGS.get(path);
  if (widening !== undefined) {
    emitter.overlayAudit.applied("FIELD_WIDENINGS", path);
    useWideningSymbols(emitter, widening);
  }
  const ambient = Object.fromEntries(
    Object.entries(override?.ambient ?? {}).map(([key, scope]) => {
      const canonical = emitter.lowerer.canonicalScope(scope);
      if (canonical === null) {
        throw new Error(`Overlay asserts unknown ambient scope "${scope}" at ${path}`);
      }
      return [key, JSON.stringify(canonical)];
    })
  );
  const assertedContext =
    Object.keys(ambient).length === 0
      ? fieldContext
      : {
          ...fieldContext,
          assertedAmbient: { ...fieldContext.assertedAmbient, ...ambient },
        };
  const loweredContext = selectedContext(assertedContext, parameter, member);
  const projected = pickOrdinary(
    emitter,
    group,
    name,
    loweredContext,
    override,
    widening?.extraType,
    path
  );
  if (projected === null) {
    draft.unsupported.push({
      path: name,
      kind: "unsupported",
      reason: "no declaration the emitter can lower",
    });
    return;
  }
  const optional = memberOptional(group, override);
  const overlayDocs = CONTENT_FIELD_DOCS.get(path);
  if (overlayDocs !== undefined) {
    emitter.overlayAudit.applied("CONTENT_FIELD_DOCS", path);
  }
  const docLines = [
    ...new Set([...(overlayDocs ?? []), ...group.flatMap(fieldDocs), ...(projected.docs ?? [])]),
  ];
  // The selector member is the scope parameter itself rather than a projected type.
  const selectorType = parameter?.selector?.member === member ? parameter.parameterName : undefined;
  const memberType = selectorType ?? projected.memberType;
  const type = selectorType ?? emittedMemberType(projected);
  draft.members.push({ member, type, optional, docs: docLines });
  draft.fieldMembers.push({ name, member, group, type, memberType, docs: docLines, override });
  draft.memberDocs[member] = {
    optional,
    docs: docLines,
    memberType,
    ...authoredLiterals(projected.admits.literals),
  };
  draft.docTables.push(...(projected.docTables ?? []));
  draft.patchMembers.push({ member, docs: docLines, memberType });
  draft.fieldMetadata.push(projected.metadata(member));
  if (projected.code !== undefined) {
    draft.extraCode.push(projected.code);
    draft.exportedNames.push(...(projected.exportedNames ?? []));
  }
  if (projected.omissions !== undefined) {
    absorbOmissions(draft, projected.omissions);
  }
  draft.emittedMembers.add(member);
  draft.emittedFields.push({
    field: name,
    authoredPath: [member],
    ...underParameter(projected.admits, parameter),
  });
  draft.nestedEmittedFields.push(
    ...(projected.nested ?? [])
      .map((emitted) => parameterised(emitted, parameter))
      .map((emitted) => ({
        ...emitted,
        authoredPath: [member, ...(emitted.authoredPath ?? [])],
      }))
  );
  draft.corpusDescents.push(...(projected.descents ?? []));
}

/**
 * The declaration loop. Everything the emitter can lower is emitted, in the
 * rules' own declaration order. The SDK's promise is that a mod author does
 * not run out of API, so a field is in unless something objects: either the
 * emitter cannot express it, or CONTENT_DECLINED_FIELDS refuses it outright.
 *
 * Named fields and top-level splices share this one pass, because a splice
 * can be *positional*. Inside a solar system initializer's `planet`,
 * `change_orbit` advances the orbit cursor and is declared before the `moon`
 * blocks it applies to, so emitting splice members first would describe
 * different geometry. Iterating the flattened declarations also collapses a
 * splice that several subtype arms each declare — the planet tree is declared
 * twice, once per subtype — which a second pass would instead report as a
 * member-name collision.
 */
function projectDeclarations(
  emitter: Emitter,
  type: ContentType,
  fields: readonly RuleField[],
  grouped: ReadonlyMap<string, readonly RuleField[]>,
  parameter: ScopeParameter | null,
  fieldContext: FieldContext,
  localisationMemberNames: ReadonlySet<string>,
  draft: ContentTypeDraft
): void {
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
    draft.localisationRenames.push(
      `${type.name}.${name} — "${declared}" is a localization slot member, ` +
        `so the body field authors as "${renamed}"`
    );
    if (SYNTHETIC_LOCALISATION.has(`${type.name}.${declared}`)) {
      draft.localisationPointers.set(declared, renamed);
    }
    return renamed;
  };

  const seenNames = new Set<string>();
  const seenCategories = new Set<string>();
  for (const declaration of flatten(fields, type.name)) {
    const key = declaration.key;
    if (key.kind === "aliasName") {
      if (seenCategories.has(key.category)) {
        continue;
      }
      seenCategories.add(key.category);
      // Rebuilt with the narrowed key: `AliasNameField` is an intersection, and
      // narrowing `declaration.key` does not re-type `declaration` itself.
      declareSplice(
        emitter,
        { ...declaration, key },
        fieldContext,
        type,
        localisationMemberNames,
        draft
      );
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
    // Absent only for the name field, dropped by the caller: the writer emits
    // it from the definition's id, so it is not an authoring member.
    if (group === undefined) {
      continue;
    }
    const path = `${type.name}.${name}`;
    const declined = CONTENT_DECLINED_FIELDS.get(path);
    if (declined !== undefined) {
      emitter.overlayAudit.applied("CONTENT_DECLINED_FIELDS", path);
      draft.declinedFields.push({ path, kind: "declined", reason: declined });
      continue;
    }
    const override = CONTENT_FIELD_OVERRIDES.get(path);
    if (override !== undefined) {
      emitter.overlayAudit.applied("CONTENT_FIELD_OVERRIDES", path);
    }
    const member = renamedOffLocalisation(name);
    const field: FieldDeclaration = { name, member, path, group, override };
    if (override?.shape === "repeatedStruct") {
      declareRepeatedStruct(emitter, field, fieldContext, parameter, draft);
    } else {
      declareOrdinaryField(emitter, field, fieldContext, parameter, draft);
    }
  }
}

/** The emitted names one registry's code and report share. */
interface ContentTypeNames {
  readonly typeName: string;
  /** The fields interface: `XFields`, or `XFieldsBase` under a selector or subtype unions. */
  readonly fieldsName: string;
  readonly fieldsConstant: string;
  readonly localisationConstant: string;
}

function contentTypeNames(
  type: ContentType,
  parameter: ScopeParameter | null,
  hasSubtypeUnions: boolean
): ContentTypeNames {
  const typeName = pascalCase(type.name);
  // `XFieldsBase` whenever `XFields` is composed from it: by the scope
  // selector's conditional, or by intersecting the subtype unions.
  const fieldsName =
    parameter?.selector === undefined && !hasSubtypeUnions
      ? `${typeName}Fields`
      : `${typeName}FieldsBase`;
  // Off the emitted type name rather than the registry, so a camelCase registry
  // name splits at its humps the way every nested constant in the same file
  // already does — `SPRITE_TYPE_FIELDS` beside `SPRITE_TYPE_ANIMATION_FIELDS`,
  // not `SPRITETYPE_FIELDS`. Identical for every snake_case registry.
  return {
    typeName,
    fieldsName,
    fieldsConstant: `${constantCase(typeName)}_FIELDS`,
    localisationConstant: `${constantCase(typeName)}_LOCALISATION`,
  };
}

/** The registry's share of the generated public barrel, from the names it just emitted. */
function contentPublicTypes(
  typeName: string,
  parameter: ScopeParameter | null,
  patchable: boolean,
  repeatedStructTypes: readonly string[],
  locTypeName: string | null,
  subtypeUnionTypes: readonly string[]
): string[] {
  return [
    `${typeName}Def`,
    `${typeName}Fields`,
    ...subtypeUnionTypes,
    `Defined${typeName}`,
    ...(locTypeName === null ? [] : [locTypeName]),
    ...(parameter === null ? [] : [parameter.typeName]),
    ...(parameter?.declaredFrom === undefined ? [] : [parameter.declaredFrom.typeName]),
    ...(patchable ? [`${typeName}Patch`, `Patched${typeName}`, `${typeName}PatchItem`] : []),
    ...repeatedStructTypes,
  ];
}

/** The emitted text a scope-parameterised registry adds to its interfaces. */
interface ScopeParameterSurface {
  /** The interfaces' type-parameter list, empty for an unparameterised registry. */
  readonly generic: string;
  /** The same parameters as arguments, `<S, L>`, for one declaration to name another. */
  readonly genericArguments: string;
  /** The declared-FROM `L` parameter, appended wherever the generic rides. */
  readonly declaredFromParameter: string;
  /** The synthetic scope authoring member, where the registry declares one. */
  readonly scopeMember: string;
  /** The declared-FROM authoring member, where the registry declares one. */
  readonly declaredFromMember: string;
  /** The exported scope union types the parameters name. */
  readonly scopeTypes: string;
  /** Every name {@link ScopeParameterSurface.scopeTypes} exports. */
  readonly scopeTypeNames: readonly string[];
}

function scopeParameterDeclarations(
  type: ContentType,
  parameter: ScopeParameter | null
): ScopeParameterSurface {
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
        `${parameter.parameterDefault}${declaredFromParameter}>`;
  const genericArguments =
    parameter === null
      ? ""
      : `<${parameter.parameterName}${declaredFrom === undefined ? "" : ", L"}>`;
  const scopeMember =
    parameter?.authoringMember === null || parameter?.authoringMember === undefined
      ? ""
      : docComment(
          [
            ...parameter.authoringMember.docs,
            ...(parameter.fallback === null ? [] : [`Defaults to \`${parameter.fallback}\`.`]),
          ],
          "  "
        ) +
        `  ${parameter.authoringMember.member}${parameter.authoringMember.required ? "" : "?"}: S;\n`;
  const declaredFromMember =
    declaredFrom === undefined
      ? ""
      : docComment(
          [
            `The scope \`${declaredFrom.effect}\` is handed as this definition's`,
            "location, and the ambient location scope its callbacks receive.",
            "Emits nothing — the game learns it from the call site, not from the",
            "definition. Declaring it types the matching ambient scope in",
            `${listed(Object.keys(declaredFrom.members))}, and holds every`,
            `\`${camelCase(declaredFrom.effect)}\` call for this definition to a`,
            "location of the same scope. Omitted, that ambient scope stays unreadable and the",
            "call sites stay unchecked.",
          ],
          "  "
        ) + `  ${declaredFrom.member}?: L;\n`;
  const scopeOfName = `${pascalCase(type.name)}ScopeOf`;
  const scopeTypeNames =
    parameter === null
      ? []
      : [
          parameter.typeName,
          ...(parameter.selector === undefined ? [] : [scopeOfName]),
          ...(declaredFrom === undefined ? [] : [declaredFrom.typeName]),
        ];
  const scopeTypes =
    parameter === null
      ? ""
      : docComment([`The scopes ${indefiniteArticle(type.name)} ${type.name} may declare.`]) +
        `export type ${parameter.typeName} = ` +
        `${parameter.scopes.map((scope) => JSON.stringify(scope)).join(" | ")};\n\n` +
        (parameter.selector === undefined
          ? ""
          : docComment([
              `The scope ${indefiniteArticle(type.name)} ${type.name}'s own clauses run in, ` +
                `selected by its \`${parameter.parameterType}\`.`,
            ]) +
            `export type ${scopeOfName}<E extends ${parameter.parameterType}> =\n` +
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
  return {
    generic,
    genericArguments,
    declaredFromParameter,
    scopeMember,
    declaredFromMember,
    scopeTypes,
    scopeTypeNames,
  };
}

/**
 * The `XDef` declaration: the fields interface plus the id. A registry whose
 * fields are a union of subtype arms gets one `Def` interface per arm and
 * `XDef` as their union, so a definition's type stays a name wherever it is
 * inferred.
 */
function definitionType(
  type: ContentType,
  typeName: string,
  fieldsName: string,
  parameter: ScopeParameter | null,
  unions: SubtypeUnionsPlan
): string {
  const declaredFrom = parameter?.declaredFrom;
  const generic =
    parameter === null
      ? "<Id extends string = string>"
      : `<\n  Id extends string = string,\n` +
        `  ${parameter.parameterName} extends ${parameter.parameterType} = ` +
        `${parameter.parameterDefault},\n` +
        (declaredFrom === undefined
          ? ""
          : `  L extends ${declaredFrom.typeName} | undefined = undefined,\n`) +
        ">";
  const fieldsArguments =
    parameter === null
      ? ""
      : `<${parameter.parameterName}${declaredFrom === undefined ? "" : ", L"}>`;
  const idMember = "  /** Full content id, including the mod prefix. */\n" + "  id: Id;\n";
  const withId = docComment([
    `${capitalizedArticle(type.name)} ${type.name} with the id it is defined under.`,
  ]);
  if (unions.arms.length === 0) {
    const base = parameter === null ? `${typeName}Fields` : `${fieldsName}${fieldsArguments}`;
    return (
      withId + `export interface ${typeName}Def${generic} extends ${base} {\n` + idMember + "}\n\n"
    );
  }
  const defArguments =
    parameter === null
      ? "<Id>"
      : `<Id, ${parameter.parameterName}${declaredFrom === undefined ? "" : ", L"}>`;
  return (
    unions.arms
      .map(
        (arm) =>
          docComment([`${capitalizedArticle(type.name)} ${arm.typeName} definition with its id.`]) +
          `export interface ${arm.defTypeName}${generic} extends ${arm.typeName}${fieldsArguments} {\n` +
          idMember +
          "}\n\n"
      )
      .join("") +
    withId +
    `export type ${typeName}Def${generic} =\n` +
    unions.arms.map((arm) => `  | ${arm.defTypeName}${defArguments}`).join("\n") +
    ";\n\n"
  );
}

/**
 * Assembles the registry's generated module text from the projected pieces, and
 * the names it exports.
 *
 * The two are returned together because the public barrel checks every name it
 * publishes against them: a declaration this stops emitting takes its name out
 * of the list with it.
 */
function contentTypeCode(
  emitter: Emitter,
  type: ContentType,
  cwtType: ContentType,
  names: ContentTypeNames,
  parameter: ScopeParameter | null,
  surface: ScopeParameterSurface,
  localisationPlan: LocalisationPlan,
  locTypeName: string | null,
  draft: ContentTypeDraft,
  unions: SubtypeUnionsPlan,
  patch: { readonly code: string; readonly exportedNames: readonly string[] }
): { readonly code: string; readonly exportedNames: readonly string[] } {
  const { typeName, fieldsName, fieldsConstant, localisationConstant } = names;
  const declaredFrom = parameter?.declaredFrom;
  const claimed = new Set(unions.arms.flatMap((arm) => arm.members.map((entry) => entry.member)));
  const exportedNames = [
    ...draft.exportedNames,
    ...surface.scopeTypeNames,
    fieldsName,
    ...unions.arms.flatMap((arm) => [arm.typeName, arm.defTypeName]),
    ...(fieldsName === `${typeName}Fields` ? [] : [`${typeName}Fields`]),
    `${typeName}Def`,
    ...(locTypeName === null ? [] : [locTypeName]),
    `Defined${typeName}`,
    ...patch.exportedNames,
    fieldsConstant,
    localisationConstant,
  ];
  const code =
    draft.extraCode.join("") +
    surface.scopeTypes +
    docComment([
      `${capitalizedArticle(type.name)} ${type.name}, as the game's rules describe it.`,
      "",
      `Generated from \`type[${cwtType.name}]\` at \`${type.path}\`.`,
    ]) +
    `export interface ${fieldsName}${surface.generic} {\n` +
    surface.scopeMember +
    surface.declaredFromMember +
    localisationMembers(emitter, type, localisationPlan) +
    draft.members
      .filter((entry) => !claimed.has(entry.member))
      .map((entry) => renderMember({ name: entry.member, ...entry }))
      .join("") +
    "}\n\n" +
    unions.arms
      .map((arm) =>
        renderSubtypeArm(
          arm,
          `${indefiniteArticle(type.name)} ${type.name}`,
          fieldsName,
          surface.generic,
          surface.genericArguments
        )
      )
      .join("") +
    (parameter?.selector === undefined
      ? ""
      : docComment([
          `${capitalizedArticle(type.name)} ${type.name}, as the game's rules describe it.`,
          `The \`${parameter.parameterType}\` argument selects the member types that scope allows.`,
        ]) +
        `export type ${typeName}Fields<E extends ${parameter.parameterType} = ` +
        `${parameter.parameterType}${surface.declaredFromParameter}> = ` +
        `E extends ${parameter.parameterType} ? ` +
        `${fieldsName}<E${declaredFrom === undefined ? "" : ", L"}> : never;\n\n`) +
    (unions.arms.length === 0
      ? ""
      : docComment([
          `${capitalizedArticle(type.name)} ${type.name}, as the game's rules describe it:`,
          "one arm per way its subtypes apply.",
        ]) +
        `export type ${typeName}Fields${surface.generic} =\n` +
        unions.arms.map((arm) => `  | ${arm.typeName}${surface.genericArguments}`).join("\n") +
        ";\n\n") +
    definitionType(type, typeName, fieldsName, parameter, unions) +
    // A registry with no declared slots emits no type: its items carry the
    // shared empty surface, so there is nothing per-registry to name.
    (locTypeName === null ? "" : localisationRefType(emitter, type, typeName, localisationPlan)) +
    docComment([
      `${capitalizedArticle(type.name)} ${type.name} registered with a mod, ` +
        "usable as a typed cross-reference.",
    ]) +
    `export type Defined${typeName}<Id extends string = string> = ` +
    `${emitter.use("DefinedContent")}<\n` +
    `  ${JSON.stringify(type.name)},\n` +
    `  ${typeName}Def<Id>\n` +
    ">;\n\n" +
    patch.code +
    constArray(
      fieldsConstant,
      emitter.use("ContentField"),
      draft.fieldMetadata.map((entry) => `  ${entry},\n`).join(""),
      [`How the writer lowers each member of {@link ${fieldsName}} to PDXScript.`]
    ) +
    docComment([
      `The localization slots ${indefiniteArticle(type.name)} ${type.name} defines, ` +
        "with the key pattern each one mints.",
    ]) +
    `export const ${localisationConstant}: readonly ${emitter.use("ContentLocalisation")}[] = ` +
    `${localisationMetadata(emitter, type, localisationPlan, draft.localisationPointers)};\n`;
  return { code, exportedNames };
}

/**
 * Why every subtype arm of the registry stays flat, or `null` when the arms
 * may become unions. A scope selector already parameterises the fields by a
 * discriminant of its own, and an `intersects` witness definer infers its
 * witness from the definition, which a union input defeats.
 */
function flatRegistryReason(type: ContentType, parameter: ScopeParameter | null): string | null {
  if (parameter?.selector !== undefined) {
    return "the registry's scope selector already parameterises its fields";
  }
  if (CONTENT_WITNESSES.get(type.name)?.mode === "intersects") {
    return "the registry's definer infers a witness from the definition, which a union defeats";
  }
  return null;
}

/**
 * The registry's `FLAT_SUBTYPE_ARMS` rows keyed by subtype. The planner
 * reports which of them it consulted; only those count as applied, so a row
 * left behind by a rule change fails the overlay audit.
 */
function flatSubtypeArms(type: ContentType): ReadonlyMap<string, string> {
  const rows = new Map<string, string>();
  for (const subtype of type.subtypes) {
    const reason = FLAT_SUBTYPE_ARMS.get(`${type.name}.${subtype.name}`);
    if (reason !== undefined) {
      rows.set(subtype.name, reason);
    }
  }
  return rows;
}

/**
 * Rewrites the draft's members, ledger rows, and patch docs to what the union
 * plan decided: a claimed member leaves the base interface for its arms, and an
 * unclaimed one takes the optionality and docs the arms agree on.
 */
function applySubtypeUnions(draft: ContentTypeDraft, unions: SubtypeUnionsPlan): void {
  draft.collapsed.push(...unions.collapsed);
  if (unions.arms.length === 0) {
    return;
  }
  for (const [index, entry] of draft.members.entries()) {
    const base = unions.base.get(entry.member);
    if (base !== undefined) {
      draft.members[index] = { ...entry, ...base };
    }
  }
  for (const [member, resolved] of [...unions.base, ...unions.claimedDocs]) {
    const row = draft.memberDocs[member];
    if (row !== undefined) {
      draft.memberDocs[member] = { ...row, ...resolved };
    }
    const patchIndex = draft.patchMembers.findIndex((entry) => entry.member === member);
    if (patchIndex !== -1) {
      draft.patchMembers[patchIndex] = { ...draft.patchMembers[patchIndex]!, docs: resolved.docs };
    }
  }
}

/**
 * Emits one manifest registry's authoring declarations, runtime metadata, and coverage report.
 * A shared CWT type can be narrowed to a manifest subtype without admitting sibling subtype fields.
 */
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
  const fieldContext = scopeFieldContext(body.scope, type.name, parameter);
  const localisationPlan = planLocalisation(emitter, type);
  const localisationMemberNames = new Set(
    localisationPlan.entries.map((entry) => camelCase(entry.key))
  );

  const draft = contentTypeDraft();
  projectDeclarations(
    emitter,
    type,
    fields,
    grouped,
    parameter,
    fieldContext,
    localisationMemberNames,
    draft
  );

  const unions = planSubtypeUnions(
    type,
    draft.fieldMembers,
    flatRegistryReason(type, parameter),
    flatSubtypeArms(type)
  );
  for (const subtype of unions.flatSubtypesApplied) {
    emitter.overlayAudit.applied("FLAT_SUBTYPE_ARMS", `${type.name}.${subtype}`);
  }
  applySubtypeUnions(draft, unions);
  const names = contentTypeNames(type, parameter, unions.arms.length > 0);
  const surface = scopeParameterDeclarations(type, parameter);
  const patchWidenings: string[] = [];
  const patchLocMembers: string[] = [];
  const patchable = CONTENT_PATCH_REGISTRIES.has(type.name);
  const patch = patchable
    ? patchTypes(
        emitter,
        type,
        names.typeName,
        surface.generic,
        draft.patchMembers,
        localisationPlan,
        patchWidenings,
        patchLocMembers
      )
    : { code: "", exportedNames: [] };
  const locTypeName = localisationPlan.entries.length === 0 ? null : `${names.typeName}Loc`;
  const module = contentTypeCode(
    emitter,
    type,
    cwtType,
    names,
    parameter,
    surface,
    localisationPlan,
    locTypeName,
    draft,
    unions,
    patch
  );

  // The prose lists are projections of the same rows the ledger carries, so
  // the report and the generated field docs cannot drift apart. Sorting by the
  // printed line keeps the report's historical order.
  const declinedRows = [...draft.declinedFields].sort((a, b) => {
    const lineA = omissionLine(a);
    const lineB = omissionLine(b);
    return lineA < lineB ? -1 : lineA > lineB ? 1 : 0;
  });
  const localisationRows = [...localisationPlan.aliases, ...draft.localisationAliases];
  return {
    code: module.code,
    exportedNames: module.exportedNames,
    typeName: names.typeName,
    publicTypes: contentPublicTypes(
      names.typeName,
      parameter,
      patchable,
      draft.repeatedStructTypes,
      locTypeName,
      // The base interface is nameable only through the barrel once `XFields`
      // is composed from it: an exported definition's inferred type spells it.
      unions.arms.length === 0
        ? []
        : [names.fieldsName, ...unions.arms.flatMap((arm) => [arm.typeName, arm.defTypeName])]
    ),
    fieldsConstant: names.fieldsConstant,
    localisationConstant: names.localisationConstant,
    locTypeName,
    emittedFields: draft.emittedFields,
    nestedEmittedFields: draft.nestedEmittedFields,
    corpusDescents: draft.corpusDescents,
    omissions: [...declinedRows, ...draft.unsupported, ...localisationRows, ...draft.collapsed],
    docTables: [{ constant: names.fieldsConstant, members: draft.memberDocs }, ...draft.docTables],
    declinedFields: declinedRows.map(omissionLine),
    inlineSplices: draft.inlineSplices,
    unsupported: draft.unsupported.map(omissionLine),
    scopeParameter: parameter,
    localisationAliases: localisationRows.map(omissionLine),
    subtypeUnions: unions.modelled,
    subtypeCollapses: draft.collapsed.map(omissionLine),
    localisationRenames: draft.localisationRenames,
    patchExclusions: patchable ? draft.patchExclusions : [],
    patchWidenings: patchable ? patchWidenings : [],
    patchLocMembers: patchable ? patchLocMembers : [],
  };
}

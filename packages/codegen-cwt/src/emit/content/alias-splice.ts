/**
 * Emits a *structural* CWT alias category as a named, self-referential block
 * interface.
 *
 * `solar_system_initializer` is the shape this exists for. Its entire planet
 * tree is declared as `alias_name[planet_initializer]`, spliced unkeyed at the
 * type's own top level, and `alias[planet_initializer:planet]` splices both
 * `planet_initializer` and `moon_initializer` back into itself. So the grammar
 * is mutually recursive and the nesting unbounded, and vanilla uses it: 2300
 * `planet` blocks and 664 `moon` blocks across the 360 shipped initializers,
 * nested three deep, anonymous and ordered.
 *
 * Two things make that expressible without a new runtime shape:
 *
 *  - the interfaces refer to each other by name, which TypeScript allows
 *    directly;
 *  - the *field tables* cannot, since a `const` cannot reference itself before
 *    it is initialised — so each category registers its table under its own name
 *    via `registerAliasStructFields`, and the writer resolves it at write time.
 *    That is the same indirection
 *    `packages/codegen-cwt/src/emit/content/alias-struct.ts` needs for
 *    `government_trigger`'s combinators, reused rather than reinvented.
 *
 * What is *not* shared with alias-struct.ts is the body: that module matches a
 * fixed template of three member shapes, where a structural category's members
 * are ordinary fields and want the ordinary projection. Hence this module runs the
 * same `field-projection.ts` loop `content-type.ts` runs, one level in.
 */

import type { DescentNode } from "../../corpus/observations.ts";
import { isOptional, type RuleField, type ScopeContext } from "../../cwt/model.ts";
import type { Emitter } from "../../emit/typescript.ts";
import type { EmittedField } from "../../lower/content-model.ts";
import { structuralSpliceOf } from "../../lower/rule-shapes.ts";
import { camelCase, capitalizedArticle, docComment } from "../../naming.ts";
import {
  CONTENT_DECLINED_FIELDS,
  CONTENT_FIELD_OVERRIDES,
  FIELD_WIDENINGS,
} from "../../overlay/index.ts";
import { constArray, member as renderMember } from "../../render/writer.ts";
import type { FieldContext } from "../scope-context.ts";
import {
  authoredLiterals,
  emittedMemberType,
  mergeByName,
  pickOrdinary,
  projectStructuralSplice,
  spliceTypeName,
  topLevelSplices,
  useWideningSymbols,
} from "./field-projection.ts";
import {
  omissionLine,
  type DocTable,
  type FieldOmissionRow,
  type MemberDocRow,
} from "./field-rows.ts";

/** Generated authoring code and coverage evidence for one structural alias splice. */
export interface AliasSpliceEmission {
  /** Complete generated module text for the category. */
  readonly code: string;
  /** Every name {@link AliasSpliceEmission.code} declares as an export. */
  readonly exportedNames: readonly string[];
  /** The block interface, e.g. `PlanetInitializerFields`. */
  readonly typeName: string;
  /** The block's runtime field table, e.g. `PLANET_INITIALIZER_FIELDS`. */
  readonly fieldsConstant: string;
  /** The key each block is written under in script, e.g. `planet`. */
  readonly memberKey: string;
  /** Categories this one splices in turn, which the driver must also emit. */
  readonly spliceCategories: readonly string[];
  /**
   * Fields projected inside the block, rooted at the *member key* rather than the
   * category — `planet.class`, `moon.size` — including those projected inside a
   * member's own block (`planet.count.min`).
   *
   * The rooting is what lets the corpus gate line these up with the real files.
   * One table serves every depth, so a `class` written inside a third-level
   * moon is the same emitted field as one written inside a first-level planet,
   * and the corpus reader aggregates the same way.
   */
  readonly emittedFields: readonly EmittedField[];
  /**
   * How the corpus reader reaches those interiors, from the same projections —
   * the splice's counterpart to `ContentEmission.corpusDescents`. Their `field`
   * is the member's own key, since the reader roots them at the member key it
   * is already walking under.
   */
  readonly corpusDescents: readonly DescentNode[];
  /** Refused outright by CONTENT_DECLINED_FIELDS, each with its reason. */
  readonly declinedFields: readonly string[];
  /** Declared in the category but not expressible, each with its reason. */
  readonly unsupported: readonly string[];
  /** The declined and unsupported rows the two prose lists are printed from. */
  readonly omissions: readonly FieldOmissionRow[];
  /** Doc rows for the category's own table and every table nested inside it. */
  readonly docTables: readonly DocTable[];
}

interface AliasSpliceContext {
  readonly category: string;
  readonly memberKey: string;
  readonly typeName: string;
  readonly fieldsConstant: string;
  readonly fields: readonly RuleField[];
  readonly fieldContext: FieldContext;
}

interface AliasSpliceDraft {
  readonly members: string[];
  readonly fieldMetadata: string[];
  readonly declinedFields: FieldOmissionRow[];
  readonly unsupported: FieldOmissionRow[];
  readonly emittedFields: EmittedField[];
  readonly corpusDescents: DescentNode[];
  readonly extraCode: string[];
  /** Every name {@link AliasSpliceDraft.extraCode} exports. */
  readonly exportedNames: string[];
  readonly spliceCategories: string[];
  readonly memberDocs: Record<string, MemberDocRow>;
  readonly docTables: DocTable[];
}

/** Returns the unpinned scope context for an alias category shared by many registries. */
function aliasSpliceFieldContext(scope: ScopeContext | null): FieldContext {
  return {
    scope,
    unpinned: "ScopeName",
    unpinnedSymbol: "ScopeName",
  };
}

/** Returns the declaration details needed to emit one structural splice category. */
function aliasSpliceContextOf(emitter: Emitter, category: string): AliasSpliceContext | null {
  const splice = structuralSpliceOf(emitter.lowerer, category);
  if (splice === null || splice.declaration.type.kind !== "block") {
    return null;
  }
  return {
    category,
    memberKey: splice.memberKey,
    typeName: spliceTypeName(category),
    fieldsConstant: `${category.toUpperCase()}_FIELDS`,
    fields: splice.declaration.type.fields,
    fieldContext: aliasSpliceFieldContext(splice.declaration.scope),
  };
}

function emptyAliasSpliceDraft(): AliasSpliceDraft {
  return {
    members: [],
    fieldMetadata: [],
    declinedFields: [],
    unsupported: [],
    emittedFields: [],
    corpusDescents: [],
    extraCode: [],
    exportedNames: [],
    spliceCategories: [],
    memberDocs: {},
    docTables: [],
  };
}

/** Combines independently projected member groups in their emitted order. */
function combineAliasSpliceDrafts(...drafts: readonly AliasSpliceDraft[]): AliasSpliceDraft {
  return {
    members: drafts.flatMap((draft) => draft.members),
    fieldMetadata: drafts.flatMap((draft) => draft.fieldMetadata),
    declinedFields: drafts.flatMap((draft) => draft.declinedFields),
    unsupported: drafts.flatMap((draft) => draft.unsupported),
    emittedFields: drafts.flatMap((draft) => draft.emittedFields),
    corpusDescents: drafts.flatMap((draft) => draft.corpusDescents),
    extraCode: drafts.flatMap((draft) => draft.extraCode),
    exportedNames: drafts.flatMap((draft) => draft.exportedNames),
    spliceCategories: drafts.flatMap((draft) => draft.spliceCategories),
    memberDocs: Object.assign({}, ...drafts.map((draft) => draft.memberDocs)),
    docTables: drafts.flatMap((draft) => draft.docTables),
  };
}

function rootAtMemberKey(context: AliasSpliceContext, field: string): string {
  return `${context.memberKey}${field.slice(context.category.length)}`;
}

/** Projects the category's ordinary named fields and records their emitter effects. */
function projectNamedMembers(emitter: Emitter, context: AliasSpliceContext): AliasSpliceDraft {
  const draft = emptyAliasSpliceDraft();
  for (const [name, group] of mergeByName(context.fields, context.typeName)) {
    const fieldPath = `${context.category}.${name}`;
    const declined = CONTENT_DECLINED_FIELDS.get(fieldPath);
    if (declined !== undefined) {
      emitter.overlayAudit.applied("CONTENT_DECLINED_FIELDS", fieldPath);
      draft.declinedFields.push({ path: fieldPath, kind: "declined", reason: declined });
      continue;
    }
    const override = CONTENT_FIELD_OVERRIDES.get(fieldPath);
    if (override !== undefined) {
      emitter.overlayAudit.applied("CONTENT_FIELD_OVERRIDES", fieldPath);
    }
    const widening = FIELD_WIDENINGS.get(fieldPath);
    if (widening !== undefined) {
      emitter.overlayAudit.applied("FIELD_WIDENINGS", fieldPath);
      useWideningSymbols(emitter, widening);
    }
    const projection = pickOrdinary(
      emitter,
      group,
      name,
      context.fieldContext,
      override,
      widening?.extraType,
      fieldPath
    );
    if (projection === null) {
      draft.unsupported.push({
        path: fieldPath,
        kind: "unsupported",
        reason: "no declaration the emitter can lower",
      });
      continue;
    }
    const optional = group.every((field) => isOptional(field.cardinality));
    const docs = [...new Set(group.flatMap((field) => field.docs))];
    const member = camelCase(name);
    draft.members.push(
      renderMember({ name: member, type: emittedMemberType(projection), optional, docs })
    );
    draft.memberDocs[member] = {
      optional,
      docs,
      memberType: projection.memberType,
      ...authoredLiterals(projection.admits.literals),
    };
    draft.docTables.push(...(projection.docTables ?? []));
    draft.fieldMetadata.push(projection.metadata(member));
    if (projection.code !== undefined) {
      draft.extraCode.push(projection.code);
      draft.exportedNames.push(...(projection.exportedNames ?? []));
    }
    if (projection.unsupported !== undefined) {
      draft.unsupported.push(...projection.unsupported);
    }
    draft.emittedFields.push(
      { field: `${context.memberKey}.${name}`, ...projection.admits },
      ...(projection.nested ?? []).map((field) => ({
        ...field,
        field: rootAtMemberKey(context, field.field),
      }))
    );
    draft.corpusDescents.push(...(projection.descents ?? []));
  }
  return draft;
}

/** Projects the category's unkeyed structural splices after its ordinary fields. */
function projectNestedSplices(emitter: Emitter, context: AliasSpliceContext): AliasSpliceDraft {
  const draft = emptyAliasSpliceDraft();
  for (const nested of topLevelSplices(context.fields, context.typeName)) {
    const nestedCategory = nested.key.category;
    if (draft.spliceCategories.includes(nestedCategory)) {
      continue;
    }
    const projected = projectStructuralSplice(emitter, nestedCategory, nested.docs);
    if (projected === null) {
      draft.unsupported.push({
        path: `${context.category}.alias_name[${nestedCategory}]`,
        kind: "unsupported",
        reason: "spliced unkeyed; that category has no authoring member",
      });
      continue;
    }
    draft.members.push(
      renderMember({
        name: projected.member,
        type: projected.memberType,
        optional: true,
        docs: projected.docs,
      })
    );
    draft.memberDocs[projected.member] = {
      optional: true,
      docs: projected.docs,
      memberType: projected.memberType,
    };
    draft.fieldMetadata.push(projected.metadata);
    draft.emittedFields.push({
      field: `${context.memberKey}.${projected.key!}`,
      ...projected.admits!,
    });
    draft.spliceCategories.push(nestedCategory);
  }
  return draft;
}

/** Builds the generated source and coverage evidence from a completed splice draft. */
function aliasSpliceEmission(
  context: AliasSpliceContext,
  draft: AliasSpliceDraft,
  contentField: string,
  registerAliasStructFields: string
): AliasSpliceEmission {
  const code =
    draft.extraCode.join("") +
    docComment([
      `${capitalizedArticle(context.memberKey)} \`${context.memberKey}\` ` +
        "block, as the game's rules describe it.",
      "",
      "Anonymous and ordered: these are written as repeated sibling blocks, so",
      "the array's order is the order the game reads them in, and an entry has",
      "no id of its own.",
    ]) +
    `export interface ${context.typeName} {\n` +
    draft.members.join("") +
    "}\n\n" +
    constArray(
      context.fieldsConstant,
      contentField,
      draft.fieldMetadata.map((entry) => `  ${entry},\n`).join(""),
      [`How the writer lowers each member of {@link ${context.typeName}} to PDXScript.`]
    ) +
    `${registerAliasStructFields}(${JSON.stringify(context.category)}, ` +
    `${context.fieldsConstant});\n`;

  return {
    code,
    exportedNames: [...draft.exportedNames, context.typeName, context.fieldsConstant],
    typeName: context.typeName,
    fieldsConstant: context.fieldsConstant,
    memberKey: context.memberKey,
    spliceCategories: draft.spliceCategories,
    emittedFields: draft.emittedFields,
    corpusDescents: draft.corpusDescents,
    declinedFields: draft.declinedFields.map(omissionLine),
    unsupported: draft.unsupported.map(omissionLine),
    omissions: [...draft.declinedFields, ...draft.unsupported],
    docTables: [
      { constant: context.fieldsConstant, members: draft.memberDocs },
      ...draft.docTables,
    ],
  };
}

/**
 * Emits one structural alias category, or returns `null` when the category is
 * not structural — which the caller reports rather than working around. See
 * {@link structuralSpliceOf} for the invariant.
 */
export function emitAliasSplice(emitter: Emitter, category: string): AliasSpliceEmission | null {
  const context = aliasSpliceContextOf(emitter, category);
  if (context === null) {
    return null;
  }
  const draft = combineAliasSpliceDrafts(
    projectNamedMembers(emitter, context),
    projectNestedSplices(emitter, context)
  );
  return aliasSpliceEmission(
    context,
    draft,
    emitter.use("ContentField"),
    emitter.use("registerAliasStructFields")
  );
}

/**
 * The repeated-struct emission: a nested content-type emission for one
 * overlay-configured repeated-struct field, with its own keying decision,
 * localisation plan, and declined/unsupported loop.
 */

import type { DescentNode } from "../../corpus/observations.ts";
import type { RuleField } from "../../cwt/model.ts";
import {
  authoredLiterals,
  memberOptional,
  mergeByName,
  metadata,
  pickOrdinary,
  type EmittedField,
} from "../../lower/fields.ts";
import { wildcardBlockOf } from "../../lower/rule-shapes.ts";
import type { FieldContext } from "../../lower/scope-context.ts";
import { camelCase, constantCase } from "../../naming.ts";
import {
  CONTENT_DECLINED_FIELDS,
  REPEATED_STRUCT_FIELD_OVERRIDES,
  type RepeatedStructDefinition,
} from "../../overlay/index.ts";
import { Emitter } from "../../render/emitter.ts";
import type { DocTable, FieldOmissionRow, MemberDocRow } from "../../render/field-rows.ts";
import { constArray, member as renderMember } from "../../render/writer.ts";
import {
  localisationMembers,
  localisationMetadata,
  planLocalisation,
  syntheticIdentityLocalisation,
} from "./localisation.ts";

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
export function repeatedStructEmission(
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
  readonly declinedFields: readonly FieldOmissionRow[];
  /** Present in the struct's rules but not expressible, or a member-name collision. */
  readonly unsupported: readonly FieldOmissionRow[];
  /**
   * Fields successfully lowered, under dotted paths like `situation.stages.icon`
   * — including those lowered inside one of those (`…stages.chance.modifier`).
   */
  readonly emittedFields: readonly EmittedField[];
  /** How the corpus reader reaches the interiors of the entry's own block fields. */
  readonly children: readonly DescentNode[];
  readonly localisationAliases: readonly FieldOmissionRow[];
  /** Doc rows for the entry's own table and every table nested inside it. */
  readonly docTables: readonly DocTable[];
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
    localisationType === undefined ? null : planLocalisation(emitter, localisationType);
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
  const declinedFields: FieldOmissionRow[] = [];
  const unsupported: FieldOmissionRow[] = [];
  const emittedFields: EmittedField[] = [];
  const children: DescentNode[] = [];
  const extraCode: string[] = [];
  const memberDocs: Record<string, MemberDocRow> = {};
  const docTables: DocTable[] = [];

  // Everything the struct's rules declare is emitted, in the rules'
  // declaration order — the same loop shape the top level uses, one level
  // down. A nested field is absent only because the emitter cannot express
  // it or CONTENT_DECLINED_FIELDS refuses it outright.
  for (const [name, group] of grouped) {
    const fieldPath = `${ownerPath}.${name}`;
    const declined = CONTENT_DECLINED_FIELDS.get(fieldPath);
    if (declined !== undefined) {
      emitter.overlayAudit.applied("CONTENT_DECLINED_FIELDS", fieldPath);
      declinedFields.push({ path: fieldPath, kind: "declined", reason: declined });
      continue;
    }
    if (localisationMemberNames.has(camelCase(name))) {
      unsupported.push({
        path: fieldPath,
        kind: "unsupported",
        reason: `collides with the "${camelCase(name)}" localization slot`,
      });
      continue;
    }
    const repeatedStructOverride = REPEATED_STRUCT_FIELD_OVERRIDES.get(fieldPath);
    if (repeatedStructOverride !== undefined) {
      emitter.overlayAudit.applied("REPEATED_STRUCT_FIELD_OVERRIDES", fieldPath);
    }
    const lowering = pickOrdinary(
      emitter,
      group,
      name,
      ctx,
      repeatedStructOverride,
      undefined,
      fieldPath
    );
    if (lowering === null) {
      unsupported.push({
        path: fieldPath,
        kind: "unsupported",
        reason: "no declaration the emitter can lower",
      });
      continue;
    }
    const optional = memberOptional(group, repeatedStructOverride);
    const docLines = [
      ...new Set([...group.flatMap((field) => field.docs), ...(lowering.docs ?? [])]),
    ];
    members.push(
      renderMember({ name: camelCase(name), type: lowering.memberType, optional, docs: docLines })
    );
    memberDocs[camelCase(name)] = {
      optional,
      docs: docLines,
      memberType: lowering.memberType,
      ...authoredLiterals(lowering.admits.literals),
    };
    docTables.push(...(lowering.docTables ?? []));
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
    unsupported.push({
      path: ownerPath,
      kind: "unsupported",
      reason: `missing type[${config.localisationType}] localization`,
    });
  }
  const constantPrefix = constantCase(typeName);
  const fieldsConstant = `${constantPrefix}_FIELDS`;
  const localisationConstant = `${constantPrefix}_LOCALISATION`;
  const locMembers =
    localisationType === undefined
      ? ""
      : localisationMembers(emitter, localisationType, localisationPlan!);
  const locMetadata =
    localisationType === undefined
      ? "[]"
      : localisationMetadata(emitter, localisationType, localisationPlan!);
  const localisationAliases: readonly FieldOmissionRow[] = localisationPlan?.aliases ?? [];
  const code =
    extraCode.join("") +
    `export interface ${typeName}Fields {\n` +
    locMembers +
    members.join("") +
    "}\n\n" +
    constArray(
      fieldsConstant,
      emitter.use("ContentField"),
      fieldMetadata.map((entry) => `  ${entry},\n`).join("")
    ) +
    `export const ${localisationConstant}: readonly ${emitter.use("ContentLocalisation")}[] = ` +
    `${locMetadata};\n\n`;

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
    docTables: [{ constant: fieldsConstant, members: memberDocs }, ...docTables],
    keying,
    identityKey,
  };
}

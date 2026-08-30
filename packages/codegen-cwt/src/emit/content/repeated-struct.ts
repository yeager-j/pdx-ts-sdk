/**
 * The repeated-struct emission: a nested content-type emission for one
 * overlay-configured repeated-struct field, with its own keying decision,
 * localisation plan, and declined/unsupported loop.
 */

import type { DescentNode } from "../../corpus/observations.ts";
import type { RuleField } from "../../cwt/model.ts";
import type { ContentType } from "../../cwt/rules.ts";
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
import { CONTENT_DECLINED_FIELDS, type RepeatedStructDefinition } from "../../overlay/index.ts";
import { Emitter } from "../../render/emitter.ts";
import type { DocTable, FieldOmissionRow, MemberDocRow } from "../../render/field-rows.ts";
import { constArray, member as renderMember } from "../../render/writer.ts";
import {
  localisationMembers,
  localisationMetadata,
  planLocalisation,
  syntheticIdentityLocalisation,
  type LocalisationPlan,
} from "./localisation.ts";

/**
 * Generated code and coverage evidence for one overlay-configured repeated struct.
 * The content-type emitter adds its code and coverage rows to the owning registry's emission.
 */
export interface RepeatedStructEmission {
  /** Generated nested interface and runtime tables. */
  readonly code: string;
  /** Name of the nested runtime field table. */
  readonly fieldsConstant: string;
  /** Name of the nested localisation descriptor table. */
  readonly localisationConstant: string;
  /** Type used by the owning registry member. */
  readonly memberType: string;
  /** Runtime descriptor for the owning repeated-struct field. */
  readonly metadata: string;
  /** Fields refused by `CONTENT_DECLINED_FIELDS`. */
  readonly declinedFields: readonly FieldOmissionRow[];
  /** Declared fields that cannot be represented or collide with another member. */
  readonly unsupported: readonly FieldOmissionRow[];
  /** Successfully lowered fields, including nested field paths. */
  readonly emittedFields: readonly EmittedField[];
  /** Corpus-reader descents into the entry's block-valued fields. */
  readonly children: readonly DescentNode[];
  /** Localisation declarations collapsed onto a canonical slot. */
  readonly localisationAliases: readonly FieldOmissionRow[];
  /** Documentation for the entry's field table and nested tables. */
  readonly docTables: readonly DocTable[];
  /** Whether record keys are sibling identity fields or container keys. */
  readonly keying: "siblings" | "container";
  /** Body field carrying a sibling-keyed record's identity. */
  readonly identityKey: string | undefined;
}

type RepeatedStructLocalisation =
  | { readonly kind: "available"; readonly type: ContentType; readonly plan: LocalisationPlan }
  | { readonly kind: "missing"; readonly typeName: string };

interface RepeatedStructPlan {
  readonly typeName: string;
  readonly keying: "siblings" | "container";
  readonly identityKey: string | undefined;
  readonly groupedFields: ReadonlyMap<string, readonly RuleField[]>;
  readonly localisation: RepeatedStructLocalisation;
}

interface RepeatedStructMembers {
  readonly members: string[];
  readonly metadata: string[];
  readonly declinedFields: FieldOmissionRow[];
  readonly unsupported: FieldOmissionRow[];
  readonly emittedFields: EmittedField[];
  readonly children: DescentNode[];
  readonly extraCode: string[];
  readonly memberDocs: Record<string, MemberDocRow>;
  readonly docTables: DocTable[];
}

function repeatedStructLocalisation(
  emitter: Emitter,
  typeName: string,
  localisationTypeName: string | undefined,
  declaredType: ContentType | undefined
): RepeatedStructLocalisation {
  if (localisationTypeName === undefined) {
    const type = syntheticIdentityLocalisation(typeName);
    return { kind: "available", type, plan: planLocalisation(emitter, type) };
  }
  if (declaredType === undefined) {
    return { kind: "missing", typeName: localisationTypeName };
  }
  return {
    kind: "available",
    type: declaredType,
    plan: planLocalisation(emitter, declaredType),
  };
}

function planRepeatedStruct(
  emitter: Emitter,
  ownerField: RuleField,
  config: RepeatedStructDefinition
): RepeatedStructPlan | null {
  if (ownerField.type.kind !== "block") {
    return null;
  }
  const container = wildcardBlockOf(ownerField.type);
  const keying = container === null ? "siblings" : "container";
  const declaredType =
    config.localisationType === undefined
      ? undefined
      : emitter.rules.contentTypes.get(config.localisationType);
  const identityKey = declaredType?.nameField ?? config.identityKey;
  if (keying === "siblings" && identityKey === undefined) {
    return null;
  }
  const groupedFields = mergeByName((container ?? ownerField.type).fields, config.typeName);
  if (identityKey !== undefined) {
    groupedFields.delete(identityKey);
  }
  const localisation = repeatedStructLocalisation(
    emitter,
    config.typeName,
    config.localisationType,
    declaredType
  );

  return {
    typeName: config.typeName,
    keying,
    identityKey,
    groupedFields,
    localisation,
  };
}

function lowerRepeatedStructMembers(
  emitter: Emitter,
  plan: RepeatedStructPlan,
  ownerPath: string,
  ctx: FieldContext
): RepeatedStructMembers {
  const localisationMemberNames = new Set(
    (plan.localisation.kind === "available" ? plan.localisation.plan.entries : []).map((entry) =>
      camelCase(entry.key)
    )
  );
  const members: string[] = [];
  const metadata: string[] = [];
  const declinedFields: FieldOmissionRow[] = [];
  const unsupported: FieldOmissionRow[] = [];
  const emittedFields: EmittedField[] = [];
  const children: DescentNode[] = [];
  const extraCode: string[] = [];
  const memberDocs: Record<string, MemberDocRow> = {};
  const docTables: DocTable[] = [];

  for (const [name, group] of plan.groupedFields) {
    const fieldPath = `${ownerPath}.${name}`;
    const declined = CONTENT_DECLINED_FIELDS.get(fieldPath);
    if (declined !== undefined) {
      emitter.overlayAudit.applied("CONTENT_DECLINED_FIELDS", fieldPath);
      declinedFields.push({ path: fieldPath, kind: "declined", reason: declined });
      continue;
    }
    const member = camelCase(name);
    if (localisationMemberNames.has(member)) {
      unsupported.push({
        path: fieldPath,
        kind: "unsupported",
        reason: `collides with the "${member}" localization slot`,
      });
      continue;
    }
    const lowering = pickOrdinary(emitter, group, name, ctx, undefined, undefined, fieldPath);
    if (lowering === null) {
      unsupported.push({
        path: fieldPath,
        kind: "unsupported",
        reason: "no declaration the emitter can lower",
      });
      continue;
    }
    const optional = memberOptional(group, undefined);
    const docs = [...new Set([...group.flatMap((field) => field.docs), ...(lowering.docs ?? [])])];
    members.push(renderMember({ name: member, type: lowering.memberType, optional, docs }));
    memberDocs[member] = {
      optional,
      docs,
      memberType: lowering.memberType,
      ...authoredLiterals(lowering.admits.literals),
    };
    docTables.push(...(lowering.docTables ?? []));
    metadata.push(lowering.metadata);
    if (lowering.code !== undefined) {
      extraCode.push(lowering.code);
    }
    if (lowering.unsupported !== undefined) {
      unsupported.push(...lowering.unsupported);
    }
    emittedFields.push(
      { field: fieldPath, authoredPath: [member], ...lowering.admits },
      ...(lowering.nested ?? []).map((field) => ({
        ...field,
        authoredPath: [member, ...(field.authoredPath ?? [])],
      }))
    );
    children.push(...(lowering.descents ?? []));
  }

  return {
    members,
    metadata,
    declinedFields,
    unsupported,
    emittedFields,
    children,
    extraCode,
    memberDocs,
    docTables,
  };
}

function renderRepeatedStruct(
  emitter: Emitter,
  plan: RepeatedStructPlan,
  members: RepeatedStructMembers
): {
  readonly code: string;
  readonly fieldsConstant: string;
  readonly localisationConstant: string;
} {
  const constantPrefix = constantCase(plan.typeName);
  const fieldsConstant = `${constantPrefix}_FIELDS`;
  const localisationConstant = `${constantPrefix}_LOCALISATION`;
  const localisation =
    plan.localisation.kind === "missing"
      ? { members: "", metadata: "[]" }
      : {
          members: localisationMembers(emitter, plan.localisation.type, plan.localisation.plan),
          metadata: localisationMetadata(emitter, plan.localisation.type, plan.localisation.plan),
        };

  return {
    fieldsConstant,
    localisationConstant,
    code:
      members.extraCode.join("") +
      `export interface ${plan.typeName}Fields {\n` +
      localisation.members +
      members.members.join("") +
      "}\n\n" +
      constArray(
        fieldsConstant,
        emitter.use("ContentField"),
        members.metadata.map((entry) => `  ${entry},\n`).join("")
      ) +
      `export const ${localisationConstant}: readonly ${emitter.use("ContentLocalisation")}[] = ` +
      `${localisation.metadata};\n\n`,
  };
}

/**
 * Lowers one overlay-configured repeated struct into a record member, nested authoring types,
 * runtime metadata, and coverage evidence. Returns `null` when the declaration does not supply a
 * usable block or identity key.
 *
 * Each record key is the nested definition's logical name, not the owning definition id. Prefix
 * and duplicate validation therefore remain runtime checks on the nested keys.
 */
export function repeatedStructEmission(
  emitter: Emitter,
  ownerField: RuleField,
  ownerPath: string,
  config: RepeatedStructDefinition,
  ctx: FieldContext
): RepeatedStructEmission | null {
  const plan = planRepeatedStruct(emitter, ownerField, config);
  if (plan === null) {
    return null;
  }
  const members = lowerRepeatedStructMembers(emitter, plan, ownerPath, ctx);
  if (plan.localisation.kind === "missing") {
    members.unsupported.push({
      path: ownerPath,
      kind: "unsupported",
      reason: `missing type[${plan.localisation.typeName}] localization`,
    });
  }
  const rendered = renderRepeatedStruct(emitter, plan, members);
  const metadataValue = metadata(
    ownerField,
    ownerField.key.kind === "name" ? ownerField.key.name : "",
    "repeatedStruct",
    [
      `keying: ${JSON.stringify(plan.keying)}`,
      ...(plan.keying === "siblings" ? [`identityKey: ${JSON.stringify(plan.identityKey)}`] : []),
      `fields: ${rendered.fieldsConstant}`,
      `localisation: ${rendered.localisationConstant}`,
    ]
  );
  return {
    ...rendered,
    memberType: `Readonly<Record<string, ${plan.typeName}Fields>>`,
    metadata: metadataValue,
    declinedFields: members.declinedFields,
    unsupported: members.unsupported,
    emittedFields: members.emittedFields,
    children: members.children,
    localisationAliases:
      plan.localisation.kind === "available" ? plan.localisation.plan.aliases : [],
    docTables: [
      { constant: rendered.fieldsConstant, members: members.memberDocs },
      ...members.docTables,
    ],
    keying: plan.keying,
    identityKey: plan.identityKey,
  };
}

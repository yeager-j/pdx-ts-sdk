import {
  ALIAS_STRUCT_FIELD_OMISSIONS,
  aliasStructFieldsOf,
  CONTENT_FIELD_MEMBER_DOCS,
  CONTENT_FIELD_OMISSIONS,
  CONTENT_REGISTRIES,
  type ContentField,
  type ContentFieldOmission,
  type ContentLocalisation,
  type ContentMemberDoc,
} from "@pdx-ts/sdk/content-registries";

/**
 * A registry's field tables, derived rather than written down — and the gate
 * that keeps them derived.
 *
 * The structure comes from the SDK's runtime descriptors: the same
 * `<REGISTRY>_FIELDS` tables the writer dispatches on, walked here by
 * reference, nested tables and alias categories included. The human-readable
 * half — doc prose, required/optional, the member type intellisense shows —
 * comes from the generated field-docs ledger, joined by table identity. The
 * join is total: a descriptor table or member the ledger does not know throws,
 * which fails `astro build` the moment a reference page renders the table, so
 * the docs cannot silently fall behind the SDK.
 *
 * The omission rows are the same declined/unsupported/collapsed rows the
 * codegen report prints. They render, marked, instead of disappearing: an
 * author who finds a field missing should read that it is known, not conclude
 * the SDK is worse than it is.
 */

/** One rendered row: an authoring member of one field table. */
export interface FieldRow {
  /** The camelCase authoring member. */
  readonly member: string;
  /** The game's own key. Absent for members spliced without a key. */
  readonly key?: string;
  /** The emitted member type, exactly as the interface spells it. */
  readonly type: string;
  readonly optional: boolean;
  readonly docs: readonly string[];
  /** Every scalar the member admits, when the rules close the set. */
  readonly literals?: readonly string[];
  /** The registries a reference value must come from, when checked. */
  readonly refTypes?: readonly string[];
  /** The id of the sub-table describing this member's block, when it has one. */
  readonly subTable?: string;
}

/** One nested table: a struct's members, or an alias category's block. */
export interface FieldSubTable {
  /** Anchor id, unique within the page. */
  readonly id: string;
  /** The dotted path or category name the table was reached as. */
  readonly title: string;
  readonly rows: readonly FieldRow[];
  /** The nested identity's localisation slots, for repeated-struct entries. */
  readonly localisation?: readonly ContentLocalisation[];
}

export interface FieldTableModel {
  readonly registry: string;
  /** The registry's own top-level members. */
  readonly rows: readonly FieldRow[];
  /** Every nested table reached from the rows, parents before children. */
  readonly subTables: readonly FieldSubTable[];
  /** The registry's localisation slots. */
  readonly localisation: readonly ContentLocalisation[];
  /**
   * Declined, unsupported, and collapsed fields — the registry's own, plus
   * those of every alias category its tables reach.
   */
  readonly omissions: readonly ContentFieldOmission[];
}

function memberDocsOf(
  table: readonly ContentField[],
  reachedAs: string
): Readonly<Record<string, ContentMemberDoc>> {
  const docs = CONTENT_FIELD_MEMBER_DOCS.get(table);
  if (docs === undefined) {
    throw new Error(
      `No field docs for the table reached as "${reachedAs}". The field-docs ledger is emitted ` +
        `beside the descriptor tables, so a missing entry means the SDK's generated output is ` +
        `stale or the ledger emitter missed a shape — run \`npm run codegen\` and inspect.`
    );
  }
  return docs;
}

/** The nested table behind one field, when its shape carries one. */
function tableOf(
  field: ContentField
): { readonly table: readonly ContentField[]; readonly category?: string } | undefined {
  switch (field.shape) {
    case "struct":
    case "triggerStruct":
    case "structMap":
    case "repeatedStruct":
      return { table: field.fields };
    case "aliasStruct":
      return { table: aliasStructFieldsOf(field.category), category: field.category };
    case "dual": {
      for (const arm of field.arms) {
        const nested = tableOf(arm);
        if (nested !== undefined) {
          return nested;
        }
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function refTypesOf(field: ContentField): readonly string[] | undefined {
  if (field.shape === "dual") {
    const collected = [
      ...new Set(field.arms.flatMap((arm) => ("refTypes" in arm ? (arm.refTypes ?? []) : []))),
    ];
    return collected.length === 0 ? undefined : collected;
  }
  return "refTypes" in field ? field.refTypes : undefined;
}

/**
 * Builds the whole field-table model for one registry, throwing on any gap
 * between the descriptors and the ledger — the drift gate.
 */
export function buildFieldTable(registry: string): FieldTableModel {
  const descriptor = CONTENT_REGISTRIES.find((entry) => entry.type === registry);
  if (descriptor === undefined) {
    throw new Error(
      `No registry named "${registry}". Registry names are the ones in CONTENT_REGISTRIES.`
    );
  }

  const subTables: Array<{
    readonly id: string;
    readonly title: string;
    readonly rows: FieldRow[];
    readonly localisation?: readonly ContentLocalisation[];
  }> = [];
  const tableIds = new Map<readonly ContentField[], string>();
  const takenIds = new Set<string>();
  const omissions: ContentFieldOmission[] = [
    ...CONTENT_FIELD_OMISSIONS[descriptor.type as keyof typeof CONTENT_FIELD_OMISSIONS],
  ];
  const reachedCategories = new Set<string>();

  const rowOf = (
    field: ContentField,
    docs: Readonly<Record<string, ContentMemberDoc>>,
    reachedAs: string
  ): FieldRow => {
    const doc = docs[field.member];
    if (doc === undefined) {
      throw new Error(
        `No doc row for member "${field.member}" of the table reached as "${reachedAs}". The ` +
          `ledger is emitted beside the descriptors, so this is generated-output drift or a ` +
          `ledger-emitter gap — run \`npm run codegen\` and inspect.`
      );
    }
    const nested = tableOf(field);
    const refTypes = refTypesOf(field);
    return {
      member: field.member,
      ...("key" in field && field.key !== undefined ? { key: field.key } : {}),
      type: doc.memberType,
      optional: doc.optional,
      docs: doc.docs,
      ...(doc.literals === undefined ? {} : { literals: doc.literals }),
      ...(refTypes === undefined ? {} : { refTypes }),
      ...(nested === undefined
        ? {}
        : {
            subTable: walkTable(
              nested.table,
              nested.category ?? `${reachedAs}.${field.member}`,
              field.shape === "repeatedStruct" ? field.localisation : undefined
            ),
          }),
    };
  };

  const walkTable = (
    table: readonly ContentField[],
    reachedAs: string,
    localisation?: readonly ContentLocalisation[]
  ): string => {
    const existing = tableIds.get(table);
    if (existing !== undefined) {
      return existing;
    }
    let id = reachedAs;
    for (let ordinal = 2; takenIds.has(id); ordinal += 1) {
      id = `${reachedAs}-${ordinal}`;
    }
    takenIds.add(id);
    tableIds.set(table, id);
    const model: {
      id: string;
      title: string;
      rows: FieldRow[];
      localisation?: readonly ContentLocalisation[];
    } = {
      id,
      title: reachedAs,
      rows: [],
      ...(localisation === undefined || localisation.length === 0 ? {} : { localisation }),
    };
    subTables.push(model);
    const docs = memberDocsOf(table, reachedAs);
    for (const field of table) {
      model.rows.push(rowOf(field, docs, reachedAs));
    }
    return id;
  };

  // Alias categories carry their own omission rows (planet_initializer's
  // declined `change_orbit` belongs on the page of every registry that splices
  // planets), gathered once per category however many tables reach it.
  const collectCategory = (field: ContentField): void => {
    if (field.shape === "aliasStruct" && !reachedCategories.has(field.category)) {
      reachedCategories.add(field.category);
      omissions.push(...(ALIAS_STRUCT_FIELD_OMISSIONS[field.category] ?? []));
    }
    if (field.shape === "dual") {
      field.arms.forEach(collectCategory);
    }
  };
  const collectCategories = (
    table: readonly ContentField[],
    seen: Set<readonly ContentField[]>
  ): void => {
    if (seen.has(table)) {
      return;
    }
    seen.add(table);
    for (const field of table) {
      collectCategory(field);
      const nested = tableOf(field);
      if (nested !== undefined) {
        collectCategories(nested.table, seen);
      }
    }
  };

  const topDocs = memberDocsOf(descriptor.fields, registry);
  const rows = descriptor.fields.map((field) => rowOf(field, topDocs, registry));
  collectCategories(descriptor.fields, new Set());

  return {
    registry,
    rows,
    subTables,
    localisation: descriptor.localisation,
    omissions,
  };
}

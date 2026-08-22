/**
 * Emits the field-docs ledger: the human-readable half of every generated
 * field table, as importable data.
 *
 * The runtime descriptors (`<REGISTRY>_FIELDS` and the tables nested inside
 * them) carry what the writer needs and nothing more. What a reference page
 * needs beyond that — the doc prose that otherwise exists only as JSDoc, the
 * optionality that otherwise exists only as the interface's `?`, the member
 * type text intellisense shows — is emitted here, in the same codegen pass
 * from the same lowerings, so the two cannot drift.
 *
 * The map is keyed by the field-table arrays themselves rather than by paths:
 * a consumer walking a descriptor tree holds each nested table by reference
 * (`field.fields`, or `aliasStructFieldsOf(category)`), so identity lookup
 * makes the join total without any path arithmetic, and a table shared by
 * several members — an enum-keyed entry shape, a clause group — has exactly
 * one entry.
 *
 * The omission records are the report's declined/unsupported/collapsed rows,
 * per registry and per alias category, so a docs build can mark what the
 * authoring surface leaves out instead of letting a missing field read as an
 * accidental hole.
 */

import type { DocTable, FieldOmissionRow, MemberDocRow } from "../../render/field-rows.ts";

/** Field-table documentation imported from one generated registry or alias module. */
export interface FieldDocsModule {
  /** Generated-module specifier the tables are imported from, e.g. `./technology.ts`. */
  readonly module: string;
  /** Documentation rows for every field table exported by the module. */
  readonly docTables: readonly DocTable[];
}

function serializeDocRow(row: MemberDocRow): string {
  return (
    `{ optional: ${row.optional}, docs: ${JSON.stringify(row.docs)}, ` +
    `memberType: ${JSON.stringify(row.memberType)}` +
    (row.literals === undefined ? "" : `, literals: ${JSON.stringify(row.literals)}`) +
    " }"
  );
}

function serializeMembers(members: Readonly<Record<string, MemberDocRow>>): string {
  return (
    "{\n" +
    Object.entries(members)
      .map(([member, row]) => `    ${JSON.stringify(member)}: ${serializeDocRow(row)},\n`)
      .join("") +
    "  }"
  );
}

function serializeOmissions(rows: readonly FieldOmissionRow[]): string {
  return (
    "[\n" +
    rows
      .map(
        (row) =>
          `    { path: ${JSON.stringify(row.path)}, kind: ${JSON.stringify(row.kind)}, ` +
          `reason: ${JSON.stringify(row.reason)} },\n`
      )
      .join("") +
    "  ]"
  );
}

/**
 * Emits the importable field-docs ledger from registry and alias documentation rows.
 * Repeated table names within one module must agree, while cross-module collisions receive aliases.
 */
export function emitContentFieldDocs(
  modules: readonly FieldDocsModule[],
  registryOmissions: ReadonlyMap<string, readonly FieldOmissionRow[]>,
  aliasOmissions: ReadonlyMap<string, readonly FieldOmissionRow[]>
): string {
  // One entry per table constant. A constant collected twice from one module
  // (which no current shape produces) must agree with itself; two modules
  // sharing a constant name import under an alias, since the entries are
  // different tables that merely spell their names alike.
  const entries: Array<{ readonly binding: string; readonly table: DocTable }> = [];
  const imports = new Map<string, string[]>();
  const takenBindings = new Map<string, number>();
  for (const { module, docTables } of modules) {
    const seen = new Map<string, DocTable>();
    for (const table of docTables) {
      const earlier = seen.get(table.constant);
      if (earlier !== undefined) {
        if (JSON.stringify(earlier.members) !== JSON.stringify(table.members)) {
          throw new Error(
            `field-docs ledger: ${module} collected two disagreeing doc tables for ` +
              `${table.constant}`
          );
        }
        continue;
      }
      seen.set(table.constant, table);
      const count = takenBindings.get(table.constant) ?? 0;
      takenBindings.set(table.constant, count + 1);
      const binding = count === 0 ? table.constant : `${table.constant}_${count + 1}`;
      imports.set(module, [
        ...(imports.get(module) ?? []),
        binding === table.constant ? table.constant : `${table.constant} as ${binding}`,
      ]);
      entries.push({ binding, table });
    }
  }

  const importCode = [...imports]
    .map(([module, names]) => `import { ${names.join(", ")} } from ${JSON.stringify(module)};\n`)
    .join("");

  const interfaces =
    "/** One authoring member's documentation: the generated interface's JSDoc,\n" +
    " * optionality, and type, as data a docs build can render. */\n" +
    "export interface ContentMemberDoc {\n" +
    "  /** False when the emitted interface requires the member. */\n" +
    "  readonly optional: boolean;\n" +
    "  /** The member's doc lines — the same text its JSDoc carries. */\n" +
    "  readonly docs: readonly string[];\n" +
    "  /** The emitted member type, exactly as the interface spells it. */\n" +
    "  readonly memberType: string;\n" +
    "  /** Every scalar the member admits, when the lowering closed the set. */\n" +
    "  readonly literals?: readonly string[];\n" +
    "}\n\n" +
    "/** A field the rules declare that the authoring surface leaves out. */\n" +
    "export interface ContentFieldOmission {\n" +
    "  /** The field's path, as the codegen report prints it. */\n" +
    "  readonly path: string;\n" +
    '  /** Why it is absent: refused by the overlay ("declined"), blocked on\n' +
    '   * emitter machinery ("unsupported"), or a localisation alias folded\n' +
    '   * onto another member ("collapsed"). */\n' +
    '  readonly kind: "declined" | "unsupported" | "collapsed";\n' +
    "  readonly reason: string;\n" +
    "}\n\n";

  const map =
    "/**\n" +
    " * Documentation for every generated field table, keyed by the table\n" +
    " * array itself — look a nested table up by the same reference the\n" +
    " * descriptor holds (`field.fields`, `aliasStructFieldsOf(category)`).\n" +
    " */\n" +
    "export const CONTENT_FIELD_MEMBER_DOCS: ReadonlyMap<\n" +
    "  readonly ContentField[],\n" +
    "  Readonly<Record<string, ContentMemberDoc>>\n" +
    "> = new Map<readonly ContentField[], Readonly<Record<string, ContentMemberDoc>>>([\n" +
    entries
      .map((entry) => `  [${entry.binding}, ${serializeMembers(entry.table.members)}],\n`)
      .join("") +
    "]);\n\n";

  const registryRecord =
    "/** Declined, unsupported, and collapsed fields per registry. */\n" +
    "export const CONTENT_FIELD_OMISSIONS: Readonly<\n" +
    "  Record<ContentTypeName, readonly ContentFieldOmission[]>\n" +
    "> = {\n" +
    [...registryOmissions]
      .map(([registry, rows]) => `  ${JSON.stringify(registry)}: ${serializeOmissions(rows)},\n`)
      .join("") +
    "};\n\n";

  const aliasRecord =
    "/** Declined and unsupported members per alias-struct category. */\n" +
    "export const ALIAS_STRUCT_FIELD_OMISSIONS: Readonly<\n" +
    "  Record<string, readonly ContentFieldOmission[]>\n" +
    "> = {\n" +
    [...aliasOmissions]
      .map(([category, rows]) => `  ${JSON.stringify(category)}: ${serializeOmissions(rows)},\n`)
      .join("") +
    "};\n";

  return (
    'import type { ContentField } from "../content/schema.ts";\n' +
    'import type { ContentTypeName } from "./content-registry.ts";\n' +
    importCode +
    "\n" +
    interfaces +
    map +
    registryRecord +
    aliasRecord
  );
}

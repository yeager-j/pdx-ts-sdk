/**
 * Shared render idioms for the emit layer.
 *
 * Every emitter under `emit/` builds the same two textual shapes over and
 * over: an interface member (doc comment, optional marker, type) and a
 * `export const NAME: readonly Type[] = [...]` field-table declaration. Before
 * this module existed, each emitter reimplemented both by hand, so a change
 * to either shape meant finding and updating every site by inspection.
 *
 * `naming.ts` still owns the casing and identifier-safety decisions
 * (`propertyName`, `docComment`); this module only assembles them into the
 * repeated shapes. Every helper here must reproduce its callers' EXACT prior
 * byte output — `codegen:check`'s drift gate is the enforcement, since this
 * module changes how generated text is produced, never what it says.
 */

import { docComment, propertyName } from "../naming.ts";
import type { TsValue } from "./types.ts";

export interface MemberOptions {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly docs: readonly string[];
  readonly indent?: string;
  readonly readonly?: boolean;
}

/**
 * One interface member: a doc comment followed by its declaration line.
 *
 * The doc comment and the line share one indent, which is what every call
 * site already did by hand — `docComment(docs, indent)` immediately followed
 * by a member line opening with the same `indent`.
 */
export function member(options: MemberOptions): string {
  const indent = options.indent ?? "  ";
  const readonlyPrefix = options.readonly === true ? "readonly " : "";
  const optionalMark = options.optional ? "?" : "";
  return (
    docComment(options.docs, indent) +
    `${indent}${readonlyPrefix}${propertyName(options.name)}${optionalMark}: ${options.type};\n`
  );
}

/**
 * One `export const NAME: readonly ElementType[] = [...]` field-table
 * declaration. `rows` is the pre-rendered body — typically
 * `entries.map((entry) => \`  ${entry},\n\`).join("")` — since the entry
 * shape (a `ContentField` object literal, a raw string) is a caller concern,
 * not this one.
 */
export function constArray(name: string, elementType: string, rows: string): string {
  return `export const ${name}: readonly ${elementType}[] = [\n${rows}];\n\n`;
}

/**
 * Whether every form a value admits is a `<type>` reference, as unadorned
 * `refTypes: [...]` metadata text — undefined when it is not, since an
 * id-shaped value alongside a non-reference arm proves nothing about any
 * registry. The one fact {@link refTypesSuffix} and {@link refTypesEntries}
 * format into two different shapes below.
 */
function refTypesEntry(value: TsValue | undefined): string | undefined {
  return value?.refTypes === undefined ? undefined : `refTypes: ${JSON.stringify(value.refTypes)}`;
}

/**
 * `, refTypes: [...]`, ready to splice directly after another metadata
 * member inside an already-open object literal — the shape `effects.ts`'
 * per-field metadata and `alias-struct.ts`'s clause fields both need.
 */
export function refTypesSuffix(value: TsValue | undefined): string {
  const entry = refTypesEntry(value);
  return entry === undefined ? "" : `, ${entry}`;
}

/**
 * `refTypes: [...]` as a bare metadata-array element (zero or one), for a
 * caller building its member list with `[...others, ...refTypesEntries(v)]`
 * rather than splicing into an object literal already holding other fields —
 * `fields.ts`'s `scalarMetadata` is the one caller, since it puts `refTypes`
 * beside its own `conversion` entry rather than after it in the same string.
 */
export function refTypesEntries(value: TsValue | undefined): readonly string[] {
  const entry = refTypesEntry(value);
  return entry === undefined ? [] : [entry];
}

/** Whether a scalar value's authored form already IS the id, or needs converting to reach it. */
export function conversionFor(value: TsValue): "identity" | "ref" {
  return value.toScalar("x") === "x" ? "identity" : "ref";
}

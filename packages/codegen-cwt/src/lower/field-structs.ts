/**
 * The struct machinery: every shape whose value is an anonymous block of named
 * members. `structShape` builds one block's interface and runtime field table,
 * recursing through `pickOrdinary` so nesting falls out of the ordinary
 * pipeline, and the `lowerStruct*` family differ only in how they find that
 * block and what they wrap the resulting type in.
 */

import type { DescentNode } from "../corpus/observations.ts";
import { isRepeated, type RuleField } from "../cwt/model.ts";
import { camelCase, constantCase, pascalCase } from "../naming.ts";
import { CONTENT_FIELD_OVERRIDES, FIELD_WIDENINGS } from "../overlay/index.ts";
import { Emitter } from "../render/emitter.ts";
import type { DocTable, FieldOmissionRow, MemberDocRow } from "../render/field-rows.ts";
import { constArray, member as renderMember } from "../render/writer.ts";
import { formOfShape } from "./authored-form.ts";
import {
  arrayType,
  authoredLiterals,
  memberOptional,
  metadata,
  repeatsSiblings,
} from "./field-metadata.ts";
import {
  mergeByName,
  pickOrdinary,
  useWideningSymbols,
  type EmittedField,
  type LoweredField,
} from "./fields.ts";
import {
  enumKeyedEntryOf,
  structBlockOf,
  triggerStructOf,
  wildcardBlockOf,
  type BlockType,
  type EnumKeyedEntry,
} from "./rule-shapes.ts";
import {
  containerContext,
  contravariantScopeType,
  scopeArg,
  withFrom,
  type FieldContext,
  type FieldScope,
} from "./scope-context.ts";

/**
 * Lowers an anonymous, identity-less block field: the fallback that
 * generalizes shape 3 ("repeated siblings with no id") down to whatever
 * cardinality CWT actually declares, so a singular fixed-shape block like
 * `forbidden_peace_offers` is just the N=0..1 case of the same mechanism.
 *
 * Recurses through the ordinary field pipeline for the struct's own members,
 * so a struct nested inside a struct (`agreement_preset.term_data.discrete_terms`
 * inside `term_data`) falls out for free rather than needing its own case.
 */
interface StructShape {
  readonly typeName: string;
  /** The name authors use, including an enclosing scope parameter where needed. */
  readonly memberType: string;
  readonly fieldsConstant: string;
  /** The interface and field-table declarations, for the caller to prepend. */
  readonly code: string;
  readonly unsupported: readonly FieldOmissionRow[];
  /** Doc rows for the struct's own table and every table nested inside it. */
  readonly docTables: readonly DocTable[];
  /** Each member's admits at `${path}.${name}`, plus whatever they nest in turn. */
  readonly nested: readonly EmittedField[];
  /** Descent nodes for the members that are themselves blocks worth walking. */
  readonly children: readonly DescentNode[];
}

/** The same interior, re-rooted under one of the keys that shares it. */
function reroot(fields: readonly EmittedField[], from: string, to: string): EmittedField[] {
  return fields.map((field) => ({ ...field, field: to + field.field.slice(from.length) }));
}

/**
 * Expands an enum-keyed block declaration into one authoring member per enum
 * value, all sharing a single entry interface.
 *
 * A `Record` keyed by the enum would be the obvious lowering and is the wrong
 * one: every other key in the SDK reaches its member in camelCase (`inherit_icon`
 * is `inheritIcon`), and a record's keys would be the game's spelling —
 * `diplo_action` beside `hidePrereqForDesc` in the same object literal. Naming
 * the members instead invents nothing, since every name comes from the enum, and
 * leaves the block's ordinary named siblings (`hide_prereq_for_desc`) exactly
 * where the rules put them rather than displacing them into a wrapper.
 *
 * One interface, not one per key: the rules declare one shape, and emitting six
 * structurally identical `…Ship`/`…Custom` interfaces would put that duplication
 * in the public API. The corpus reader still records each key's interior at its
 * own path, so the shared interior is {@link reroot}ed once per key.
 *
 * Every member is optional and each carries the declaration's own repetition:
 * `## cardinality = 0..4` bounds how many entries the block may hold in total,
 * not how often one key may be written, so it can neither require a key nor
 * cap one — and vanilla does write `custom` three times inside a single
 * `prereqfor_desc`.
 */
interface EnumKeyedMembers extends Pick<
  StructShape,
  "code" | "unsupported" | "nested" | "children" | "docTables"
> {
  /** One interface member per enum value, already indented and documented. */
  readonly members: readonly string[];
  readonly fieldMetadata: readonly string[];
  /** One doc row per enum value, for the owning block's own table. */
  readonly memberDocs: Readonly<Record<string, MemberDocRow>>;
}

function enumKeyedMembers(
  emitter: Emitter,
  keyed: EnumKeyedEntry,
  name: string,
  path: string,
  ctx: FieldContext
): EnumKeyedMembers | null {
  const entryPath = `${path}.entry`;
  const entry = structShape(
    emitter,
    keyed.block,
    name,
    entryPath,
    containerContext(keyed.declaration, ctx)
  );
  if (entry === null) {
    return null;
  }
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const nested: EmittedField[] = [];
  const children: DescentNode[] = [];
  const memberDocs: Record<string, MemberDocRow> = {};
  for (const value of keyed.values) {
    const memberPath = `${path}.${value}`;
    const field: RuleField = {
      ...keyed.declaration,
      key: { kind: "name", name: value },
      cardinality: { ...keyed.declaration.cardinality, min: 0 },
    };
    const repeated = repeatsSiblings(field, "struct");
    const memberType = repeated ? arrayType(entry.typeName) : entry.typeName;
    members.push(
      renderMember({
        name: camelCase(value),
        type: memberType,
        optional: true,
        docs: keyed.declaration.docs,
      })
    );
    memberDocs[camelCase(value)] = { optional: true, docs: keyed.declaration.docs, memberType };
    fieldMetadata.push(metadata(field, value, "struct", [`fields: ${entry.fieldsConstant}`]));
    nested.push(
      { field: memberPath, shape: "struct", repeated },
      ...reroot(entry.nested, entryPath, memberPath)
    );
    children.push({ field: value, mode: "struct", children: entry.children });
  }
  return {
    members,
    fieldMetadata,
    memberDocs,
    code: entry.code,
    unsupported: entry.unsupported,
    nested,
    children,
    docTables: entry.docTables,
  };
}

/**
 * Builds the interface and runtime field table for one anonymous block's named
 * members, recursing through the ordinary field pipeline so a struct nested
 * inside a struct falls out for free.
 *
 * Declines a block holding a splice (`alias_name`), subtype, or wildcard key:
 * those are invisible to `mergeByName`, so emitting only the ordinary fields
 * would silently drop the rest. The caller reports the path as unsupported. An
 * *enum*-keyed block is the one computed key that does not decline, because its
 * key set is closed and named — see {@link enumKeyedMembers}.
 *
 * Shared by every shape whose value is an anonymous block — `lowerStruct` and
 * `lowerStructMap` differ only in how they find that block and what they wrap
 * the resulting type in.
 */
function structShape(
  emitter: Emitter,
  block: BlockType,
  name: string,
  path: string,
  ctx: FieldContext,
  inlineTrigger?: FieldScope,
  typeNameOverride?: string
): StructShape | null {
  const keyed = enumKeyedEntryOf(emitter, block);
  const ordinary =
    keyed === null ? block.fields : block.fields.filter((inner) => inner !== keyed.declaration);
  if (ordinary.some((inner) => inner.key.kind !== "name")) {
    return null;
  }
  const grouped = mergeByName(ordinary, pascalCase(name));
  if (grouped.size === 0 && keyed === null) {
    return null;
  }
  const typeName = typeNameOverride ?? pascalCase(path);
  const members: string[] = [];
  const fieldMetadata: string[] = [];
  const extraCode: string[] = [];
  const unsupported: FieldOmissionRow[] = [];
  const nested: EmittedField[] = [];
  const children: DescentNode[] = [];
  const memberDocs: Record<string, MemberDocRow> = {};
  const docTables: DocTable[] = [];
  for (const [fieldName, group] of grouped) {
    const fieldPath = `${path}.${fieldName}`;
    const override = CONTENT_FIELD_OVERRIDES.get(fieldPath);
    if (override !== undefined) {
      emitter.overlayAudit.applied("CONTENT_FIELD_OVERRIDES", fieldPath);
    }
    const widening = FIELD_WIDENINGS.get(fieldPath);
    if (widening !== undefined) {
      emitter.overlayAudit.applied("FIELD_WIDENINGS", fieldPath);
      useWideningSymbols(emitter, widening);
    }
    const lowered = pickOrdinary(
      emitter,
      group,
      fieldName,
      ctx,
      override,
      widening?.extraType,
      fieldPath
    );
    if (lowered === null) {
      unsupported.push({
        path: fieldPath,
        kind: "unsupported",
        reason: "no declaration the emitter can lower",
      });
      continue;
    }
    const optional = memberOptional(group, override);
    const docLines = [
      ...new Set([...group.flatMap((inner) => inner.docs), ...(lowered.docs ?? [])]),
    ];
    members.push(
      renderMember({
        name: camelCase(fieldName),
        type: lowered.memberType,
        optional,
        docs: docLines,
      })
    );
    memberDocs[camelCase(fieldName)] = {
      optional,
      docs: docLines,
      memberType: lowered.memberType,
      ...authoredLiterals(lowered.admits.literals),
    };
    docTables.push(...(lowered.docTables ?? []));
    fieldMetadata.push(lowered.metadata);
    if (lowered.code !== undefined) {
      extraCode.push(lowered.code);
    }
    if (lowered.unsupported !== undefined) {
      unsupported.push(...lowered.unsupported);
    }
    const member = camelCase(fieldName);
    nested.push(
      { field: fieldPath, authoredPath: [member], ...lowered.admits },
      ...(lowered.nested ?? []).map((field) => ({
        ...field,
        authoredPath: [member, ...(field.authoredPath ?? [])],
      }))
    );
    children.push(...(lowered.descents ?? []));
  }
  if (keyed !== null) {
    // Two ways the expansion could collide with the block's own named fields,
    // both declining rather than emitting a duplicate: a sibling that is also
    // an enum value would author as one member holding two shapes, and a
    // sibling named `entry` would take the interface name the shared entry
    // shape claims. Neither occurs in the vendored rules; the point is that
    // hitting one reports the block instead of generating a broken file.
    const taken = new Set([...grouped.keys()].map(camelCase));
    const collides =
      grouped.has("entry") || keyed.values.some((value) => taken.has(camelCase(value)));
    const expanded = collides ? null : enumKeyedMembers(emitter, keyed, name, path, ctx);
    if (expanded === null) {
      return null;
    }
    members.push(...expanded.members);
    fieldMetadata.push(...expanded.fieldMetadata);
    Object.assign(memberDocs, expanded.memberDocs);
    extraCode.push(expanded.code);
    unsupported.push(...expanded.unsupported);
    nested.push(...expanded.nested);
    children.push(...expanded.children);
    docTables.push(...expanded.docTables);
  }
  if (inlineTrigger !== undefined) {
    const whenType = withFrom(
      emitter,
      `${emitter.use("Trigger")}<${scopeArg(emitter, inlineTrigger)}>`,
      inlineTrigger
    );
    members.push(`  when?: ${whenType};\n`);
    memberDocs.when = { optional: true, docs: [], memberType: whenType };
    fieldMetadata.push('{ member: "when", shape: "inlineTrigger" }');
    nested.push({
      field: `${path}.when`,
      shape: "trigger",
      repeated: false,
      clause: "trigger",
      scope: inlineTrigger.scopes,
    });
  }
  if (members.length === 0) {
    return null;
  }
  const fieldsConstant = `${constantCase(typeName)}_FIELDS`;
  const generic = inlineTrigger === undefined ? undefined : ctx.nestedTypeParameter;
  return {
    typeName,
    memberType: generic === undefined ? typeName : `${typeName}<${generic.argument}>`,
    fieldsConstant,
    nested,
    children,
    docTables: [{ constant: fieldsConstant, members: memberDocs }, ...docTables],
    code:
      extraCode.join("") +
      `export interface ${typeName}${generic?.declaration ?? ""} {\n` +
      members.join("") +
      "}\n\n" +
      constArray(
        fieldsConstant,
        emitter.use("ContentField"),
        fieldMetadata.map((entry) => `  ${entry},\n`).join("")
      ),
    unsupported,
  };
}

/**
 * Lowers a map whose keys are engine names rather than ids the mod invents:
 * `section_slots = { mid = { locator = ... } }`.
 *
 * The CWT shape is the wildcard-keyed block `repeatedStruct`'s "container"
 * keying also matches, and the rules carry nothing that tells them apart — so
 * this is requested by the overlay, never inferred. See the `structMap` doc
 * there for why the identity rules must not apply to these keys.
 */
export function lowerStructMap(
  emitter: Emitter,
  field: RuleField,
  name: string,
  path: string,
  ctx: FieldContext,
  typeNameOverride?: string
): LoweredField | null {
  const block = wildcardBlockOf(field.type);
  if (block === null) {
    return null;
  }
  const shape = structShape(
    emitter,
    block,
    name,
    path,
    containerContext(field, ctx),
    undefined,
    typeNameOverride
  );
  if (shape === null) {
    return null;
  }
  return {
    memberType: `Readonly<Record<string, ${shape.typeName}>>`,
    metadata: metadata(field, name, "structMap", [`fields: ${shape.fieldsConstant}`]),
    admits: { shape: "structMap", repeated: repeatsSiblings(field, "structMap") },
    code: shape.code,
    unsupported: shape.unsupported,
    docTables: shape.docTables,
    nested: shape.nested,
    // One field table serves every engine key, so the key itself never enters
    // the path the reader records — see `structMap` in {@link DescentNode}.
    descents: [{ field: name, mode: "structMap", children: shape.children }],
  };
}

/**
 * Lowers the scalar-valued form: `min_upgrade_cost = { <resource> = float }`.
 *
 * Keys stay `string` — `TypedRef` is a branded object and cannot type a
 * `Record` key, the same reason an economic block's `amounts` is
 * `Record<string, number>`.
 */
export function lowerScalarMap(
  emitter: Emitter,
  field: RuleField,
  name: string
): LoweredField | null {
  if (field.type.kind !== "block") {
    return null;
  }
  const values = field.type.fields.filter((inner) => inner.key.kind === "computed");
  if (values.length === 0 || values.length !== field.type.fields.length) {
    return null;
  }
  const value = emitter.unionFor(values.map((inner) => inner.type));
  if (value === null) {
    return null;
  }
  return {
    memberType: `Readonly<Record<string, ${emitter.useValue(value).type}>>`,
    metadata: metadata(field, name, "scalarMap"),
    admits: { shape: "scalarMap", repeated: repeatsSiblings(field, "scalarMap") },
  };
}

export function lowerStruct(
  emitter: Emitter,
  field: RuleField,
  name: string,
  path: string,
  ctx: FieldContext
): LoweredField | null {
  const located = structBlockOf(field.type);
  if (located === null) {
    return null;
  }
  const { block, wrapped } = located;
  const shape = structShape(emitter, block, name, path, containerContext(field, ctx));
  if (shape === null) {
    return null;
  }
  const { typeName, fieldsConstant, code, unsupported } = shape;
  // `wrapped` nests the repetition inside one key, so the key itself only
  // repeats when CWT's own cardinality says so — matching `admits.repeated`
  // below, which the form calculation must agree with.
  const structRepeated = isRepeated(field.cardinality);
  const repeated = wrapped || structRepeated;
  const metadataMembers = [
    `key: ${JSON.stringify(name)}`,
    `member: ${JSON.stringify(camelCase(name))}`,
    `shape: "struct"`,
    `form: ${JSON.stringify(formOfShape({ shape: "struct", repeated: structRepeated, wrapped }))}`,
    `fields: ${fieldsConstant}`,
    ...(wrapped ? ["wrapped: true"] : []),
    ...(repeated ? ["repeated: true"] : []),
  ];
  return {
    memberType: repeated ? arrayType(typeName) : typeName,
    metadata: `{ ${metadataMembers.join(", ")} }`,
    admits: { shape: "struct", repeated: structRepeated, ...(wrapped ? { wrapped } : {}) },
    wrapped,
    code,
    unsupported,
    docTables: shape.docTables,
    nested: shape.nested,
    // `wrapped` is exactly the reader's distinction too: the container holds
    // bare anonymous blocks rather than being one.
    descents: [
      { field: name, mode: wrapped ? "wrappedStruct" : "struct", children: shape.children },
    ],
  };
}

export function lowerTriggerStruct(
  emitter: Emitter,
  field: RuleField,
  name: string,
  path: string,
  ctx: FieldContext
): LoweredField | null {
  const located = triggerStructOf(field.type);
  if (located === null) {
    return null;
  }
  const container = containerContext(field, ctx);
  const triggerScope = contravariantScopeType(emitter, located.trigger, container);
  const shape = structShape(emitter, located.block, name, path, container, triggerScope);
  if (shape === null) {
    return null;
  }
  const repeated = isRepeated(field.cardinality);
  return {
    memberType: repeated ? arrayType(shape.memberType) : shape.memberType,
    metadata:
      `{ key: ${JSON.stringify(name)}, member: ${JSON.stringify(camelCase(name))}, ` +
      `shape: "triggerStruct", form: ${JSON.stringify(formOfShape({ shape: "triggerStruct", repeated }))}, ` +
      `fields: ${shape.fieldsConstant}${repeated ? ", repeated: true" : ""} }`,
    admits: { shape: "triggerStruct", repeated },
    code: shape.code,
    unsupported: shape.unsupported,
    docTables: shape.docTables,
    nested: shape.nested,
    descents: [
      {
        field: name,
        mode: "triggerStruct",
        ordinaryKeys: located.ordinaryKeys,
        children: shape.children,
      },
    ],
  };
}

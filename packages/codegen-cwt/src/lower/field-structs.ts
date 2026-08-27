/** Lowers CWT block fields into generated struct declarations and metadata. */

import type { DescentNode } from "../corpus/observations.ts";
import { isRepeated, type RuleField } from "../cwt/model.ts";
import { camelCase, constantCase, docComment, pascalCase } from "../naming.ts";
import {
  CONTENT_FIELD_DOCS,
  CONTENT_FIELD_OVERRIDES,
  FIELD_WIDENINGS,
  type ContentFieldOverride,
} from "../overlay/index.ts";
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

/** Re-roots nested field paths under the generated member that owns them. */
function rerootFields(
  fields: readonly EmittedField[],
  sourcePath: string,
  targetPath: string
): EmittedField[] {
  return fields.map((field) => ({
    ...field,
    field: targetPath + field.field.slice(sourcePath.length),
  }));
}

/** The generated members and evidence for one enum-keyed block declaration. */
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
    const member = camelCase(value);
    const field: RuleField = {
      ...keyed.declaration,
      key: { kind: "name", name: value },
      cardinality: { ...keyed.declaration.cardinality, min: 0 },
    };
    const repeated = repeatsSiblings(field, "struct");
    const memberType = repeated ? arrayType(entry.typeName) : entry.typeName;
    members.push(
      renderMember({
        name: member,
        type: memberType,
        optional: true,
        docs: keyed.declaration.docs,
      })
    );
    memberDocs[member] = { optional: true, docs: keyed.declaration.docs, memberType };
    fieldMetadata.push(metadata(field, value, "struct", [`fields: ${entry.fieldsConstant}`]));
    nested.push(
      { field: memberPath, shape: "struct", repeated },
      ...rerootFields(entry.nested, entryPath, memberPath)
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

/** The generated artifacts accumulated while lowering one struct block. */
interface StructDraft {
  readonly members: string[];
  readonly fieldMetadata: string[];
  readonly extraCode: string[];
  readonly unsupported: FieldOmissionRow[];
  readonly nested: EmittedField[];
  readonly children: DescentNode[];
  readonly memberDocs: Record<string, MemberDocRow>;
  readonly docTables: DocTable[];
}

function lowerNamedStructMembers(
  emitter: Emitter,
  grouped: ReadonlyMap<string, readonly RuleField[]>,
  path: string,
  ctx: FieldContext
): StructDraft {
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
    const member = camelCase(fieldName);
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
    const overlayDocs = CONTENT_FIELD_DOCS.get(fieldPath);
    if (overlayDocs !== undefined) {
      emitter.overlayAudit.applied("CONTENT_FIELD_DOCS", fieldPath);
    }
    const docs = [
      ...new Set([
        ...(overlayDocs ?? []),
        ...group.flatMap((field) => field.docs),
        ...(lowered.docs ?? []),
      ]),
    ];
    members.push(renderMember({ name: member, type: lowered.memberType, optional, docs }));
    memberDocs[member] = {
      optional,
      docs,
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
    nested.push(
      { field: fieldPath, authoredPath: [member], ...lowered.admits },
      ...(lowered.nested ?? []).map((field) => ({
        ...field,
        authoredPath: [member, ...(field.authoredPath ?? [])],
      }))
    );
    children.push(...(lowered.descents ?? []));
  }

  return {
    members,
    fieldMetadata,
    extraCode,
    unsupported,
    nested,
    children,
    memberDocs,
    docTables,
  };
}

/** Rejects enum-keyed declarations that would collide with an ordinary member or nested type. */
function enumKeysCollideWithMembers(
  grouped: ReadonlyMap<string, readonly RuleField[]>,
  keyed: EnumKeyedEntry
): boolean {
  const memberNames = new Set([...grouped.keys()].map(camelCase));
  return grouped.has("entry") || keyed.values.some((value) => memberNames.has(camelCase(value)));
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
/** Naming and extra members a caller adds to the block interface it asks for. */
interface StructShapeOptions {
  /** Replaces the name derived from the field path. */
  readonly typeName?: string;
  readonly typeDocs?: readonly string[];
  /**
   * Adds an optional display-text member for a block the game localises under
   * a key of its own rather than through a body field — an engine-keyed map
   * entry, shown under its map key. It carries no field metadata, because the
   * game reads no such key in the block.
   */
  readonly localisationMember?: string;
}

function structShape(
  emitter: Emitter,
  block: BlockType,
  name: string,
  path: string,
  ctx: FieldContext,
  inlineTrigger?: FieldScope,
  options: StructShapeOptions = {}
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
  const typeName = options.typeName ?? pascalCase(path);
  const draft = lowerNamedStructMembers(emitter, grouped, path, ctx);
  if (options.localisationMember !== undefined) {
    const textType = emitter.use("LocalizedText");
    const docs = ["Display text emitted to localization under this entry's own key."];
    draft.members.push(`${docComment(docs, "  ")}  ${options.localisationMember}?: ${textType};\n`);
    draft.memberDocs[options.localisationMember] = {
      optional: true,
      docs,
      memberType: textType,
    };
  }
  if (keyed !== null) {
    const expanded = enumKeysCollideWithMembers(grouped, keyed)
      ? null
      : enumKeyedMembers(emitter, keyed, name, path, ctx);
    if (expanded === null) {
      return null;
    }
    draft.members.push(...expanded.members);
    draft.fieldMetadata.push(...expanded.fieldMetadata);
    Object.assign(draft.memberDocs, expanded.memberDocs);
    draft.extraCode.push(expanded.code);
    draft.unsupported.push(...expanded.unsupported);
    draft.nested.push(...expanded.nested);
    draft.children.push(...expanded.children);
    draft.docTables.push(...expanded.docTables);
  }
  if (inlineTrigger !== undefined) {
    const whenType = withFrom(
      emitter,
      `${emitter.use("Trigger")}<${scopeArg(emitter, inlineTrigger)}>`,
      inlineTrigger
    );
    draft.members.push(`  when?: ${whenType};\n`);
    draft.memberDocs.when = { optional: true, docs: [], memberType: whenType };
    draft.fieldMetadata.push('{ member: "when", shape: "inlineTrigger" }');
    draft.nested.push({
      field: `${path}.when`,
      shape: "trigger",
      repeated: false,
      clause: "trigger",
      scope: inlineTrigger.scopes,
    });
  }
  if (draft.members.length === 0) {
    return null;
  }
  const fieldsConstant = `${constantCase(typeName)}_FIELDS`;
  const generic = inlineTrigger === undefined ? undefined : ctx.nestedTypeParameter;
  return {
    typeName,
    memberType: generic === undefined ? typeName : `${typeName}<${generic.argument}>`,
    fieldsConstant,
    nested: draft.nested,
    children: draft.children,
    docTables: [{ constant: fieldsConstant, members: draft.memberDocs }, ...draft.docTables],
    code:
      draft.extraCode.join("") +
      docComment(options.typeDocs ?? []) +
      `export interface ${typeName}${generic?.declaration ?? ""} {\n` +
      draft.members.join("") +
      "}\n\n" +
      constArray(
        fieldsConstant,
        emitter.use("ContentField"),
        draft.fieldMetadata.map((entry) => `  ${entry},\n`).join("")
      ),
    unsupported: draft.unsupported,
  };
}

/**
 * Lowers a wildcard-keyed block whose keys are engine-defined names.
 * Callers must select this shape explicitly because CWT cannot distinguish it from
 * an id-keyed repeated struct.
 */
export function lowerStructMap(
  emitter: Emitter,
  field: RuleField,
  name: string,
  path: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined
): LoweredField | null {
  const block = wildcardBlockOf(field.type);
  if (block === null) {
    return null;
  }
  // An entry the game shows under its own map key localises through that key
  // and nothing else, so its slot pattern is a bare `$`.
  const localisationMember = override?.mapKeyLocalisation === true ? "name" : undefined;
  const shape = structShape(emitter, block, name, path, containerContext(field, ctx), undefined, {
    typeName: override?.nestedTypeName,
    typeDocs: override?.nestedTypeDocs,
    localisationMember,
  });
  if (shape === null) {
    return null;
  }
  const localisation =
    localisationMember === undefined
      ? []
      : [
          `localisation: [{ member: ${JSON.stringify(localisationMember)}, ` +
            `pattern: "$", required: false }]`,
        ];
  return {
    memberType: `Readonly<Record<string, ${shape.typeName}>>`,
    metadata: metadata(field, name, "structMap", [
      `fields: ${shape.fieldsConstant}`,
      ...localisation,
    ]),
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
 * Lowers a block of computed keys and scalar values to a readonly record.
 * Keys remain strings because branded reference objects cannot be record keys.
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

/**
 * Lowers a fixed-shape anonymous block, including the wrapped anonymous-list
 * spelling. Returns `null` when the block contains structure this model cannot preserve.
 */
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

/**
 * Lowers a block that combines ordinary struct members with one trigger splice.
 * The generated interface exposes the splice as its optional `when` member.
 */
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

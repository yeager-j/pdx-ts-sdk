/**
 * Emits a CWT alias category as a named requirements interface.
 *
 * `government_trigger` is the shape this exists for. It looks like a trigger
 * category and is not one: the game reads it as a fixed list of empire
 * requirements, not as a script condition tree, so lowering it to `Trigger<S>`
 * would hand authors an API whose output the game silently ignores. Its members
 * come in exactly three shapes:
 *
 *  - a *domain clause* — `authority = { value = x OR = { text = t value = a
 *    value = b } }` — one uniform template shared by ten members, differing
 *    only in which content type the values reference. Two of the ten
 *    (`civics`, `## cardinality = 0..2`; `ethics`, `## cardinality = 0..3`)
 *    let the direct `value` key repeat, unlike the other eight's `0..1`, but
 *    the template stays singular for all ten: a real-install sweep of every
 *    shipped `civics =` / `ethics =` clause (SDK-45) found zero of 259 civics
 *    blocks and zero of 233 ethics blocks writing a second direct `value` —
 *    every multi-value clause in the corpus goes through `OR`/`NOT`/`NOR`
 *    instead, which `GovernmentTriggerClauseGroup` already models as a list.
 *    Widening `value` to an array for two of ten domains would cost every
 *    consumer a union-vs-array branch for a form nothing in the corpus uses;
 *    the singular field stays, and this note is the evidence trail if that
 *    ever needs revisiting;
 *  - a *scalar* — `host_has_dlc = enum[dlc]`, `is_nomadic = bool`;
 *  - a *combinator* — `OR`/`AND`/`limit`, each splicing the whole category back
 *    into itself, plus the block-level `text`/`always` fields that the
 *    consuming `potential`/`possible` blocks carry too. Each combinator is
 *    "repeat this key and the game ANDs the repeats" (55 vanilla `potential`/
 *    `possible` blocks write exactly one direct `OR`, zero write two — SDK-42),
 *    which an array member can misread as "any one of these" — exactly
 *    backwards, and exactly the reading a *domain clause*'s own `or` invites
 *    two members up (`GovernmentTriggerClauseGroup`, genuine disjunction). A
 *    combinator whose CWT key collides with a clause group key (`OR` is the
 *    one government_trigger has) is emitted as `<key>Groups` rather than
 *    `<key>` to keep that reading from crossing levels; see
 *    `combinatorMemberName`.
 *
 * The clause and its groups lower onto the runtime shapes that already exist
 * (`struct` plus repeated `value`). Only the combinators need the `aliasStruct`
 * shape, whose category-keyed lookup is what lets a field table refer to
 * itself.
 *
 * A member matching none of the three is declined by name, with its reason, and
 * the caller reports it — the emitter never drops a member quietly.
 */

import type { RuleField, RuleType } from "../cwt/model.ts";
import type { AliasDecl } from "../cwt/rules.ts";
import { camelCase, docComment, isPlainName, pascalCase } from "../naming.ts";
import { formOfShape } from "./authored-form.ts";
import { omissionLine, type DocTable, type FieldOmissionRow, type MemberDocRow } from "./fields.ts";
import type { Emitter, TsValue } from "./types.ts";

export interface AliasStructEmission {
  readonly code: string;
  /** The block interface, e.g. `GovernmentTriggerBlock`. */
  readonly typeName: string;
  /** The block's runtime field table, e.g. `GOVERNMENT_TRIGGER_FIELDS`. */
  readonly fieldsConstant: string;
  /** Category member names lowered onto the block, in declaration order. */
  readonly emittedMembers: readonly string[];
  /** Members matching no known shape, each with its reason. */
  readonly declinedMembers: readonly string[];
  /** The declined rows {@link declinedMembers} is printed from. */
  readonly omissions: readonly FieldOmissionRow[];
  /** Doc rows for the block's table and each clause member's table pair. */
  readonly docTables: readonly DocTable[];
}

/** The negation keys a domain clause repeats alongside `OR`. */
const GROUP_KEYS = new Set(["OR", "NOT", "NOR"]);

/**
 * CWT writes the combinators in caps (`OR`), and `camelCase` only lowercases a
 * name's first character — `camelCase("OR")` is `oR`. Folding first keeps
 * `OR`/`AND`/`NOR` reading as `or`/`and`/`nor`.
 */
function memberName(key: string): string {
  return camelCase(key.toLowerCase());
}

/**
 * The member name for a block-level combinator (`OR`/`AND`/`limit`, each
 * splicing the whole category back into itself as a list of sibling blocks
 * the game ANDs together).
 *
 * `GROUP_KEYS` (`OR`/`NOT`/`NOR`) are the *same* CWT keys a domain clause
 * uses for its own grouped operands (`GovernmentTriggerClauseGroup`, where
 * `or` really does mean disjunction). A combinator whose key collides with a
 * group key would emit a same-named member one level up with the opposite
 * meaning — `or: [a, b]` reading as "a OR b" when the game ANDs the two
 * blocks — so a colliding combinator gets a `Groups` suffix to keep the
 * repeated-block sense visible at the type. `AND`/`limit` (government_trigger's
 * other two combinators) name nothing a clause also uses, so they are left
 * alone: an array of AND-blocks or limit-blocks does not invite the same
 * misreading.
 */
function combinatorMemberName(key: string): string {
  return GROUP_KEYS.has(key) ? `${memberName(key)}Groups` : memberName(key);
}

function keyOf(field: RuleField): string | null {
  return field.key.kind === "name" ? field.key.name : null;
}

/** A block whose every field is an ordinary named key, else `null`. */
function namedFields(type: RuleType): readonly RuleField[] | null {
  if (type.kind !== "block" || type.bare.length > 0 || type.fields.length === 0) {
    return null;
  }
  return type.fields.every((field) => keyOf(field) !== null) ? type.fields : null;
}

interface ClauseShape {
  readonly kind: "clause";
  /** The content type every `value` in the clause references. */
  readonly ref: TsValue;
}

interface ScalarShape {
  readonly kind: "scalar";
  readonly value: TsValue;
}

interface CombinatorShape {
  readonly kind: "combinator";
  /** The block's own non-splice fields, e.g. `text` and `always`. */
  readonly fields: readonly RuleField[];
}

type MemberShape = ClauseShape | ScalarShape | CombinatorShape;

/**
 * Matches the uniform domain template: an optional `value`, plus repeatable
 * `OR`/`NOT`/`NOR` groups of `{ text? value+ }`. Every `value` in the member —
 * outer and nested — must reference the same content type, since one clause
 * type parameter has to serve them all.
 */
function clauseShape(emitter: Emitter, type: RuleType): ClauseShape | null {
  const fields = namedFields(type);
  if (fields === null) {
    return null;
  }
  const values: RuleType[] = [];
  let groups = 0;
  for (const field of fields) {
    const key = keyOf(field)!;
    if (key === "value") {
      values.push(field.type);
      continue;
    }
    if (!GROUP_KEYS.has(key)) {
      return null;
    }
    const inner = namedFields(field.type);
    if (inner === null) {
      return null;
    }
    for (const nested of inner) {
      const nestedKey = keyOf(nested)!;
      if (nestedKey === "value") {
        values.push(nested.type);
        continue;
      }
      if (nestedKey !== "text" || nested.type.kind !== "localisation") {
        return null;
      }
    }
    groups += 1;
  }
  if (groups === 0 || values.length === 0) {
    return null;
  }
  const referenced = new Set(values.map((value) => (value.kind === "typeRef" ? value.name : null)));
  if (referenced.size !== 1 || referenced.has(null)) {
    return null;
  }
  const ref = emitter.valueFor(values[0]!);
  return ref === null ? null : { kind: "clause", ref };
}

/** Matches a member that splices the whole category back into itself. */
function combinatorShape(type: RuleType, category: string): CombinatorShape | null {
  if (type.kind !== "block" || type.bare.length > 0) {
    return null;
  }
  const splices = type.fields.filter(
    (field) =>
      field.key.kind === "aliasName" &&
      field.key.category === category &&
      field.type.kind === "aliasMatchLeft" &&
      field.type.category === category
  );
  const rest = type.fields.filter((field) => !splices.includes(field));
  if (splices.length !== 1 || rest.some((field) => keyOf(field) === null)) {
    return null;
  }
  return { kind: "combinator", fields: rest };
}

function shapeOf(emitter: Emitter, type: RuleType, category: string): MemberShape | string {
  const combinator = combinatorShape(type, category);
  if (combinator !== null) {
    return combinator;
  }
  const clause = clauseShape(emitter, type);
  if (clause !== null) {
    return clause;
  }
  if (type.kind === "block") {
    return "a block matching neither the value/OR/NOT/NOR clause template nor a self-splice";
  }
  const value = emitter.valueFor(type);
  return value === null ? "a scalar type the emitter cannot express" : { kind: "scalar", value };
}

/**
 * Merges the non-splice fields the combinators declare — `text` and `always` —
 * into the block's own leading members. They belong to the block rather than to
 * any one combinator: the consuming `potential`/`possible` blocks declare the
 * same two beside their splice.
 */
function blockScalars(
  emitter: Emitter,
  combinators: readonly CombinatorShape[]
): Map<string, TsValue> | string {
  const grouped = new Map<string, RuleType[]>();
  for (const combinator of combinators) {
    for (const field of combinator.fields) {
      const key = keyOf(field)!;
      grouped.set(key, [...(grouped.get(key) ?? []), field.type]);
    }
  }
  const merged = new Map<string, TsValue>();
  for (const [key, types] of grouped) {
    const value = emitter.unionFor(types);
    if (value === null) {
      return `block-level field "${key}" has a type the emitter cannot express`;
    }
    merged.set(key, value);
  }
  return merged;
}

function conversionOf(value: TsValue): "identity" | "ref" {
  return value.toScalar("x") === "x" ? "identity" : "ref";
}

/**
 * `, refTypes: [...]` when every form the value admits is a `<type>`
 * reference, else `""` — the same convention `emit/fields.ts`'
 * `scalarMetadata` and `emit/effects.ts`' `refTypesMeta` use for ordinary
 * fields. Without this, a clause's `value` field records "this looks like a
 * reference" but never says to *what*, and `buildMod`'s dangling-reference
 * guard cannot resolve a target it was never told.
 */
function refTypesSuffix(value: TsValue): string {
  return value.refTypes === undefined ? "" : `, refTypes: ${JSON.stringify(value.refTypes)}`;
}

function valueField(key: string, value: TsValue): string {
  return (
    `  { key: ${JSON.stringify(key)}, member: ${JSON.stringify(memberName(key))}, ` +
    `shape: "value", form: ${JSON.stringify(formOfShape({ shape: "value" }))}, ` +
    `conversion: ${JSON.stringify(conversionOf(value))}${refTypesSuffix(value)} },\n`
  );
}

/**
 * One clause member's own field tables (group plus clause), keyed by its own
 * `ref` rather than a category-wide one. `authority`, `civics`, `origin` and
 * the rest of `government_trigger`'s domain clauses share one template but
 * each names a different `<type>` — `clauseShape` already tracks that per
 * member (it is what parameterizes `GovernmentTriggerClause<R>`), so the
 * runtime table has to be per member too, or every clause after the first one
 * `shapes` yields would silently carry someone else's `refTypes`.
 */
/**
 * The doc rows matching {@link clauseFieldsCode}'s two tables, with the
 * clause's own `R` substituted — the same prose the shared generic interfaces
 * carry as JSDoc, restated per member table so the ledger's join stays total.
 */
function clauseDocTables(
  ref: TsValue,
  clauseFieldsConstant: string,
  groupFieldsConstant: string,
  groupName: string
): readonly DocTable[] {
  const groupType = `readonly ${groupName}<${ref.type}>[]`;
  return [
    {
      constant: clauseFieldsConstant,
      members: {
        value: {
          optional: true,
          docs: ["The single value the requirement accepts."],
          memberType: ref.type,
        },
        or: {
          optional: true,
          docs: ["Groups where any operand satisfies the requirement."],
          memberType: groupType,
        },
        not: {
          optional: true,
          docs: ["Groups whose operands must not be present."],
          memberType: groupType,
        },
        nor: {
          optional: true,
          docs: ["Groups where no operand may be present."],
          memberType: groupType,
        },
      },
    },
    {
      constant: groupFieldsConstant,
      members: {
        text: {
          optional: true,
          docs: ["Localization key for the tooltip this group produces."],
          memberType: "string",
        },
        values: {
          optional: false,
          docs: ["The group's operands, emitted as repeated `value` keys."],
          memberType: `readonly ${ref.type}[]`,
        },
      },
    },
  ];
}

function clauseFieldsCode(
  ref: TsValue,
  clauseFieldsConstant: string,
  groupFieldsConstant: string
): string {
  const suffix = refTypesSuffix(ref);
  return (
    `export const ${groupFieldsConstant}: readonly ContentField[] = [\n` +
    `  { key: "text", member: "text", shape: "value", ` +
    `form: ${JSON.stringify(formOfShape({ shape: "value" }))}, conversion: "identity" },\n` +
    `  { key: "value", member: "values", shape: "value", ` +
    `form: ${JSON.stringify(formOfShape({ shape: "value", repeated: true }))}, ` +
    `conversion: ${JSON.stringify(conversionOf(ref))}${suffix}, repeated: true },\n` +
    "];\n\n" +
    `export const ${clauseFieldsConstant}: readonly ContentField[] = [\n` +
    `  { key: "value", member: "value", shape: "value", ` +
    `form: ${JSON.stringify(formOfShape({ shape: "value" }))}, ` +
    `conversion: ${JSON.stringify(conversionOf(ref))}${suffix} },\n` +
    [...GROUP_KEYS]
      .map(
        (key) =>
          `  { key: ${JSON.stringify(key)}, member: ${JSON.stringify(memberName(key))}, ` +
          `shape: "struct", form: ${JSON.stringify(formOfShape({ shape: "struct", repeated: true }))}, ` +
          `fields: ${groupFieldsConstant}, repeated: true },\n`
      )
      .join("") +
    "];\n\n"
  );
}

export function emitAliasStruct(
  emitter: Emitter,
  category: string,
  members: ReadonlyMap<string, readonly AliasDecl[]>
): AliasStructEmission {
  const typeName = `${pascalCase(category)}Block`;
  const clauseName = `${pascalCase(category)}Clause`;
  const groupName = `${clauseName}Group`;
  const constant = category.toUpperCase();
  const fieldsConstant = `${constant}_FIELDS`;

  const shapes = new Map<string, MemberShape>();
  const declinedMembers: FieldOmissionRow[] = [];
  const declined = (name: string, reason: string): void => {
    declinedMembers.push({ path: `${category}:${name}`, kind: "declined", reason });
  };
  for (const [name, declarations] of members) {
    if (!isPlainName(name.toLowerCase())) {
      declined(name, "not a plain name");
      continue;
    }
    if (declarations.length !== 1) {
      declined(
        name,
        `declared ${declarations.length} times, and the ` +
          "emitter has no rule for merging alias-struct members"
      );
      continue;
    }
    const shape = shapeOf(emitter, declarations[0]!.type, category);
    if (typeof shape === "string") {
      declined(name, shape);
      continue;
    }
    shapes.set(name, shape);
  }

  const combinators = [...shapes.values()].filter(
    (shape): shape is CombinatorShape => shape.kind === "combinator"
  );
  const scalars = blockScalars(emitter, combinators);
  if (typeof scalars === "string") {
    throw new Error(`alias category ${category}: ${scalars}`);
  }

  const blockMembers: string[] = [];
  const metadata: string[] = [];
  const emittedMembers: string[] = [];
  const memberDocs: Record<string, MemberDocRow> = {};
  // One field-table pair per clause member (SDK-37), keyed by that member's
  // own `ref` — `authority`, `civics`, `origin`, ... each name a different
  // `<type>`, so a category-wide pair would carry (at best) only the first
  // member's `refTypes` and leave the guard unable to resolve the rest.
  const clauseTables: string[] = [];
  const docTables: DocTable[] = [];
  for (const [key, value] of scalars) {
    blockMembers.push(`  ${memberName(key)}?: ${value.type};\n`);
    memberDocs[memberName(key)] = { optional: true, docs: [], memberType: value.type };
    metadata.push(valueField(key, value));
  }
  for (const [name, shape] of shapes) {
    if (scalars.has(name)) {
      declined(name, `collides with the block's own "${memberName(name)}" field`);
      continue;
    }
    const docLines = members.get(name)![0]!.docs;
    const docs = docComment(docLines, "  ");
    if (shape.kind === "scalar") {
      blockMembers.push(`${docs}  ${memberName(name)}?: ${shape.value.type};\n`);
      memberDocs[memberName(name)] = {
        optional: true,
        docs: docLines,
        memberType: shape.value.type,
      };
      metadata.push(valueField(name, shape.value));
    } else if (shape.kind === "clause") {
      const memberConstant = `${constant}_${name.toUpperCase()}`;
      const memberClauseFieldsConstant = `${memberConstant}_CLAUSE_FIELDS`;
      const memberGroupFieldsConstant = `${memberConstant}_CLAUSE_GROUP_FIELDS`;
      const memberType = `${clauseName}<${shape.ref.type}>`;
      blockMembers.push(`${docs}  ${memberName(name)}?: ${memberType};\n`);
      memberDocs[memberName(name)] = { optional: true, docs: docLines, memberType };
      metadata.push(
        `  { key: ${JSON.stringify(name)}, member: ${JSON.stringify(memberName(name))}, ` +
          `shape: "struct", form: ${JSON.stringify(formOfShape({ shape: "struct" }))}, ` +
          `fields: ${memberClauseFieldsConstant} },\n`
      );
      clauseTables.push(
        clauseFieldsCode(shape.ref, memberClauseFieldsConstant, memberGroupFieldsConstant)
      );
      docTables.push(
        ...clauseDocTables(
          shape.ref,
          memberClauseFieldsConstant,
          memberGroupFieldsConstant,
          groupName
        )
      );
    } else {
      const memberType = `readonly ${typeName}[]`;
      blockMembers.push(`${docs}  ${combinatorMemberName(name)}?: ${memberType};\n`);
      memberDocs[combinatorMemberName(name)] = { optional: true, docs: docLines, memberType };
      metadata.push(
        `  { key: ${JSON.stringify(name)}, member: ${JSON.stringify(combinatorMemberName(name))}, ` +
          `shape: "aliasStruct", form: ${JSON.stringify(formOfShape({ shape: "aliasStruct", repeated: true }))}, ` +
          `category: ${JSON.stringify(category)}, repeated: true },\n`
      );
    }
    emittedMembers.push(name);
  }

  const hasClauseMember = [...shapes.values()].some((shape) => shape.kind === "clause");
  // The clause and group interfaces stay generic and category-wide — only
  // their runtime field tables (above) need to be per member, since the
  // interfaces carry no `refTypes` of their own.
  const clauseInterfaces = !hasClauseMember
    ? ""
    : docComment([
        `One \`OR\`/\`NOT\`/\`NOR\` group inside a ${category} clause.`,
        "",
        "The game reads the repeated `value` keys as the group's operands and",
        "`text` as the tooltip shown when the group decides the outcome.",
      ]) +
      `export interface ${groupName}<R> {\n` +
      "  /** Localization key for the tooltip this group produces. */\n" +
      "  text?: string;\n" +
      "  /** The group's operands, emitted as repeated `value` keys. */\n" +
      "  values: readonly R[];\n" +
      "}\n\n" +
      docComment([
        `One requirement inside a ${category} block.`,
        "",
        "Every domain member of the category shares this template and differs",
        "only in which content type `R` references.",
      ]) +
      `export interface ${clauseName}<R> {\n` +
      "  /** The single value the requirement accepts. */\n" +
      "  value?: R;\n" +
      "  /** Groups where any operand satisfies the requirement. */\n" +
      `  or?: readonly ${groupName}<R>[];\n` +
      "  /** Groups whose operands must not be present. */\n" +
      `  not?: readonly ${groupName}<R>[];\n` +
      "  /** Groups where no operand may be present. */\n" +
      `  nor?: readonly ${groupName}<R>[];\n` +
      "}\n\n";

  const code =
    clauseInterfaces +
    clauseTables.join("") +
    docComment([
      `A \`${category}\` requirements block, as the game's rules describe it.`,
      "",
      "Not a script condition: the game evaluates these against an empire's",
      "static configuration, so only the members below are read.",
    ]) +
    `export interface ${typeName} {\n` +
    blockMembers.join("") +
    "}\n\n" +
    `export const ${fieldsConstant}: readonly ContentField[] = [\n` +
    metadata.join("") +
    "];\n\n" +
    `registerAliasStructFields(${JSON.stringify(category)}, ${fieldsConstant});\n`;

  return {
    code,
    typeName,
    fieldsConstant,
    emittedMembers,
    declinedMembers: declinedMembers.map(omissionLine),
    omissions: declinedMembers,
    docTables: [{ constant: fieldsConstant, members: memberDocs }, ...docTables],
  };
}

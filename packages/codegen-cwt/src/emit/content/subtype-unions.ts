/**
 * Turns the subtype arms of one registry into a union of named interfaces, and
 * reports what the arms say that the types cannot.
 *
 * A `subtype[start]` arm in a type body declares fields that exist, or are
 * required, only for definitions the subtype covers. Read flat, every such
 * field is an optional member with a doc line, and a non-start technology
 * without a `cost` typechecks. Where a subtype's selector is one readable
 * field an author writes (`start_tech = yes`, a written `levels`), the
 * registry's fields type becomes a union instead: one named interface per
 * way the modelled subtypes can apply together, each extending the shared
 * base and spelling the arm members' requiredness as the rules declare it.
 * The arms are named interfaces rather than an intersection of two-member
 * unions because TypeScript distributes such an intersection into anonymous
 * object types, and a type inferred from a definition then spells every
 * nested type instead of naming the arm. Everything the model cannot state
 * stays flat and becomes a `collapsed` row wherever a required declaration
 * was read as optional.
 */

import { isOptional, type RuleField, type SubtypeCondition } from "../../cwt/model.ts";
import type { ContentSubtype, ContentType, SubtypeSelector } from "../../cwt/rules.ts";
import { docComment, pascalCase } from "../../naming.ts";
import type { ContentFieldOverride } from "../../overlay/index.ts";
import { member as renderMember } from "../../render/writer.ts";
import { conditionDocs, memberOptional } from "./field-metadata.ts";
import type { FieldOmissionRow } from "./field-rows.ts";

/** How one arm of a subtype union treats a member. */
export type ArmStatus = "required" | "optional" | "absent";

/** One authored body member the planner may claim out of the base interface. */
export interface ClaimableMember {
  /** The CWT key. */
  readonly name: string;
  /** The authoring member name. */
  readonly member: string;
  /** Every declaration grouped under the key, with its subtype provenance. */
  readonly group: readonly RuleField[];
  /** The type text written into the emitted interface. */
  readonly type: string;
  /** The type text the field-docs ledger records. */
  readonly memberType: string;
  /** The flat reading's doc lines, "Only when …" lines included. */
  readonly docs: readonly string[];
  readonly override: ContentFieldOverride | undefined;
}

/** One member of a union arm, ready to render. */
export interface UnionArmMember {
  readonly member: string;
  readonly type: string;
  readonly optional: boolean;
  readonly docs: readonly string[];
}

/**
 * One arm of the registry's fields union: the definitions for which exactly
 * these modelled subtypes apply. Rendered as a named interface extending the
 * base, with a matching `Def` interface carrying the id.
 */
export interface SubtypeArm {
  /** The exported fields interface, `TechnologyStartFields`. */
  readonly typeName: string;
  /** The exported definition interface, `TechnologyStartDef`. */
  readonly defTypeName: string;
  /** The modelled subtypes this arm selects, in declaration order. */
  readonly selected: readonly ContentSubtype[];
  /** The modelled subtypes this arm leaves unselected. */
  readonly unselected: readonly ContentSubtype[];
  /** Every claimed member, spelled for this arm. */
  readonly members: readonly UnionArmMember[];
}

/** How an unclaimed member renders in the base interface once the arms are known. */
export interface BaseMember {
  readonly optional: boolean;
  readonly docs: readonly string[];
}

/** The ledger's view of one claimed member: optional in some arm, with the arms' conditions in prose. */
export interface ClaimedMemberDocs {
  readonly optional: boolean;
  readonly docs: readonly string[];
}

/** Everything the union planner decides for one registry. */
export interface SubtypeUnionsPlan {
  /** The arms of the fields union, or none when no subtype is modelled. */
  readonly arms: readonly SubtypeArm[];
  /** The report line per modelled subtype: `start (\`start_tech = yes\`)`. */
  readonly modelled: readonly string[];
  /** Base rendering for every member no arm claims, keyed by member. */
  readonly base: ReadonlyMap<string, BaseMember>;
  /** Ledger rows for every claimed member, keyed by member. */
  readonly claimedDocs: ReadonlyMap<string, ClaimedMemberDocs>;
  /** Required arm declarations the flat reading authors optional. */
  readonly collapsed: readonly FieldOmissionRow[];
  /**
   * The `flatSubtypes` rows that kept a subtype flat which would otherwise
   * have been an arm: the rows the overlay audit may count as applied. A row
   * on a subtype no declaration sits under, or whose selector is unreadable
   * anyway, changes nothing and is stale.
   */
  readonly flatSubtypesApplied: readonly string[];
}

/** A subtype the planner can model, with its discriminant member resolved. */
interface ModelledSubtype {
  readonly subtype: ContentSubtype;
  readonly selector: SubtypeSelector;
  readonly discriminant: ClaimableMember;
}

function singleCondition(field: RuleField): SubtypeCondition | null {
  return field.conditions?.length === 1 ? field.conditions[0]! : null;
}

/**
 * How one declaration reads in the given arm of `subtype`. An unconditional
 * declaration reads as declared in both arms; one under `subtype[X]` only in
 * the selected arm and one under `subtype[!X]` only in the unselected arm. A
 * declaration under any other arm may apply whichever way this subtype goes,
 * so it reads as optional in both — a civic trait block is declared under
 * `subtype[civic]` and again under `subtype[origin]`, and neither arm may
 * forbid it.
 */
function armReading(
  field: RuleField,
  subtype: string,
  selected: boolean
): "declared" | "optional" | "absent" {
  const conditions = field.conditions ?? [];
  if (conditions.length === 0) {
    return "declared";
  }
  const condition = singleCondition(field);
  if (condition === null || condition.subtype !== subtype) {
    return "optional";
  }
  return condition.negated !== selected ? "declared" : "absent";
}

function armStatus(
  group: readonly RuleField[],
  subtype: string,
  selected: boolean,
  override: ContentFieldOverride | undefined
): ArmStatus {
  const readings = group.map((field) => armReading(field, subtype, selected));
  if (readings.every((reading) => reading === "absent")) {
    return "absent";
  }
  const required =
    override?.optional !== true &&
    group.some((field, index) => readings[index] === "declared" && !isOptional(field.cardinality));
  return required ? "required" : "optional";
}

/** The member's status in the selected and unselected arms of one subtype. */
export function armStatuses(
  group: readonly RuleField[],
  subtype: string,
  override: ContentFieldOverride | undefined
): { readonly selected: ArmStatus; readonly unselected: ArmStatus } {
  return {
    selected: armStatus(group, subtype, true, override),
    unselected: armStatus(group, subtype, false, override),
  };
}

/** The phrase the docs use for "the subtype applies", as an author reads it. */
function selectedPhrase(modelled: ModelledSubtype): string {
  const member = modelled.discriminant.member;
  switch (modelled.selector.kind) {
    case "flag":
      return modelled.selector.set ? `\`${member}: true\`` : `\`${member}\` is not \`true\``;
    case "present":
      return `\`${member}\` is set`;
    case "literal":
      return `\`${member}\` is \`${JSON.stringify(modelled.selector.token)}\``;
  }
}

/** How the rules spell the selector, for the union's own documentation. */
function selectorSpelling(selector: SubtypeSelector): string {
  switch (selector.kind) {
    case "flag":
      return selector.set ? `\`${selector.field} = yes\`` : `no \`${selector.field} = yes\``;
    case "present":
      return `a written \`${selector.field}\``;
    case "literal":
      return `\`${selector.field} = ${selector.token}\``;
  }
}

/** The doc sentences that state how the two arms differ for one member. */
function conditionSentences(
  statuses: { readonly selected: ArmStatus; readonly unselected: ArmStatus },
  phrase: string
): string[] {
  const { selected, unselected } = statuses;
  if (selected === "required" && unselected === "absent") {
    return [`Required when ${phrase}, and not allowed otherwise.`];
  }
  if (selected === "absent" && unselected === "required") {
    return [`Required unless ${phrase}, and not allowed when it is.`];
  }
  if (selected === "required") {
    return [`Required when ${phrase}.`];
  }
  if (unselected === "required") {
    return [`Required unless ${phrase}.`];
  }
  return selected === "absent" ? [`Not allowed when ${phrase}.`] : [`Only when ${phrase}.`];
}

/** The member's docs without the flat reading's lines for the modelled subtypes. */
function docsWithoutFlatConditions(
  claimable: ClaimableMember,
  modelled: readonly ModelledSubtype[]
): string[] {
  const modelledNames = new Set(modelled.map((entry) => entry.subtype.name));
  const flatLines = new Set(
    claimable.group.flatMap((field) => {
      const condition = singleCondition(field);
      return condition !== null && modelledNames.has(condition.subtype)
        ? conditionDocs({ ...field, conditions: [condition] })
        : [];
    })
  );
  return claimable.docs.filter((line) => !flatLines.has(line));
}

function discriminantArms(modelled: ModelledSubtype): {
  readonly selected: Omit<UnionArmMember, "docs">;
  readonly unselected: Omit<UnionArmMember, "docs">;
} {
  const { member, type } = modelled.discriminant;
  const selector = modelled.selector;
  const set = { member, type: "true", optional: false };
  const unset = { member, type: type === "boolean" ? "false" : "never", optional: true };
  if (selector.kind === "flag") {
    return selector.set
      ? { selected: set, unselected: unset }
      : { selected: unset, unselected: set };
  }
  const written = { member, type, optional: false };
  const absent = { member, type: "never", optional: true };
  if (selector.kind === "present") {
    return { selected: written, unselected: absent };
  }
  const token = JSON.stringify(selector.token);
  return {
    selected: { member, type: token, optional: false },
    unselected: { member, type: `Exclude<${type}, ${token}>`, optional: true },
  };
}

/**
 * Whether a subtype can be a union: its selector is a flag or a written field
 * that the registry authors as a scalar member. A literal selector's negation
 * is only sound over a closed literal union, so it stays flat.
 */
function modelledSubtypeOf(
  subtype: ContentSubtype,
  members: readonly ClaimableMember[]
): ModelledSubtype | { readonly reason: string } {
  const selector = subtype.selector;
  if (selector === null) {
    return { reason: "the subtype's body is not one readable field" };
  }
  if (selector.kind === "literal") {
    return { reason: "the subtype selects by a literal value, which the type does not state" };
  }
  const discriminant = members.find((entry) => entry.name === selector.field);
  if (discriminant === undefined) {
    return { reason: `its selector field \`${selector.field}\` is not an authored member` };
  }
  return { subtype, selector, discriminant };
}

/** Why one declaration's arm cannot be a union, or `null` when it can. */
function unmodelledReason(
  field: RuleField,
  modelled: ReadonlyMap<string, ModelledSubtype | { readonly reason: string }>,
  registryReason: string | null
): string | null {
  if (field.conditions === undefined || field.conditions.length === 0) {
    return null;
  }
  if (registryReason !== null) {
    return registryReason;
  }
  if (field.conditions.length > 1) {
    return "declared under nested subtype arms";
  }
  const verdict = modelled.get(field.conditions[0]!.subtype);
  if (verdict === undefined) {
    return "names no declared subtype";
  }
  return "reason" in verdict ? verdict.reason : null;
}

function collapsedRow(path: string, condition: SubtypeCondition, reason: string): FieldOmissionRow {
  const arm = `subtype[${condition.negated ? "!" : ""}${condition.subtype}]`;
  return {
    path,
    kind: "collapsed",
    reason: `required under ${arm}, authored optional: ${reason}`,
  };
}

/**
 * Collapse rows for a block read flat: one per declaration a subtype arm
 * requires, since the flat member is optional. `why` states what keeps the
 * level flat; paths are `<prefix>.<key>`.
 */
export function collapsedConditionRows(
  grouped: ReadonlyMap<string, readonly RuleField[]>,
  pathPrefix: string,
  why: string
): FieldOmissionRow[] {
  const rows: FieldOmissionRow[] = [];
  for (const [name, group] of grouped) {
    for (const field of group) {
      const condition = field.conditions?.[0];
      if (condition === undefined || isOptional(field.cardinality)) {
        continue;
      }
      rows.push(collapsedRow(`${pathPrefix}.${name}`, condition, why));
    }
  }
  return rows;
}

/** One modelled subtype's reading of a claimed member, in one arm. */
interface MemberReading {
  readonly type: string;
  readonly status: ArmStatus;
}

/** How a modelled subtype reads each claimed member when it is selected and when it is not. */
interface SubtypeReadings {
  readonly modelled: ModelledSubtype;
  readonly phrase: string;
  /** Keyed by member. A member absent here is not this subtype's concern. */
  readonly selected: ReadonlyMap<string, MemberReading>;
  readonly unselected: ReadonlyMap<string, MemberReading>;
  /** The condition sentences per member, shared by every arm. */
  readonly sentences: ReadonlyMap<string, readonly string[]>;
}

function readSubtype(entry: ModelledSubtype, members: readonly ClaimableMember[]): SubtypeReadings {
  const phrase = selectedPhrase(entry);
  const arms = discriminantArms(entry);
  const selected = new Map<string, MemberReading>();
  const unselected = new Map<string, MemberReading>();
  const sentences = new Map<string, readonly string[]>();
  for (const claimable of members) {
    if (claimable === entry.discriminant) {
      selected.set(claimable.member, {
        type: arms.selected.type,
        status: arms.selected.optional ? "optional" : "required",
      });
      unselected.set(claimable.member, {
        type: arms.unselected.type,
        status: arms.unselected.optional ? "optional" : "required",
      });
      continue;
    }
    const statuses = armStatuses(claimable.group, entry.subtype.name, claimable.override);
    if (statuses.selected === statuses.unselected) {
      continue;
    }
    sentences.set(claimable.member, conditionSentences(statuses, phrase));
    selected.set(claimable.member, { type: claimable.type, status: statuses.selected });
    unselected.set(claimable.member, { type: claimable.type, status: statuses.unselected });
  }
  return { modelled: entry, phrase, selected, unselected, sentences };
}

/**
 * Joins two subtypes' readings of one member. `never` beside anything else
 * is a contradiction only when the other side requires the member; a required
 * literal beside a different required literal is one too. Returns `null` for
 * a contradiction, which drops the arm.
 */
function joinReadings(left: MemberReading, right: MemberReading): MemberReading | null {
  const absentLeft = left.status === "absent" || left.type === "never";
  const absentRight = right.status === "absent" || right.type === "never";
  if (absentLeft && absentRight) {
    return { type: "never", status: "absent" };
  }
  if (absentLeft || absentRight) {
    const present = absentLeft ? right : left;
    return present.status === "required" ? null : { type: "never", status: "absent" };
  }
  if (left.type !== right.type) {
    if (left.status === "required" && right.status === "required") {
      return null;
    }
    // A required literal narrows an optional wider spelling of the same member.
    return left.status === "required" ? left : right;
  }
  return left.status === "required" || right.status === "required"
    ? { type: left.type, status: "required" }
    : { type: left.type, status: "optional" };
}

/**
 * Plans the subtype arms of one registry from its authored members.
 *
 * `registryReason`, when set, keeps every arm flat and names why in each
 * collapse row — a registry whose scope selector already parameterises its
 * fields has no room for a second discriminant. `flatSubtypes` does the same
 * per subtype, for the overlay's `FLAT_SUBTYPE_ARMS` rows.
 */
export function planSubtypeUnions(
  type: ContentType,
  members: readonly ClaimableMember[],
  registryReason: string | null,
  flatSubtypes: ReadonlyMap<string, string>
): SubtypeUnionsPlan {
  const verdicts = new Map(
    type.subtypes.map((subtype) => {
      const flatReason = registryReason ?? flatSubtypes.get(subtype.name);
      return [
        subtype.name,
        flatReason === undefined ? modelledSubtypeOf(subtype, members) : { reason: flatReason },
      ];
    })
  );
  // A subtype no top-level declaration sits under has nothing to split; an
  // arm of its discriminant alone would change the type and state nothing.
  const armed = new Set(
    members.flatMap((claimable) =>
      claimable.group.flatMap((field) => singleCondition(field)?.subtype ?? [])
    )
  );
  const modelled = [...verdicts.values()].filter(
    (verdict): verdict is ModelledSubtype =>
      !("reason" in verdict) && armed.has(verdict.subtype.name)
  );
  const flatSubtypesApplied = type.subtypes
    .filter(
      (subtype) =>
        flatSubtypes.has(subtype.name) &&
        armed.has(subtype.name) &&
        !("reason" in modelledSubtypeOf(subtype, members))
    )
    .map((subtype) => subtype.name);

  // A subtype's own selector field is what an author writes to select it, not
  // a contract the flat reading lost, so it never earns a row.
  const selectorFields = new Set(type.subtypes.flatMap((subtype) => subtype.selector?.field ?? []));
  const collapsed: FieldOmissionRow[] = [];
  for (const claimable of members) {
    if (selectorFields.has(claimable.name)) {
      continue;
    }
    for (const field of claimable.group) {
      const reason = unmodelledReason(field, verdicts, registryReason);
      if (reason === null || isOptional(field.cardinality)) {
        continue;
      }
      collapsed.push(collapsedRow(`${type.name}.${claimable.name}`, field.conditions![0]!, reason));
    }
  }

  const readings = modelled.map((entry) => readSubtype(entry, members));
  const claimed = new Set(readings.flatMap((reading) => [...reading.selected.keys()]));
  const docsOf = new Map(
    members.map((claimable) => [claimable.member, docsWithoutFlatConditions(claimable, modelled)])
  );
  const sentencesOf = (member: string): string[] =>
    readings.flatMap((reading) => reading.sentences.get(member) ?? []);
  const selectsDoc = (entry: ModelledSubtype): string =>
    `Selects the \`${entry.subtype.name}\` subtype (CWT \`subtype[${entry.subtype.name}]\`).`;

  const arms: SubtypeArm[] = [];
  const typeName = pascalCase(type.name);
  // Single-subtype arms first in declaration order, combinations after, and
  // the arm no subtype covers last.
  const masks = [...Array(1 << readings.length).keys()].slice(1);
  for (const mask of [...masks, 0]) {
    const selected = readings.filter((_, index) => (mask & (1 << index)) !== 0);
    const unselected = readings.filter((_, index) => (mask & (1 << index)) === 0);
    const armMembers: UnionArmMember[] = [];
    let contradiction = false;
    for (const claimable of members) {
      if (!claimed.has(claimable.member)) {
        continue;
      }
      let joined: MemberReading | null = null;
      for (const reading of readings) {
        const own = (selected.includes(reading) ? reading.selected : reading.unselected).get(
          claimable.member
        );
        if (own === undefined) {
          continue;
        }
        joined = joined === null ? own : joinReadings(joined, own);
        if (joined === null) {
          contradiction = true;
          break;
        }
      }
      if (contradiction) {
        break;
      }
      const docs = docsOf.get(claimable.member)!;
      const selectedBy = selected.find((reading) => reading.modelled.discriminant === claimable);
      armMembers.push(
        joined === null || joined.status === "absent"
          ? { member: claimable.member, type: "never", optional: true, docs }
          : {
              member: claimable.member,
              type: joined.type,
              optional: joined.status === "optional",
              docs:
                selectedBy === undefined
                  ? [...docs, ...sentencesOf(claimable.member)]
                  : [...docs, selectsDoc(selectedBy.modelled)],
            }
      );
    }
    if (contradiction) {
      continue;
    }
    const armName =
      selected.length === 0
        ? "Plain"
        : selected.map((reading) => pascalCase(reading.modelled.subtype.name)).join("");
    arms.push({
      typeName: `${typeName}${armName}Fields`,
      defTypeName: `${typeName}${armName}Def`,
      selected: selected.map((reading) => reading.modelled.subtype),
      unselected: unselected.map((reading) => reading.modelled.subtype),
      members: armMembers,
    });
  }

  const base = new Map<string, BaseMember>();
  const claimedDocs = new Map<string, ClaimedMemberDocs>();
  for (const claimable of members) {
    const docs = docsOf.get(claimable.member)!;
    if (!claimed.has(claimable.member)) {
      base.set(claimable.member, { optional: baseOptional(claimable, modelled), docs });
      continue;
    }
    const requiredEverywhere = arms.every((arm) =>
      arm.members.some((entry) => entry.member === claimable.member && !entry.optional)
    );
    const discriminantOf = modelled.find((entry) => entry.discriminant === claimable);
    claimedDocs.set(claimable.member, {
      optional: !requiredEverywhere,
      docs:
        discriminantOf === undefined
          ? [...docs, ...sentencesOf(claimable.member)]
          : [...docs, selectsDoc(discriminantOf)],
    });
  }
  return {
    arms: modelled.length === 0 ? [] : arms,
    modelled: modelled.map(
      (entry) => `${entry.subtype.name} (${selectorSpelling(entry.selector)})`
    ),
    base,
    claimedDocs,
    collapsed,
    flatSubtypesApplied,
  };
}

/**
 * Whether an unclaimed member is optional in the base interface. No arm
 * claimed it, so every modelled subtype's arms agree about it; it is required
 * exactly when some subtype's arms agree it is required. With no modelled
 * subtype at all this is the flat reading.
 */
function baseOptional(claimable: ClaimableMember, modelled: readonly ModelledSubtype[]): boolean {
  if (modelled.length === 0) {
    return memberOptional(claimable.group, claimable.override);
  }
  return !modelled.some(
    (entry) =>
      armStatuses(claimable.group, entry.subtype.name, claimable.override).selected === "required"
  );
}

/** The sentence an arm's documentation opens with: which subtypes it selects. */
function armDescription(arm: SubtypeArm, spoken: string): string[] {
  const selects = arm.selected.map(
    (subtype) =>
      `\`${subtype.name}\` (\`subtype[${subtype.name}]\`, selected by ${selectorSpelling(subtype.selector!)})`
  );
  const leaves = arm.unselected.map((subtype) => `\`${subtype.name}\``);
  const opening =
    selects.length === 0
      ? `${capitalise(spoken)} none of the subtypes ${leaves.join(", ")} covers.`
      : `${capitalise(spoken)} the subtype${selects.length === 1 ? "" : "s"} ${selects.join(" and ")} ` +
        (leaves.length === 0 ? "covers." : `covers, and ${leaves.join(", ")} does not.`);
  return [opening];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Renders one arm's fields interface. `spoken` is the registry as prose
 * ("a technology"); `generic` and `baseArguments` are the scope-parameter
 * surface the base interface takes, empty for an unparameterised registry.
 */
export function renderSubtypeArm(
  arm: SubtypeArm,
  spoken: string,
  baseName: string,
  generic: string,
  baseArguments: string
): string {
  return (
    docComment(armDescription(arm, spoken)) +
    `export interface ${arm.typeName}${generic} extends ${baseName}${baseArguments} {\n` +
    arm.members
      .map((entry) =>
        renderMember({
          name: entry.member,
          type: entry.type,
          optional: entry.optional,
          docs: entry.docs,
        })
      )
      .join("") +
    "}\n\n"
  );
}

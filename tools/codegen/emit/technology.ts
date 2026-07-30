/**
 * Emits the technology definition type.
 *
 * The rules model 25 fields. `Technology.toEntries()` can write nine of them,
 * so the rest are reported as modelled-but-unemitted: that list is the
 * technology vertical's remaining work, and it should stay visible rather than
 * disappearing into a filter.
 */

import { isOptional, isRepeated, type RuleField, type RuleType } from "../cwt/model.ts";
import type { ContentType } from "../cwt/rules.ts";
import { camelCase, docComment } from "../naming.ts";
import { FIELD_WIDENINGS, REQUIRED_LOCALISATION, TECHNOLOGY_EMITTED_FIELDS } from "../overlay.ts";
import { Emitter } from "./types.ts";

export interface TechnologyEmission {
  readonly code: string;
  readonly emittedFields: readonly string[];
  /** Modelled by the rules but not yet writable by the SDK's emitter. */
  readonly unemittedFields: readonly string[];
  readonly unsupported: readonly string[];
}

/**
 * A block holding bare references, such as `category = { <technology_category> }`.
 *
 * `prerequisites` also allows a nested `OR = { ... }`; the SDK models the flat
 * list only, and the alternative form is reported as unemitted.
 */
function bareRefsOf(type: RuleType): readonly RuleType[] | null {
  return type.kind === "block" && type.bare.length > 0 ? type.bare : null;
}

/** A block holding nothing but a trigger splice, such as `potential = { ... }`. */
function triggerScopeOf(emitter: Emitter, field: RuleField): string | null {
  if (field.type.kind !== "block") {
    return null;
  }
  const splices = field.type.fields.filter((inner) => inner.key.kind === "aliasName");
  if (splices.length === 0 || splices.length !== field.type.fields.length) {
    return null;
  }
  const declared = field.scope?.this;
  return declared === undefined || declared === null ? null : emitter.canonicalScope(declared);
}

function memberType(emitter: Emitter, field: RuleField): string | null {
  const scope = triggerScopeOf(emitter, field);
  if (scope !== null) {
    return `Trigger<${JSON.stringify(scope)}>`;
  }
  const bare = bareRefsOf(field.type);
  if (bare !== null) {
    const inner = emitter.unionFor(bare);
    return inner === null ? null : `(${inner.type})[]`;
  }
  const value = emitter.valueFor(field.type);
  if (value === null) {
    return null;
  }
  return isRepeated(field.cardinality) ? `(${value.type})[]` : value.type;
}

/**
 * Flattens `subtype[…]` blocks into the field list.
 *
 * A subtype-gated field exists only for technologies matching that subtype —
 * `cost` and `weight` live under `subtype[!repeatable]`, for instance. Modelling
 * that properly needs a discriminated union; for now they surface as ordinary
 * optional fields with the predicate recorded in their TSDoc.
 */
function flatten(fields: readonly RuleField[]): RuleField[] {
  return fields.flatMap((field) => {
    if (field.key.kind !== "subtype") {
      return [field];
    }
    if (field.type.kind !== "block") {
      return [];
    }
    const predicate = `${field.key.negated ? "not " : ""}\`${field.key.name}\``;
    return flatten(field.type.fields).map((inner) => ({
      ...inner,
      cardinality: { min: 0, max: inner.cardinality.max },
      docs: [...inner.docs, `Only for technologies that are ${predicate}.`],
    }));
  });
}

function mergeByName(fields: readonly RuleField[]): Map<string, RuleField[]> {
  const grouped = new Map<string, RuleField[]>();
  for (const field of flatten(fields)) {
    if (field.key.kind !== "name") {
      continue;
    }
    const existing = grouped.get(field.key.name);
    if (existing === undefined) {
      grouped.set(field.key.name, [field]);
      continue;
    }
    existing.push(field);
  }
  return grouped;
}

/**
 * Overloaded rule keys (`cost` is both a number and a modifier block) collapse
 * to whichever declaration the SDK can currently write.
 */
function pickDeclaration(emitter: Emitter, group: readonly RuleField[]): string | null {
  for (const field of group) {
    const type = memberType(emitter, field);
    if (type !== null) {
      return type;
    }
  }
  return null;
}

function localisationMembers(type: ContentType): string {
  return type.localisation
    .map((entry) => {
      const field = camelCase(entry.key);
      const required = entry.required || REQUIRED_LOCALISATION.has(`${type.name}.${field}`);
      const pattern = entry.pattern.replace("$", "<id>");
      return (
        docComment([`English text emitted to localization under \`${pattern}\`.`], "  ") +
        `  ${field}${required ? "" : "?"}: string;\n`
      );
    })
    .join("");
}

export function emitTechnology(
  emitter: Emitter,
  type: ContentType,
  fields: readonly RuleField[]
): TechnologyEmission {
  const grouped = mergeByName(fields);
  const emittedFields: string[] = [];
  const unsupported: string[] = [];
  const members: string[] = [];

  for (const name of TECHNOLOGY_EMITTED_FIELDS) {
    const group = grouped.get(name);
    if (group === undefined) {
      unsupported.push(`${name} (no such rule field)`);
      continue;
    }
    const base = pickDeclaration(emitter, group);
    if (base === null) {
      unsupported.push(`${name} (no declaration the emitter can type)`);
      continue;
    }
    const widening = FIELD_WIDENINGS.get(`${type.name}.${name}`);
    const memberName = camelCase(name);
    const optional = group.every((field) => isOptional(field.cardinality));
    members.push(
      docComment(
        group.flatMap((field) => field.docs),
        "  "
      ) +
        `  ${memberName}${optional ? "?" : ""}: ${base}${widening === undefined ? "" : ` | ${widening.extraType}`};\n`
    );
    emittedFields.push(name);
  }

  const unemitted = [...grouped.keys()].filter(
    (name) => !(TECHNOLOGY_EMITTED_FIELDS as readonly string[]).includes(name)
  );

  const code =
    docComment([
      "A technology, as the game's rules describe it.",
      "",
      `Generated from \`type[${type.name}]\` at \`${type.path}\`.`,
    ]) +
    "export interface TechnologyFields {\n" +
    localisationMembers(type) +
    members.join("") +
    "}\n";

  return { code, emittedFields, unemittedFields: unemitted.sort(), unsupported };
}

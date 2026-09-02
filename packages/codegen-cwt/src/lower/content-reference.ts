/**
 * Resolves the CWT reference brands shared by authored and vanilla registry ids.
 * Both generators use this module so one registry cannot receive conflicting brands.
 */

import type { RuleField, RuleType } from "../cwt/model.ts";
import type { ContentType, RuleSet } from "../cwt/rules.ts";
import { camelCase } from "../naming.ts";

/**
 * Every qualified `<type.subtype>` reference the rules write, as `type.subtype`:
 * in a body field, or as the selector of another type's subtype
 * (`subtype[contract] = { category = <mission_category.contract> }`).
 */
export function qualifiedSubtypeReferences(rules: RuleSet): ReadonlySet<string> {
  const found = new Set<string>();
  const visitType = (type: RuleType): void => {
    if (type.kind === "typeRef") {
      if (type.name.includes(".")) {
        found.add(type.name);
      }
      return;
    }
    if (type.kind === "block") {
      visitFields(type.fields);
      for (const bare of type.bare) {
        visitType(bare.type);
      }
    }
  };
  const visitFields = (fields: readonly RuleField[]): void => {
    for (const field of fields) {
      if (field.key.kind === "computed") {
        visitType(field.key.type);
      }
      visitType(field.type);
    }
  };
  for (const body of rules.bodies.values()) {
    visitFields(body.fields);
  }
  for (const type of rules.contentTypes.values()) {
    for (const subtype of type.subtypes) {
      if (subtype.selector?.kind === "reference") {
        found.add(subtype.selector.reference);
      }
    }
  }
  return found;
}

/**
 * Collects CWT type names that appear in qualified `<type.subtype>` references.
 * Pass the result to {@link referenceNameOf} when resolving registry reference brands.
 */
export function typesReferencedBySubtype(rules: RuleSet): ReadonlySet<string> {
  return new Set(
    [...qualifiedSubtypeReferences(rules)].map((reference) =>
      reference.slice(0, reference.indexOf("."))
    )
  );
}

/**
 * A subtype the rules reference qualified and that one authored flag selects:
 * a definition written with `field = yes` is a `<type.subtype>`, so the
 * capability returns the qualified reference for it and the item keeps the
 * flag's literal as the witness a consumer can read back.
 */
export interface SubtypeReferenceRefinement {
  /** The CWT type declaring the subtype. */
  readonly type: string;
  /** The subtype the reference names. */
  readonly subtype: string;
  /** The qualified reference, `mission_category.contract`. */
  readonly reference: string;
  /** The `bool` body field whose `yes` selects the subtype. */
  readonly field: string;
  /** The authoring member of {@link SubtypeReferenceRefinement.field}. */
  readonly member: string;
  /** Whether every definition must write the field. */
  readonly required: boolean;
}

const REFINEMENTS_BY_RULES = new WeakMap<
  RuleSet,
  ReadonlyMap<string, SubtypeReferenceRefinement>
>();

/**
 * The refinement each CWT type earns from the rules alone, keyed by type name.
 *
 * A qualified reference to a subtype nobody can select by one flag stays
 * unrefined: the field then takes only a raw id, exactly as before. A type
 * with two selectable referenced subtypes fails here, because the capability
 * emits one qualified overload per registry and would otherwise pick silently.
 */
export function subtypeReferenceRefinements(
  rules: RuleSet
): ReadonlyMap<string, SubtypeReferenceRefinement> {
  const cached = REFINEMENTS_BY_RULES.get(rules);
  if (cached !== undefined) {
    return cached;
  }
  const refinements = new Map<string, SubtypeReferenceRefinement>();
  for (const reference of [...qualifiedSubtypeReferences(rules)].sort()) {
    const dot = reference.indexOf(".");
    const typeName = reference.slice(0, dot);
    const subtypeName = reference.slice(dot + 1);
    const type = rules.contentTypes.get(typeName);
    const selector = type?.subtypes.find((subtype) => subtype.name === subtypeName)?.selector;
    if (selector?.kind !== "flag" || !selector.set) {
      continue;
    }
    const field = rules.bodies
      .get(typeName)
      ?.fields.find(
        (candidate) => candidate.key.kind === "name" && candidate.key.name === selector.field
      );
    if (field?.type.kind !== "bool") {
      throw new Error(
        `<${reference}> is selected by \`${selector.field} = yes\`, but type[${typeName}] declares ` +
          `${selector.field} as ${field === undefined ? "no field" : field.type.kind} rather than bool, ` +
          "so the selecting literal has no boolean member to survive on"
      );
    }
    const existing = refinements.get(typeName);
    if (existing !== undefined) {
      throw new Error(
        `type[${typeName}] has two flag-selected subtypes the rules reference qualified ` +
          `(<${existing.reference}> and <${reference}>); the capability refines one per registry`
      );
    }
    refinements.set(typeName, {
      type: typeName,
      subtype: subtypeName,
      reference,
      field: selector.field,
      member: camelCase(selector.field),
      required: field.cardinality.min >= 1,
    });
  }
  REFINEMENTS_BY_RULES.set(rules, refinements);
  return refinements;
}

/**
 * Resolves the CWT reference brand for a registry and optional subtype narrowing.
 * It validates the subtype and qualifies the type name only when CWT references that
 * type by subtype.
 */
export function referenceNameOf(
  type: ContentType,
  subtype: string | undefined,
  subtypeReferencedTypes: ReadonlySet<string>
): string {
  if (subtype === undefined) {
    return type.name;
  }
  const declaredSubtype = type.subtypes.find((candidate) => candidate.name === subtype);
  if (declaredSubtype === undefined) {
    const declared = type.subtypes.map((candidate) => candidate.name).join(", ");
    throw new Error(
      `The manifest narrows type[${type.name}] to subtype "${subtype}", but that names no ` +
        `subtype of it, so the rules have no reference for the registry. Declared subtypes: ` +
        declared
    );
  }
  return subtypeReferencedTypes.has(type.name) ? `${type.name}.${declaredSubtype.name}` : type.name;
}

/**
 * Resolves the CWT reference brands shared by authored and vanilla registry ids.
 * Both generators use this module so one registry cannot receive conflicting brands.
 */

import type { RuleField, RuleType } from "../cwt/model.ts";
import type { ContentType, RuleSet } from "../cwt/rules.ts";

/**
 * Collects CWT type names that appear in qualified `<type.subtype>` references.
 * Pass the result to {@link referenceNameOf} when resolving registry reference brands.
 */
export function typesReferencedBySubtype(rules: RuleSet): ReadonlySet<string> {
  const found = new Set<string>();
  const visitType = (type: RuleType): void => {
    if (type.kind === "typeRef") {
      const dot = type.name.indexOf(".");
      if (dot > 0) {
        found.add(type.name.slice(0, dot));
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
  return found;
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

/**
 * The CWT reference a registry's definitions satisfy — what a field holding
 * `<component_template>` is actually asking for.
 *
 * Shared rather than private to the main codegen because two generators brand
 * the same definitions: `@pdx-ts/codegen-cwt` emits the `XRef` a defined item
 * wears, and `@pdx-ts/codegen-vanilla` emits the same `XRef` on every vanilla id
 * of that registry. Derived twice they went out of step the moment a registry
 * name stopped being its reference name — the spriteType trie asked for a
 * `SpriteTypeRef` the SDK never declared.
 */

import type { RuleField, RuleType } from "./cwt/model.ts";
import type { ContentType, RuleSet } from "./cwt/rules.ts";

/**
 * Every CWT type the rules reference by subtype somewhere — the type half of a
 * `<type.subtype>` spelling.
 *
 * Read by {@link referenceNameOf}. Collected from the type bodies rather than
 * tabulated, because the question is exactly "do the rules distinguish this
 * type's subtypes when they refer to it", and only the rules can answer it.
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
        visitType(bare);
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
 * The reference name for one registry, given the CWT subtype it narrows to.
 *
 * The type's own name answers this for every registry that is a whole CWT type.
 * A subtype narrowing need not: three registries share
 * `type[component_template]`, one per subtype, and the rules refer to that type
 * by subtype (`<component_template.utility_component_template>`,
 * `<component_template.planet_killer>`). Branding those with the SDK's own
 * registry name left a defined component template unable to reach any field
 * that references one — the name it carried was not a name the rules have.
 *
 * `type[sprite]` is the other case. It declares eight subtypes and the rules
 * never once spell one in a reference: every `<sprite>` field asks for the type
 * whole. Branding an authored sprite `sprite.normal` there would invent a
 * reference no field asks for, so the bare type name is the right answer, and
 * whether the rules distinguish subtypes of a type is what decides between the
 * two — not the presence of the narrowing.
 */
export function referenceNameOf(
  type: ContentType,
  subtype: string | undefined,
  subtypeReferencedTypes: ReadonlySet<string>
): string {
  if (subtype === undefined) {
    return type.name;
  }
  const self = type.subtypes.find((candidate) => candidate.name === subtype);
  if (self === undefined) {
    const declared = type.subtypes.map((candidate) => candidate.name).join(", ");
    throw new Error(
      `The manifest narrows type[${type.name}] to subtype "${subtype}", but that names no ` +
        `subtype of it, so the rules have no reference for the registry. Declared subtypes: ` +
        declared
    );
  }
  return subtypeReferencedTypes.has(type.name) ? `${type.name}.${self.name}` : type.name;
}

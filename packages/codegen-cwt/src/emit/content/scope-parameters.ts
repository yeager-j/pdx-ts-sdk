/**
 * The scope-parameter machinery of the content-type emitter: resolving a
 * registry's `CONTENT_SCOPE_PARAMETERS` overlay row against the rules, and
 * re-describing lowered fields and their contexts under the definition's own
 * scope parameter.
 */

import type { EmittedField } from "../../lower/fields.ts";
import type { FieldContext } from "../../lower/scope-context.ts";
import { pascalCase } from "../../naming.ts";
import { CONTENT_SCOPE_PARAMETERS, type ContentScopeParameter } from "../../overlay/index.ts";
import { Emitter } from "../../render/emitter.ts";

/** A {@link ContentScopeParameter.declaredFrom} row, resolved against the rules. */
export interface DeclaredFrom {
  /** Authoring member that declares the location scope without emitting a field. */
  readonly member: string;
  /** The emitted union of scopes the declaration may name. */
  readonly typeName: string;
  /** Canonical scopes admitted by the referenced CWT scope group. */
  readonly scopes: readonly string[];
  /** Definition members whose callbacks receive this scope as FROM. */
  readonly members: readonly string[];
  /** Effect whose argument supplies the declared location. */
  readonly effect: string;
}

/** Resolved scope-parameter policy for one generated content registry. */
export interface ScopeParameter {
  /** Name of the generated scope union. */
  readonly typeName: string;
  /** Canonical scopes the definition may declare. */
  readonly scopes: readonly string[];
  /** Scope used when the author omits the declaration. */
  readonly fallback: string;
  /** Generic parameter name used by the generated definition. */
  readonly parameterName: "S" | "E";
  /** Constraint applied to the generated scope parameter. */
  readonly parameterType: string;
  /** Default type argument for the generated scope parameter. */
  readonly parameterFallback: string;
  /** Optional discriminator that selects a definition's callback scope. */
  readonly selector?: NonNullable<ContentScopeParameter["selector"]>;
  /** Optional declaration tying callback FROM to a starting effect argument. */
  readonly declaredFrom?: DeclaredFrom;
}

/**
 * The declared-FROM parameter, with the admissible scopes read off the rules'
 * own scope group rather than restated in the overlay.
 *
 * The group the row names is checked against the one the starting effect's own
 * argument is declared with, so "cannot drift apart" is enforced rather than
 * asserted: a rules bump that retypes the argument fails codegen here instead
 * of emitting a declaration union and a hand-written overload that quietly
 * disagree with the generated signature beneath them.
 */
function declaredFromOf(
  emitter: Emitter,
  registry: string,
  row: NonNullable<ContentScopeParameter["declaredFrom"]>
): DeclaredFrom {
  const declared = effectArgumentScopeGroup(emitter, row.effect, row.argument);
  if (declared !== row.scopeGroup) {
    throw new Error(
      `Overlay declared FROM for ${registry} names scope group "${row.scopeGroup}", but ` +
        `${row.effect}.${row.argument} is declared ` +
        `${declared === null ? "with no scope group" : `"${declared}"`} — ` +
        "the declaration must be typed by the argument that supplies it"
    );
  }
  const members = emitter.rules.scopeGroups.get(row.scopeGroup);
  if (members === undefined) {
    throw new Error(
      `Overlay declared FROM for ${registry} names unknown scope group "${row.scopeGroup}"`
    );
  }
  const scopes = members.map((member) => {
    const scope = emitter.canonicalScope(member);
    if (scope === null) {
      throw new Error(
        `Scope group "${row.scopeGroup}" names unknown scope "${member}" for ${registry}`
      );
    }
    return scope;
  });
  return {
    member: row.member,
    typeName: `${pascalCase(registry)}${pascalCase(row.member)}`,
    scopes: [...new Set(scopes)].sort(),
    members: row.members,
    effect: row.effect,
  };
}

/** The scope parameter this registry declares, with its scopes canonicalised. */
export function scopeParameterOf(emitter: Emitter, registry: string): ScopeParameter | null {
  const row = CONTENT_SCOPE_PARAMETERS.get(registry);
  if (row === undefined) {
    return null;
  }
  // An unknown scope name fails codegen rather than degrading, the same rule
  // the `scope` assertion follows: silently widening on a typo would recreate
  // the unfillable field the row exists to fix.
  const canonical = (name: string): string => {
    const scope = emitter.canonicalScope(name);
    if (scope === null) {
      throw new Error(`Overlay scope parameter for ${registry} names unknown scope "${name}"`);
    }
    return scope;
  };
  const scopes = row.scopes.map(canonical);
  const fallback = canonical(row.fallback);
  if (!scopes.includes(fallback)) {
    throw new Error(`Overlay scope parameter for ${registry} defaults outside its own scope list`);
  }
  const selector = row.selector;
  if (selector !== undefined) {
    if (!Object.values(selector.scopes).every((scope) => scopes.includes(canonical(scope)))) {
      throw new Error(`Overlay scope selector for ${registry} maps outside its own scope list`);
    }
    return {
      typeName: `${pascalCase(registry)}Scope`,
      scopes,
      fallback,
      parameterName: "E",
      parameterType: selector.typeName,
      parameterFallback: selector.fallback,
      selector,
      ...(row.declaredFrom === undefined
        ? {}
        : { declaredFrom: declaredFromOf(emitter, registry, row.declaredFrom) }),
    };
  }
  return {
    typeName: `${pascalCase(registry)}Scope`,
    scopes,
    fallback,
    parameterName: "S",
    parameterType: `${pascalCase(registry)}Scope`,
    parameterFallback: fallback,
  };
}

/**
 * Re-describes an unpinned scope as the definition's parameter, for the corpus
 * gate. `"any"` and a parameter emit the same `NoInfer<S>`, but they are
 * opposite claims about fillability: one field admits only universal rules, the
 * other admits anything legal in a scope some definition can declare.
 */
export function underParameter(
  admits: Omit<EmittedField, "field">,
  parameter: ScopeParameter | null
): Omit<EmittedField, "field"> {
  if (parameter === null || admits.scope !== "any") {
    return admits;
  }
  return { ...admits, scope: { parameter: parameter.scopes } };
}

/**
 * The context one member of a selector-parameterised registry lowers against.
 *
 * `fieldContext.unpinned` carries the selected scope, so which member is being
 * lowered decides where that type lands: the member the selector scopes gets it
 * as its own scope — plus the declared FROM, where the registry has one — a
 * member the selector supplies as FROM gets it there and runs in the registry's
 * fallback scope instead, and everything else is the fallback with no FROM. A
 * registry with no selector lowers every member the same way and passes through
 * untouched.
 */
export function selectedContext(
  fieldContext: FieldContext,
  parameter: ScopeParameter | null,
  member: string
): FieldContext {
  const selector = parameter === null ? undefined : parameter.selector;
  if (parameter === null || selector === undefined) {
    return fieldContext;
  }
  const declaredFrom = parameter.declaredFrom;
  if (selector.scopedMembers.includes(member)) {
    return declaredFrom?.members.includes(member) === true
      ? { ...fieldContext, assertedFrom: "NoInfer<L>" }
      : fieldContext;
  }
  const fallback = JSON.stringify(parameter.fallback);
  return selector.fromMembers?.includes(member) === true
    ? { ...fieldContext, unpinned: fallback, assertedFrom: fieldContext.unpinned }
    : { ...fieldContext, unpinned: fallback };
}

/**
 * The `scope_group` one named argument of one effect is declared with, or
 * `null` where the effect, the argument, or a group on it is absent — each of
 * which is a reason for the caller to fail rather than a shape to work around.
 */
function effectArgumentScopeGroup(
  emitter: Emitter,
  effect: string,
  argument: string
): string | null {
  const declarations = emitter.rules.effects.get(effect) ?? [];
  for (const declaration of declarations) {
    if (declaration.type.kind !== "block") {
      continue;
    }
    for (const field of declaration.type.fields) {
      if (field.key.kind !== "name" || field.key.name !== argument) {
        continue;
      }
      if (field.type.kind === "scopeGroup") {
        return field.type.name;
      }
    }
  }
  return null;
}

/** `a`, `b` and `c` — a prose list of member names for a doc comment. */
export function listed(members: readonly string[]): string {
  const quoted = members.map((member) => `\`${member}\``);
  return quoted.length < 2
    ? (quoted[0] ?? "")
    : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

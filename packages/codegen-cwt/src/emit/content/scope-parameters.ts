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
import type { AmbientScopeKey } from "../../special-scope-paths.ts";

/** A {@link ContentScopeParameter.declaredFrom} row, resolved against the rules. */
export interface DeclaredFrom {
  /** Authoring member that declares the location scope without emitting a field. */
  readonly member: string;
  /** The emitted union of scopes the declaration may name. */
  readonly typeName: string;
  /** Canonical scopes admitted by the referenced CWT scope group. */
  readonly scopes: readonly string[];
  /** Definition members and ambient slots that receive this scope. */
  readonly members: Readonly<Record<string, AmbientScopeKey>>;
  /** Effect whose argument supplies the declared location. */
  readonly effect: string;
}

/** Resolved scope-parameter policy for one generated content registry. */
export interface ScopeParameter {
  /** Name of the generated scope union. */
  readonly typeName: string;
  /** Canonical scopes the definition may declare. */
  readonly scopes: readonly string[];
  /** Scope used when the author omits the declaration, or null when it is required. */
  readonly fallback: string | null;
  /** Generic parameter name used by the generated definition. */
  readonly parameterName: "S" | "E";
  /** Constraint applied to the generated scope parameter. */
  readonly parameterType: string;
  /** Rendered default type argument for the generated scope parameter. */
  readonly parameterDefault: string;
  /** Synthetic authoring member that declares the definition's scope. */
  readonly authoringMember: {
    /** Authoring member that names the definition's scope. */
    readonly member: string;
    /** Whether every authored definition must state the member. */
    readonly required: boolean;
    /** Whether the returned item carries the declaration beside its erased def. */
    readonly carriesWitness: boolean;
    /** Consumer-facing description of the declared scope. */
    readonly docs: readonly string[];
  } | null;
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
  const declared = effectArgumentScopeConstraint(emitter, row.effect, row.argument);
  if (declared !== "open" && declared !== row.scopeGroup) {
    throw new Error(
      `Overlay declared FROM for ${registry} names scope group "${row.scopeGroup}", but ` +
        `${row.effect}.${row.argument} is declared ` +
        `${declared === null ? "with no scope" : `"${declared}"`} — ` +
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
  const scopeNames =
    "effect" in row.scopes
      ? effectReceivingScopes(emitter, registry, row.scopes.effect)
      : row.scopes;
  const scopes = scopeNames.map(canonical);
  const authoringMember =
    row.authoringMember === undefined
      ? {
          member: "scope",
          required: false,
          carriesWitness: false,
          docs: [
            "The scope this definition's own clauses run in.",
            "",
            "Emits nothing — it names a fact the game already knows and the rules",
            "decline to state (`this = any`).",
          ],
        }
      : row.authoringMember;
  const fallback = row.fallback === undefined ? null : canonical(row.fallback);
  if (fallback === null && authoringMember?.required !== true) {
    throw new Error(
      `Overlay scope parameter for ${registry} has no fallback for an optional declaration`
    );
  }
  if (fallback !== null && !scopes.includes(fallback)) {
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
      parameterDefault: JSON.stringify(selector.fallback),
      authoringMember: null,
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
    parameterDefault: fallback === null ? `${pascalCase(registry)}Scope` : JSON.stringify(fallback),
    authoringMember,
    ...(row.declaredFrom === undefined
      ? {}
      : { declaredFrom: declaredFromOf(emitter, registry, row.declaredFrom) }),
  };
}

/** Receiving scopes of the effect that defines a declaration's supported universe. */
function effectReceivingScopes(emitter: Emitter, registry: string, effect: string): string[] {
  const declarations = emitter.rules.effects.get(effect);
  if (declarations === undefined) {
    throw new Error(`Overlay scope parameter for ${registry} names unknown effect "${effect}"`);
  }
  const scopes = declarations.flatMap((declaration) => declaration.supportedScopes ?? []);
  if (scopes.length === 0) {
    throw new Error(
      `Overlay scope parameter for ${registry} names effect "${effect}" with no scopes`
    );
  }
  return [...new Set(scopes)];
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
 * The context one member of a scope-parameterised registry lowers against.
 *
 * `fieldContext.unpinned` carries the selected scope, so which member is being
 * lowered decides where that type lands: the member the selector scopes gets it
 * as its own scope — plus the declared FROM, where the registry has one — a
 * member the selector supplies as FROM gets it there and runs in the registry's
 * fallback scope instead, and everything else is the fallback with no FROM. A
 * A declared location then fills the ambient slot that member maps to, with or
 * without a selector.
 */
export function selectedContext(
  fieldContext: FieldContext,
  parameter: ScopeParameter | null,
  member: string
): FieldContext {
  if (parameter === null) {
    return fieldContext;
  }
  const selector = parameter.selector;
  const declaredFrom = parameter.declaredFrom;
  let selected = fieldContext;
  if (selector !== undefined && selector.scopedMembers.includes(member)) {
    selected = fieldContext;
  } else if (selector?.fromMembers?.includes(member) === true) {
    selected = {
      ...fieldContext,
      unpinned: JSON.stringify(parameter.fallback),
      assertedAmbient: { ...fieldContext.assertedAmbient, from: fieldContext.unpinned },
    };
  } else if (selector !== undefined) {
    selected = { ...fieldContext, unpinned: JSON.stringify(parameter.fallback) };
  }
  const ambient = declaredFrom?.members[member];
  return ambient === undefined
    ? selected
    : {
        ...selected,
        assertedAmbient: { ...selected.assertedAmbient, [ambient]: "NoInfer<L>" },
      };
}

/**
 * The `scope_group` one named argument of one effect is declared with, or
 * `null` where the effect, the argument, or a group on it is absent — each of
 * which is a reason for the caller to fail rather than a shape to work around.
 */
function effectArgumentScopeConstraint(
  emitter: Emitter,
  effect: string,
  argument: string
): string | "open" | null {
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
      if (field.type.kind === "scope" && field.type.name === "any") {
        return "open";
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

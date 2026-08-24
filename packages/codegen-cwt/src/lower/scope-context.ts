/**
 * The scope a field's closures run in: what THIS/FROM/ROOT resolve to at one
 * point in a body's recursion, and the TypeScript scope argument or wrapper
 * that resolution becomes.
 *
 * `fields.ts` calls into this for every trigger, effect, weight, modifier, and
 * economic-operation shaped member it lowers. Nothing here knows how to lower
 * a *shape* into a member type — only how the ambient scope context a shape
 * sits in turns into the `S`/FROM/ROOT arguments that shape's generic type
 * takes, and how a container field's own annotation changes that context for
 * its children.
 */

import type { RuleField, ScopeContext } from "../cwt/model.ts";
import type { Emitter } from "../render/emitter.ts";
import { AMBIENT_SCOPE_KEYS, type AmbientScopeKey } from "../special-scope-paths.ts";

/**
 * Carries the ambient scope and fallback TypeScript types used while lowering a field.
 * Pass the context returned by {@link containerContext} when recursively lowering
 * a nested struct.
 */
export interface FieldContext {
  /** The effective CWT scope context at this point in nested lowering. */
  readonly scope: ScopeContext | null;
  /** The TypeScript scope used when no rule or overlay pins the field. */
  readonly unpinned: string;
  /**
   * The SDK symbol named by {@link FieldContext.unpinned}, when it is an import.
   * Omit this for enclosing-definition type parameters.
   */
  readonly unpinnedSymbol?: string;
  /**
   * An overlay-provided TypeScript type for FROM when CWT leaves it unstated.
   * This value takes precedence over the ambient rule context.
   */
  readonly assertedFrom?: string;
  /** The enclosing registry's authoring parameter, for nested typed blocks. */
  readonly nestedTypeParameter?: {
    /** The generic parameter declaration appended to the nested interface name. */
    readonly declaration: string;
    /** The generic argument used when referring to the nested interface. */
    readonly argument: string;
  };
}

/**
 * Resolved TypeScript and runtime scope facts for one lowered field.
 * Use these values when rendering generic arguments and conformance metadata.
 */
export interface FieldScope {
  /** The TS type parameter: one canonical scope literal, or the unpinned type. */
  readonly type: string;
  /** {@link FieldContext.unpinnedSymbol}, where {@link FieldScope.type} is it. */
  readonly unpinned?: string;
  /** The same thing as data, `"any"` where nothing pinned it. */
  readonly scopes: readonly string[] | "any";
  /**
   * The TypeScript literal scope held by FROM inside the block.
   * `null` keeps an undeclared or `any` FROM inaccessible to authors.
   */
  readonly from: string | null;
  /**
   * The TypeScript literal scope held by ROOT inside the block.
   * It is independent of the block's own scope and `null` when undeclared.
   */
  readonly root: string | null;
  /** Every named ambient slot, in the public map's canonical order. */
  readonly context: Readonly<Record<AmbientScopeKey, string | null>>;
}

/**
 * The scope FROM holds inside one field's block.
 *
 * A field's own `replace_scopes` states the whole context, so a FROM it leaves
 * out is cleared rather than inherited — unlike `this`, which every annotation
 * names. Only a `push_scope` (or no annotation at all) leaves the enclosing
 * definition's FROM standing.
 */
function fromType(emitter: Emitter, field: RuleField, ctx: FieldContext): string | null {
  return ambientType(emitter, field, ctx, "from");
}

/**
 * The scope ROOT holds inside one field's block, on {@link fromType}'s terms.
 *
 * Separate from the field's own scope rather than derived from it: a
 * `replace_scopes` names THIS and ROOT independently and the two often differ,
 * so ROOT is only ever what the rules say it is. Where they say nothing it
 * stays `null` — a `push_scope` never states ROOT, and neither does an
 * unannotated field, so inheriting or guessing one would put a scope on the
 * ref that nothing in the rules backs.
 */
function rootType(emitter: Emitter, field: RuleField, ctx: FieldContext): string | null {
  return ambientType(emitter, field, ctx, "root");
}

function ambientType(
  emitter: Emitter,
  field: RuleField,
  ctx: FieldContext,
  ambient: AmbientScopeKey
): string | null {
  const declared =
    field.scope?.replaces === true
      ? field.scope[ambient]
      : (field.scope?.[ambient] ?? ctx.scope?.[ambient]);
  if (declared === undefined || declared === null) {
    return null;
  }
  const canonical = emitter.canonicalScope(declared);
  return canonical === null ? null : JSON.stringify(canonical);
}

/**
 * Resolves the scope a field's closures run in, including FROM and ROOT.
 * An asserted scope overrides THIS and throws when the overlay names an unknown scope.
 */
export function scopeType(
  emitter: Emitter,
  field: RuleField,
  ctx: FieldContext,
  asserted?: string
): FieldScope {
  // An asserted FROM wins over the rules, on `ContentFieldOverride.scope`'s
  // terms: it is there because the rules state no FROM at all, and a rule that
  // later states one is a disagreement to review rather than to average.
  const context = Object.fromEntries(
    AMBIENT_SCOPE_KEYS.map((key) => [key, ambientType(emitter, field, ctx, key)])
  ) as Record<AmbientScopeKey, string | null>;
  context.from = ctx.assertedFrom ?? context.from;
  const from = context.from;
  const root = context.root;
  if (asserted !== undefined) {
    const canonical = emitter.canonicalScope(asserted);
    if (canonical === null) {
      throw new Error(`Overlay asserts unknown scope "${asserted}"`);
    }
    return { type: JSON.stringify(canonical), scopes: [canonical], from, root, context };
  }
  const unpinned: FieldScope = {
    type: ctx.unpinned,
    scopes: "any",
    from,
    root,
    context,
    ...(ctx.unpinnedSymbol === undefined ? {} : { unpinned: ctx.unpinnedSymbol }),
  };
  const declared = field.scope?.this ?? ctx.scope?.this;
  if (declared === undefined || declared === null) {
    return unpinned;
  }
  const canonical = emitter.canonicalScope(declared);
  return canonical === null
    ? unpinned
    : { type: JSON.stringify(canonical), scopes: [canonical], from, root, context };
}

/**
 * Renders `EffectBlock` generic arguments with the complete named ambient map.
 */
export function effectBlockArgs(emitter: Emitter, scope: FieldScope): string {
  return `${scopeArg(emitter, scope)}, ${contextLiteral(scope)}`;
}

function contextLiteral(scope: FieldScope): string {
  const members = AMBIENT_SCOPE_KEYS.flatMap((key) => {
    const value = scope.context[key];
    return value === null ? [] : [`readonly ${key}: ${value}`];
  });
  return members.length === 0 ? "{}" : `{ ${members.join("; ")} }`;
}

/**
 * Emits runtime metadata when a block's single THIS scope differs from ROOT.
 * Unpinned, multi-scope, and rootless blocks need no split-root marker.
 */
export function splitRootMetadata(scope: FieldScope): readonly string[] {
  if (scope.root === null || scope.scopes === "any" || scope.scopes.length !== 1) {
    return [];
  }
  return JSON.stringify(scope.scopes[0]) === scope.root ? [] : ["splitRoot: true"];
}

/**
 * Wraps a declarative member type in `WithFrom` when it exposes any ambient
 * scope. The historical name is retained for generated-emitter call sites.
 */
export function withFrom(emitter: Emitter, inner: string, scope: FieldScope): string {
  if (
    AMBIENT_SCOPE_KEYS.filter((key) => key !== "root").every((key) => scope.context[key] === null)
  ) {
    return inner;
  }
  return `${emitter.use("WithFrom")}<${inner}, ${scopeArg(emitter, scope)}, ${contextLiteral(scope)}>`;
}

/**
 * The `ScopeContext` a struct field's own children run in, given the field's
 * own annotation (if any) and whatever scope was already in force above it.
 *
 * `## replace_scope(s)` states the whole context, so `root`/`from` it leaves
 * out are cleared rather than inherited — `scopeOf` already returns them as
 * `null` in that case, which is what `replaces: true` here passes through
 * unchanged. `## push_scope` states only `this` (`scopeOf` always reports its
 * `root`/`from` as `null`, `replaces: false`), so those two carry over from
 * the parent instead of clearing.
 */
function pushedScope(fieldScope: ScopeContext, parentScope: ScopeContext | null): ScopeContext {
  if (fieldScope.replaces) {
    return fieldScope;
  }
  return {
    this: fieldScope.this,
    ...inheritedAmbientScopes(parentScope),
    replaces: false,
  };
}

function inheritedAmbientScopes(
  parentScope: ScopeContext | null
): Record<AmbientScopeKey, string | null> {
  return Object.fromEntries(
    AMBIENT_SCOPE_KEYS.map((key) => [key, parentScope?.[key] ?? null])
  ) as Record<AmbientScopeKey, string | null>;
}

/**
 * Resolves the context inherited by a struct field's nested members.
 * Fields without a scope annotation reuse the existing context; annotated fields merge
 * their push or replacement through the CWT scope rules.
 */
export function containerContext(field: RuleField, ctx: FieldContext): FieldContext {
  return field.scope === null ? ctx : { ...ctx, scope: pushedScope(field.scope, ctx.scope) };
}

/**
 * Resolves scope arguments for contravariant trigger-bearing shapes.
 * An unpinned `ScopeName` becomes `never`, while explicit, parameterized, and
 * container-inherited scopes remain unchanged.
 */
export function contravariantScopeType(
  emitter: Emitter,
  field: RuleField,
  ctx: FieldContext,
  asserted?: string
): FieldScope {
  const scope = scopeType(emitter, field, ctx, asserted);
  if (scope.type !== "ScopeName") {
    return scope;
  }
  // `never` spells no SDK symbol, so the widened scope drops the import the
  // unpinned one would have declared.
  const { unpinned, ...rest } = scope;
  return { ...rest, type: "never" };
}

/**
 * Returns the rendered scope argument and registers its SDK import when needed.
 * Type parameters have no import and pass through unchanged.
 */
export function scopeArg(emitter: Emitter, scope: FieldScope): string {
  if (scope.unpinned !== undefined) {
    emitter.use(scope.unpinned);
  }
  return scope.type;
}

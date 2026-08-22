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

/**
 * The scope a field's closures run in.
 *
 * `asserted` is an overlay row's declared scope, which wins over the rules —
 * see `ContentFieldOverride.scope` for when that is legitimate. A bad scope
 * name there throws rather than falling back to `ScopeName`: silently widening
 * would turn a typo into a field that accepts nothing useful, which is the very
 * failure the row exists to fix.
 */
/**
 * What a field's lowering needs to know about the definition enclosing it.
 *
 * `unpinned` is the type an unannotated scope lowers to. Normally `ScopeName`,
 * which admits only rules legal in every scope; for a registry whose scope is a
 * parameter of the definition (see `CONTENT_SCOPE_PARAMETERS`) it is that
 * parameter instead, so the clauses follow whatever the definition declared.
 *
 * `scope` is the effective `ScopeContext` in force at this point in the
 * recursion — the type's own top-level scope at the root, and, beneath a
 * struct field that itself carries a `field.scope` (`## replace_scopes`/
 * `## push_scope` on the struct field, not on the leaf), that field's scope
 * merged onto whatever was in force above it. `containerContext` builds that
 * merge and `structShape` recurses with the result, so a leaf with no
 * annotation of its own (`governments.cwt`'s `modification.add`/`remove`,
 * scoped only by the enclosing `modification` container) still resolves the
 * container's scope through the same `field.scope?.this ?? ctx.scope?.this`
 * fallback `scopeType`/`fromType` use for a leaf's own annotation.
 */
export interface FieldContext {
  readonly scope: ScopeContext | null;
  readonly unpinned: string;
  /**
   * The SDK symbol {@link FieldContext.unpinned} names, where it names one
   * rather than a type parameter of the enclosing definition. Carried so a field
   * that actually lands on the unpinned type declares the import at the site
   * that writes it — a registry whose fields are all scope-annotated imports
   * nothing, and a contravariant field widens to `never` and imports nothing
   * either.
   */
  readonly unpinnedSymbol?: string;
  /**
   * The type FROM lowers to in this field's block, where the overlay asserts a
   * FROM the rules leave unstated (`ContentScopeParameter.selector.fromMembers`).
   * A TS type rather than a scope name, because the scope it names is the
   * definition's own parameter and not a constant any rule could state.
   */
  readonly assertedFrom?: string;
  /** The enclosing registry's authoring parameter, for nested typed blocks. */
  readonly nestedTypeParameter?: { readonly declaration: string; readonly argument: string };
}

export interface FieldScope {
  /** The TS type parameter: one canonical scope literal, or the unpinned type. */
  readonly type: string;
  /** {@link FieldContext.unpinnedSymbol}, where {@link FieldScope.type} is it. */
  readonly unpinned?: string;
  /** The same thing as data, `"any"` where nothing pinned it. */
  readonly scopes: readonly string[] | "any";
  /**
   * The scope FROM holds inside this block, as a TS literal type, when the
   * rules name one. `null` where they do not — including their `from = any`,
   * which names no scope and must stay unreadable rather than lower to
   * something an author could navigate through.
   *
   * Read from the rules even when `asserted` overrides `this`: an overlay row
   * corrects the scope a block *runs* in, which says nothing about what the
   * game hands it as FROM.
   */
  readonly from: string | null;
  /**
   * The scope ROOT holds inside this block, on the same terms as {@link
   * FieldScope.from} — and independent of `type`, which is the whole reason it
   * is carried separately. `## replace_scopes = { this = planet root = country
   * ... }` on a solar system initializer's `init_effect` means the block runs
   * in planet scope while `root = { ... }` runs in country scope.
   */
  readonly root: string | null;
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
  ambient: "from" | "root"
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

export function scopeType(
  emitter: Emitter,
  field: RuleField,
  ctx: FieldContext,
  asserted?: string
): FieldScope {
  // An asserted FROM wins over the rules, on `ContentFieldOverride.scope`'s
  // terms: it is there because the rules state no FROM at all, and a rule that
  // later states one is a disagreement to review rather than to average.
  const from = ctx.assertedFrom ?? fromType(emitter, field, ctx);
  const root = rootType(emitter, field, ctx);
  if (asserted !== undefined) {
    const canonical = emitter.canonicalScope(asserted);
    if (canonical === null) {
      throw new Error(`Overlay asserts unknown scope "${asserted}"`);
    }
    return { type: JSON.stringify(canonical), scopes: [canonical], from, root };
  }
  const unpinned: FieldScope = {
    type: ctx.unpinned,
    scopes: "any",
    from,
    root,
    ...(ctx.unpinnedSymbol === undefined ? {} : { unpinned: ctx.unpinnedSymbol }),
  };
  const declared = field.scope?.this ?? ctx.scope?.this;
  if (declared === undefined || declared === null) {
    return unpinned;
  }
  const canonical = emitter.canonicalScope(declared);
  return canonical === null
    ? unpinned
    : { type: JSON.stringify(canonical), scopes: [canonical], from, root };
}

/**
 * `EffectBlock`'s type arguments: the block's own scope, plus the scopes its
 * closure's `ctx.from` and `ctx.root` hold where the rules declare them. Each
 * trailing argument is emitted only as far as it says something — a block with
 * neither emits the one-argument form — so the defaults keep an undeclared
 * ambient scope unreadable rather than admitting a ref the game will not
 * honour. A declared ROOT with no FROM still has to spell the FROM slot, and
 * `undefined` is exactly the sentinel the default already means.
 */
export function effectBlockArgs(emitter: Emitter, scope: FieldScope): string {
  const own = scopeArg(emitter, scope);
  if (scope.root !== null) {
    return `${own}, ${scope.from ?? "undefined"}, ${scope.root}`;
  }
  return scope.from === null ? own : `${own}, ${scope.from}`;
}

/** Runtime evidence that natural event FROM cannot be witnessed by this block's `this`. */
export function splitRootMetadata(scope: FieldScope): readonly string[] {
  if (scope.root === null || scope.scopes === "any" || scope.scopes.length !== 1) {
    return [];
  }
  return JSON.stringify(scope.scopes[0]) === scope.root ? [] : ["splitRoot: true"];
}

/**
 * Wraps a declarative member type in `WithFrom` where the rules give the block
 * a FROM, adding the closure form that can reach it.
 *
 * A trigger and a weight block are values rather than closures, so unlike an
 * effect field there is no argument list to hand FROM to — the closure form is
 * that argument list. Only fields with a FROM get it: the plain form stays the
 * only way to write a condition that has no FROM to name.
 *
 * FROM alone decides whether the wrapper appears; a declared ROOT rides along
 * on the closure the FROM already earned. A field that declares ROOT and no
 * FROM therefore keeps the plain form and cannot reach either — a known gap
 * rather than a judgement about that field, since the wrapper's whole reason
 * to exist is the missing argument list.
 */
export function withFrom(emitter: Emitter, inner: string, scope: FieldScope): string {
  if (scope.from === null) {
    return inner;
  }
  const root = scope.root === null ? "" : `, ${scope.root}`;
  return `${emitter.use("WithFrom")}<${inner}, ${scopeArg(emitter, scope)}, ${scope.from}${root}>`;
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
  return fieldScope.replaces
    ? fieldScope
    : {
        this: fieldScope.this,
        root: parentScope?.root ?? null,
        from: parentScope?.from ?? null,
        replaces: false,
      };
}

/**
 * The `ctx` a struct field's own body recurses with.
 *
 * `structShape` types every one of a container's fields against the `ctx`
 * built here: a container that itself carries a `field.scope`
 * (`governments.cwt`'s `modification`, `## replace_scopes = { this = country
 * root = country }`) folds that annotation into `ctx.scope` via
 * {@link pushedScope}, so `add`/`remove` beneath it — themselves unannotated —
 * resolve "country" through the same fallback an annotated leaf uses. A field
 * with no `field.scope` passes `ctx` through unchanged, leaving whatever scope
 * was already in force (including one folded in by an enclosing container)
 * standing.
 */
export function containerContext(field: RuleField, ctx: FieldContext): FieldContext {
  return field.scope === null ? ctx : { ...ctx, scope: pushedScope(field.scope, ctx.scope) };
}

/**
 * As {@link scopeType}, for shapes whose scope parameter reaches a
 * `Trigger<S>` contravariantly — a trigger field itself, and a weight block,
 * whose rows carry `when: Trigger<S>`.
 *
 * `Trigger<in S>` is contravariant, so the unpinned literal `ScopeName`
 * ("valid in every scope") types the field as accepting only conditions
 * legal in every scope — for most fields none, which makes the field
 * unwritable rather than unchecked. `never` is the top of that lattice:
 * substituting it is what "the rules did not say" should mean, the same way
 * an unknown reference target lowers to `| string` rather than to something
 * nothing can satisfy. Only the truly-unpinned case changes — a field a
 * `CONTENT_SCOPE_PARAMETERS` row threads through as `NoInfer<S>`, or one an
 * override, the rules themselves, or an enclosing container (see
 * {@link containerContext}) pin to a real scope, is untouched: any of those
 * already leave `scope.type` at something other than `ScopeName`, so the
 * widen below never fires for them.
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
 * The scope argument a member type spells, declaring the import it needs.
 *
 * Every site that writes `scope.type` into the output goes through here: the
 * unpinned type is `ScopeName` for an ordinary registry and a type parameter for
 * a scope-parameterised one, and only the first is a symbol to import.
 */
export function scopeArg(emitter: Emitter, scope: FieldScope): string {
  if (scope.unpinned !== undefined) {
    emitter.use(scope.unpinned);
  }
  return scope.type;
}

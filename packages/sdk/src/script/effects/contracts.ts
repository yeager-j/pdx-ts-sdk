/**
 * The shared half of every declared contract.
 *
 * A declared contract is the arrangement where the rules cannot state a scope,
 * so the definition declares it once, carries it on the item it returns, and
 * the effect that consumes the definition checks its call sites against that
 * declaration — `situation_type.targetScope` with `startSituation`,
 * `special_project.locationScope` with `enableSpecialProject`.
 *
 * The witness is a phantom property, so it is covariant: a value typed as two
 * definitions at once (`cond ? planetProject : fleetProject`) carries the union
 * of their declarations, and a scope value satisfying *either* arm then
 * satisfies the union — the check passes while the definition that actually
 * runs may be the other one. The scope is a build-time fact about one
 * definition; a value that could be two definitions has no single fact to
 * check, so this rejects it rather than checking the half that happens to
 * match (SDK-181).
 */

/** True when `T` is a union of more than one member. */
type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never;

/**
 * The shape an ambiguous witness resolves to: nothing satisfies it, and its one
 * property says why in the error.
 */
export interface AmbiguousDeclaration {
  readonly __narrow_this_to_one_definition__: "this value could be more than one definition, and they declare different scopes — narrow it to one before passing it here";
}

/**
 * `Contract` where `Scope` is one declared scope, and an unsatisfiable type
 * naming the problem where it is a union of several.
 *
 * Undeclared is not ambiguous: a definition that declares nothing has
 * `undefined` as its scope, one member, and stays on the unchecked path.
 */
export type Unambiguous<Scope, Contract> =
  IsUnion<Scope> extends true ? AmbiguousDeclaration : Contract;

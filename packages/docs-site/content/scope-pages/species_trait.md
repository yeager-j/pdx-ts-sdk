# Species trait

A species trait is a typed trait value associated with a species. The SDK uses it as the callback
scope for trait iterators, but generates no trait-specific ordinary effects or dedicated event kind.
It is an inspection context for trait-level checks rather than a mutable trait lifecycle API.

## Common entry points

Common entry points include species and pop-group trait iterators that supply a
`SpeciesTraitScope`.

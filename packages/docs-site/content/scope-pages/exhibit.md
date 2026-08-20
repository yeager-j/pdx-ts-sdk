# Exhibit

An exhibit is a display context associated with a specimen. Triggers can inspect whether the
exhibit is active and read the contained specimen's rarity or category, but the generated interface
adds no exhibit-specific ordinary effects. It is therefore an inspection-oriented view of museum
or collection content rather than a mutable lifecycle API.

## Common entry points

Common entry points include country-level exhibit iterators and typed callbacks that supply an
`ExhibitScope`.

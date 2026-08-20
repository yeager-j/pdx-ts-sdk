# Alliance

Alliance is the typed federation relationship context returned by a country's `alliance` link.
The canonical rules define no alliance-specific event kind or scope-specific effect surface, so
country and federation contexts carry the related mechanics. It is useful when script follows an empire's
federation relationship without treating the alliance as an independent object API.

## Common entry points

Common entry points include the country-to-alliance link and typed callbacks that supply an
`AllianceScope`.

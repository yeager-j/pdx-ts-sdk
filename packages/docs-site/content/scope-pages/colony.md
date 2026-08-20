# Colony

A colony is a colonized-world context used by planetary management scripts. Its generated effects
cover construction, districts, buildings, colony type, controller, deposits, terraforming, and
population operations. It is the operational settlement view of a world rather than the broader
planet context, which can also represent uncolonized worlds.

## Common entry points

Common entry points include `colony_event` bodies, colony-scoped callbacks, and links that select a
country capital or sector capital.

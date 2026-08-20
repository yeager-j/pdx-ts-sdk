# Planet

A planet is a world evaluated through the game's planet script interface. Planet operations cover
colonization progress, deposits, ownership, conquest, local infrastructure, and other world state,
but a planet does not need to be a colony. It is the broad world-level context beneath a star
system and around any settlement built on that world.

## Common entry points

Common entry points include `planet_event` bodies, planet-scoped callbacks, and links or iterators
that select a planet or an object it orbits.

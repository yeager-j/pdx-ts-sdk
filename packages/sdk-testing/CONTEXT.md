# Simulation

Interpreting recorded triggers and effects outside the game, so event chains
get unit tests that run in milliseconds and a failing condition can say _which_
subcondition failed.

The boundary that defines this context is what it refuses to know: it
implements an audited subset of game semantics and throws on everything else. A
wrong emulator is worse than no emulator, because every divergence is a green
test for broken behavior. See the [context map](../../CONTEXT-MAP.md).

## Language

**Fixture**:
A declared starting world — the countries, planets, fleets, sites, and
situations a test runs against.

**World**:
The mutable simulated game the interpreter runs over, built from a fixture.
Distinct from Authoring's `PureMod`, which is immutable by construction.

**World state**:
The entity data the world holds, addressed by entity id.

**Whitelist**:
The single audited table of what the interpreter implements — leaf triggers,
combinators, leaf effects, structural effects, iterators, and scope links.
Every entry carries a note defending its semantics against the real game.
Anything absent throws at evaluation time with a coverage summary; nothing
evaluates silently.

**Doc pin**:
The paragraph of Paradox's pinned documentation dump a whitelist entry's note
was read from, recorded by hash. Turns the audit from a one-time reading into a
standing one: `tests/whitelist-audit.test.ts` fails on a changed paragraph, on
an unacknowledged deprecation marker, and on selecting a dump version the
table was never read against. The one claim no paragraph settles — event-target
lifetime, recorded live in-game — is pinned to the verified game build instead.

**Sim scope**:
The subset of the game's scopes this interpreter models. Narrower than
Authoring's `ScopeName` by design — a scope outside the subset is refused
rather than approximated.

**Explanation**:
The structured account of why a trigger evaluated as it did, down to the
subcondition. The reason this context exists rather than a plain boolean.

**Delivery**:
Running one event on the world: the fired record plus its `immediate` block,
and nothing else. What delivery does with each field of an event body is
itself an audited table (`EVENT_FIELD_DELIVERY`), because an event carrying
script delivery never runs — an option's effects, a `trigger` the game checks
before firing, an `after` block — is refused at registration rather than
half-delivered, and a `fire_only_once` event is refused a second delivery
rather than run twice.

**Fired record**:
One event the run actually fired, in order — what a test asserts against.

# Handoff: after the events-and-effects vertical

Written after the vertical landed, for whoever continues. The predecessor is
[handoff-events-and-effects.md](handoff-events-and-effects.md); the spike's
gate verdict is [verdict-effects-probe.md](verdict-effects-probe.md). Both are
history now — this file is the live list.

## What landed

The load-bearing claim held: **triggers are expression trees, effects are
recorded closures**, with zero escape hatches in consumer code. Concretely:

- **Runtime**: one scope-agnostic Proxy recorder ([effect-core.ts](../src/effect-core.ts))
  under 41 generated per-scope interfaces. The Proxy throws on unknown names.
  Structural effects (`if` chains with a positional-association guard,
  `within`, `randomList`, `whileLoop`, `random`, event-target saves,
  `addResource`) are hand-written; everything else is meta-table-driven.
- **Codegen**: 1054/1082 triggers (was 929 — nested clause fields, comparison
  fields, splice-plus-fields, enum-key expansion), 976/1058 effects across 87
  scope-set cluster interfaces, and the 21-kind event table
  ([generated/events.ts](../src/generated/events.ts)) derived from
  `type[event]`'s subtypes. Every skip has a named reason in the codegen
  report. Output is byte-deterministic.
- **Events**: `mod.defineCountryEvent` / `definePlanetEvent` with eager
  closure recording, loc riding along (`{id}.name`/`.desc`/`.a`…), the FROM
  contract (declared on the event, witnessed at fire sites with `NoInfer`,
  inert-sentinel `ctx.from` when undeclared), and `events/{prefix}_events.txt`
  emission with the namespace line. The example mod ships the probe's full
  event chain; its output is golden-filed.
- **Latency** (measured on the real `CountryScope`, 533 completions):
  176ms cold / 1.1ms warm; full-repo typecheck 0.96s.

## Follow-up work, roughly in value order

1. **Generate the fire-effect overload pairs.** Six kinds have typed
   signatures (hand-written module augmentation in [events.ts](../src/events.ts));
   the other 15 have runtime encoders but no types. The overloads are fully
   templated (kind key + scope), so `emit/effects.ts` could emit them once it
   can import `EventRef` — a type-only cycle that already works elsewhere.
2. **The remaining 13 event kinds on `Mod`.** `defineEventOf` is generic
   already; adding `defineShipEvent` etc. is a typed wrapper per kind (or one
   generic `defineEvent(kind, def)` over `EVENT_KINDS`).
3. **Event body fields not yet modelled**: `mean_time_to_happen`, triggered
   desc/picture variants, `abort_trigger`/`abort_effect`, `ai_chance` on
   options (the `Modifier` type is ready for it), diplomatic/timeline event
   fields, `base = <event>` inheritance. The rules body
   (`rules.bodies.get("event")`) is parsed and waiting; the definition surface
   is hand-written, so these are additive.
4. **The 61-effect skip tail** (see the codegen report): `switch` /
   `inverted_switch` (need a design — probably `scope.switchOn(field, cases)`),
   `create_army`-family `name` splices, and a long tail of one-off fields
   (`ethos`, `orbit_distance`, …). None block anything; each is a named line
   in the report.
5. **`prev` and deeper FROM chains.** `ScopeRef` covers them mechanically
   (`scopeRef("prev")`); the design question is typing, same as `fromfrom`
   (currently absent by design).
6. **on_action registration** — the only way mods actually *pull* events into
   play without another mod firing them.

The chosen next spike is none of the above: it is the mod-testing evaluator —
see [handoff-mod-testing.md](handoff-mod-testing.md).

## Sharp edges worth knowing

- **Wrapper effects with all-optional args still take two parameters**:
  `everyOwnedPlanet({}, body)`. An overload dropping the empty object would be
  nicer; do it in the emitter, not by hand.
- **Effects overloaded between block and scalar emit scalar-only** (`log`,
  reported under "Effects emitted scalar-only"). Method overloads in the
  cluster interfaces could restore the block forms.
- **Same-scope effect closures inside args objects** are typed
  `ScopeObjOf<union>` because `this` is illegal in nested object types —
  conservative (common members only), correct.
- **Overriding FROM on a contract-less event does not typecheck** (the
  witness overload requires `F extends ScopeName`). Deliberate for now.
- The old conventions all still hold: overlay entries stay expensive (two were
  added, both audited: `HAND_WRITTEN_EFFECTS`, `FIRE_EFFECTS`), nothing drops
  silently, goldens are the acceptance test, no Prettier over `tests/`, the
  yml BOM is load-bearing, rebaseline drift deliberately.

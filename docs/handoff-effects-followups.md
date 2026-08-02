# Handoff: after the events-and-effects vertical

> **Superseded 2026-08-02 — this is no longer the live list.** Tracking moved
> to Linear (see [roadmap.md](roadmap.md)'s header). Follow-ups 1, 2, and 6
> below landed; the resolution is noted inline on each. The rest are still
> open and are recorded in the roadmap. The "what landed" and "sharp edges"
> sections stay as written, with the authoring surface updated where the
> pure-API migration renamed it.

Written after the vertical landed, for whoever continues. The predecessor is
[handoff-events-and-effects.md](handoff-events-and-effects.md); the spike's
gate verdict is [verdict-effects-probe.md](verdict-effects-probe.md).

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
- **Events**: `defineCountryEvent` / `definePlanetEvent` (then methods on
  `Mod`, since 2026-08-02 definers on `createEvents`) with eager
  closure recording, loc riding along (`{id}.name`/`.desc`/`.a`…), the FROM
  contract (declared on the event, witnessed at fire sites with `NoInfer`,
  inert-sentinel `ctx.from` when undeclared), and `events/{prefix}_events.txt`
  emission with the namespace line. The example mod ships the probe's full
  event chain; its output is golden-filed.
- **Latency** (measured on the real `CountryScope`, 533 completions):
  176ms cold / 1.1ms warm; full-repo typecheck 0.96s.

## Follow-up work, roughly in value order

1. ~~**Generate the fire-effect overload pairs.**~~ **Done 2026-08-01** —
   `src/generated/event-fires.ts` emits the witness-overload pair per fire
   effect, merged into the generated scope interfaces.
2. ~~**The remaining 13 event kinds.**~~ **Done 2026-08-01** — all 20 scoped
   kinds are generated from `EVENT_KINDS`; today they are the `defineXEvent`
   definers on the `namespace(ns)` handle (`src/generated/event-definers.ts` —
   they were on `createEvents` until SDK-23 removed the factories). The scopeless
   `event` kind stays skipped: its closures cannot be typed.
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
6. ~~**on_action registration**~~ **Done** — `on(hook, events)` over the
   generated `onActions` table (`createOnActions().on(hook, event)` until SDK-23
   made it free and array-valued), with the hook's scope and FROM metadata
   deciding which event contract is accepted.

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

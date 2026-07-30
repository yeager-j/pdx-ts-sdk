# Effects probe verdict: the model holds

Stage 0 of the events-and-effects slice, per the
[handoff doc](handoff-events-and-effects.md)'s suggested first probe. The
probe lives in `design/effects-probe/` and stays there — it is the design
record, not the implementation.

## The judgment

**Recorded-closure effects hold with zero escape hatches in the mainline.**
[probe.ts](../design/effects-probe/probe.ts) writes the nastiest realistic
case — `random_list` with weight modifiers, a nested `every_owned_planet`
saving an event target and firing a follow-up event, the follow-up reading the
firing country back through `FROM` — with no casts, no `any`, and no raw scope
strings outside sanctioned type-level declarations (`eventTarget<"planet">`,
`from: "country"`). The recorded output byte-matches a golden written by hand
before the recorder ran ([probe.test.ts](../design/effects-probe/probe.test.ts)).

Acceptance results:

| Check | Result |
| --- | --- |
| Mainline reads clean, zero casts | Pass |
| 7 negative claims pinned with `@ts-expect-error` | Pass (two needed design fixes, below) |
| Byte-identical round-trip vs hand-written golden | Pass, first run |
| 560-method interface: cold completion | 148ms (budget ~200ms) |
| 560-method interface: warm completion | 2.4ms |
| Full-repo `tsc` with the 5.3k-line fixture | 0.82s total |

## Two findings the probe caught (why probes exist)

1. **The FROM witness needs `NoInfer`.** With
   `fire<F>(args: { id: EventRef<K, F>; from: ScopeRef<F> })`, TypeScript
   unions the inference candidates from both sites, so a wrong-scope witness
   *unified* instead of erroring. `from: ScopeRef<NoInfer<F>>` makes the event
   ref the single inference source and restores the check. The emitter must
   generate `NoInfer` on every witness position.
2. **Undeclared FROM must not be `never`.** `never` assigns anywhere, so
   `ctx.from` on a contract-less event passed straight into `within(...)`.
   The fix is an inert sentinel interface (`UndeclaredFrom`) that is not a
   `ScopeRef`; the error then names the sentinel and its `hint` field says how
   to fix it.

## Error-message quality (checked by hand)

- Wrong-scope effect: `Property 'addResource' does not exist on type
  'PlanetScope'` — ideal.
- Fire-site contract violations produce a TS2769 overload error: verbose, but
  each branch terminates in an actionable line (`Property 'from' is missing…`,
  `Type '"planet"' is not assignable to type '"country"'`). No
  instantiation-depth explosions anywhere.
- Truthiness poisoning fires as TS2774, as it already does for triggers.

## Decisions validated (now binding for stages 1–4)

- **One scope-agnostic Proxy recorder + generated interface types.** The
  runtime needs no per-scope code at all; `makeScope` carries the design's
  single cast. The Proxy throws on names missing from the meta table —
  "nothing dropped silently" at record time.
- **`iff` chains with a positional-association guard.** Recording effects
  between `iff(...)` and `.else(...)` throws, because PDXScript attaches
  `else` to the preceding `if` by position.
- **FROM declared on the event, witnessed at fire sites.** `from: ctx.self`
  emits nothing (natural FROM); any other ref emits the game's own
  `scopes = { from = ... }` override block. On-action/vanilla-fired paths
  remain untracked — documented, fundamental.
- **`random_list` arms as `{ weight, modifiers?, do }`** — trigger-ish parts
  are data, effect parts are closures; the mixed block needs no third concept.
- **Event targets declare their scope once** (`eventTarget<"planet">(...)`);
  save sites enforce it, reads are then safe.

## Deviations from the plan, for the record

- Event definition got its own probe file
  ([events-sample.ts](../design/effects-probe/events-sample.ts)) instead of
  living in scopes-sample.
- `latency-sim.ts` is gitignored; regenerate with
  `node design/effects-probe/gen-latency-sim.ts` and measure with
  `node design/effects-probe/measure-latency.ts`.

## Watch items for the emitter stages

- The witness overload pair must be generated for all 15 fire effects;
  overriding FROM on a *contract-less* event does not typecheck (the witness
  overload requires `F extends ScopeName`). Acceptable for now; revisit if
  vanilla interop needs it.
- `add_resource`'s `<resource> = float` computed key was hand-encoded as a
  SPECIAL in the probe. Codegen needs a story for computed-key fields or an
  overlay entry.
- Completion latency was measured with a cold LanguageService; a real tsserver
  session with all 38 interfaces loaded should be spot-checked once generated.

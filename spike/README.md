# Spike: importing a PDXScript mod as generated TypeScript

**Question.** We compile TypeScript → PDXScript. Can we run the arrow backwards —
parse an existing PDXScript mod and hand its author generated `@pdx-ts/sdk`
TypeScript as a porting head start — and can we guarantee we didn't drop or
misread anything?

**Method.** `run.ts` (not product code) parses a real shipped mod with
`@pdx-ts/pdxscript`, classifies every file against `CONTENT_REGISTRIES`, raises
each covered definition into its `Def` shape by inverting the generated
`ContentField` tables, then lowers every raised field back through the SDK's
_real_ `fieldEntries` and tree-compares against the original parse. Nothing is
trusted: a field either round-trips canonically (`mapped`), round-trips modulo
in-block key order (`mapped-reordered`, justified by ADR-0005), is carried as a
raw PDXScript tree (`script-carried` for trigger/effect bodies, `raw-carried`
for shapes the spike raiser doesn't attempt), is `unmapped` (key the field
table doesn't know), or is loudly `mapped-drift`.

```sh
node --conditions=pdx-source spike/run.ts            # Dawn of Ascension (parity target)
node --conditions=pdx-source spike/run.ts <modDir>   # any other mod
```

## Results

**Dawn of Ascension** (workshop 2816360131, the parity target):

- 74 script files, 0 parse failures; 719 definitions in covered registries,
  42 outside them (scripted_triggers 23, on_actions 11, scripted_effects 6),
  plus 158 events in 8 files.
- 6,259 field groups: **87.8% mapped**, 2.5% mapped-reordered, 2.1%
  script-carried (lossless by construction), 6.7% raw-carried, 1.0% unmapped,
  **0 drift**.
- 464/719 definitions fully representable today; 500/719 recover their English
  `name` text from the mod's localisation.

**Gigastructural Engineering** (workshop 1121692237, the scale benchmark):

- 1,286 script files, 2 parse failures — both loud refusals, not misreads.
- Coverage inverts: 4,252 definitions covered vs **8,781 uncovered** (scripted
  triggers/effects, button_effects, inline_scripts, script_values, deposits,
  districts, …) plus 2,155 events.
- Of 26,193 covered field groups: 79.6% mapped(+reordered), 4.4%
  script-carried, 6.7% raw-carried, 9.1% unmapped, 0.3% drift.

## What the parity gate caught (evidence it works)

- The spike's own raiser bugs (`@var` double-prefixing) — caught as 360 drifts,
  fixed, went to zero.
- A real SDK gap: `economicOperation` lowers amounts with bare `kv()`, so a
  `@variable` amount would be defensively quoted — the game would read a
  string. 139 occurrences in DoA alone. `weightBlock`'s `base` looks similar
  (56 drifts in Giga). Fix belongs in `content/blocks.ts`.
- `upgrades = {}` (empty list) is dropped by lowering — absent-vs-empty needs a
  decision.

## Answers

1. **Feasible? Yes.** The hard parts already exist: a lossless order-preserving
   parser, machine-readable field tables to invert, raw-tree `Trigger`s, and a
   lowering that accepts passthrough nodes. The raiser is ~300 lines.
2. **Practical? Mixed, as predicted.** For a manifest-shaped mod (DoA) the
   generated code is a genuine head start: ~90% of fields land as typed
   members with recovered loc text, and the remainder arrives as explicit raw
   islands. But grouping by feature can't be derived (one file → one module is
   the honest projection), triggers/effects/modifier closures emit as `raw*()`
   escape hatches rather than idiomatic builders until someone inverts
   `EFFECT_META`/`modifiers.ts`, and a scripty mod (Giga: 67% of definitions
   outside covered registries) mostly can't ride today's surface at all.
   Blocking SDK gaps: preserved original ids (the capability layer throws on
   foreign prefixes), a `raw()` def escape hatch, a raw-effect constructor,
   and events/scripted_triggers/scripted_effects import surfaces.
3. **Reliable? Yes — with the round-trip gate, and only with it.** Import must
   re-lower every raised definition and tree-compare before writing any
   TypeScript; anything that doesn't round-trip is carried as raw PDXScript or
   refused by name, never silently reinterpreted. The gate is cheap (it reuses
   the existing serializer + lowering) and it demonstrably catches both
   importer bugs and SDK bugs.

# Bug bash: the dogfood findings

> **Working index, 2026-08-03.** Every finding from the four coverage probes,
> consolidated for dispatch. Each entry maps to one Linear ticket and carries what
> a fixer needs without reading the source doc — symptom, cause with `file:line`,
> the evidence that justified it, the fix, and how to verify.
>
> Source docs, if you want the full narrative and the measurements:
> `coverage-arc-site-dogfood.md`, `coverage-situation-dogfood.md`,
> `coverage-parallel-probes.md`. Every claim here was verified against the
> vendored rules and re-measured against the installed game before filing.

**Read "Dispatch" first if you are parallelising this.** Roughly half these
tickets regenerate the same tree, and two of them edit the same function.

---

# Dispatch

## The hard constraint: generated output is one tree

`npm run codegen` regenerates all of `packages/sdk/src/generated/` from
`packages/codegen-cwt/`, and `npm run codegen:check` is
`git diff --exit-code packages/sdk/src/generated`. `AGENTS.md` requires generated
output to be committed **together with the source change that produced it**.

So any two tickets that touch codegen inputs produce overlapping generated diffs.
They cannot run in parallel in one checkout, and merging their branches means
re-running codegen on the merge result and re-reviewing the whole diff anyway.

**Codegen-input tickets** (each regenerates the tree):
SDK-30, SDK-31, SDK-33, SDK-34, SDK-39, SDK-40, SDK-41, SDK-42, SDK-44, SDK-45,
SDK-47, SDK-50, SDK-51.

**Runtime-only tickets** (no regeneration; parallelise freely against the
codegen work): SDK-32, SDK-35, SDK-36, SDK-37, SDK-38, SDK-43, SDK-46, SDK-48,
SDK-49, SDK-52, SDK-53, SDK-54.

## Collision map

| File                                           | Tickets                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/codegen-cwt/src/emit/types.ts`       | **SDK-33, SDK-47** — both edit `valueFor`. Do together or strictly in sequence.                                                                                                                                                                  |
| `packages/codegen-cwt/src/overlay.ts`          | SDK-31, SDK-39, SDK-42, SDK-44, SDK-45, SDK-50 — six tickets adding rows. Different tables, so semantically independent, but the same file and the same regenerated tree. **SDK-30** lands here too, as the first `CONTENT_DECLINED_FIELDS` row. |
| `packages/sdk/src/compiler/compile.ts`         | SDK-32, SDK-37, SDK-38 — the fold coordinates content/path grouping while `compiler/references.ts` owns `registriesByTarget` and `builtIds`. |
| `packages/sdk/src/content.ts`                  | SDK-35, SDK-36 (`WeightBlock` + `weightBlock`), SDK-45 (`EconomicResourceBlock`), SDK-48 (`collectModifierDescs`).                                                                                                                               |
| `packages/sdk/src/effect-core.ts`              | SDK-35, SDK-36 (`Modifier`, `modifierEntry`), SDK-48 (`modifierDescKeys`).                                                                                                                                                                       |
| `packages/codegen-cwt/src/content-manifest.ts` | SDK-40, SDK-41, SDK-51 — all three add registries or `VANILLA_REF_EXTRAS` entries.                                                                                                                                                               |
| `packages/codegen-vanilla/src/`                | SDK-40, SDK-41, SDK-51 — all three need install-derived emission; SDK-41 is the one that builds the machinery.                                                                                                                                   |
| `packages/sdk-testing/src/`                    | SDK-49 alone.                                                                                                                                                                                                                                    |
| `packages/create-stellaris-mod/src/templates/` | SDK-54 alone.                                                                                                                                                                                                                                    |

## Suggested waves

**Wave 1 — the two blocking bugs, fully independent of each other.**
SDK-31 (codegen, overlay rows) and SDK-32 (runtime, `build.ts`/`render.ts`).
Different packages, no overlap. Both are the reason a registry is currently
unusable.

**Wave 2 — one agent per collision cluster, run in parallel.**

- _codegen/types_ — SDK-33 + SDK-47 together (same function, and the fix is the
  same shape: stop collapsing a richer `RuleType` to the narrow one)
- _codegen/overlay_ — SDK-30, SDK-39, SDK-42, SDK-44, SDK-45, SDK-50 batched
  into one agent, one regeneration, one generated-diff review. SDK-30 is the only
  one that also removes a field rather than adding rows, and it carries an
  `AGENTS.md` edit — see its entry.
- _build.ts_ — SDK-37 + SDK-38 together (both are the guard; one test file)
- _content.ts weight blocks_ — SDK-35 + SDK-36 together
- _standalone_ — SDK-49, SDK-53, SDK-54, SDK-48, SDK-43, SDK-46, SDK-52, one each

**Wave 3 — the install-derived vocabulary work.**
SDK-41 first (builds the `complex_enum` emission machinery), then SDK-40 and
SDK-51 on top of it. Sequential by dependency, not by file conflict.

**SDK-34 sits outside the waves**, because its generated diff needs to be read on
its own rather than mixed into anyone else's: it changes generated scope types
across registries. Do it alone, after Wave 2's codegen work has landed.

## Verification, for every ticket

```sh
npm run typecheck && npm test && npm run build
```

Plus, for any codegen-input ticket:

```sh
npm run codegen        # then read the report and inspect the full generated diff
```

Do not run `npm run codegen -- --rebaseline`.

**A green build proves nothing about output correctness.** Every silent-output
finding in this document (`change_orbit`, the component overwrite, the
non-functional shield, English-as-a-loc-key) was found by diffing emitted script
against the vanilla source, never by a passing gate. Where a ticket says a
specific vanilla definition is the subject, re-port enough of it to diff.

The four probe mod projects are in the session scratchpad
(`probe-system-init`, `probe-ship-cluster`, `probe-tradition`, `probe-civic`),
each a working project with the SDK linked. Several carry gap tests that should
be inverted when their ticket lands.

---

# Blocking

## SDK-31 — Component templates cannot declare `resources` or `modifier`

**Symptom.** A ported `SMALL_SHIELD_1` occupies a slot, costs nothing and grants
nothing. `UtilityComponentTemplateFields`, `WeaponComponentTemplateFields` and
the strike-craft equivalent declare no member for `resources`, `modifier`,
`ship_modifier`, `ship_design_modifier`, `triggered_ship_modifier` or
`triggered_ship_design_modifier`. The writer iterates the declared
`ContentField[]`, so an undeclared member is dropped even past a cast, and
content items carry a `def` rather than a lowered entry — no AST escape.

**Cause.** `grep component_template packages/codegen-cwt/src/overlay.ts` returns
**zero** rows. Not an emitter limitation.

**Evidence.** CWT declares them on all three subtypes — `components.cwt:186`,
`:335`, `:402` (`resources`); `:207`, `:422` (`modifier`); `:210`, `:343`, `:425`
(`ship_modifier`). **1,193 of 1,500** vanilla component templates write a
top-level `resources`; 355 write `modifier`.

**Fix.** Add `CONTENT_FIELD_OVERRIDES` rows for all three registries, copying the
proven ones: `ship_size.modifier` (`overlay.ts:887`), `ship_size.resources`
(`:894`, `:901`), `section_template.resources` (`:1000`, `:1008`, `:1017`).
Weapon and strike-craft `resources` splice `economic_template_no_produce`, so
`produces` should not be authorable there — `EconomicResourceBlock`
(`content.ts:88`) does not model that distinction yet.

**Verify.** Invert the two gap tests in `probe-ship-cluster`.

## SDK-32 — Two component registries in one module silently overwrite each other

**Symptom.** One `collection` holding a weapon template and a utility template
emits one file containing only the weapon. `mod.warnings` is `[]`. The dropped
component's localization is still emitted, so the `.yml` advertises something
that does not exist.

**Cause.** Those three registries are the only ones of 35 sharing an `outputDir`
(`generated/content-registry.ts:181`, `:190`, `:199`) — because the game does
(`components.cwt:31-33`). Path is `<outputDir>/<prefix>_<stem>.txt`
(`build.ts:124-128`); `render` keys a `Map` by that path
(`render.ts:24-25`); second `set` wins.

**Why it matters.** The layout that triggers it is the one `README.md` and
`AGENTS.md` teach — one feature module fanning out across registries.

**Fix.** Group content files by `relPath` before serializing rather than by
registry; registry declaration order then id keeps emission deterministic. At
minimum, throw when two registries resolve to the same `relPath`.

**Verify.** Reproduction is fifteen lines — one `defineWeaponComponentTemplate`
and one `defineUtilityComponentTemplate` in a single `collection`.

---

# Convergent defects

Each was hit independently by three or four probes, through unrelated registries.
These are single fixes across the generated surface, not registry patches.

## SDK-33 — Unannotated CWT scope lowers to an unsatisfiable `Trigger<ScopeName>`

**Symptom.** `Trigger<in S>` is contravariant (`trigger-core.ts:32`), so
`Trigger<ScopeName>` means _legal in every scope_. Only **112 of 1,054**
generated trigger functions satisfy it. When CWT declares no `## replace_scopes`,
codegen emits exactly that, and the field becomes unwritable rather than
unchecked. 157 occurrences across `generated/`.

**Evidence.** `tradition_category.desc.trigger` rejects **25 of 25** vanilla
uses; `civic_or_origin.swap_type.trigger` 41 of 56;
`solar_system_initializer.usage_odds` 189 of 306. Every probe independently
invented the same cast workaround.

**Fix.** Emit `Trigger<never>` / `WeightBlock<never>` when CWT declares no scope —
`never` is the top of a contravariant lattice, so it accepts everything. "The
rules did not say" should lower to _unchecked_, the way an unknown reference
target already lowers to `| string`. `emit/types.ts`.

Where the scope is genuinely known, a `CONTENT_FIELD_OVERRIDES` `scope`
assertion buys real checking: `usage_odds` → `system` (189 uses, plus the game's
own `example.txt:148`), `tradition_category.desc.trigger` → `country` (25/25,
plus the `country` annotation on the sibling `potential`).

**Collides with SDK-47** — same function.

## SDK-34 — Container-level `replace_scopes` not propagated to nested members

**Symptom.** The second cause of the same broken type. `governments.cwt:430` puts
`## replace_scopes = { this = country root = country }` on the `modification`
container; its `add`/`remove` members still generate as `Trigger<ScopeName>`
(`generated/civic-or-origin.ts:74-75`).

**The contrast proves it is propagation, not the default:** sibling fields
annotated on the field itself come out right — `playable`/`ai_playable` lower to
`Trigger<"no_scope">` (`:346`, `:350`).

**Cause.** `structShape` forwards the enclosing definition's `FieldContext`
unchanged (`emit/fields.ts:789`); `scopeType` reads
`field.scope?.this ?? ctx.scope?.this` (`:275`). The container's own parsed
`scope` (`cwt/model.ts:265-283`) is never folded in.

**Evidence.** 33 of 142 vanilla `modification` fields use the block form; every
one writes country-scoped conditions.

**Fix.** Derive a child `FieldContext` from the container field's `scope` in
`structShape` and the other nested lowerings. **Do this one alone** — it changes
scope types on other registries and needs its own generated-diff review.

## SDK-35 — `WeightBlock` models only `base`, one of fifteen operations

**Symptom.** `WeightBlock` is `{ base?, modifiers? }` (`content.ts:109-114`).
`modifier_rule.cwt:1-3` allows `base`, every `complex_maths_enum` member
(`set weight add subtract factor mult multiply divide modulo round_to max min pow`)
and every `simple_maths_enum` member at that top level.

**Evidence.** In `common/traditions/`, **292 of 293** `weight`/`ai_weight` blocks
use a top-level `factor` and **1** uses `base` — the SDK expresses the spelling
used once and not the one used 292 times. Across all 4,064 `ai_weight` blocks
under `common/`, `weight` (2,255) outnumbers `base` (848) 2.7 to 1.

**Fix.** Widen `WeightBlock` to the `complex_maths_enum` keys — the member set
`Modifier` already has at row level (`effect-core.ts:220-229`) minus `desc` and
`when`. `weightBlock` (`content.ts:759-768`) already emits `base` ahead of the
rows and would emit the rest the same way.

## SDK-36 — `WeightBlock` cannot express `complex_trigger_modifier` or `scaled_modifier`

**Symptom.** `modifiers` admits only `Modifier` rows. `modifier_rule.cwt:32-53`
and `:15-30` declare two further row kinds any `alias_name[modifier_rule]` splice
accepts. Neither appears anywhere in `packages/sdk/src`.

**Evidence.** **552 occurrences** of `complex_trigger_modifier` across 42 files
in `common/`; 12 of `scaled_modifier`. The system-init port had to silently drop
the row scaling its spawn odds by the habitable-worlds galaxy setting — the one
genuine behavioural divergence in that port.

**No workaround.** `usageOdds` is a plain data field with no per-entry hook.

**Fix.** Add a `complexTriggerModifier` arm to the row union. It needs no scope
type parameter — `trigger` names a key, `trigger_scope` carries its own scope.

## SDK-37 — Subtype-qualified reference targets bypass the guard

**Symptom.** No civic or origin reference is checked anywhere, at either layer.
Same for `ship_size.required_component_set`: a dangling id **built cleanly and
emitted**, while a dangling `useShipnamesFrom` threw.

**Cause, build layer.** `registriesByTarget` (`build.ts:526-536`) registers a
_qualified_ `referenceName` under both qualified and bare forms. `civic_or_origin`
registers unqualified while its fields target `civic_or_origin.civic`; that
matches no key, and `build.ts:554` reads an unmatched target as "nothing here
could have defined it". Handled direction is qualified→bare; missing one is
**bare→qualified**.

**Cause, type layer.** `CivicOrOriginRef` is branded
``"civic_or_origin" | `civic_or_origin.${string}` `` (`refs.ts:125`) — a union
satisfying neither subtype ref. `vanilla.civicOrOrigin` is the only constructor,
and `stellaris-ids` has no subtype split.

**Third cause.** `GOVERNMENT_TRIGGER_CLAUSE_FIELDS` lowers `value` with
`conversion: "ref"` and **no `refTypes`** (`generated/government-trigger.ts:60-86`),
so clause references are never recorded at all.

**Proof.** Three tests in `probe-civic`, including a control:
`defineTechnology({ prerequisites: ["dogfood_tech_does_not_exist"] })` throws in
the same build while both civic cases pass silently.

**Blast radius.** 203 `civics` + 104 `origin` clauses + 40
`alternate_civic_version` in vanilla civics; 780 `required_component_set` rows.
Plus `hasCivic`, `hasValidCivic`, `hasInvalidCivic`, `hasOrigin`,
`forceAddCivic`, `forceRemoveCivic`, `setOrigin`, `councilor.civic`.

**Fix.** Longest-prefix target resolution in `build.ts` (or register unqualified
`referenceName`s under their subtype targets); give the `government_trigger`
clause emitter its per-member reference type; optionally subtype-aware
constructors, which need the split in `codegen-vanilla` first.

## SDK-38 — Nested definition ids never enter `builtIds`

**Symptom.** A mod cannot reference its own `tradition_swap` —
`hasTradition("dogfood_<swap id>")` **throws** at `buildMod` with the swap
defined in the same collection.

**Cause.** `builtIds` (`build.ts:537-543`) is populated purely from top-level
`defined.id`. `ContentAuthoring` already tracks nested ids in `this.nestedIds`
(`content.ts:1093`, populated `:1273-1289`) for the prefix and duplicate checks.

**Evidence.** `traditions.cwt:16-21` declares
`type[swapped_tradition] { base_type = tradition }`. Of 180 vanilla swap names,
**135 are referenced** from outside `common/traditions/`.

**Workaround that must not ship.** Mis-prefixing the swap makes the guard skip it
(`build.ts:547-549`) with only a `missing-prefix` warning — trading away the
collision guarantee.

**Fix.** Fold `nestedIds` into `builtIds` for fields the overlay marks as nested
definitions (`overlay.ts:1090-1096` records `localisationType: "swapped_tradition"`).
Separately, give swaps reference identity so `hasTradition(adopt.swaps.nomad)`
checks like any other cross-reference.

## SDK-47 — `value_field` collapses to `number`

**Symptom.** CWT distinguishes `float` from `value_field`, which accepts a float
_or_ a variable, a `scope.variable` path, `value:<script_value>`, or
`trigger:<name>`. `modifier_rule.cwt:2`/`:7` type every modifier-row operation as
`value_field`; `effects.cwt:1218` does the same for `change_variable.value`.

**Cause.** `cwt/model.ts:134` parses it into its own `RuleType` kind, carried
faithfully through the model — then `emit/types.ts:104` flattens it alongside
`int` and `float` to `number`. **357** `= value_field` slots in the rules.

**Evidence.** Across every modifier operand in `common/`: 14,622 numeric
literals, **2,020 non-numeric** (1,282 `value:<script_value>`, 139
`trigger:<name>`, 599 variable/path), plus 2,314 `@scripted_variable`. **12% of
vanilla's modifier operands are not numbers.**

**Also:** `check_variable`'s generated doc comment already documents the wider
domain directly above a signature that admits only floats. Docs wider than types.

**Fix.** Lower `valueField` to something wider than `number` — a branded
`ScriptValue` that `number` widens into leaves every existing numeric call site
unchanged. **Collides with SDK-33** — same function.

---

# Silent-output bugs

## SDK-30 — `change_orbit` is positional in the game and a hoisted field in the SDK

**Predates these probes**; the system-init probe re-measured it and added one
observation that changes the recommended fix. Read the ticket for the original
scoping.

**Symptom.** At the top level of an initializer, `change_orbit` advances the
orbit cursor for the planets that follow it, so its position _among_ the `planet`
blocks is the geometry. The SDK models it as `changeOrbit?: number[]`
(`generated/solar-system-initializer.ts:253`) and emits every value **after**
every planet, where it shifts nothing. No error, no warning; the mod builds clean
and the system's geometry is silently wrong.

**Evidence.** Stellaris ships the proof in its own commented reference:
`common/solar_system_initializers/example.txt:128` reads _"The following is
shorthand, equivalent to `planet = { class = none orbit_distance = X }`"_,
directly above a `change_orbit = 30`. A planet's `orbit_distance` is measured
from the _previous_ planet (`example.txt:87`), and `class = none` is documented
as "will affect the orbit of subsequent planets, but no visible planet will be
generated" (`:80`). `solar_system_initializers.cwt:72-75` gives it
`cardinality = 0..inf`, and the subject initializer writes `change_orbit = 15`
twice — only meaningful as a cursor operation.

**288 of 355** top-level initializer blocks (81%) place at least one
`change_orbit` between two `planet` blocks. (Corrected from the 280/360 in the
ticket; different block detection, same conclusion.)

**The new observation.** The field's emission position is **opposite at the two
nesting levels**, purely by accident of CWT declaration order:

| Level       | Declaration order                                                       | Effect                           |
| ----------- | ----------------------------------------------------------------------- | -------------------------------- |
| initializer | `planet` at `solar-system-initializer.ts:380`, `change_orbit` at `:388` | emits **after** planets — broken |
| planet      | `change_orbit` at `planet-initializer.ts:183`, `moon` at `:294`         | emits **before** moons — correct |

So the planet-level case, which the ticket currently records as "already correct
and should stay that way", is correct only because the rules happen to declare
those keys in that order. A reordering upstream would silently break it, and the
workaround that rescues the moon case works by luck rather than design.

Also: `PlanetInitializerFields.changeOrbit` is a single `number`
(`planet-initializer.ts:99`), so a planet spacing N moons with N `change_orbit`
lines can carry only one. Four vanilla planet blocks write more than one. And the
`{ min, max }` arm (CWT:74-75, 5 vanilla uses) is missing entirely.

**Decision (2026-08-03): delete the field concept.** The alternative — building a
runtime shape for a heterogeneous ordered sequence, plus its writer case and an
overlay row declaring the two keys one sequence — was rejected as a project's
worth of new machinery for a spelling the game already documents as sugar.

Dropping `changeOrbit` from `SolarSystemInitializerFields`,
`PlanetInitializerFields` and `MoonInitializerFields` removes a concept rather
than adding one, and disposes of the missing `{ min, max }` arm and the
single-`number` limit along with it. The long form typechecks today (`none` is in
`SolarSysInitPlanetClass`, `generated/enums.ts:376`):

```ts
const advanceOrbit = (distance: number): PlanetInitializerFields => ({
  class: "none",
  orbitDistance: distance,
});
```

**Two things the implementer needs to know.**

_This will be the first entry in `CONTENT_DECLINED_FIELDS`_, which is
`new Map([])` today (`overlay.ts:349`) and which `AGENTS.md` says "should stay
that way: a field whose lowered shape is wrong is better measured and fixed than
withheld".

That rationale does not cover this case, and the row's comment should say so.
`change_orbit` is not a field whose lowered shape is wrong — it is a _second
spelling_ of a capability the SDK already emits correctly. Declining it withholds
nothing; it removes a broken duplicate. That is a different bar from the one
`AGENTS.md` rejects, and clearing it is what makes this a justified exception
rather than the start of a dumping ground. `AGENTS.md`'s line wants updating in
the same change: the table has exactly one entry, and this is the bar for a
second.

_Reported coverage for `solar_system_initializer` will drop, and nothing will
fail._ The corpus gate reports coverage rather than asserting it
(`corpus-conformance.test.ts:9-11`); only `form`/`scope` mismatches are asserted
against `ACKNOWLEDGED`, and a declined field has no lowered type to mismatch. Note
the drop in the codegen report rather than chasing it.

**Also in scope.** The README's "Nested content stays nested" section documents
the limit and the old 280/360 number; it should document the long form instead.
The ticket's original scoping question — whether another registry has the same
positional-sibling pattern — only mattered for the rejected route and can be
dropped. (`asteroid_belt` and `orbital_line` sit in the same body and are _not_
positional: belts carry an absolute `radius`, CWT:32.)

**Verify.** Re-port `unique_system_initializer_02`
(`unique_system_initializers.txt:152-276`) and diff emitted against source; its
three interleaved `change_orbit` lines are the case. `probe-system-init` has the
port already, written against the long form.

## SDK-48 — Modifier `desc` localization keys are positional

**Symptom.** `content.ts:1313` derives the key from the array index:
`${ownerId}_${fieldPath}_${index}`. Demonstrated — inserting one row at index 2
of an 11-row `monthly_progress` repoints `_2` from "The Flesh is Weak" to the new
row and shifts everything below.

**Why it is worse than cosmetic.** English regenerates and looks fine. Any
shipped translation is silently misaligned — no build error, no symptom until a
player reading that language sees the wrong tooltip. Vanilla uses stable
hand-authored keys.

The doc comment there claims the key is "deterministic across runs, and never
collides" — both true, and neither is the property that matters.

**Fix.** An optional author-supplied slug (`descKey`) falling back to the index,
or a hash of the desc text. Worth auditing for other index-derived keys.

## SDK-50 — Identity-conversion text fields silently emit English as a key

**Symptom.** `archaeological_site_type.desc` is `conversion: "identity"` — a raw
key with no way to define its text. Writing English there emits
`desc = "The asteroid reads hollow on every scan."` verbatim, with **no warning
and no error**. The game shows the key.

**Narrowed by the situation probe:** this is _not_ a design position. Every text
slot on `situation_type` does the right thing. So it is a missing
`REQUIRED_LOCALISATION` row.

**Fix.** Three parts, increasing in value: add the missing row (and the
`ArchaeologicalSiteTypeDesc.text` arm); **audit every registry** for the same
omission, since the signature is an `identity`-conversion text field and it fails
silently every time; and make the silent case loud — reject a string that cannot
be a loc key, or warn when one contains a space.

Distinct from SDK-15 (unattached keys) and SDK-44 (conditional requiredness).

## SDK-42 — `government_trigger` `or`/`and` arrays silently emit a conjunction

**Symptom.** `or: [{ authority }, { civics }]` emits two sibling `OR` blocks,
which the game **ANDs**. Vanilla `civic_franchising`'s "corporate authority _or_
the sovereign civic" becomes "_and_". `or: [{ authority, civics }]` — one
element, two members — is correct.

**Why it is defensible and still wrong.** The array is repetitions of the `OR`
key, per `alias[government_trigger:OR]` (`governments.cwt:919-925`). So the API
follows the rules — and `or: [a, b]` reads as `a OR b` to anyone writing
TypeScript. The clause-level `or`/`not`/`nor` carry the _other_ meaning under the
same names.

**Evidence.** **55 vanilla blocks contain exactly one direct `OR`; zero contain
two or more.** The repeated arm has no corpus precedent; the misreading it
enables inverts a gate.

**Fix.** Pin the arity via a `CONTENT_FIELD_OVERRIDES` `arity` assertion, or
rename the member (`orGroups`) so the array level is visible.

---

# Missing surface

## SDK-46 — `EventDef` omits 14 of 20 declared event fields

**Blocking instance.** `events.cwt:503` declares `archaeology = bool` on
`subtype[fleet]` — what makes the game render a fleet event in the excavation
window. Every vanilla dig-stage event sets it. `EventDef` (`events.ts:79`) has no
member and no escape hatch, so **arc sites cannot be shipped**. The only route is
rebuilding the emitted entry through the PDXScript AST by hand, which requires
knowing that `PdxValue` narrows on `"container"`, that `block()` wants
`PdxEntry[]` where `items` is `PdxItem[]`, and that spreading preserves `refs`
and `locEntries`.

**General shape.** `EventDef` is hand-written while content registries are
generated. Of 20 unconditionally-declared keys it covers 6 and omits 14,
including `trigger`, `mean_time_to_happen`, `location`, `abort_trigger`,
`event_chain`, `major`, `trackable`. `EventOption` omits nine more.

**Decision, not just a fix.** Either generate the event surface (bringing it
under the existing drift gate) or accept the gap list as a backlog. Minimum to
unblock arc sites is the five subtype window flags.

**Resolution.** Kept hand-written per the ticket's explicit scope (generating
the event surface is a separate architectural decision, not taken here).
Added the five window flags (`archaeology`, `firstContact`,
`espionageOperation`, `astralRift`, `diplomatic`) plus `difficulty`, and 32
more `EventDef`/`EventOption` members — every unconditionally-declared field the
ticket named, `location` and `meanTimeToHappen` besides, all nine omitted
`EventOption` fields, and a second pass closing `diplomatic_title`,
`event_window_type`, `event_picture_background`, `notification_event_icon`,
`force_open`, `major_trigger`, and `weight_multiplier`. The four kind-gated
window flags condition their type on `S` (`S extends "fleet" ? boolean :
never`), so `defineCountryEvent({ archaeology: true })` is a compile error;
`diplomatic` and `major_trigger`/`weight_multiplier` are attribute subtypes
(driven by their own value — `diplomatic`, `major`, `isTriggeredOnly` — not
by the event's kind) and stay unconditional, matching the precedent
`hideWindow`/`isTriggeredOnly` already set. See `packages/sdk/src/events.ts`
and `packages/sdk/tests/event-fields.test.ts`/`event-fields.test-d.ts`.

Remaining gap list, precise by CWT site:

- Event inheritance (`base = <event>`, the `*_clear` directives,
  `events.cwt:159-171`) — a whole authoring mode, not a field.
- Repeated/conditional `desc` blocks (`events.cwt:200-209`) — `desc` here
  only supports the flat loc-key form; the conditional-array form is
  unmodeled.
- Repeated/conditional `picture` blocks (`events.cwt:213-231`) and
  `picture_event_data` (`events.cwt:233-285`) — same gap as `desc`, plus a
  large cosmetic nested structure of low authoring value.
- Repeated/conditional `show_sound` blocks (`events.cwt:296-302`) —
  `showSound` only supports the flat ref form.
- `option.name`'s conditional dual forms (`events.cwt:325-335`) — the corpus
  (`arcsite_events.txt`) uses the flat `name` + sibling `option.trigger` form
  exclusively, which is what's supported.
- `custom_gui`/`custom_gui_option` (event-level, `subtype[diplomatic]`,
  `events.cwt:476-478`) — niche diplomatic-screen customization.
- `pre_triggers` (`subtype[colony]`/`[carrier]`/`[country]`,
  `events.cwt:481-499`) — `colony_pre_trigger`/`country_pre_trigger` are
  their own restricted alias families, distinct from ordinary `Trigger<S>`;
  no existing SDK machinery authors a restricted trigger subset, so this
  needs new infrastructure, not just a field — correctly out of scope here.

## SDK-39 — `triggered_modifier` missing from tradition and `tradition_swap`

Declared twice in `traditions.cwt:68` and `:124`; zero occurrences in
`generated/tradition.ts`. 28 vanilla uses. `ascension_perk`, `edict`, `job`,
`councilor` and `situation_type` all have the `CONTENT_FIELD_OVERRIDES` row
(`overlay.ts:591-596`); tradition does not. Runtime already supports the shape
(`content.ts:922-928`). **Worth sweeping for other registries missing the same row.**

## SDK-40 — `component_slot_template` has no registry

`ComponentSlotTemplateRef` can never be constructed: no definer, no `vanilla.*`
helper, no `stellaris-ids` registry. `components.cwt:27-30` declares it a
first-class type under `common/`. **3,019 `component_slot` rows** across 414
section templates, from a closed vocabulary of **31**. Two halves: add to
`stellaris-ids`, and add to `CONTENT_MANIFEST`. Depends on SDK-41.

## SDK-41 — Install-derived vocabularies

Two findings, one shape. **Half 1:** four generated enums are unnarrowed
`= string` — `ShipClass`, `SectionSlot`, `ComponentSlot`, `ComponentTag` — and
they are the ship cluster's actual joins. The `sectionSlots` ↔ `fitsOnSlot` link
decides whether a section mounts at all and is `string` on both ends.
**Half 2:** `VANILLA_REF_EXTRAS` has four entries, so 17 of 18 vanilla ids in the
system-initializer port were unchecked. Demonstrated: `sc_neutron_starrr`,
`pc_barrenn`, `d_physics_55555` all pass `tsc` _and_ a vanilla-view build
silently.

Both are the same emit pattern in `codegen-vanilla` plus lowering in
`codegen-cwt`. Corpus sizes for the `oversized` decision: deposits 587, anomaly
categories 327, planet classes 78, star classes 45. **No script body is read, so
the `PROVENANCE.md` chokepoint is untouched.** Do this before SDK-40 and SDK-51.

## SDK-51 — A vanilla event cannot be referenced or fired

`on_visible = { country_event = { id = story.5 } }` is on essentially every
vanilla arc site. Fire effects take a branded `EventRef` and there is no
`vanilla.event(...)`. The workaround is a hand-forged object literal that
compiles only because the FROM brand is optional. Note the asymmetry: declarative
fields are `Ref | string` so `stage[].event` takes a raw id, but the effect
recorder does not. Depends on SDK-41.

## SDK-49 — The `fixture` harness models only country and planet

`SimScopeName = "country" | "planet"` (`sdk-testing/src/state.ts:23`). Both
single-registry probes hit it; both fell back to regexing emitted script.

**It inverts the testing package's value proposition:** the features simple
enough to verify by inspection are testable, and the ones with enough logic to
warrant a test are not. A situation is almost entirely arithmetic — an 11-row
progress calculation with variables and thresholds is exactly what you would want
to assert on.

**Fix.** Widen `SimScopeName` (`fleet`, `situation`, `archaeological_site` are
what these probes needed), and independently make the unsupported-scope case a
_diagnosis_ rather than an assignability failure — the current error names
`SimScopeName` but never says the harness models two scopes out of ~40.

---

# Smaller

## SDK-43 — Scripted trigger bindings have no negated form

`isMachineEmpire(false)` is a compile error while the native `isNomadic(false)`
beside it compiles — nothing at the call site distinguishes them.
`scripted.ts:189-200` hard-codes `kv(name, true)` for the parameterless case.
**7,746 negated call sites** against 23,174 affirmative. Fix:
`ScriptedArgs<TriggerParams<N>>` becomes `[value?: boolean]` when the param list
is empty.

## SDK-44 — Conditionally-required localization is always optional

Two slots the rules require and the SDK does not. `tradition_swap.name` is
required unless `inherit_name = yes` (`traditions.cwt:22-38`); marked
`required: false` unconditionally, and **116 of 180** vanilla swaps are in the
requiring subtype. A probe wrote four swaps with no name, built clean, and
emitted four that render as raw keys. Separately, `global_ship_design` has **no
name member at all** — the emitter handles `localisation = { name = "$" }` but
drops the `localisation = { name = name }` form, which five other CWT types also
use.

## SDK-52 — Situation approach ids unchecked against their own definition

`SituationApproach = string` (`enums.ts:364`), so
`currentSituationApproach("...")` accepts anything — while the approach is
declared twelve lines away in the same object literal. `SituationStage` likewise.
Cheaper than SDK-41's enums because it needs only the definition's own record
keys, not an install-derived vocabulary.

## SDK-45 — Three small type and scope corrections

`EconomicResourceBlock.category` is hand-written as `TypedRef<"economic_category">`
(`content.ts:90`) while every generated helper produces the wider
`EconomicCategoryRef` (`refs.ts:222`), so `vanilla.economicCategory("ships")` does
not typecheck into it — one line. `ship_size.modifier` is
`ModifierClosure<"starbase">` though `ship_sizes.cwt:107-116` declares the field
twice and a corvette is `!starbase` (latent: all 14 modifier names vanilla writes
there typecheck anyway). `civic_or_origin` clause `value` is singular where
`governments.cwt:756` allows `0..2` (corpus-correct: zero of 878 blocks use two).

## SDK-53 — Six authoring ergonomics friction points

Module basenames must be snake_case, enforced at runtime rather than compile
time. `Trigger` has no methods, so the fluent `.and()` fails. `and()` always
emits an explicit `AND` wrapper, making vanilla diffs noisy. Iterators require
`{}` when the only member is optional. `situation.target<S>` restates
`targetScope`. `vanilla.sprite`/`soundEffect` are callable tries and do not
surface alongside the 35 `export function` accessors.

## SDK-54 — `create-stellaris-mod` config side effect

In the generated project `config` lives in `src/index.ts`, which is also the
build entrypoint with a top-level `await write(...)`. So importing `config` runs
the build and writes `out/` — `npm run install-mod` builds twice (the second
without a vanilla view, silently skipping the collision checks), and a test
wanting the prefix writes to disk. Fix: move `config` to `src/mod.ts`. Templates
are at `packages/create-stellaris-mod/src/templates/`.

---

# Also tracked, not from these probes

Existing tickets these findings touch or depend on:

- **SDK-11** — corpus gate not seeing block interiors. Plausibly _why_ SDK-31 was
  never caught: the gate would have flagged 1,193 vanilla definitions writing a
  field the SDK cannot author.
- **SDK-15** — standalone localization API. Adjacent to SDK-50 and SDK-44.
- **SDK-18** — scripted variables. Covers the 2,314 `@scripted_variable` operands
  that SDK-47 does not.
- **SDK-24** — scope-narrowing combinator. A narrower case than SDK-33.
- **SDK-20** — `component_tags`. Overlaps SDK-41's `ComponentTag`.

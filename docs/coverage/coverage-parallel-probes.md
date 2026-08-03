# Coverage probes: four registries in parallel

> **Findings, 2026-08-03. Nothing implemented yet.** Four consumer-side probes run
> concurrently, same method as `coverage-arc-site-dogfood.md` and
> `coverage-situation-dogfood.md`: port a real vanilla feature against the shipped
> packages from a mod project outside this repo, and record what it costs. Every
> claim below was re-verified against the rules and re-measured against the
> installed game before it was written down; counts are this document's own, and
> differ from the probes' by a few percent where the parse differed.
>
> **This document is organised by defect, not by registry.** That is the result:
> three defects were hit independently by three or four probes each, through
> different registries and in some cases different causes. Each is one fix across
> the generated surface, not several registry-specific patches.

## Subjects

| Registry                                                                  | Ported from vanilla                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `solar_system_initializer`                                                | `unique_system_initializer_02` (Larionessi Refuge) — 7 planet bodies, 2 moons, 12 deposit operations, an arc site, a DLC branch |
| `civic_or_origin`                                                         | `civic_fanatic_purifiers` and `origin_syncretic_evolution` — both subtypes                                                      |
| `tradition` + `tradition_category`                                        | the complete Prosperity tree — 1 category, 7 traditions, 23 `tradition_swap` blocks                                             |
| `ship_size` + `section_template` + `component_template` + `component_set` | a corvette hull end to end, plus the `global_ship_design` that joins them                                                       |

All four ports build, pass their own tests, and are field-complete against their
sources except where a finding below prevented it.

---

# Part 1 — Convergent defects

## A. `Trigger<ScopeName>` is unsatisfiable, so an unscoped field is unauthorable

**Hit by all four probes, through five registries, from two distinct causes.**

`Trigger<in S>` is contravariant (`packages/sdk/src/trigger-core.ts:32`). So
`Trigger<ScopeName>` does not mean "any scope" — it means "legal in _every_
scope", and only **112 of the 1,054** generated trigger functions satisfy it. A
field typed that way rejects essentially every real condition.

There are **157 occurrences** of `Trigger<ScopeName>` across
`../../packages/sdk/src/generated`. Some are legitimate `links.ts` helpers; the
content-field cases are not.

| Field                                                                    | Probe       | Why it is `ScopeName`                             | Vanilla uses rejected            |
| ------------------------------------------------------------------------ | ----------- | ------------------------------------------------- | -------------------------------- |
| `solar_system_initializer.usage_odds`, `neighbor_system.trigger`         | system-init | CWT silent                                        | 189 of 306 condition occurrences |
| `tradition_category.desc.trigger`                                        | tradition   | CWT silent                                        | **25 of 25**                     |
| `civic_or_origin.swap_type.trigger`                                      | civic       | CWT silent (prose states country scope)           | 41 of 56                         |
| `civic_or_origin.modification.add`/`.remove`                             | civic       | **CWT annotates the container, codegen drops it** | 33 of 142                        |
| `ship_size.triggered_ship_roles[].trigger`, `section_template.ai_weight` | ship        | CWT silent                                        | —                                |

Also carrying the shape: `ship_size.selectable`, `.potential_construction`,
`.possible_construction`, and fields on `economic_category` and
`graphical_culture`.

### Two causes, two fixes

**Cause 1 — CWT says nothing.** Codegen's response to silence is the strictest
possible type. It should be the loosest: emit `Trigger<never>` / `WeightBlock<never>`,
which under contravariance accepts every trigger. "The rules did not say" should
lower to _unchecked_, the way an unknown reference target already lowers to
`| string` — not to _impossible_. This is a one-word change covering every field
in the table.

**Cause 2 — CWT does say, on the container.** `governments.cwt:430` puts
`## replace_scopes = { this = country root = country }` directly on the
`modification` block whose members `add`/`remove` are, and the generated members
are still `Trigger<ScopeName>` (`generated/civic-or-origin.ts:74-75`). The
sibling fields whose annotation sits on the field itself come out correctly
(`playable`/`ai_playable` → `Trigger<"no_scope">`). `structShape` forwards the
enclosing definition's `FieldContext` to members unchanged
(`packages/codegen-cwt/src/emit/fields.ts:789`), never folding in the container
field's own parsed `scope`. This one needs a real fix in the nested lowerings and
a full generated-diff review, since it will change scope types elsewhere.

Where the scope is _known_ despite CWT's silence, a `CONTENT_FIELD_OVERRIDES`
`scope` assertion buys real checking rather than merely unblocking — AGENTS.md
already names this case. Two have evidence ready: `usage_odds` → `system`
(189 occurrences plus the game's own `example.txt:148`, "this = galactic_object"),
and `tradition_category.desc.trigger` → `country` (25/25, plus the `country`
annotation on the sibling `potential`).

Every probe independently wrote the same workaround — a cast or a re-label
through the exported `trigger()` constructor — which is the strongest possible
signal that the type is not doing the job it exists for.

## B. `WeightBlock` is much narrower than `modifier_rule.cwt`

**Hit by three probes. Two separate omissions.**

```ts
export interface WeightBlock<S extends ScopeName, M extends Modifier<S> = Modifier<S>> {
  readonly base?: number;
  readonly modifiers?: readonly M[];
}
```

`modifier_rule.cwt:1-3` declares three things at that top level: `base` (float),
every member of `complex_maths_enum` (`value_field`), and every member of
`simple_maths_enum`. `complex_maths_enum` is `set weight add subtract factor mult
multiply divide modulo round_to max min pow`. The SDK models one of fifteen.

**Omission 1 — top-level operations other than `base`.** Measured over the
installed `common/`:

| Scope                                     | blocks | direct `factor` | direct `weight` | direct `base` |
| ----------------------------------------- | ------ | --------------- | --------------- | ------------- |
| `common/traditions/` `weight`+`ai_weight` | 293    | **292**         | —               | 1             |
| `common/tradition_categories/`            | 33     | 30              | —               | 2             |
| every `ai_weight` under `common/`         | 4,064  | —               | **2,255**       | 848           |

In `common/traditions/` the SDK expresses the spelling used **once** and cannot
express the spelling used **292 times**. Across all `ai_weight` blocks, the
unsupported `weight` outnumbers the supported `base` by 2.7 to 1. The workaround
— routing the value through an unconditional `modifier = { factor = N always = yes }`
row — is semantically identical and appeared in 29 places in the tradition port
alone.

`Modifier` already models `factor`, `add`, `weight`, `subtract`, `mult`,
`multiplier`, `divide`, `minValue`, `maxValue` at the _row_ level
(`effect-core.ts:220-229`), and its doc comment says the member set was chosen by
measuring the corpus. The same measurement was evidently never done at block
level.

**Omission 2 — the non-`modifier` row kinds.** `modifier_rule.cwt:15-30` declares
`scaled_modifier` and `:32-53` declares `complex_trigger_modifier` in full. Neither
appears anywhere in `../../packages/sdk/src`. **552 occurrences** of
`complex_trigger_modifier` across 42 files in `common/`. The system-init port had
to silently drop the row that scales its spawn odds by the galaxy's
habitable-worlds setting — the one behavioural divergence in that port.

## C. The reference-integrity guard has three blind spots

**Hit by three probes, three distinct causes, one symptom: a mod's own ids stop
being checked.** This is the SDK's headline safety property silently not holding.

**C1 — a bare `referenceName` cannot answer a qualified target.**
`registriesByTarget` (`build.ts:526-536`) registers a _qualified_ `referenceName`
under both its qualified and bare forms; the comment there spells out that
intent. `civic_or_origin` registers unqualified, while every field holding one
targets `civic_or_origin.civic` or `.origin`. That target matches no key, and
`build.ts:554` reads an unmatched target as "nothing here could have defined it"
and skips. The handled direction is qualified→bare; the missing one is
bare→qualified.

The type layer fails independently and for the same reason: `CivicOrOriginRef` is
branded `"civic_or_origin" | \`civic_or_origin.${string}\``— a union satisfying
neither subtype ref — and`vanilla.civicOrOrigin`is the only constructor there
is.`@pdx-ts/stellaris-ids` carries one flat id union with no subtype split, so
there is no checked way to build either subtype ref at all.

`ship_size.required_component_set` fails identically via
`component_set.required_component` (780 vanilla rows across 34 ship-size files) —
a subtype qualifier with no split registry behind it. Verified directly: a
dangling `requiredComponentSet` **built cleanly and emitted the dangling id**,
while a dangling `useShipnamesFrom` threw as it should.

The blast radius reaches past content fields: `hasCivic`, `hasValidCivic`,
`hasInvalidCivic`, `hasOrigin`, `forceAddCivic`, `forceRemoveCivic`, `setOrigin`
and `councilor.civic` all name the same subtype targets.

**C2 — nested definition ids never enter the known-id set.** `builtIds`
(`build.ts:537-543`) is populated purely from top-level `defined.id`.
`ContentAuthoring` already tracks nested ids in `this.nestedIds`
(`content.ts:1093`) for the prefix and duplicate checks, but they are never
folded in. Consequence: a mod cannot reference its own `tradition_swap` —
`hasTradition("dogfood_<swap id>")` **throws at `buildMod`**. `traditions.cwt:16-21`
declares `type[swapped_tradition] { base_type = tradition }`, and vanilla makes
**135 such references** from outside `common/traditions/`. The only workaround
(mis-prefixing the swap so the guard skips it) trades away the collision
guarantee the guard exists to provide.

**C3 — a clause field records no target at all.**
`GOVERNMENT_TRIGGER_CLAUSE_FIELDS` lowers `value` with `conversion: "ref"` and no
`refTypes` (`generated/government-trigger.ts:60-86`), so `potential`/`possible`
references are never recorded even before C1 discards them. 203 `civics` and 104
`origin` clauses in the vanilla civic files.

### The control that makes this credible

The civic probe wrote a **control test**: `defineTechnology({ prerequisites: ["dogfood_tech_does_not_exist"] })` throws in the same project, proving the guard is
live, while both civic cases pass silently. That is the right experimental design
and it is why C1 is reported as fact rather than suspicion.

---

# Part 2 — Blocking registry findings

## 1. Component templates cannot declare `resources` or `modifier`

**A shield that costs nothing and grants nothing.** No member exists for
`resources`, `modifier`, `ship_modifier`, `ship_design_modifier`,
`triggered_ship_modifier` or `triggered_ship_design_modifier` on any of the three
component registries. The writer iterates the declared `ContentField[]`, so an
undeclared member is dropped even past a cast, and content items carry a `def`
rather than a lowered entry — so the AST escape that works for `EventDef` does
not apply here.

CWT declares them on all three subtypes: `components.cwt:186`, `:335`, `:402`
(`resources`); `:207`, `:422` (`modifier`); `:210`, `:343`, `:425`
(`ship_modifier`).

Measured over `common/component_templates/`: **1,193 of 1,500** component
templates (80%) write a top-level `resources`, and **355** write a top-level
`modifier`. Every armour, shield, reactor, thruster and sensor in the game is
`modifier` plus `resources` and little else. **The utility component registry is
unusable for its purpose**, and no component of any kind can be given a build cost.

**The cause is precise and the fix is small.** `grep component_template
packages/codegen-cwt/src/overlay.ts` returns **zero**. Every other registry with
these shapes has its `CONTENT_FIELD_OVERRIDES` rows — `ship_size.modifier`
(`overlay.ts:887`), `ship_size.resources` (`:894`, `:901`),
`section_template.resources` (`:1000`, `:1008`, `:1017`) — and those prove the
machinery works. One extra decision: weapon and strike-craft `resources` splice
`economic_template_no_produce` rather than `economic_template`, so `produces`
should not be authorable there, a distinction `EconomicResourceBlock` does not
model today.

## 2. Two component kinds in one module silently lose one of them

**Reproduced independently, from scratch, in fifteen lines.** One `collection`
holding a `defineWeaponComponentTemplate` and a `defineUtilityComponentTemplate`
emits one file containing only the weapon. `mod.warnings` is `[]`. The utility
component is gone from every `.txt` — but its localization is still emitted,
because loc is registered from the definition rather than the file, so the `.yml`
advertises a component that does not exist.

`utility_`, `weapon_` and `strike_craft_component_template` are the **only three
of the SDK's 35 registries sharing an `outputDir`** (`content-registry.ts:181`,
`:190`, `:199`) — and they share it because the game does
(`components.cwt:31-33`). The emitted path is `<outputDir>/<prefix>_<stem>.txt`,
and `render` writes into a `Map` keyed by that path (`render.ts:24-25`), so the
second `set` overwrites the first.

This is the sharpest finding in the set, because the layout that triggers it is
the one the SDK **actively teaches**: "one feature module fans out across every
registry it defines into". An author following the documented pattern ships a
broken mod with no symptom but a missing component in game.

Fix: group content files by `relPath` before serializing rather than by registry
(registry declaration order then id keeps it deterministic). At minimum,
`buildMod` must throw when two registries resolve to the same `relPath`.

## 3. `change_orbit` is positional in the game and a hoisted field in the SDK

Stellaris ships the proof in its own commented reference:
`common/solar_system_initializers/example.txt:128` reads _"The following is
shorthand, equivalent to `planet = { class = none orbit_distance = X }`"_,
directly above a `change_orbit = 30`. A planet's `orbit_distance` is measured from
the _previous_ planet (`example.txt:87`), so position is load-bearing.
`solar_system_initializers.cwt:72-75` gives it `cardinality = 0..inf` and the
subject writes `change_orbit = 15` twice — only meaningful as a cursor operation.

The SDK models it as `changeOrbit?: number[]`
(`generated/solar-system-initializer.ts:253`) and emits every value after every
planet, where it shifts nothing. No error, no warning; the mod builds clean and
the geometry is silently wrong. **288 of 355 vanilla initializers (81%)** place at
least one `change_orbit` between two planets.

**The field's emission position is opposite at the two nesting levels**, by
accident of CWT declaration order — `planet` (`:380`) before `change_orbit`
(`:388`) at the top level, but `change_orbit` (`planet-initializer.ts:183`) before
`moon` (`:294`) one level down. So the workaround that rescues the moon case
works by luck. That argues for deleting the concept rather than repositioning it:
per the game's own documentation `{ class: "none", orbitDistance }` _is_
`change_orbit`, so dropping the field removes a concept instead of adding one —
and disposes of the missing `{ min, max }` arm (CWT:74-75) at the same time.

---

# Part 3 — Other verified findings

**`triggered_modifier` is absent from `TraditionFields` and `TraditionSwapFields`.**
Declared twice in CWT (`traditions.cwt:68`, `:124`), zero occurrences in the
generated file, 28 vanilla uses. `ascension_perk`, `edict`, `job`, `councilor` and
`situation_type` all have the overlay row; `tradition` does not. Purely a missing
`CONTENT_FIELD_OVERRIDES` row.

**`component_slot_template` has no registry at all.** The ref type
`ComponentSlotTemplateRef` can never be constructed: no definer, no `vanilla.*`
helper, no `stellaris-ids` registry. `components.cwt:27-30` declares it a
first-class type under `common/`, squarely in remit. 3,019 `component_slot` rows
across 414 vanilla section templates, drawn from a closed vocabulary of **31**
slot templates — a 31-member union would check all 3,019.

**Four generated enums are unnarrowed `= string`, and the cluster's actual joins
are among them.** `ComponentSlot`, `ComponentTag`, `SectionSlot`, `ShipClass`.
That makes free-form strings of `ship_size.class` (required on every ship size)
and of the `sectionSlots` keys ↔ `fitsOnSlot` link that decides whether a section
can be mounted at all. These are `complex_enum`s whose members come from the
install — exactly what `@pdx-ts/stellaris-ids` exists to supply, and it carries
only id registries today. No script body is read, so the licensing chokepoint in
`PROVENANCE.md` is untouched.

**Vanilla ids in system initializers are unchecked.** 17 of the 18 ids in that
port are bare strings — planet classes, star classes, deposits. Demonstrated, not
assumed: `sc_neutron_starrr`, `pc_barrenn` and `d_physics_55555` all pass `tsc`
_and_ a vanilla-view build silently and reach the emitted file. CWT declares every
one as a typed reference (`solar_system_initializers.cwt:22`, `:31`, `:155`,
`:208`, `:212`, `:216`). `VANILLA_REF_EXTRAS` has exactly four entries. Installed
corpus sizes for the `oversized` decision: deposits 587, anomaly categories 327,
planet classes 78, star classes 45.

**A `tradition_swap`'s display name is optional where the rules make it
conditionally required.** `traditions.cwt:22-38` requires a `$` localization for a
swap that does not write `inherit_name = yes`; `TRADITION_SWAP_LOCALISATION` marks
it `required: false` unconditionally. **116 of vanilla's 180 swaps** are in the
requiring subtype. The probe wrote four swaps with no name, built cleanly, and
emitted four swaps that render as raw keys in game — its own test caught it, the
SDK did not. `REQUIRED_LOCALISATION` keys on registry types and has no way to say
"required unless `inheritName`".

**`or`/`and` on a `government_trigger` block silently emit a conjunction.**
`or: [a, b]` produces two sibling `OR` blocks, which the game ANDs — so vanilla's
"corporate authority **or** the sovereign civic" becomes "**and**". The array is a
list of repetitions of the `OR` key, not of operands, which is defensible from
`alias[government_trigger:OR]` (`governments.cwt:919`) and reads as the opposite
to anyone writing TypeScript. No error, no warning. **55 vanilla blocks contain
exactly one direct `OR`; zero contain two or more** — so the repeated arm has no
corpus precedent while the misreading it enables silently inverts a gate. Pin the
arity, or rename the member.

**Scripted-trigger bindings have no negated form.** `isMachineEmpire(false)` is a
compile error while the native `isNomadic(false)` beside it is fine — nothing at
the call site distinguishes them. Across the 595 names bound by
`@pdx-ts/stellaris-ids/triggers`: **7,746 negated call sites** in `common/` and
`events/` against 23,174 affirmative. `not(...)` works and emits
`NOT = { x = yes }` instead of `x = no`.

**`EconomicResourceBlock.category` is a one-line type bug.** Hand-written as
`TypedRef<"economic_category"> | string` (`content.ts:90`) while every generated
helper produces `EconomicCategoryRef = TypedRef<"economic_category" | \`economic_category.${string}\`>`
(`refs.ts:222`), so `vanilla.economicCategory("ships")`does not typecheck into
it. The one hand-written reference type in the content model is the one that
disagrees with the generated ones. Affects every registry with a`resources` block.

**`global_ship_design` has no localization slot.** `GLOBAL_SHIP_DESIGN_LOCALISATION`
is empty and there is no `name` member — the name key _is_ the id — so the design
shows its raw id in the fleet UI with no way to supply text. `global_ship_designs.cwt:8`
spells it `localisation = { name = name }` rather than the usual `name = "$"`
pattern, and the emitter handles only the latter. Distinct from the known
identity-conversion issue: there is no member at all, so the author cannot even
supply the wrong thing. Five other CWT types use the same spelling.

**`ship_size.modifier` is scoped `starbase` for hulls that are not starbases.**
`ship_sizes.cwt:107-116` declares the field twice, `subtype[starbase]` and
`subtype[!starbase]`, and codegen kept the first arm. Latent rather than blocking:
all 14 modifier names vanilla writes inside a ship size's `modifier` block
typecheck through the starbase recorder anyway. It does mean a starbase-only
modifier is accepted on a corvette.

**Minor, and possibly worth leaving.** `civic_or_origin`'s clause `value` is
typed singular; `governments.cwt:756` declares `cardinality = 0..2` with a
`GOVERNMENT_CIVIC_POINTS_BASE` define. Zero of the 878 vanilla clause blocks write
two, so this is corpus-correct but rules-incomplete.

---

# Part 4 — What held up

Worth recording, because the list above is not a verdict on the whole.

**The generic content model is doing real work.** Keyed sub-records lower to two
different PDXScript shapes with no per-registry code — `stages` as a container,
`approach` and `tradition_swap` as siblings keyed by `name`. `name_field`
registries just work: the author writes `id:` and gets
`ship_section_template = { key = … }` without learning the distinction. The `dual`
lowering needs no author input. `section_slots` as
`Readonly<Record<string, {locator}>>` is exactly right, and the overlay note
explaining why those keys are deliberately _not_ prefixed is the correct call.

**Cross-registry composition works where the target is a plain registry.** The
`global_ship_design` port names a ship size, a section template, a weapon and a
utility, and **all four arrive as branded values from their own definers**, ids
following automatically. A technology in a tradition slot is rejected on the
brand. The failures in Part 1C are all qualified or nested targets — the ordinary
case is sound.

**`government_trigger` shipped, and it is good.** `coverage-dawn-of-ascension.md`
lists `civic_or_origin` as blocked on the `alias_name[government_trigger]` family;
that is now **stale and should be corrected**. A nine-member real vanilla gate —
`value` + `OR` on ethics, five `NOR` groups with tooltip keys, two `NOT` — emitted
**byte-identical** to `civic_fanatic_purifiers`. All thirteen clause members
vanilla uses are present.

**The recursive planet/moon splice worked cleanly** — nested array literals,
correctly typed at every depth, with `PlanetInitializerFields` exported so a
repeated shape factors into a helper with no cast.

**`WithFrom` earned its keep**, reached for correctly on first try from the type
alone. **The modifier path recorder is genuinely pleasant**, and `m.raw(name, value)`
checked every flat name both probes threw at it. **Emission order is exact** —
which is what made the `change_orbit` workaround possible at all.

**Definition order for a tree is the order you want to write it in.** Adopt and
finish first, then the gating row, then the traditions that gate on it, then the
category naming them all — vanilla's file order and TypeScript's binding order
agree. `possible: hasTradition(supplyChainTheory)` reads better than vanilla's
string.

---

# Part 5 — Method note

Each probe ran in its own copy of the mod project sharing one `node_modules`
symlink into `../../packages`, which cost ~30ms per copy to set up and made
cross-probe interference impossible — necessary, because `discoverContent` and
`buildMod` are whole-mod operations and one broken module aborts the build for
everyone.

Each brief required a **"My own mistakes"** section, on the stated grounds that a
report claiming zero author errors would be treated as under-examined. That did
more work than any other instruction. Between them the probes investigated and
**dropped** a missing `solar_system_initializer_random_list` registry (zero vanilla
precedent), an `inline_script` "gap" (a text-substitution primitive whose
TypeScript equivalent is a shared const), a `planet.resource` shape complaint (the
SDK matches the rules exactly), a weapon-stats-CSV gap (the rules explicitly allow
the in-script form), and a codegen annotation-ordering hypothesis (wrong: the
real cause was a missing overlay row).

Two methodology errors are worth repeating because they generate false findings.
One probe ran a type-safety check from a file outside `../../tsconfig.json`'s `include`,
got zero errors, and nearly concluded cross-registry references were unchecked —
moving it into `src/` produced the expected four. Another assumed the vanilla view
would catch bad deposit ids at build time and nearly softened a finding to
"compile-time only"; testing the assumption strengthened it to "unchecked
anywhere". **Passing gates say nothing about whether the output is right** — every
one of the three silent-output findings above (`change_orbit`, the component
overwrite, the non-functional shield) was found by diffing emitted script against
vanilla, never by a green build.

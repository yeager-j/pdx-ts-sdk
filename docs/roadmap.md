# Content-breadth roadmap

> **Historical as of 2026-08-01 — tracking moved to Linear.** The remaining
> items below were filed as SDK-1 onward (SDK-20 and SDK-21 were split out
> later) in the
> [SDK MVP project](https://linear.app/unnamed-system/project/sdk-mvp-077fabda18d8)
> ("Dawn of Ascension" milestone; the two post-MVP items carry no milestone).
> Linear is now the worklist; this file stays as the design record behind
> those tickets. Evidence and measurements live in
> [coverage-dawn-of-ascension.md](coverage-dawn-of-ascension.md); design
> decisions in [handoff-vanilla-surface.md](handoff-vanilla-surface.md).

Yardstick: **Dawn Of Ascension** (Steam workshop `2816360131`). The goal is
being equipped to build a mod of that size, not porting it.

## Done

- [x] **Report field coverage per registry.** Codegen reports what it emits,
      declines, and cannot lower, instead of one flat exclusion list.
- [x] **`name_field` registries.** Registries whose top-level key is a repeated
      keyword with the id in a body field. The keyword is not derivable from the
      rules, so it is declared in the manifest and checked against any
      `type_key_filter` CWT does carry.
- [x] **Delete `CONTENT_EMITTED_FIELDS`.** Every field the emitter can lower is
      emitted. A field is out only if the emitter cannot express it — shape
      conformance retired the one `CONTENT_DECLINED_FIELDS` row, and the list is
      now empty.
- [x] **Emit every field inside repeated structs.** The emit-everything flip now
      reaches all the way down; nested overlay entries keep only what cannot be
      inferred.
- [x] **Corpus conformance gate.** `tests/codegen/corpus-conformance.test.ts`
      parses the installed game and measures each emitted interface against
      every shipped definition. Coverage is now "share of real field
      occurrences expressible", which predicts whether a mod is buildable.
- [x] **Scope links.** 87 typed navigation links in both trigger and effect
      position, generated from `links.cwt`; `target` is author-asserted plus
      a declared contract on situations. See the machinery section.
- [x] **Accept both scalar and block for dual declarations.** The picker merges
      a mixed scalar/block group into a `dual` of both arms, dispatched at write
      time by what the author passed; retired ~24 overlay rows and, once shape
      conformance could find them, eight more fields whose second form was
      unwritable.
- [x] **Shape conformance.** The corpus gate compares each lowered type against
      the values behind it, not just the keys. It retired the last declined
      field and found ten more dual declarations the picker had been silently
      halving.
- [x] **Per-definition field scopes.** Where CWT scopes a body `any` and is
      right, the definition declares its own scope and the unpinned fields
      follow it. Landed for `decision`; `ship_size`'s construction clauses turn
      out to be a different shape — the clause discovers its scope rather than
      the definition knowing it — and are SDK-24.
- [x] **Event kinds generated.** All 20 scoped kinds get `defineXEvent` and
      witnessed fire overloads from `EVENT_KINDS` + the effect rules.

## Registries

Landed: `technology`, `building`, `tradition`, `tradition_category`,
`ascension_perk`, `agenda`, `edict`, `decision`, `job`, `opinion_modifier`,
`scripted_modifier`, `casus_belli`, `war_goal`, `agreement_preset`,
`bombardment_stance`, `archaeological_site_type`, `global_ship_design`,
`utility_component_template`, `weapon_component_template`,
`strike_craft_component_template`, `scripted_loc`, `situation_type`,
`static_modifier`, `councilor`, `economic_category`, `civic_or_origin`,
`ship_size`, `component_set`, `section_template`, `ambient_object`,
`graphical_culture`, `starbase_level`, `species_class`,
`country_ship_of_size_limit`.

**34 registries, 27 of them at 100% real-corpus coverage.** The seven below
100% are all held there by the same handful of unlowered fields — `resources`,
`modifier`, `triggered_*_modifier` on the component templates and `building`,
plus `inline_script`, which is its own cross-cutting item.

Nothing is blocked any more: alias categories unblocked `civic_or_origin` and
the malformed-option drift block unblocked `councilor` and
`economic_category`. `civic_or_origin` is one type with `subtype[civic]` /
`subtype[origin]` split by `is_origin`, so there is no separate `civic`
registry to expose; its `potential`/`possible` lower onto the shared
`GovernmentTriggerBlock` rather than a `Trigger`, since the game reads that
position as the requirements DSL and not a script condition tree.

Every registry with a declared CWT type is landed. What is left was filed as
three "no CWT type" items and resolved as three different things (SDK-9):

- [ ] `component_tags` — not a content type but the declaration site for the
      open `enum[component_tag]` set, whose members generate modifier names.
      Moved to SDK-20 with its design; see
      [engine-keyed maps](#engine-keyed-maps) for why the trie cannot absorb it.
- [x] `country_limits` — the premise was wrong, it _does_ declare two CWT types.
      `country_ship_of_size_limit` landed as an ordinary registry;
      `country_ownership_limit` as an
      [additive contribution](#additive-contributions-to-engine-owned-objects).
- [x] `scripted_variables` — a TS `const` already is one, inlined. What inlining
      costs is ejectability, which is the
      [scripted-emission item](#emit-scripted-effects-triggers-and-variables).

## Machinery

### Scope links

**Landed 2026-08-01.** `owner = { ... }` — single-link scope navigation, legal
in both trigger and effect position — appears **8062 times** across vanilla's
`common/`. Codegen now reads `links.cwt` (93 declared links) and emits the
static scope links as **87 trigger functions** (`src/generated/links.ts`,
re-exported through `src/triggers.ts`) and **87 effect methods** folded into
the generated scope-interface clusters and `EFFECT_META`.

One classification feeds both positions (`tools/codegen/emit/links.ts`):

- Trigger position: free wrapper functions with input/output reversed relative
  to a `push_scope` iterator — the condition runs in the link's _output_ scope,
  the result is valid in its _input_ scopes:
  `owner(isAtWar())` is a `Trigger<"planet" | "ship" | …25 input scopes>`.
- Effect position: body-only closure methods —
  `planet.owner((country) => …)` emits `owner = { … }`. They ride the existing
  `{ kind: "wrapper", fields: null }` meta shape, so `src/effect-core.ts`
  needed zero changes; the recorder Proxy already dispatched it.

Not emitted by codegen, each named in the report:

- **`target` (`output_scope = any`) — resolved 2026-08-01, both ways at
  once.** The evidence settled it: CWT declares a situation's target nowhere,
  vanilla's observed targets span country/planet/ship/star/system/starbase/
  none (24% of `start_situation` calls pass no target at all, one passes a
  `$TARGET$` macro), but every individual situation type is consistent about
  its target kind. So navigation is **author-asserted** — the hand-written
  `target<S>(condition)` trigger and the `target<S>(body)` method on the four
  input scopes (runtime rides the STRUCTURAL table) — and the situation side
  is **declared**: `targetScope` on `defineSituationType` (emits nothing)
  makes `startSituation` require a matching `ScopeRef` witness via an
  overload merged into the generated signature (`src/situations.ts`).
- The 4 value links (`variable`, `script_value`, `modifier`, `trigger`) — RHS
  number producers, not navigation; they belong to a future script-value
  feature.
- `pop_faction_parameter` — data-driven (`from_data`, `parameter:` prefix).

Special scope references (`root`, `this`, `from`×4, `prev`×4) are deliberately
excluded: they are dump-only positional references with "Output Scope:
various", not links, and typing `root` needs definition-context threading — a
separate design. `ScopeRef` + `within` + `ctx.self` keep covering `this`,
`from`, and event targets.

The drift gate now joins `links.cwt` against the dump's `scopes.log` (`links`
in `drift-baseline.json`); the one genuine drift is `pop_group`, a real link
the dump omits. The testing interpreter is deliberately untouched — a link
reached in a world test fails loudly via the whitelist, and
`resolveScopePath` in `src/testing/interpret.ts` is the extension point.

This corrected the day-one survey, which concluded the expression layer held
up. That was based on spot-checking effect _names_ — every one resolved — and
never checked scope _navigation_.

### Repeated-struct field shape

**Landed 2026-08-01.** A field that repeats, each occurrence an anonymous
block with a fixed internal shape — usually a trigger plus payload. Distinct
from nested content definitions, which key by their own id; the writer must
emit N sibling blocks under one key.

Consumers cleared: `scripted_loc.text` (1152/1152, re-landing the registry —
was 43% before landing, `text` its whole reason to exist), `war_goal`
(87/87, was 95%), `agreement_preset` (56/56, was 83%, term_data's
`discrete_terms`/`resource_terms` lower through CWT's other repeated-struct
spelling — see "wrapped" below), `archaeological_site_type` (124/124, was
89%). All four now report 100% corpus coverage. `situations` landed on top of
it as `situation_type`, expressing both its `stages` (shape 1) and `approach`
(shape 2) fields.

The shape is inferred from CWT block structure, the same way `economicResources`
and `trigger`/`effect` already are — no overlay row was needed for any of the
four consumers above. An anonymous field whose type is a block of ordinary
named fields (no splices, subtypes, or computed keys — those bail out to stay
`unsupported` rather than silently drop content) lowers through the same
`pickOrdinary` pipeline used at the content type's own top level, recursively,
so a struct nested inside a struct (`term_data` containing `discrete_terms`)
falls out for free. Landing this also picked up struct-shaped fields nobody
had named as repeated-struct consumers — `building.triggered_desc`,
`bombardment_stance.kill_pop_amount`, ship-design `growth_stages`/`section`,
weapon/utility/strike-craft component template `friendly_aura`/`hostile_aura`
and others — moving `building` from 18 curated fields to 82% real corpus
coverage and similarly across the other component-heavy registries.

One collision the auto-inference surfaced: a body field can share a name with
a localisation slot without meaning the same thing — `building.desc`
(`single_alias_right[triggered_desc_clause]`, a repeated trigger+text struct)
is unrelated to the `desc` flavor text `type[building].localisation` already
claims for the TS member `desc`. Both succeeding would emit the same
interface property twice with different types, so the emitter now checks
every ordinary field's derived member name against the localisation plan
first and declines the collision (visible in the report as "collides with the
... localization slot") rather than emit a broken duplicate. **Resolved
2026-08-01**: an overlay `member` rename maps the colliding key to a distinct
authoring member — `building.desc`, `tradition_category.desc`, and
`situation_type.desc` all author as `conditionalDesc` while emitting the
game's `desc` key. (`triggeredDesc` was not an option: buildings carry a
separate real `triggered_desc` key.)

**Design settled 2026-08-01.** The game spells these three ways, but only two
matter to an author:

1. keyed container — `stages = { stage_1 = { ... } }`, id is the key
2. repeated siblings with a name field — `approach = { name = approach_a ... }`
3. repeated siblings with no id at all — `text = { trigger = { ... } ... }`

1 and 2 are the same thing spelled differently: a named, ordered collection
whose name is both identity and localization key. `99_README_SITUATIONS.txt`
confirms they localize identically — a stage's key and an approach's `name` each
take an optional `<key>_desc`. This is the same distinction `name_field` already
draws one level up, where a top-level registry keys either by the entry key or
by a keyword with the id in a body field, so the model reuses that concept
rather than inventing a second one.

So 1 and 2 both author as a record keyed by id, and 3 as an array:

```ts
stages: { stage_1: { ... } },                    // emits stage_1 = { ... }
approaches: { approach_a: { ... } },             // emits approach = { name = approach_a ... }
text: [{ trigger: ..., localizationKey: ... }],  // genuinely a list
```

The record form is what makes the id structural rather than just another field:
it cannot be omitted, it cannot collide, the mod prefix applies at one point the
way it already does for top-level ids, and localization rides the key for both
spellings instead of two separate stories. Insertion order carries the "list
your stages in the correct order" requirement, and the mod-prefix rule keeps
every key non-integer-like, which is the one case JS would reorder.

Two more things the implementation had to generalize beyond the three-shape
write-up above, both discovered against real corpus files rather than reasoned
from CWT alone:

- **Cardinality, not a fourth shape.** `war_goal.forbidden_peace_offers` has no
  id and cardinality `0..1`, not `0..inf` — CWT's own N=0-or-1 case of shape 3.
  The emitter does not special-case it: a shape-3 field's author-facing type is
  `T` or `T[]` by the same `repeated` flag every other shape already uses, so a
  singular fixed-shape block just falls out of the general mechanism.
- **A second CWT spelling of "repeated, no id."** Besides repeating a named
  field directly (`text = { ... }` written N times), CWT sometimes wraps the
  repetition as a bare anonymous block declared repeatable _inside_ a singular
  container field — `agreement_preset.term_data.discrete_terms = { ##
cardinality = 0..inf { key = ... value = ... } }`. Internally this is
  "wrapped": the container field's own cardinality is irrelevant, the
  repetition lives on the bare declaration, and the writer emits one field
  holding N anonymous nested blocks rather than N sibling entries at the same
  level. The author-facing type is the same `T[]` either way.

### Asserted field scopes

**Landed 2026-08-01.** `ContentFieldOverride` gained a `scope`, declaring the
scope a field's closures run in where CWT annotates none and the mechanical
fallback is wrong.

An unannotated field lowers to `Trigger<ScopeName>` / `ModifierClosure<ScopeName>`
— "valid in **every** scope". That is right when the scope genuinely varies (a
decision's own scope depends on its category) and wrong when the scope is fixed
but simply unannotated, and the wrong case produces a field that is emitted and
unfillable.

`country_ship_of_size_limit.show` is the worked example: CWT gives it no scope
_and_ no cardinality, so it is required, and all 7 shipped entries write a
country condition (`has_technology`, `has_origin`) that `Trigger<ScopeName>`
rejects. The corpus gate reported 100% regardless, because it only checks
whether a field is **present** — see [shape conformance](#shape-conformance).

Two rules the mechanism needs:

- the assertion **wins over a scope the rules do declare**, or a wrong upstream
  annotation would be unfixable
- an unknown scope name **throws** rather than degrading to `ScopeName`, since
  silently widening on a typo recreates the exact bug the row exists to fix

Deliberately one row, not a sweep: 20 content fields across 9 registries lower
to `Trigger<ScopeName>` and each needs its own judgment about whether the scope
is variable or merely unannotated. That belongs to shape conformance.

**Swept 2026-08-02, and it took no second row.** Shape conformance resolves
every scopeless field mechanically, and none of the 41 is the
`country_ship_of_size_limit.show` case again. They split three ways:

- **No evidence either way** (the majority). `graphical_culture.randomized`,
  `species_class.playable`, `ship_size.selectable` and the rest write only
  universal conditions and DLC scripted triggers, which constrain nothing. An
  assertion here would be a guess, and the row format exists to refuse guesses.
- **Never written at all** — `civic_or_origin.trigger`/`add`/`remove`,
  `economic_category.trigger`, `scripted_loc.trigger`, `tradition_category.trigger`.
  The `invented` report already names these.
- **CWT scopes them `any` on purpose**, and asserting over that would be
  overriding a decision rather than filling a gap. See
  [per-definition field scopes](#per-definition-field-scopes) — the type is still
  unfillable, but the fix is not a constant.

### Additive contributions to engine-owned objects

**Landed 2026-08-01.** Not every registry entry is a definition the mod owns.
`country_ownership_limit` has exactly one entry in vanilla, keyed `default`, and
the game reads that key **additively** — vanilla's own file notes that a second
`default` applies both its limits and the original's. Across the 31 installed
workshop mods, the two that touch this registry both write `default` and nothing
else.

So there is no id to author, and `defineCountryOwnershipLimit({ id })` would be
the wrong shape regardless of the mod-prefix rule — it would emit a file with no
observed precedent and a silent failure mode if the engine reads only `default`.
It authors as a contribution instead:

```ts
mod.addShipOfSizeLimits([titanLimit, dreadnoughtLimit]);
```

Takes `DefinedCountryShipOfSizeLimit` refs so the cross-reference stays branded,
accumulates across calls, collapses duplicates, and emits nothing when unused.

This is the first place the mod-prefix invariant was worth _not_ relaxing. The
rule is what makes `define` structurally incapable of overriding vanilla, which
is the guarantee the patch resolver stands on; the fix was to model the thing
correctly rather than weaken the rule. Still worth making the prefix a
per-registry property rather than a global axiom before the next engine-keyed
registry reopens it.

Open, and cheap to settle: CWT declares no `type_key_filter` here and vanilla's
commented example shows `name_of_ownership_limit = { ... }`, so a named key may
well be legal. An in-game check would collapse this back to an ordinary
registry.

### Engine-keyed maps

**Landed 2026-08-01.** Two shapes for a block keyed by names the _engine_ owns
rather than ids the mod invents — `structMap` for block values
(`section_slots = { mid = { locator = part1 } }`) and `scalarMap` for scalar
ones (`min_upgrade_cost = { alloys = 20 }`, from CWT's `{ <resource> = float }`).
Together they took `ship_size` from 88% to **100% across 319 definitions**.

The interesting part is that `structMap` and a repeated-struct **container** are
the _same_ declaration in CWT — a wildcard-keyed block inside a block — and mean
opposite things:

- a situation's `stages` key is an id the mod owns: mod-prefixed,
  duplicate-checked, localised, and ordered
- a ship size's `section_slots` key is `mid`, `bow`, `core` or the integer `1`:
  a name the engine and the ship models already agree on, which section
  templates reference by `slot = "mid"`

Nothing in the rules separates them, so the shape is **requested by the overlay,
never inferred** — the same precedent `weightedEvents` set for computed keys.
That is the whole justification for a second shape rather than a flag on the
first: prefixing `mid` would break every reference to it. Entry order is also
meaningless here, which is what makes a plain object safe — a repeated-struct
record leans on insertion order to carry a stage sequence and on its prefix rule
to keep keys non-integer-like, since JS iterates integer-like keys first. Slots
are addressed by name, so `1` sorting ahead of `mid` changes nothing.

`scalarMap` was built because a _second_ consumer turned up:
`civic_or_origin.leader_background_job_weight` (`{ <job> = int }`) had been left
on the machinery backlog when that registry landed, and
`ship_size.min_upgrade_cost` is the identical shape. Landing it retired the
backlog entry, so `civic_or_origin` also reached 100%. Keys stay `string`:
`TypedRef` is a branded object and cannot type a `Record` key, the same reason
an economic block's `amounts` is `Record<string, number>`. Closing that is the
[vanilla identifier package](#vanilla-identifier-package)'s job.

`lowerStruct` and `lowerStructMap` now share one `structShape` helper, so the
two differ only in how they locate the block and what they wrap the result in.

### Top-level unkeyed splice

**Landed 2026-08-01.** A definition body whose top level _is_ a spliced alias
clause, alongside ordinary named fields. `static_modifier` is the consumer:
`{ alias_name[modifier] = alias_match_left[modifier] icon = filepath … }`, so
vanilla writes `empire_base = { max_rivalries = 3 }` with the modifier names at
the block root. `mergeByName` keeps only `name` keys, so the splice was
invisible to the field model — the registry would have emitted a definition that
could set an icon but never a modifier.

The emitter now scans the flattened body for `aliasName` keys and lowers each to
one authoring member (`modifiers: ModifierClosure<S>`), emitted ahead of the
named fields to match both the rules' declaration order and vanilla's files. The
runtime shape is `inlineModifiers`, carrying a `member` and no `key` — there is
none to write — and the writer splices its rows rather than wrapping them.
Only `modifier` lowers; the other categories a body splices this way
(`game_rule`'s `trigger`, `script_value`'s `modifier_rule`, `deposit`'s
`resources_template_optional`) belong to types the manifest does not expose, and
are reported rather than given an invented member name.

Two things the corpus forced:

- **Coverage has to resolve the category.** A splice is one member covering
  thousands of legal keys, which no field list can enumerate, so `conformance`
  takes a separate `spliced` name set — counted as covered, never as `invented`.
  Resolved from the same `joinModifierScopes` codegen runs, `static_modifier`
  reports **99.5% across 3096 definitions**; the 18 residual keys are names the
  game's own dump omits, which is what `CustomModifiers`/`unchecked` are for.
- **`ModifierClosure<ScopeName>` was unusable.** The rules pin no scope to a
  static modifier's body, and the distributive `ScopedModifierRecorder` turned
  that into a union of every per-scope recorder with no member in common — not
  even `raw`, whose name parameter intersected to `never`. An unconstrained `S`
  is now checked first and without distributing, resolving to an any-scope
  recorder built from the union of all names. The trie's DAG dedup absorbs it
  entirely: **one** new interface, 3456 → 3457. This also fixed
  `situation_type.target_modifier`, which had the same defect.

### Accept both scalar and block where CWT declares a field twice

**Landed 2026-08-01.** A field group mixing a bare scalar with a
`modifier_rule` block now lowers mechanically to `number | WeightBlock<S>`
(dispatched by what the author passes), and a group of differing scalar literals lowers to their union — which made
`progress_direction = bidirectional` (and the two fields its subtype gates)
reachable for the first time. Pure `modifier_rule` splices now infer
`WeightBlock`/`WeightBlockWithLoc` without overlay help, the same way
`trigger`/`effect` splices always did.

This retired ~24 overlay rows (the six known dual declarations plus every
"modifier_rule blocks lower to a base plus gated Modifier rows" row) and
surfaced dual fields nobody had catalogued: `approach.ai_weight`,
`building.district_limit`/`empire_limit`/`planet_limit`,
`technology.cost`/`weight`, `scripted_loc.text.weight`. `building.ai_weight`
and `custom_storm_ai_weight` emit for the first time. The one upstream typo
(`total_progress`'s `value_int_field`) is normalized in `classifyScalar`
rather than overlaid.

Note the corpus gate reported no problem here, because it only checked whether
a field is PRESENT. Comparing the emitted type against real values is
[shape conformance](#shape-conformance), which would have flagged a
block-typed field whose 254 observed values are scalars.

**Generalized 2026-08-02, once shape conformance could see the rest.** The
weight case was not the only one — ten more fields are declared once as a scalar
and once as a block, and in every one the corpus writes both arms, so whichever
the picker dropped was a form no author could produce.

`valueOrWeightBlock` is now `dual`: a union of arms, each carrying its own
complete lowering, dispatched at write time by the form of the value the author
passed. Nothing about it is weight-specific any more — a scalar pairs with a
weight block, a struct, a repeated struct, a trigger or a bare value list
identically, because each arm lowers through the ordinary pipeline and the
writer resolves an arm by re-entering its own field loop. Eight of the ten fixed
themselves the moment it landed:

| field                           | arms                                       |
| ------------------------------- | ------------------------------------------ |
| `ship_size.construction_type`   | value_set member, or a list of it          |
| `ship_size.graphical_culture`   | bool, or a `<graphical_culture>` list      |
| `starbase_level.picture`        | `<sprite>`, or a trigger+picture block     |
| `situation_type.title` / `desc` | localisation key, or N trigger+text blocks |
| `archaeological_site_type.desc` | localisation key, or N trigger+text blocks |
| `civic_or_origin.modification`  | bool, or an add/remove trigger pair        |
| `species_class.randomized`      | bool, or a condition block                 |

Plus `archaeological_site_type.stage.difficulty`, a min/max block nobody had
catalogued, which fell out for free.

**What decides whether a dual is well formed** is not how many declarations
there are but whether the arms can be _told apart_ by the value the author
passed — the writer has one key and one member to work with. Two arms that both
author as arrays are indistinguishable, so `lowerDual` declines and the field
stays whichever arm the picker keeps. That is the standing case for
`situation_type.picture`, where CWT puts `cardinality = 0..inf` on both the bare
`<sprite>` and the trigger-gated block; `title` and `desc` dual cleanly only
because their scalar arm is `0..1`. `ship_size.graphical_culture` had the same
collision from a `0..2` on both declarations, resolved by an `arity` assertion —
the cardinality there reads as "at most one of each form", and no shipped ship
size writes the key twice in 263 definitions.

The runtime rule lives in one place: `acceptedForm` in `src/content.ts` maps a
lowered field to the authored form it accepts, and codegen imports it to decide
whether a pair of arms is distinguishable. Two copies of that rule would be two
opportunities to emit a dual the writer cannot dispatch.

Three fields are a different defect and remain acknowledged:
`global_ship_design.growth_stages`, `ship_size.triggered_ship_roles` and
`species_class.resources` lower to keyed blocks against a corpus that only ever
writes bare lists there. CWT declares one form and vanilla writes another, so
there is no second arm to admit — inventing one would be guessing at game
semantics from a shipped file.

### Make the corpus gate see inside nested blocks

**Landed with the corpus gate** (the repeated-struct descent shipped in the
same change that landed the gate; this section predates it). The honest
residue: plain `struct` fields (`on_monthly`, `triggered_blocked_desc`,
`term_data`) still count as one opaque top-level key, and descent stops one
level below a repeated struct — fixing either side alone would manufacture
false "unexpressed" entries, since the emitter's `nestedEmittedFields`
reporting is symmetric with the corpus walk. `CONTENT_REGISTRIES` already
carries the full walkable field tree if this is ever worth finishing.

### Shape conformance

**Landed 2026-08-02.** The other half of the corpus gate. The reader now records
what definitions write under each key — block or scalar, repeated or single,
which scalars, which inner keys — and `shapeConformance` measures the lowered
type against it. The emitter supplies the other side: `emittedFields` carries a
shape descriptor per field rather than a bare name, which is precisely what the
gate had been missing.

Four comparisons, split by what a disagreement proves:

- **form** and **scope** are asserted. The corpus writes it, so it is legal, and
  the emitted type cannot hold it — the field is unfillable however the rules
  read. New ones fail; the known ones are acknowledged with a reason in the
  test, and an acknowledgement whose defect is fixed fails too, so the list
  cannot rot in either direction.
- **arity** and **literal** are reported. A `T[]` the game happens never to
  repeat is still legal, and a stray scalar is usually an upstream spelling the
  game reads case-insensitively (`LARGE` for `large`, in two component
  templates).

The scope comparison is the one that needed a real idea rather than a
predicate. `Trigger<S>` is contravariant, so a field typed `Trigger<S>` admits
exactly the triggers legal in **every** scope S names — which makes an unpinned
`Trigger<ScopeName>` the _narrowest_ field type there is, not the widest. Resolve
each key vanilla writes inside the field to its own scope set (the same
`## scopes`-then-dump resolution the trigger and effect emitters run) and the
verdict falls out. Keys nothing knows — scripted triggers, scope links —
resolve to null and are skipped: they are the vanilla-surface backlog, not
evidence about the field holding them.

`CONTENT_DECLINED_FIELDS` is now empty. `job.auto_generate_description` became
an `arity: "single"` assertion in `CONTENT_FIELD_OVERRIDES`, which is the
`scope` assertion's exact sibling — both state game semantics the rules get
wrong, both need evidence rather than a reviewer's word, and shape conformance
is where that evidence now comes from. The field is authorable for the first
time instead of merely withheld. Asserting the arity narrows the declared
cardinality rather than special-casing the lowering, so the member type, the
runtime metadata and the shape descriptor cannot end up disagreeing about
whether the key repeats.

The blind spot named here — a field CWT declares twice, where both readings
satisfy a presence check — is exactly what it found ten more of, eight of them
since fixed. See
[accept both scalar and block](#accept-both-scalar-and-block-where-cwt-declares-a-field-twice).

### Per-definition field scopes

Shape conformance's other finding, and a genuinely new problem. Six fields were
unfillable not because anything was misread but because CWT scopes them `any`
_correctly_: `decision`'s `potential`, `allow`, `effect`, `on_queued`,
`on_unqueued` and `ship_size.potential_construction`. The rules say so in as
many words — decisions.cwt annotates `this = any` with a comment explaining
that a decision on a nomadic ship colony is ship-scoped and on a planet
planet-scoped.

The trouble is that "the scope varies per definition" and "no author can write a
condition here" are the same statement once `Trigger<S>` is contravariant: the
field admits only universal triggers, and vanilla writes `is_capital`,
`is_planet_class`, `add_modifier`, `free_housing`. Every non-universal condition
in all 111 shipped decisions is planet-valid, so the scope is not really free —
it is a function of the definition (a decision's category, a ship size's
construction site).

So the fix is neither a `scope` assertion nor widening: it is the definition
supplying its own scope.

**Landed for `decision` 2026-08-02.** A `CONTENT_SCOPE_PARAMETERS` row declares
the scopes a registry's definitions may run in and which one they run in
unstated; every field the rules left unpinned then takes that parameter, and one
authoring member names it:

```ts
defineDecision({
  id: "hg_jettison_cargo",
  name: "Jettison Cargo",
  scope: "ship",
  potential: hasShipFlag("hg_laden"),
  effect: (ship) => ship.removeShipFlag("hg_laden"),
});
```

`scope` emits nothing — it states a fact the engine already knows and the rules
decline to. Omitted, it is `planet`, which is what all 111 shipped decisions are
written against; the wrong choice is a type error at the first condition rather
than a mod that builds and misbehaves.

Four things this needed:

- **`NoInfer` on every parameterised field.** Without it TypeScript infers `S`
  from the `Trigger<S>` positions too, and those are contravariant, so it lands
  somewhere unrelated to what the author declared. `scope` has to be the sole
  inference site.
- **The definer's return type erases `S`.** `Trigger<"ship">` is not assignable
  to `Trigger<"planet">`, so a leaked `S` would put a ship decision outside its
  own registry's item union and break `collection([…])`. The definer is generic
  in its _parameter_ and erased in its _result_, the same split
  `defineSituationType` already uses for `targetScope`.
- **A field the rules do pin keeps its own scope.** `show_tech_unlock_if` is
  `Trigger<"country">` before and after: the parameter fills the gap rather than
  flattening the registry into it.
- **The gate stops acknowledging and starts checking.** `EmittedField.scope`
  gained a parameter form, and `fieldAdmits` reads it as "some declared scope
  takes this rule" — so the five acknowledged decision mismatches became a live
  check that the declared set covers what the corpus writes. Declare too narrow
  a set and it fails.

**`ship_size.potential_construction` turned out not to be this shape at all**, and
looking properly is what showed it. A decision is consistently one scope per
definition — `is_scope_type` appears in **zero** shipped decisions. A ship size's
construction clause is evaluated against several scope types and vanilla branches
on which, testing `is_scope_type` 13 times across those clauses and again inside
the scripted triggers they delegate to:

```
potential_construction = { is_scope_type = starbase  OR = { has_starbase_size >= … } }
```

So a scope parameter there would encode a false premise. `Trigger<ScopeName>` is
the correct type — "runs in an unknown scope" is exactly true — and what is
missing is a way to narrow _inside_ the clause: `inScope("starbase", condition)`,
the type-level counterpart of the runtime test vanilla already uses, sound
because a condition guarded by `is_scope_type` is simply false in other scopes.
That is SDK-24, and it waits on the vanilla scripted-trigger binding, since most
bodies here delegate to triggers the SDK cannot name yet.

Two mechanisms, then, for two different facts: **the definition knows its scope**
(a parameter) versus **the clause discovers it** (a narrowing combinator).

Worth revisiting: `decision.ai_weight` and `resources` are in this class too and
the gate cannot see them. A `WeightBlock`'s conditions live in its `modifier`
rows, one level below the keys the gate reads, so they were unfillable in
exactly the same way and appeared in no report. They are parameterised now
because the row covers every unpinned field, not because anything flagged them —
worth remembering that the gate's reach stops at the first level of a block.

### Bind vanilla scripted triggers and effects

`is_fallen_empire` appears 214 times in DoA and is in neither the generated
surface nor the CWT rules, because it is vanilla _script_ — vanilla ships ~1449
scripted triggers and ~1455 scripted effects in `common/scripted_triggers/` and
`common/scripted_effects/`.

Decided: opt-in scope assertion at the declaration, existence and `$PARAM$`
lists checked, only scope asserted. Body inference rejected. Downstream of the
vanilla identifier package. See
[handoff-vanilla-surface.md](handoff-vanilla-surface.md).

### Vanilla identifier package

Separate install-derived package, version-pinned to the game, closing the one
place the SDK knowingly degrades cross-content references to raw strings. Types
only, per-registry segmentation, identifiers never script bodies. Also carries
sound and picture names, which `decision.sound`, `event.picture`, and
`event.show_sound` currently take as `string`.

### Parse non-trigger/effect CWT alias categories

`readAliases` is hardcoded to `"trigger"` and `"effect"`, so any other alias
family never reaches a rule table. Blocks `civic_or_origin` and `species_class`
via `government_trigger`, and `job.possible_pre_triggers` via `pop_pre_trigger`.

The real question is what they lower to — `government_trigger` is a small
bespoke DSL, not a `Trigger<ScopeName>`, and emitting it as one would be a lie.
Do not sweep in `modifier_rule` or `economic_template`: those appear in every
landed registry and are already handled by dedicated shapes.

### Resolve the malformed-option drift block

`## default: no` at `governments.cwt:479,482` and `economic_categories.cwt:21` —
two hashes, so the parser reads a structured option and the value is invalid.
Manifesting any type from those files trips the drift gate. Blocks `councilor`
and `economic_category`; `councilor`'s own fields are clean and it is blocked
purely by file adjacency.

Needs a deliberate call, not a reflexive rebaseline. VERSION.md already records
two upstream defects of this kind rather than working around them.

### Generalize whole-object patching beyond technology

`patchTechnology` is the only patch entry point and `patchPlan()` hardcodes the
`technologies` registry. DoA overrides ids across several registries — and
notably overrides **other mods**: Gigastructural civics, Planetary Diversity
scripted triggers, ACOT situations and perks, all via `000000_` filename
prefixes.

Two problems. Generalizing the rule table is the easy one. Whether patching a
third-party mod's id is soundly supportable is not, since the SDK cannot see
that load order from the vanilla install.

### Event kinds beyond country and planet

**Landed 2026-08-01.** All 20 scoped kinds generate `defineXEvent` (on
`createEvents`, `src/generated/event-factory.ts` — originally also on an
abstract `GeneratedEventMethods` class, deleted with the builder on
2026-08-02) and the witnessed fire-overload pairs (`src/generated/event-fires.ts`, merged into the scope
interfaces; receiving scopes come from each fire effect's own `## scopes`, so
`observer_event` rides `UniversalEffects`). The runtime was already generic —
`buildEvent` and the fire encoders never keyed on kind. The scopeless `event`
kind is skipped and reported: its closures cannot be typed.

### Standalone localization API

A build's localization map is internal to `buildMod` and only written by
definition-attached names. DoA ships 12 localisation files whose keys are
largely unattached — tooltips, event body text, mod menu strings. Also decide
multi-file splitting and multi-language support; the path is hardcoded to
english.

### Static asset passthrough

`render(mod)` returns `Map<string, string>` and `write(dir, files)` writes utf8
only. DoA carries 154M of gfx, 19M of sound, and 56K of `interface` that a real
mod cannot ship without.

### Emit scripted effects, triggers, and variables

Post-MVP by decision. A TS function that records effects already is a scripted
effect, inlined; a const already is a scripted variable. But inlining breaks two
things that matter: **ejectability** — a mod whose shared logic is inlined 50
times is not maintainable by hand — and **sub-mod consumption**, since other
mods call your triggers by name and inlined logic has no name.

So the feature is an opt-in API emitting real named definitions, not a
replacement for inlining.

### Multi-file layout within a registry

**Landed 2026-08-02 with SDK-22.** A collection carries an optional flat
snake_case file stem — `collection("ascension", [...])` emits
`common/technology/<prefix>_ascension.txt`, and under SDK-23 a module named
`ascension.ts` does the same — and same-stem collections merge (by canonical
order since SDK-23, item order before it). The constraint held: `buildMod` computes emission paths, so the
patch planner reserves and enumerates _every_ one of the mod's own technology
files rather than one fixed name, pinned by a split-tech-plus-patch test.
Stems carry no `/`: the subdirectories under a registry directory are different
registries, not layout. Localization is still one file — its splitting belongs
to the standalone-localization item above.

### Pure-function authoring API (SDK-22, spiked and landed 2026-08-01/02)

**Landed 2026-08-02.** The `Mod` builder is gone; authoring is registry-typed
collection factories plus an explicit fold. `createTechnologies(file?)` and its
33 siblings are emitted per registry (`src/generated/content-factories.ts`),
`createEvents(file, namespace)` co-declares an event file with its namespace
(`src/generated/event-factory.ts`), `createOnActions()` binds hooks, and
`buildMod(config, collections, { vanilla? })` validates and assembles into a
`PureMod` value that `render(mod)` / `write(dir, files)` finish. Creation is
registration: a definer records into its collection at the definition site, so
the only thing left to forget is a whole collection.

**Superseded in part by SDK-23 (below), the same day**: the factories are gone.
Definers are free functions returning items, `collection(file, items)` places
them, `namespace(ns)` carries event identity, and `on(hook, events)` binds
hooks. Everything else in this entry — the fold, the value, the diagnostics
policy, the goldens — stands as written.

Shipped decisions, all pinned by test: prefix typing dropped (a missing prefix
is a `missing-prefix` warning on the value; collision with a real vanilla id
under an injected view is a hard error), `buildMod` takes collections rather
than loose items (nested arrays flatten, so a pack is a module exporting one),
warnings are data on the returned value instead of console output, event
namespaces are authored at `createEvents` so the recorder closures still run
eagerly at the define site and full ids are plain strings, and the generated
`Def` types stopped reusing `Id` for nested repeated-struct keys. The file stem
on a collection is also the SDK-19 splitting primitive (below).

Two deviations from the spike's own plan, both decided during it: events are
_not_ deferred/stamped in `buildMod` (so forward references stay illegal, as
under the builder), and the item vocabulary is collection-typed rather than one
flat tagged-value array. The [verdict](verdict-pure-api-probe.md) records the
full evolution.

Migrated in six sequential chunks on `feature/pure-api` (9dd8857 promote,
78871c4 codegen, 13f4c56 examples/README, 6b1853b runtime tests, 50a9d95 type
tests, then the builder deletion), each ending on green gates with the
byte-parity harness live throughout. The builder's bytes for the
representative fixture are committed as goldens in
`tests/__snapshots__/pure-api/`, captured from `Mod.render()` before the class
was deleted — the permanent record that the fold reproduces it exactly.

### Filesystem discovery and free definers (SDK-23)

**Landed 2026-08-02.** Colocate content by feature, not by content type. The
collection factories are gone; every definer is a free function that returns an
item and registers nothing (`defineTechnology` and its 33 siblings in
`src/generated/content-definers.ts`, `namespace(ns).defineXEvent` in
`src/generated/event-definers.ts`, `on(hook, events)`, `patchTechnology`,
`addShipOfSizeLimits`), `collection(file, items)` places a list of them, and
`discoverContent(dir)` (`src/discover.ts`) imports a directory of feature
modules and turns each module's exports into a collection named after the file.
Export is registration; importing another module's item without re-exporting it
references the definition without placing it again.

Shipped decisions:

1. An event namespace and an event file are in bijection — `buildMod` already
   refused two namespaces in one file; it now also refuses one namespace across
   two files.
2. Emission order is a pure function of content, so layout cannot be identity:
   registry declaration order → emitted file path bytes → id bytes, with event
   files by path and numeric ids within a file, hook blocks by hook name, and
   the contribution sink and patch list by id.
3. A hook's event list is author data and is written inside one
   `on(hook, [a, b, c])` call — never inferred from export or file order.
4. A module re-exporting another module's item places it twice and gets the
   existing duplicate-id error.
5. Same-basename modules in different folders share a stem and merge, which is
   what lets two features emit into one registry file.
6. One module's stem fans out across every registry it defined into, so a
   feature module holding technologies and events emits
   `common/technology/<prefix>_<stem>.txt` _and_ `events/<prefix>_<stem>.txt`.
   That is `collection(stem, items)`'s property; `discoverContent` only takes
   the stem from a filename.

The showcase is `examples/hello-galaxy/`, restructured from a single `mod.ts`
into `content/resonance.ts` (technologies + events) and
`content/amplifiers.ts` — one feature per module, fanned out to
`common/technology/hello_galaxy_{amplifiers,resonance}.txt` and
`events/hello_galaxy_resonance.txt`. `discoverContent` is a convenience over
`collection`, so the manual path stays first-class and `examples/hardening/`
remains its living example.

The interim restructure (56cfa27) kept content-type-shaped modules —
`content/resonance/{technology,events}.ts` + `content/amplifiers/technology.ts`
— which made the golden `out/` tree byte-identical across the move but
demonstrated the anti-pattern the ticket exists to kill. This chunk fixes that:
the goldens moved deliberately (`hello_galaxy_technology.txt` →
`{amplifiers,resonance}.txt`, `hello_galaxy_events.txt` →
`hello_galaxy_resonance.txt`), with every definition byte-identical inside its
new file, and the claim is now stated sharply rather than by byte-parity — an
identity-preservation test in `tests/example-mod.test.ts` freezes the
technology id set, the event namespace and full ids, and the localization
bytes across the regrouping.

Landed in six sequential chunks on `feature/pure-api`: 56e842e (canonical
emission order, the one golden recapture), b2e8dc7 (free definers beside the
factories, `namespace`/`on`/`collection`, the bijection check), 8a16415 (every
consumer migrated, zero golden movement), e8e0ce0 (factories deleted;
`src/factories.ts` became `src/definers.ts`), 56cfa27 (`discoverContent` and the
first hello-galaxy restructure), and this chunk (feature fan-out in the
showcase, the fixture, and the docs, plus the fan-out and
identity-preservation tests).

## Cross-cutting, unscheduled

- **`inline_script`** — 285 buildings, 146 jobs, 36 weapon components, 27
  traditions. A vanilla mechanism for sharing script fragments that the SDK does
  not model at all. Not a registry, so it never appeared in a registry survey;
  the corpus gate surfaced it.

# Content-breadth roadmap

> **Historical as of 2026-08-01 — tracking moved to Linear.** The remaining
> items below were filed as SDK-1 through SDK-19 in the
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
      emitted. A field is out only if the emitter cannot express it or a
      `CONTENT_DECLINED_FIELDS` row refuses it, and that list holds one entry.
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
- [x] **Accept both scalar and block for dual declarations.** The picker
      merges a scalar + `modifier_rule` group into `number | WeightBlock<S>`
      and unions multi-literal declarations; retired ~24 overlay rows.
- [x] **Event kinds generated.** All 20 scoped kinds get `defineXEvent` and
      witnessed fire overloads from `EVENT_KINDS` + the effect rules.

## Registries

Landed: `technology`, `building`, `tradition`, `tradition_category`,
`ascension_perk`, `agenda`, `edict`, `decision`, `job`, `opinion_modifier`,
`scripted_modifier`, `casus_belli`, `war_goal`, `agreement_preset`,
`bombardment_stance`, `archaeological_site_type`, `global_ship_design`,
`utility_component_template`, `weapon_component_template`,
`strike_craft_component_template`, `scripted_loc`, `situation_type`,
`static_modifier`, `councilor`, `economic_category`, `civic_or_origin`.

Nothing is blocked any more: alias categories unblocked `civic_or_origin` and
the malformed-option drift block unblocked `councilor` and
`economic_category`. `civic_or_origin` is one type with `subtype[civic]` /
`subtype[origin]` split by `is_origin`, so there is no separate `civic`
registry to expose; its `potential`/`possible` lower onto the shared
`GovernmentTriggerBlock` rather than a `Trigger`, since the game reads that
position as the requirements DSL and not a script condition tree.

Not yet attempted:

- [ ] `ship_size`, `graphical_culture`, `species_class` (also needs alias
      categories), `starbase_level`
- [ ] `component_sets`, `section_templates`, `ambient_objects` — `name_field`
      registries; the machinery exists, the entries do not
- [ ] `component_tags`, `country_limits`, `scripted_variables` — no CWT type
      declared anywhere; each needs a deliberate call between an overlay entry,
      a raw-emit path, and explicit non-support

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
(runtime shape `valueOrWeightBlock`, dispatched by what the author passes),
and a group of differing scalar literals lowers to their union — which made
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

Note the corpus gate reported no problem here, because it only checks whether
a field is PRESENT. Comparing the emitted type against real values is
[shape conformance](#shape-conformance), which would have flagged a
block-typed field whose 254 observed values are scalars.

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

The unbuilt half of the corpus gate. Compare each lowered type against the real
values: array versus scalar, enum membership, block versus scalar. This is what
retires the last `CONTENT_DECLINED_FIELDS` entry —
`job.auto_generate_description` lowers to `boolean[]` from a CWT cardinality
quirk while all three shipped jobs write a scalar `no`, which is a mechanical
comparison rather than a judgment.

Known blind spot, per the picker defect above: where CWT declares a field twice
at different arities, both readings satisfy the corpus.

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

**Landed 2026-08-01.** All 20 scoped kinds generate `defineXEvent`
(`GeneratedEventMethods` in `src/generated/event-methods.ts`, chained onto
`GeneratedContentMethods` so `Mod` keeps one base) and the witnessed
fire-overload pairs (`src/generated/event-fires.ts`, merged into the scope
interfaces; receiving scopes come from each fire effect's own `## scopes`, so
`observer_event` rides `UniversalEffects`). The runtime was already generic —
`buildEvent` and the fire encoders never keyed on kind. The scopeless `event`
kind is skipped and reported: its closures cannot be typed.

### Standalone localization API

`Mod.loc` is private and only written by definition-attached names. DoA ships 12
localisation files whose keys are largely unattached — tooltips, event body
text, mod menu strings. Also decide multi-file splitting and multi-language
support; the path is hardcoded to english.

### Static asset passthrough

`render()` returns `Map<string, string>` and `synth()` writes utf8 only. DoA
carries 154M of gfx, 19M of sound, and 56K of `interface` that a real mod
cannot ship without.

### Emit scripted effects, triggers, and variables

Post-MVP by decision. A TS function that records effects already is a scripted
effect, inlined; a const already is a scripted variable. But inlining breaks two
things that matter: **ejectability** — a mod whose shared logic is inlined 50
times is not maintainable by hand — and **sub-mod consumption**, since other
mods call your triggers by name and inlined logic has no name.

So the feature is an opt-in API emitting real named definitions, not a
replacement for inlining.

### Multi-file layout within a registry

Lowest priority. One file per registry at a fixed name today; DoA splits
technology across 4 files and component templates across 14. Ergonomics only —
but any splitting API must feed the same path-order machinery the patch resolver
uses, not bypass it. Record the decision even if it is "no".

## Cross-cutting, unscheduled

- **`inline_script`** — 285 buildings, 146 jobs, 36 weapon components, 27
  traditions. A vanilla mechanism for sharing script fragments that the SDK does
  not model at all. Not a registry, so it never appeared in a registry survey;
  the corpus gate surfaced it.

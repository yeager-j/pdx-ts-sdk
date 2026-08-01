# Content-breadth roadmap

> **Live, last updated 2026-08-01.** The tracked worklist for the phase that
> follows the architecture being settled. Evidence and measurements live in
> [coverage-dawn-of-ascension.md](coverage-dawn-of-ascension.md); design
> decisions in [handoff-vanilla-surface.md](handoff-vanilla-surface.md). This
> file is the list.

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

## Registries

Landed: `technology`, `building`, `tradition`, `tradition_category`,
`ascension_perk`, `agenda`, `edict`, `decision`, `job`, `opinion_modifier`,
`scripted_modifier`, `casus_belli`, `war_goal`, `agreement_preset`,
`bombardment_stance`, `archaeological_site_type`, `global_ship_design`,
`utility_component_template`, `weapon_component_template`,
`strike_craft_component_template`, `scripted_loc`, `situation_type`.

Blocked, each on a named cause:

- [ ] `civic_or_origin` — needs [alias categories](#parse-non-triggereffect-cwt-alias-categories)
- [ ] `councilor` — needs [the drift block resolved](#resolve-the-malformed-option-drift-block)
- [ ] `economic_category` — same drift block
- [ ] `static_modifier` — splices `alias_name[modifier]` unkeyed at the top level
      of the definition; `mergeByName` only tracks fields whose key kind is
      `"name"`, so the splice is invisible to the field model. Needs a
      top-level unkeyed `ModifierClosure` merged with ordinary members.

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

Not emitted, each named in the codegen report:

- **`target` (`output_scope = any`) — explicitly gated on situations, do not
  let this rot.** Its landing scope varies at runtime
  (spy_network/espionage_operation/agreement/situation). When situations work
  needs it: either thread `target` a real scope contract from the situation
  side, or fall back to emitting an author-asserted generic
  `target<S extends ScopeName>`.
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
89%). All four now report 100% corpus coverage. `situations` (out of scope —
the registry itself is still not added) can now express both its `stages`
(shape 1) and `approach` (shape 2) fields.

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
... localization slot") rather than emit a broken duplicate. `building.desc`
and `tradition_category.desc` both hit this and stay on the machinery
backlog — a real but narrow gap, not a regression, since neither could lower
at all before this landed.

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

### Emit every field inside repeated structs

The emit-everything flip stopped at the top level. A `repeatedStruct` field
still takes a `REPEATED_STRUCT_DEFINITIONS` overlay entry carrying a
hand-written `fields` array, and the emitter iterates it as an allowlist
(`for (const name of config.fields)`). Its unemitted list is plain set
subtraction with no capability probe, so curation is reported under "blocked on
emitter machinery" — `tradition.tradition_swap.on_enabled` is withheld with
nothing having tested whether it lowers.

Part of the overlay entry is legitimate: `identityKey` and `keying` cannot be
inferred, the same argument that makes the top-level keyword manifest-declared.
The `fields` array is not. Run the same probe inside structs and emit what
lowers.

Do this BEFORE situations, whose `stages` and `approach` would otherwise each
arrive with a fresh hand-curated field list.

### Accept both scalar and block where CWT declares a field twice

Three registries have hit the same defect: `opinion_modifier.opinion`/`decay`/
`growth`, `bombardment_stance.planet_damage`, `archaeological_site_type.weight`.
Each is declared twice in CWT, once as a bare scalar and once as a
`modifier_rule` block, and the picker keeps the scalar and silently drops the
gated adjustments. Each needed a hand-written override.

Six occurrences now, with `total_progress`, `stages.end`, and
`stages.section_weight` from situations. Systematic, not coincidence.

**"The block should win" was the wrong prescription, and situations proved it.**
Overriding `stages.end` to `WeightBlock` typed away the scalar form, and vanilla
writes `end = 100` **254 times against 1 block**; Dawn of Ascension writes 40
scalars and no blocks. So an author must now spell the only form anyone uses as
`end: { base: 100 }`. Picking either declaration is wrong in one direction or
the other.

Accept **both**: `number | WeightBlock<S>`, lowered by which one the author
passes. That retires the six overrides without making the common case verbose.

Note the corpus gate reported no problem here, because it only checks whether a
field is PRESENT. Comparing the emitted type against real values is
[shape conformance](#shape-conformance), which would have flagged a block-typed
field whose 254 observed values are scalars.

### Make the corpus gate see inside nested blocks

`readRegistryCorpus` walks one level of each definition and never descends into
a repeated struct, so the gate is structurally blind to everything inside one.
Fixing nested curation gained `tradition_swap.on_enabled` and tradition's
coverage did not move, because the gate cannot see it.

This matters most for situations, whose substance lives almost entirely inside
`stages` and `approach`. Measured as-is, situations would report a high number
derived from a handful of top-level fields while saying nothing about the parts
that carry the content.

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

`Mod` exposes `defineCountryEvent` and `definePlanetEvent`. DoA uses
`country_event` (276), `situation_event` (74), `planet_event` (11),
`fleet_event` (6), `observer_event` (5), `system_event` (1).
`src/generated/events.ts` already generates `EVENT_KINDS` with each kind's
scope, so these should be generated rather than hand-written.

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

# Coverage baseline: Dawn Of Ascension

> **Survey, 2026-07-31. Nothing implemented yet.** A gap list measured against a
> real medium-sized mod, taken as the yardstick for the content-breadth phase.
> The goal is being _equipped_ to build a mod of this size — not porting it.

Baseline mod: **Dawn Of Ascension**, Steam workshop `2816360131`, surveyed from
the local install rather than from documentation.

DoA touches **34 registries** across 33 top-level directories under `common/`
(`governments/` splits into civics and councilors). **5 are supported today.**

Two caveats on the yardstick. DoA uses **neither traditions nor edicts**, so two
of the SDK's seven existing registries get no exercise here — broad coverage, not
total. And the generated effect/trigger surface already holds up: spot-checks of
DoA's heavy hitters (`start_situation`, `create_fleet`, `create_ship_design`,
`export_trigger_value_to_variable`, `resource_stockpile_compare`) all resolve.
The gap is registries and plumbing, not the expression layer.

## Supported today

| Registry                               | DoA entries                    |
| -------------------------------------- | ------------------------------ |
| `technology` (+ `technology/category`) | 125 across 4 files, 1 category |
| `buildings`                            | 63                             |
| `council_agendas`                      | 7                              |
| `ascension_perks`                      | 4                              |
| `on_actions`                           | 11                             |

## Flat registries — the documented recipe

CWT type exists, keyed by id, no new machinery expected. Each follows "Adding a
new content type" in `AGENTS.md`: manifest entry, `CONTENT_EMITTED_FIELDS`
allowlist, overlay rows, and three kinds of evidence.

Batch 1 — empire/government:

- [ ] `civic_or_origin` (+ `swapped_civic`) — `common/governments.cwt` — 20
- [ ] `councilor` — `common/governments.cwt` — 6
- [x] `decision` — `common/decisions.cwt` — 7
- [x] `job` — `common/pop_jobs.cwt` — 2
- [ ] `economic_category` — `common/economic_categories.cwt` — 1

`governments.cwt` declares ONE type, `civic_or_origin`, with `subtype[civic]` and
`subtype[origin]` split by `is_origin` — there is no separate `civic` type to
expose. Likewise `pop_jobs.cwt` declares one `job` type with `subtype[capped]` /
`subtype[uncapped]`. `swapped_civic`, `swapped_job`, and `councilor` are genuine
separate types.

Both remaining items in this batch are blocked on infrastructure, not modeling:

- `civic_or_origin` — `potential`/`possible` use a bespoke
  `alias_name[government_trigger]` family instead of the standard
  `single_alias_right[trigger_clause]`. `readAliases` in
  `tools/codegen/cwt/rules.ts` is hardcoded to the `"trigger"` and `"effect"`
  categories, so `government_trigger` never reaches any rule table. A civic that
  cannot gate who may pick it is broken, not minimal.
- `councilor`, `economic_category` — both share a file with a vendor-authored
  `## default: no` structured option (`governments.cwt:479,482`,
  `economic_categories.cwt:21`) that the CWT parser reports as malformed. Adding
  either type pulls the whole file into `RULE_FILES` and the drift gate exits 1.
  `councilor`'s own fields are clean; it is blocked purely by file adjacency.

Batch 2 — modifiers and loc:

- [ ] `static_modifier` — `common/modifiers.cwt` — 10
- [ ] `opinion_modifier` — `common/modifiers.cwt` — 3
- [ ] `scripted_modifier` — `common/scripted_modifiers.cwt` — 5
- [ ] `scripted_loc` — `common/scripted_loc.cwt` — 2

`common/modifiers.cwt` declares `static_modifier`, `triggered_opinion_modifier`,
and `block_triggered` against `common/static_modifiers`; pick deliberately. Check
whether these bodies should accept the existing `ModifierBlock` recorder rather
than a fresh shape.

Batch 3 — war and diplomacy:

- [ ] `casus_belli` — `common/casus_belli_and_war_goals.cwt` — 3
- [ ] `war_goal` — `common/casus_belli_and_war_goals.cwt` — 3
- [ ] `agreement_preset` — `common/agreements.cwt` — 1
- [ ] `bombardment_stance` — `common/bombardment_stances.cwt` — 2
- [ ] `archaeological_site_type` — `common/archaeology.cwt` — 1

Batch 4 — ships and misc. Sequence after the `name_field` work below, since the
ship stack cross-references it:

- [ ] `ship_size` — `common/ship_sizes.cwt` — 11
- [ ] `global_ship_design` — `common/global_ship_designs.cwt` — 8
- [ ] `graphical_culture` — `common/graphical_cultures.cwt` — 7
- [ ] `species_class` — `common/species_consolidated.cwt` — 1
- [ ] `starbase_level` — `common/starbases_consolidated.cwt` — 1

`global_ship_designs` also declares `name_field`; confirm its shape. The
branded-ref chain matters here — global ship designs reference section templates,
which reference component templates and component sets. Verify it holds end to
end.

## Registries needing new generic machinery

- [ ] `component_templates` — 276 across 14 files
- [ ] `ambient_objects` — 200 across 4 files
- [ ] `component_sets` — 46
- [ ] `section_templates` — 19

These four share a shape nothing in the SDK supports. The top-level key is a
repeated keyword — `utility_component_template`, `weapon_component_template`,
`strike_craft_component_template`, `component_set`, `ship_section_template`,
`ambient_object` — and the actual id lives in an inner `key = "..."` field. CWT
declares it as `name_field = "key"` plus `## type_key_filter` subtypes
(`config/common/components.cwt:5,33`, `section_templates.cwt:3`,
`ambient_objects.cwt`).

`tools/codegen/` has zero handling for `name_field` today. The supported
registries only meet it on _swap_ subtypes (`swapped_ascension_perk`), which goes
down a different path. This is a generic-model addition to the emitter and
writer, not a per-registry branch.

**541 DoA entries — by volume the largest single chunk of the mod.**

- [ ] `situations` — 7 files, 96–519 lines each

The spine of DoA: ascension project, dawn of an ascended empire, creating dark
matter, ascendant ships, fallen empire spying, AI resource, plus an ACOT compat
override. CWT type is `situation_type` in `config/common/situations.cwt`. Unlike
the flat registries this has real internal structure — stages, approaches,
`on_progress`/`on_stage` triggers, monthly progress modifiers — and pairs with
`situation_event`. Attempt only after the flat registries prove the recipe.

## Registries with no CWT type

No type declaration anywhere in `vendor/cwtools-stellaris-config`, so the codegen
pipeline has no source to read. Each needs a deliberate decision: audited overlay
entry, raw-emit escape hatch, or explicit non-support.

- [ ] `component_tags` — a bare 7-line list, no `=` entries at all. Probably
      needs a raw-emit path rather than a content type.
- [ ] `country_limits` — 4 entries across `ownership_limits` and
      `ship_of_size_limits` subdirs
- [ ] `scripted_variables` — 77 entries; see the ejectability section below

## Machinery

### Bind vanilla scripted triggers and effects

- [ ] **Blocking.** Without it most DoA `potential`/`allow`/`trigger` blocks
      cannot be expressed.

DoA calls `is_fallen_empire` 214 times. It is in neither the generated surface
nor the CWT rules, because it isn't a game primitive — it's vanilla _script_, in
`common/scripted_triggers/00_scripted_triggers.txt`. Vanilla ships ~1449 scripted
triggers and ~1455 scripted effects there. No amount of codegen from `vendor/`
will produce them.

Use `@pdx-ts/pdxscript` with the existing `VanillaView`/`viewFromFiles` machinery
(`src/vanilla/surface.ts`) to read the install at build time and generate typed
bindings, rather than hand-listing them.

**Resolved 2026-07-31 — see [handoff-vanilla-surface.md](handoff-vanilla-surface.md).**
Scope is settled by opt-in assertion at the declaration; body inference is
rejected. Existence and `$PARAM$` lists are checked, only scope is asserted. This
item is now downstream of the vanilla identifier package described in that note.

### Generalize event kinds

- [ ] Replace the two hand-written `defineXEvent` methods with generated ones.

`Mod` exposes only `defineCountryEvent` and `definePlanetEvent`
(`src/mod.ts:114`), and `defineEventOf` is typed to
`kind: "country_event" | "planet_event"`. DoA uses `country_event` (276),
`situation_event` (74), `planet_event` (11), `fleet_event` (6), `observer_event`
(5), `system_event` (1).

`src/generated/events.ts` already generates `EVENT_KINDS` for every kind with its
scope, so this should become generated methods off that table — the
`GeneratedContentMethods` shape — not more hand-written pairs. `situation_event`
depends on the situations registry.

### Standalone localization API

- [ ] Expose localization keys not attached to a definition.

`Mod.loc` is private (`src/mod.ts:57`) and only ever written by `registerLoc`
from definition-attached names. DoA ships 12 localisation files whose keys are
largely not attached to any definition: tooltips, situation and event body text,
mod menu strings, scripted_loc outputs.

Add a public entry point feeding the same duplicate-key check and BOM-prefixed
renderer. Also decide on multi-file splitting — `renderLocalization` emits
exactly one `localisation/english/{prefix}_l_english.yml` — and on multi-language
support, since the path is hardcoded to english.

### Static asset passthrough

- [ ] Copy binary and non-PDXScript files into the synth output.

`render()` returns `Map<string, string>` and `synth()` writes every value as utf8
(`src/mod.ts:249`) — text only. DoA carries 154M of gfx (`.dds` sprites, entity
and mesh files), 19M of sound (`.ogg`), and 56K of `interface` (`.gui`) that a
real mod cannot ship without.

Needs a way to declare files or directories copied verbatim, with binary-safe
writing. Decide whether `render()` gains a separate asset map or its value type
widens. The `.gfx` and `.gui` declaration files are PDXScript-ish and could later
become typed; verbatim passthrough is the unblocking step.

### Generalize whole-object patching beyond technology

- [ ] Generalize the rule table and patch plan across registries.
- [ ] Decide whether patching a third-party mod's id is supportable at all.

`patchTechnology` is the only patch entry point (`src/mod.ts:88`) and
`patchPlan()` hardcodes registry `"technologies"` and the `common/technology/`
path filter.

DoA overrides ids it does not own across several registries — and notably
overrides **other mods**, not just vanilla: Gigastructural civics
(`civic_bogged_down_researchers`, `civic_encryption_goes_brr`, …), Planetary
Diversity scripted triggers (`pd_is_planet_class_*`,
`pd_make_all_gaia_worlds_effect`), ACOT content (`situation_acot_ascension`,
`ap_galactic_ascendancy_acot`). All via `000000_` filename prefixes — exactly the
load-order hack the resolver exists to replace.

The second checkbox is the harder one: the SDK cannot see a third-party mod's
load order from the vanilla install. Per `AGENTS.md`, `patchX` needs per-registry
load-order and emission verification — deliberately not free once `defineX`
exists.

### Multi-file layout within a registry

- [ ] Lowest priority; record the decision even if it's "no".

`ContentAuthoring.render()` emits one file per registry at a fixed generated
name. DoA splits technology across 4 files, component templates across 14, and
uses a nested `common/technology/category/` subdirectory.

Not required for correctness — one large file loads identically — so this is
authoring ergonomics and diff reviewability. But the patch resolver already
reasons about filenames for load order, so any splitting API must feed the same
path-order machinery rather than bypass it.

## Emitting scripted effects, triggers, and variables

**Post-MVP, deliberately.** A TypeScript function that records effects already
_is_ a scripted effect, inlined at build time; a `const` already is a scripted
variable. That covers the authoring need, which is why this doesn't block.

But inlining is not a complete answer, for two reasons that have nothing to do
with authoring convenience:

1. **Ejectability.** You should be able to take the generated mod and walk away.
   A mod whose shared logic has been inlined 50 times is not a mod anyone can
   pick up and maintain by hand.
2. **Sub-mod consumption.** Other mods extend yours by calling your scripted
   triggers and effects _by name_. Inlined logic has no name to call.

So the eventual feature is an authoring API that emits real named definitions
into `common/scripted_effects/`, `common/scripted_triggers/`, and
`common/scripted_variables/` — not a replacement for inlining, but an opt-in
alternative for logic that's meant to be part of the mod's public surface.

DoA hand-writes 30 such definitions plus 77 scripted variables, which is the
scale to design against. Note `src/vanilla/patch.ts` already re-declares
file-local `@variables` in patch output, so scripted variables have partial
machinery. Distinct from the vanilla-binding task above, which is about
_consuming_ vanilla's scripted triggers.

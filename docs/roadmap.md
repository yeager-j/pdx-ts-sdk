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
`strike_craft_component_template`.

Blocked, each on a named cause:

- [ ] `civic_or_origin` — needs [alias categories](#parse-non-triggereffect-cwt-alias-categories)
- [ ] `councilor` — needs [the drift block resolved](#resolve-the-malformed-option-drift-block)
- [ ] `economic_category` — same drift block
- [ ] `static_modifier` — splices `alias_name[modifier]` unkeyed at the top level
      of the definition; `mergeByName` only tracks fields whose key kind is
      `"name"`, so the splice is invisible to the field model. Needs a
      top-level unkeyed `ModifierClosure` merged with ordinary members.
- [ ] `scripted_loc` — needs [repeated structs](#repeated-struct-field-shape).
      Reverted rather than shipped: its whole surface was `random` and `value`
      while `text`, written by 1095 of 1152 shipped definitions, lowered to
      nothing.
- [ ] `situations` — needs [repeated structs](#repeated-struct-field-shape).
      Seven in DoA, 96–519 lines each, and the spine of the mod.

Not yet attempted:

- [ ] `ship_size`, `graphical_culture`, `species_class` (also needs alias
      categories), `starbase_level`
- [ ] `component_sets`, `section_templates`, `ambient_objects` — `name_field`
      registries; the machinery exists, the entries do not
- [ ] `component_tags`, `country_limits`, `scripted_variables` — no CWT type
      declared anywhere; each needs a deliberate call between an overlay entry,
      a raw-emit path, and explicit non-support

## Machinery

### Repeated-struct field shape

**Highest leverage remaining.** A field that repeats, each occurrence an
anonymous block with a fixed internal shape — usually a trigger plus payload.
Distinct from nested content definitions, which key by their own id; the writer
must emit N sibling blocks under one key.

Consumers: `scripted_loc.text` (1095/1152), `archaeological_site_type.stage`
(123/124), `agreement_preset.term_data` (all 56),
`war_goal.forbidden_peace_offers` (42/87), and **situations**, whose stages and
approaches are exactly this shape.

Blocks the situations registry outright and caps four others.

### Fix the scalar-versus-block field picker

Three registries have hit the same defect: `opinion_modifier.opinion`/`decay`/
`growth`, `bombardment_stance.planet_damage`, `archaeological_site_type.weight`.
Each is declared twice in CWT, once as a bare scalar and once as a
`modifier_rule` block, and the picker keeps the scalar and silently drops the
gated adjustments. Each needed a hand-written override.

Three occurrences is systematic, not coincidence: when a group holds both, the
block is the richer form and should win. Fixing it retires three overrides and
prevents a fourth. The corpus gate cannot catch this class — both forms lower
and both produce legal-looking output.

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

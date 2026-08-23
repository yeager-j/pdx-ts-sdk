# cwtools-stellaris-config snapshot

Upstream: https://github.com/yeager-j/cwtools-stellaris-config

| | |
| --- | --- |
| Commit | `0bd81db21401350dd93852604ef86e17268c1f0d` |
| Committed | 2026-08-22 |
| Fetched | 2026-08-22 |

Licensed under the upstream MIT license, reproduced in `LICENSE`.

## Why this fork and not cwtools/cwtools-stellaris-config

The fork is the config behind the Paradox Language Support IDE plugin, and it is
materially more correct and more complete for our purposes:

- **It encodes scopes in the rules.** `## scopes` appears on 1129 trigger rules
  and 1124 effect rules. Canonical upstream annotates 1 of 1037 triggers and 0 of
  1020 effects, which is why the first pass of this codegen had to take scopes
  from the game's log dumps alone.
- **It is right where upstream is wrong.** Upstream declares
  `enum[research_areas]` with `physics society engineering psionics`. The fork
  declares `enum[research_area]` with three values, and the game agrees: across
  690 vanilla technologies the only areas used are `society` (323),
  `engineering` (199), and `physics` (168). No technology uses `psionics`.
- **Its doc dumps are version-matched.** `script-docs/` holds one directory per
  game release; we read `v4.4.1`, which matches this machine's Stellaris 4.4.6
  (`modsCompatibilityVersion` 4.4). Upstream ships a single undated dump.
- **It is fresher.** 2026-07-28 against upstream's 2026-06-11.

Structurally it also merges `scope_changes.cwt` into `triggers.cwt` and
`effects.cwt`, splits the combined `trigger_docs.log` back into `triggers.log`
and `effects.log`, and expresses scope-changing rules as
`single_alias_right[trigger_clause]` rather than an inline block.

The vendored source is now our own fork of that fork,
[yeager-j/cwtools-stellaris-config](https://github.com/yeager-j/cwtools-stellaris-config).
Everything above still applies — it tracks DragonKnightOfBreeze's `master` —
but rule fixes land there first and are contributed upstream from there, so
this snapshot can carry a fix before upstream merges it.

### Fixes this snapshot carries ahead of upstream

Twelve commits carried on our fork ahead of DragonKnightOfBreeze's `master`.
The earlier rule corrections each delete a row from
`packages/codegen-cwt/src/overlay.ts` or a special case in the loader rather
than adding one; the GFX corrections supply the upstream-true rules needed by
the GFX codegen work:

- `2b960cc` `situations.cwt` `total_progress` declared `value_int_field`, a
  typo for `int_value_field`. Retires the loader's special case in
  `cwt/model.ts`.
- `4146b40` `## cardinality = 0..inf` on three single-valued keys —
  `pop_jobs.cwt` `auto_generate_description`, and both arms of `orbit_angle`
  and `size` in `solar_system_initializers.cwt`'s planet and moon aliases.
  Retires five `arity: "single"` overlay rows.
- `4e72e3a` `## replace_scopes = { root = country this = country }` on
  `components.cwt` and `section_templates.cwt` `ai_weight`. Retires three
  scope rows and additionally fixes `strike_craft_component_template`, which
  no row covered.
- `c4966f4` `governments.cwt` stated the civic/origin swap trigger's scope in
  prose, attached to the wrong field; it is now an annotation on `trigger`.
- `6af61f0` four more spliced clause fields whose scope the rules omitted:
  `special_projects.cwt` `cost` and `AI_wait_days`,
  `solar_system_initializers.cwt` `usage_odds`, `traditions.cwt`
  `tradition_category.desc`.
- `a2463b9` seventeen fields that hand-inlined a subset of
  `single_alias[modifier_clause]`'s body now splice the alias.
- `5b5109d` `scopes.cwt` declares `no_scope`, which the rest of the config,
  the game's `scopes.log` and 27 documented triggers already treat as a
  scope. Retires the overlay's `EXTRA_SCOPES`.
- `ec350bd` GFX type paths include the required `game/` root, and
  `gfx/particles.cwt` gains a `## type_key_filter` for the game's `pdxparticle`
  definition key.
- `a4ee61a` corrects where `ec350bd` attached that filter. It sat on
  `type[particle_type]`, one block below the type it describes. The game writes
  `objectTypes = { pdxparticle = { name type scale } }` in the 39
  `gfx/particles/*.gfx` files (1738 definitions) — that is `type[particle]`,
  whose `path_extension` and `skip_root_key` already matched — and
  `particle = { name subsystem … }` in the 1089 `*.asset` files (1108
  definitions), which is `type[particle_type]`. So `pdxparticle` moves onto
  `type[particle]` and `type[particle_type]` gains `## type_key_filter = particle`.
- `74492cc` `effects.cwt` `create_fleet.parent` declared `sceop[fleet]`, a typo
  for `scope[fleet]` and the only `sceop` in the config. Retires `create_fleet`'s
  `unsupported-field-value` row from the script-gap ledger.
- `e053fef` seven `alias[trigger:any_*]` iterators — `any_cosmic_storm`,
  `any_system_within_storm`, `any_cosmic_storm_start_position`,
  `any_cosmic_storm_end_position`, `any_system_added_to_storm`,
  `any_system_removed_from_storm` and `any_trait_available_for_species` — spliced
  the trigger clause with no `## push_scope`, so the nested triggers read as
  running in the enclosing scope. Their `count_*` siblings name the iterated
  object on `limit`, and those scopes are now declared. The same commit settles a
  contradiction it exposed: the six `random_/ordered_/every_cosmic_storm_{start,end}_position`
  effects pushed `cosmic_storm` while all twelve rules describe iterating
  "all systems valid to be a storms start/end position", so they now push
  `system`. Retires seven `missing-push-scope` ledger rows and changes the nested
  scope of six published effect wrappers.
- `0bd81db` `any_existing_species_traits` declared `## push_scope = country`
  while its four siblings and all five descriptions say the iterated object is
  a trait. Found by `packages/codegen-cwt/tests/iterator-push-scope.test.ts`,
  which the commit above made possible. Changes the nested scope of one
  published trigger wrapper.

`country_ship_of_size_limit.show` deliberately stays an overlay row rather
than becoming a sixth annotation: its scope is inferred from the corpus
alone, with nothing in the rules or the game's documentation to corroborate
it, which is a weaker footing than the four above.

## What is here, and what is not

Only the inputs codegen reads:

- `config/**/*.cwt` — the rule files (172 of them).
- `script-docs/v4.4.1/{triggers,effects}.log` — Paradox's own documentation
  dumps. Now a cross-check on the rules' `## scopes` rather than the sole source,
  and still the only source of the usage examples that become TSDoc.
- `script-docs/v4.4.1/scopes.log` — the scope-link dump, used to confirm every
  scope either source names is a scope the game actually has.
- `script-docs/v4.4.1/modifiers.log` (4.1 MB) — the game's dump of every
  modifier name with its categories. The only source that lists the *generated*
  names (economic-category products like `country_unity_produces_mult`, and the
  per-ship-size stats), so it is the primary input for the scoped modifier-key
  types; `modifiers.cwt` + `modifier_categories.cwt` supply the category → scope
  join and the drift cross-check.

Deliberately excluded: `localizations.log`, which nothing reads yet, along with
the fork's `script-files/`, its older `script-docs` versions, and the 20 other
game-version directories.

### Known upstream defects

The defects this file previously listed are fixed as of this snapshot, across
PRs #17, #18, #19 and #20: `common/leader_classes.cwt:13` closes its
`desc = description"` quote and the file parses; `modifiers.cwt` files the two
`situation_nomad_economy_*` rows under the `Countries` category that
`modifier_categories.cwt` actually defines, and agrees with the game's
`modifiers.log` on every shared name's category; the ten `## default: …`
annotations that should have been `###` doc comments are all corrected; the
three exhibit iterators are declared once each, correctly scoped, rather than
twice with a `## copes` typo; and `scopes.cwt` declares `galactic_community`
(7af3179), which restores `save_global_event_target_as`'s scope list and puts
the name into the generated `ScopeName` union and `ScopeMap`. `malformedOptions`
and `unknownModifierCategories` are both empty in `drift-baseline.json` as a
result, and `unknownScopes` is down to one name.

Two defects remain, neither of them blocking:

- The game's own `modifiers.log` does not list the two
  `situation_nomad_economy_*` names or `starbase_collected_colony_resources_add`,
  so those stay under `modifiers.rulesOnly`. The dump is the authority for
  generated names, so this is upstream-unfixable rather than a rules bug.
- `unknownScopes` keeps `pop`, which the v4.4.1 dumps still name even though
  4.0 replaced the scope with `pop_group`. That is dump staleness, not a rules
  defect — the rules were updated.

`modifiers.rulesOnly` also carries `biological_logistic_growth_mult` and
`lithoid_logistic_growth_mult`. Those two are a deliberate fork decision rather
than a defect: the dump generates them only uppercase-prefixed
(`BIOLOGICAL_logistic_growth_mult`, `LITHOID_logistic_growth_mult`), PR #19
dropped the lowercase spellings for that reason, and PR #20 restored them under
the `Pops` category. Because the dump is the authority for modifier names,
restoring them changes no generated type — it only records them as rules-only.

## Updating

Re-run the copy against a newer commit of the fork — and a newer `script-docs`
version when the game updates — then update the table above and run
`npm run codegen`. Drift
in the name join, in the scope cross-check, or in the parser's diagnostics will
fail the build against `packages/codegen-cwt/src/drift-baseline.json`. Review the diff, then
rebaseline deliberately. That failure is the point: upstream renames and
scope changes should not silently become wrong types.

A new `script-docs` version also reopens the testing interpreter's whitelist.
`packages/sdk-testing/tests/whitelist-audit.test.ts` pins each modeled key to
the dump paragraph its audit note was read from, so the version bump and every
paragraph that changed under it fail until somebody re-reads them and re-pins
(`AUDITED_DOC_DUMP` and the `docs` entries in
`packages/sdk-testing/src/whitelist.ts`). A newly deprecated key fails the same
way, and is answered by modeling the replacement or recording why the entry
stays. Re-pinning without reading defeats the whole point: a note that no
longer matches the game is a green test for broken behavior.

## Why a snapshot rather than a submodule

Hermetic builds and reviewable diffs while the codegen is still churning. Once it
stabilises a submodule is the better answer — it drops 2.5 MB from the tree and
makes bumping a one-liner.

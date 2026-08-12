# cwtools-stellaris-config snapshot

Upstream: https://github.com/DragonKnightOfBreeze/cwtools-stellaris-config

| | |
| --- | --- |
| Commit | `3378e418ed875789903a4d7786cb7b54a6f47d4d` |
| Committed | 2026-08-05 |
| Fetched | 2026-08-05 |

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

The defects this file previously listed are fixed upstream as of this snapshot,
across PRs #17, #18 and #19: `common/leader_classes.cwt:13` closes its
`desc = description"` quote and the file parses; `modifiers.cwt` files the two
`situation_nomad_economy_*` rows under the `Countries` category that
`modifier_categories.cwt` actually defines, drops two lowercase archetype
modifier names the game only generates uppercase, and agrees with the game's
`modifiers.log` on every shared name's category; the ten `## default: …`
annotations that should have been `###` doc comments are all corrected; and the
three exhibit iterators are declared once each, correctly scoped, rather than
twice with a `## copes` typo. `malformedOptions` and
`unknownModifierCategories` are both empty in `drift-baseline.json` as a result.

Three defects remain, none of them blocking:

- `save_global_event_target_as` no longer lists the `galactic_community` scope.
  That removal was ours (PR #19) and it was wrong — the game's own `effects.log`
  documents `galactic_community` as a supported scope for exactly that effect,
  and `enums.cwt` lists it in `scope_type_token`. The removal was argued from
  its absence in `script-docs/*/scopes.log`, but that file dumps scope *changes*
  (links), not scope types: `exhibit` and `espionage_asset` are absent from it
  too and are both declared scopes. The real defect is that `scopes.cwt` never
  declared `galactic_community`. A follow-up PR restores the scope list and adds
  the declaration; until it lands, `unknownScopes` keeps the name and the
  generated `ScopeName` union is missing it. Nothing else in our output moves,
  because codegen already dropped the undeclared scope.
- The game's own `modifiers.log` does not list the two
  `situation_nomad_economy_*` names or `starbase_collected_colony_resources_add`,
  so those stay under `modifiers.rulesOnly`. The dump is the authority for
  generated names, so this is upstream-unfixable rather than a rules bug.
- `unknownScopes` also keeps `pop`, which the v4.4.1 dumps still name even
  though 4.0 replaced the scope with `pop_group`. That is dump staleness, not a
  rules defect — the rules were updated.

## Updating

Re-run the copy against a newer commit — and a newer `script-docs` version when
the game updates — then update the table above and run `npm run codegen`. Drift
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

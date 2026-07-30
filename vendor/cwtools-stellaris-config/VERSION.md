# cwtools-stellaris-config snapshot

Upstream: https://github.com/DragonKnightOfBreeze/cwtools-stellaris-config

| | |
| --- | --- |
| Commit | `251fe1189b4ea6ad3c945182e08d893ac7b684b8` |
| Committed | 2026-07-28 |
| Fetched | 2026-07-30 |

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

Deliberately excluded: `modifiers.log` (4.1 MB) and `localizations.log`, which
nothing reads yet, along with the fork's `script-files/`, its older `script-docs`
versions, and the 20 other game-version directories.

### Known upstream defect

`config/common/leader_classes.cwt:13` has an unmatched `"` (`desc = description"`),
so that one file does not parse. Nothing reads it, and the parser is right to
refuse it rather than guess. Worth an upstream issue.

## Updating

Re-run the copy against a newer commit — and a newer `script-docs` version when
the game updates — then update the table above and run `npm run codegen`. Drift
in the name join, in the scope cross-check, or in the parser's diagnostics will
fail the build against `tools/codegen/drift-baseline.json`. Review the diff, then
rebaseline deliberately. That failure is the point: upstream renames and
scope changes should not silently become wrong types.

## Why a snapshot rather than a submodule

Hermetic builds and reviewable diffs while the codegen is still churning. Once it
stabilises a submodule is the better answer — it drops 2.5 MB from the tree and
makes bumping a one-liner.

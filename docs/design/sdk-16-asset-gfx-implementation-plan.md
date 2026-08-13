# Asset files and GFX authoring — implementation plan

> Consolidates the completed wayfinder map
> [Asset files and GFX authoring](https://linear.app/unnamed-system/issue/SDK-16/asset-files-and-gfx-authoring)
> (SDK-16) into the delivery route. Every design decision here is **closed** —
> resolved in a map ticket and final. This document routes and digests; each
> ticket's resolution comment is the authority when a detail here reads
> ambiguous. Delete this file when SDK-16 closes (docs describing shipped
> behavior are deleted, per AGENTS.md).

## Destination

Byte-preserved Asset files and typed GFX definitions sufficient for Dawn of
Ascension to assemble every required non-script file through the SDK: 569 Asset
files (156,964,614 bytes) included byte-for-byte, all 308 new GFX definitions
authored (129 `spriteType`, 62 `pdxmesh`, 117 `pdxparticle`), the one
vanilla-identical `GFX_situation_stage_9` inherited rather than re-emitted
(309/309 effective coverage), safe rendering and materialization, and a
successful live Stellaris load.

## How to work this plan

- Work the slices in dependency order below. One slice is one reviewed unit —
  land it as one or more stacked PRs, each slice's exit gate green before a
  dependent slice starts. Slices 1 and 2 are independent; 4 and 5 can run in
  parallel once their dependencies land.
- If implementing a slice seems to require reopening a decision, stop and
  surface the conflict against the owning ticket — do not improvise a variant.
- The [Permanent SDK gates](#permanent-sdk-gates) and
  [Evidence boundary](#evidence-boundary) sections bind every slice, not just
  the one that introduces them.

## Already landed

- **Exact materialization foundation** —
  [SDK-148](https://linear.app/unnamed-system/issue/SDK-148) (PR #87) shipped
  `packages/sdk/src/output/`: `RenderedMod`/`RenderedFile` with text and byte
  artifacts, SHA-256 identity, exact `write()` with staging, activation,
  rollback, a materialization manifest, and `withMaterializationLock`. Slice 1
  finishes this contract; it does not start it.
- **Vendored GFX rule fixes** —
  [Submit upstream CWT rule fixes for GFX defects](https://linear.app/unnamed-system/issue/SDK-124)
  (PR #115, commit `93c68ae`) landed the `game/` path-prefix fix and the
  `type_key_filter = pdxparticle` fix in `vendor/cwtools-stellaris-config`. The
  fork `yeager-j/cwtools-stellaris-config` is the vendored source; no overlay
  rows exist for these facts.
- **Accepted authoring DX** —
  [Prototype the GFX and Asset authoring surface](https://linear.app/unnamed-system/issue/SDK-123)
  fixed the surface: one `assetsDirectory` mirroring the mod root is the normal
  DX; per-file `assetFile` is the exceptional path; GFX path fields stay raw
  logical-path strings checked during the Fold. Prototype artifact at commit
  `1f7f92d`.

## Slice 1 — Finish the RenderedMod and materialization contract

**Owning decision:**
[Define the rendered-file and materialization contract](https://linear.app/unnamed-system/issue/SDK-118)
(SDK-118), as twice amended 2026-08-13 — foreign added entries are preserved
and reported, not drift, with a kind policy; the journal and lock-identity
contracts are sharpened. See the amendment comments on the ticket. **Depends
on:** nothing (foundation already landed).

Remaining work over `packages/sdk/src/output/`:

- Remove the public `mergeWrite()`. No merge primitive survives at the root or
  under an `/advanced` name.
- Private owned-byte adoption: Asset bytes captured at declaration flow through
  `PureMod`, rendering, hashing, and materialization without a second
  payload-sized copy. `RenderedFile.bytes()` returns a copy, never SDK-owned
  mutable storage.
- Sink results: successful `write()`/`install()` return a report distinguishing
  `written` from `unchanged`, naming the authoritative output and manifest,
  listing foreign entries present, and carrying post-commit cleanup warnings
  (cleanup failure after the activation commit point is a warning, never a
  failure). `install()` also returns content and launcher-descriptor paths. A
  verified target whose owned entries match the new `RenderedMod` is an
  unchanged success and performs no activation, regardless of foreign entries
  present.
- Drift and deliberate replacement: Materialization drift covers
  manifest-owned entries only — modified, deleted, or type-changed owned
  entries and symlink swaps on owned paths. Ordinary materialization refuses
  drift with `MaterializationError` (exhaustive reason union: unowned output,
  drift, busy target, activation/rollback failure, recovery-required) and
  drift evidence plus an opaque receipt of the observed snapshot.
  `replaceMaterialization()` revalidates a reviewed receipt, still requires a
  valid SDK-owned manifest, and turns new drift into a fresh conflict. An
  unowned target can never be force-replaced; there is no adoption mode —
  first materialization still accepts only an absent, empty, or
  manifest-owned target. The SDK never prompts or prints.
- Foreign entries: added entries the manifest does not own are preserved,
  never deleted, and always listed in the sink result — the game loads them,
  so visibility is the safeguard. They survive activation by being
  hardlinked/copied into staging after the owned tree is built, leaving swap,
  rollback, and crash-recovery semantics unchanged. A claim over a foreign
  path (including a directory/file conflict) is a hard refusal. An audited
  OS-metadata basename allowlist (`.DS_Store`, `Thumbs.db`, `desktop.ini`) is
  exempt from the report. Preservation covers foreign regular files and
  directories only — foreign symlinks, FIFOs, sockets, and devices are refused
  with a structured error; traversal is no-follow, and preserved identities
  are revalidated at the commit point.
- Persistent locking and recovery: single-writer per physical target via an
  exclusive sibling lock (real parent resolved first so symlinked aliases
  serialize together; the lock name derives from the same basename string as
  the target, never a transformed identity, so filesystem case/NFC aliasing
  converges aliases onto one lock inode) held through inspection, staging,
  activation, and cleanup; a second writer fails immediately. `install()`
  locks both of its activation paths — content directory and launcher
  descriptor — in canonical order, so two installs whose paths overlap (one's
  descriptor path is the other's content path) serialize instead of racing
  live. The lock holds a
  transaction journal covering both activation sites — content and
  launcher-descriptor paths, staged/previous identities with hashes, and a
  per-rename phase — so a crash between `install()`'s two renames is
  recoverable from journal evidence alone. A separate recovery operation
  interprets the journal, restores or completes, and preserves everything
  behind a structured recovery error when evidence is ambiguous. A
  crash-orphaned transaction is never broken merely for being old.
- Representability preflight: every final absolute path is preflighted before
  staging; an unrepresentable path fails without touching the target.

**Exit gate:** negative controls proving — stale owned output removed by an
ordinary build; owned-file drift refused and receipt-replayable; foreign
entries preserved across activation and listed in the result; a claim over a
foreign path refused; foreign symlinks and special files refused; allowlisted
OS-metadata basenames absent from the report; unowned/busy targets refused;
crash recovery restores the last committed output; process-kill controls at
each `install()` rename leave no mixed content/descriptor generations;
cross-process case/NFC/symlink-alias lock controls hold single-writer;
rollback on activation failure; symlink and target-swap probes never escape
the tree; unchanged build reports `unchanged`. Plus `npm run typecheck`,
`npm test`, `npm run build`.

## Slice 2 — Path claims in the Fold; Vanilla path evidence

**Owning decision:**
[Define logical-path ownership and collision safety](https://linear.app/unnamed-system/issue/SDK-119)
(SDK-119), as amended 2026-08-13 — `@pdx-ts/stellaris-ids` is a hard
dependency
([ADR-0006](../adr/0006-stellaris-ids-is-a-hard-dependency.md)); the
missing-evidence escape is retired. **Depends on:** nothing (independent of
slice 1).

- Move path adjudication out of `RenderedMod` construction
  (`packages/sdk/src/output/rendered.ts`) into the Fold
  (`packages/sdk/src/compiler/compile.ts`): every channel — inner descriptor,
  generated PDXScript, events, on-actions, localization, patch plans, typed
  GFX, Asset files — submits its final mod-root-relative **Path claim** before
  `PureMod` exists. A successful `PureMod` is collision-free; `render()` only
  serializes adjudicated claims.
- Minting profile: relative, `/`-separated, NFC-normalized, case-preserving;
  portable component profile (no control chars, `< > : " \ | ? *`, leading or
  trailing space, trailing period, Windows device basenames,
  case-insensitively); components capped at 255 UTF-8 bytes **and** 255 UTF-16
  code units; no total-length cap — the sink preflights absolute paths
  (slice 1). A second, locale-independent Unicode case-folded portability
  identity detects aliases; NFC and case-only aliases are collisions, not
  winners. Validation is component-tree based: one portable spelling per
  directory node, and a node is never both file and directory.
- Exclusive ownership: one producer per final path, rejected even for
  byte-identical duplicate claims. One `PathOwnershipError` carries the
  complete canonically sorted conflict set with exhaustive reasons (duplicate,
  portable alias, file/directory, reserved, vanilla) and both sides' producer
  kinds and Feature stems. `descriptor.mod` and `.pdx-sdk-manifest.json` are
  reserved exact paths.
- **Vanilla path inventory**: content-free, version-pinned, canonically sorted
  set of every game-visible logical path (base + official DLC, including
  archive-internal logical entries). Generated into `@pdx-ts/stellaris-ids`
  through the audited licensing chokepoint, behind a dedicated lazily-loaded
  exports subpath; a live-install inventory adds optional current-install
  evidence. Because the package is a hard peer dependency (ADR-0006), packaged
  evidence is always present and **every Path claim is always checked** — the
  former author-minted-path carve-out and `PDX_UNCHECKED_VANILLA_PATHS` escape
  are retired unimplemented. A stale or malformed installed inventory throws
  `VanillaPathInventoryError`; explicit game-version acceptance governs
  intentional mismatch. Ordinary claims never replace a vanilla path;
  whole-file replacement stays outside this effort.
- Hard-dependency conversion rides this slice: delete the empty merge-target
  interfaces in `packages/sdk/src/identifiers/contracts.ts` and the
  unchecked-`string` degraded mode; import the package's types directly. The
  project-supplied game-version range stays as `create-stellaris-mod` emits
  it. The scaffolder converts too: its no-install and no-detected-build paths
  always emit the dependency pin, and the ETARGET recovery guidance
  (`packages/create-stellaris-mod/src/commands/init.ts`) stops advising
  continue-unchecked — when no package version matches the detected game
  version, scaffolding refuses explicitly instead.
- The inventory is the package's second runtime surface (after the
  trigger/effect bindings): amend PROVENANCE.md, the licensing shape test that
  pins the bindings as the only runtime, and the package exports map for the
  data subpath.

**Exit gate:** alias/collision/reserved-path/directory-file fixtures over the
Fold; conflict sets complete and canonically ordered; `codegen:vanilla` gates
for the inventory (generator report, licensing, committed output,
install-gated checks); the amended licensing shape test and PROVENANCE update
reviewed together. Standard three gates.

## Slice 3 — Asset file and tree capture

**Owning decision:**
[Choose when Asset sources become build-owned bytes](https://linear.app/unnamed-system/issue/SDK-117)
(SDK-117). **Depends on:** slices 1 and 2.

```ts
mod.assetFile({ source, path }): AssetFileItem
mod.assetTree({ source, into? }): readonly AssetFileItem[]
```

- Sources are absolute paths or `file:` URLs; cwd-relative refused. Capture is
  synchronous, at declaration, all-or-nothing: missing, unreadable,
  disappearing, or type-changing entries abort without partial Items. After
  capture, source mutation or disappearance has no effect; each new invocation
  recaptures.
- Trees include every regular file (dotfiles and files under hidden
  directories included — no extension allowlist, no ignore layer); symlinks
  and non-regular entries are rejected, not skipped; an empty tree is an
  error; empty directories and filesystem metadata are not content. Map each
  relative source path to its destination, validate through the shared
  logical-path contract, reject within-declaration normalization aliases, sort
  by destination with the existing UTF-8 byte comparator, then read each
  source exactly once. A tree expands into ordinary Asset file Items — it is
  not a lasting model concept.
- Items are capability-owned and become real only through Feature placement. A
  Feature stem supplies diagnostic provenance and never modifies an Asset
  file's complete logical path. The public Item exposes logical path,
  `byteLength`, and `sha256` — never a source path or mutable bytes; private
  owned storage flows into `PureMod` without a payload-sized copy (slice 1's
  adoption point).

**Exit gate:** falsification fixtures for every rejection above plus
single-read verification; the synthetic scale corpus (below) lands with this
slice as a dedicated mandatory CI command. Standard three gates.

## Slice 4 — Generate and lower typed GFX

**Owning decisions:**
[Generalize CWT-backed lowering for GFX definitions](https://linear.app/unnamed-system/issue/SDK-120)
(SDK-120) and
[Define GFX identity, references, placement, and grouping](https://linear.app/unnamed-system/issue/SDK-121)
(SDK-121). **Depends on:** slices 2 and 3.

Lowering (SDK-120):

- Extend the general content protocol with declarative file-layout metadata —
  output extension, root envelope, definition keyword, shared-envelope
  membership — carried from `ContentType` (`path_extension`, `skip_root_key`
  already parse) through the registry descriptor to the Fold, which stops
  hardcoding `.txt`. No separate GFX compiler channel.
- `mod.spriteType`, `mod.pdxmesh`, `mod.pdxparticle` are ordinary
  `packages/codegen-cwt/src/content-manifest.ts` rows riding the standard
  evidence pipeline. The sprite row narrows to the `normal` subtype via `as`
  (`{ type: "sprite", as: "normal", keyword: "spriteType" }`); the particle
  row states `keyword: "pdxparticle"` explicitly. Teach the corpus reader
  `path_extension` so `.gfx` files are corpus (vanilla evidence: 8,539
  `spriteType`, 3,232 `pdxmesh`, 1,720 `pdxparticle`).
- The same manifest rows flow into `@pdx-ts/codegen-vanilla`'s
  `VANILLA_MANIFEST` (`packages/codegen-vanilla/src/manifest.ts` derives its
  id rows from `CONTENT_MANIFEST`), so this slice also regenerates
  `@pdx-ts/stellaris-ids`: vanilla `pdxmesh`/`pdxparticle` id sets appear, the
  sprite row migrates from ref-only to authorable, and the vanilla-name
  collision refusal gains the evidence it acts on. Run the install-gated
  `codegen:vanilla` gates before committing; review the package diff as a
  public API.
- Casing: emission is canonical lowercase only; recognition is an audited
  exact list of observed variants (vanilla's 77 `SpriteType`, CWT subtype
  spellings); an unlisted casing fails loudly.
- Envelopes: one envelope per emitted file; never in authored code. Mixed
  `objectTypes` ordering is family-major (family by keyword byte order, then
  definitions sorted by name) per ADR-0005; parsing retains ordered repeated
  members. Dawn reproduction is semantic, never byte-layout mimicry.

Identity, references, placement (SDK-121):

- Every GFX name is minted; none is author-supplied whole, and there is no
  exact-name definition escape. Sprite default mint
  `GFX_${prefix}_${name}`; **shape mints** are a closed, rules-derived set
  (text icon `GFX_text_${prefix}_${name}`, fleet-order button patterns, kin)
  whose targets may be typed items or intentional raw strings; seed from the
  CWT `# inferred` annotations, falling back to an audited overlay list if
  they prove non-machine-readable. Mesh/particle mint `${prefix}_${name}` — no
  registry segment, no suffix enforcement. Duplicate minted name in a build is
  an error; no cross-family duplicate check. A name that provably collides
  with a vanilla definition is refused (shadow-override is out of scope).
- Authored sprites carry `referenceName: "sprite"` — `SpriteRef`-branded,
  joining the existing `vanilla.sprite` registry by brand. Dangling-reference
  checking generalizes to **containment**, applied after an exact-match
  exemption (amended on SDK-121, 2026-08-13): a reference equal to a known
  vanilla name — always known under ADR-0006 — is valid as-is; otherwise a
  sprite reference containing `${prefix}` as a `_`-delimited segment must
  resolve in this build, and the rest are assumed third-party. Without the
  exemption, a short prefix occurring inside a vanilla name (prefix `ui` vs
  vanilla `GFX_astral_rift_ui_icon`) would reject a legitimate vanilla
  reference. Sprite `textureFile` and
  pdxmesh `file` accept `AssetFileItem | string` — an Item lowers to its
  declared logical path; plain strings get a fold-time existence warning
  (never an error) against captured paths ∪ the vanilla path inventory.
  `pdxparticle.type` is an unchecked string (targets live in opaque `.asset`
  Assets).
- Placement is SDK-owned and canonical: `interface/${prefix}_${stem}.gfx`,
  `gfx/models/${prefix}_${stem}.gfx`, `gfx/particles/${prefix}_${stem}.gfx`;
  default stems overlaid to `sprites`/`meshes`/`particles`; Feature stems
  compose as for `common/`; one registry per emitted file; no author-chosen
  subdirectories.

**Exit gate:** `npm run codegen`, complete `packages/sdk/src/generated/` diff
reviewed as a public-API change, codegen report read, `npm run codegen:check`;
`codegen:vanilla` regeneration with its install-gated, licensing, and
committed-output checks, the `packages/stellaris-ids/src` diff reviewed as a
public-API change; evidence pipeline green (four kinds of evidence, corpus
gates, presence floors); fixtures for minted collisions, unlisted casing,
vanilla-exact-match acceptance, containment dangling references, generated
ordering, and repeated members. Standard three gates.

## Slice 5 — Project Manifest `assetsDirectory`

**Owning decisions:** SDK-117's Project-Manifest DX plus SDK-123's accepted
prototype. **Depends on:** slice 3 (may run beside slice 4).

- `stellaris-mod.json` gains optional project-relative `assetsDirectory`,
  validated like `contentDirectory`; its tree mirrors the mod root
  (`assets/gfx/interface/icon.dds` owns `gfx/interface/icon.dds`). Fresh
  scaffolds omit it until Assets exist.
- Generated `buildTheMod()` wiring resolves the field against the Project
  Manifest, calls the same public tree-ingestion the standalone path uses, and
  places the Items as `mod.feature("assets", assets)` — capture happens inside
  every build invocation, never at module evaluation. Schema and runtime share
  one layout descriptor (`packages/create-stellaris-mod/src/project-layout.ts`).
  The SDK stays manifest-agnostic.
- Scaffolded build/install output reports one Asset capture summary — file
  count and total bytes — before listing output, so accidental hidden files
  are visible.

**Exit gate:** scaffolder fixtures for present/absent `assetsDirectory`,
per-invocation recapture control, capture-summary output. Standard three
gates.

## Slice 6 — Dawn conformance (consumer project)

**Owning decision:**
[Set the Dawn verification gates and implementation handoff](https://linear.app/unnamed-system/issue/SDK-122)
(SDK-122). **Depends on:** slices 4 and 5. Lives entirely in the Dawn consumer
project — see [Evidence boundary](#evidence-boundary).

A consumer-owned command: validates its dependency manifest against the
installed Workshop corpus, stages exactly the typed-GFX dependency closure
into a temporary mirrored Asset tree, builds twice, and emits a versioned
machine-readable report proving —

- 569 Asset files totaling 156,964,614 bytes, with exact paths and hashes;
- 308 authored definitions: 129 `spriteType`, 62 `pdxmesh`, 117 `pdxparticle`;
- semantic equivalence and inheritance of `GFX_situation_stage_9`, hence
  309/309 effective coverage;
- deterministic repeated-build `RenderedMod` hash, read counts, and memory
  measurements.

**Exit gate:** the report, attached to SDK-16 in Linear.

## Slice 7 — Live Stellaris load evidence

**Owning decision:** SDK-122. **Depends on:** slice 6.

Install the exact conformance `RenderedMod` in a dedicated playset. Pin game
build, SDK/rules/identifier versions, corpus and report hashes, and the
`RenderedMod` hash. Reach a playable state and exercise representative
ordinary and animated/masked sprites, mesh/material/animation, and
muzzle/trail/hit particles. Fresh normalized logs must contain no unexpected
generated-path or generated-id parser, duplicate, missing-texture, mesh, or
particle errors. This proves the Asset/GFX load, not full Dawn gameplay
parity.

**Exit gate:** the pinned evidence bundle attached to SDK-16. Then close
SDK-16 and delete this document.

## Permanent SDK gates

From SDK-122; these bind every implementation PR.

- Focused positive and negative controls plus `npm run typecheck`,
  `npm test`, `npm run build` on every PR. Codegen work additionally
  regenerates, reviews the complete generated diff and report, and runs
  `codegen:check`; Vanilla-inventory work runs its generator, licensing,
  committed-output, verified-build, and install-gated checks.
- **Synthetic scale corpus:** ~512 files, ~160 MiB, run under `--expose-gc`
  through a dedicated mandatory CI command (not ordinary `npm test`). Gates:
  one read per source; deterministic repeated builds; no retained-copy
  accumulation; retained ArrayBuffers ≤ `1.10 * capturedBytes + 8 MiB` while
  snapshots are live. Wall time and peak RSS reported, not thresholded.
- Small fixtures permanently falsify: missing, unreadable, disappearing,
  type-changing, symlinked and non-regular sources; path aliases and
  collisions; stale receipts; cross-process serialization; crash recovery;
  rollback; cleanup-warning success; foreign-entry preservation, reporting,
  and special-file refusal; dangling references; generated ordering; repeated
  GFX members.
- Raw GFX Asset-path strings classify during the Fold: matching captured path
  → local; matching Vanilla inventory → Vanilla; neither → assumed external,
  with a structured warning. A missing local-looking string warns; a passed
  `AssetFileItem` is a hard local relationship that fails if unplaced.

## Evidence boundary

No Dawn paths, hashes, names, manifests, fixtures, aggregate commands, or
special cases enter `pdx-sdk`. The consumer project owns the 569-file
dependency manifest, semantic GFX comparison, conformance report, and live
evidence, attached to Linear. SDK tests use only generic synthetic and
property fixtures.

## Out of scope

Fixed by the map; none of this returns without a redrawn destination.

- Typed `.gui` authoring; typed `.asset`-entity or particle-type authoring
  (these remain Asset files); the seven sprite subtypes Dawn does not use.
- Asset transformation, texture/mesh conversion, packing, bundling, watching,
  incremental builds.
- Deliberate vanilla GFX shadow-override —
  [ruled out](https://linear.app/unnamed-system/issue/SDK-125): Dawn's only
  exact-name collision is a no-op repetition of vanilla.
- Any general whole-vanilla-file replacement capability.

## Decision index

| Ticket                                                                                                        | Decision (gist)                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Choose when Asset sources become build-owned bytes](https://linear.app/unnamed-system/issue/SDK-117)         | Synchronous declaration-time capture into Feature-owned immutable bytes; `assetsDirectory` mirrors the mod root                                                                                   |
| [Define the rendered-file and materialization contract](https://linear.app/unnamed-system/issue/SDK-118)      | Immutable hash-identified `RenderedMod`; exact over the owned set, failure-safe; foreign entries preserved and reported (amended 2026-08-13); `replaceMaterialization()` for reviewed replacement |
| [Define logical-path ownership and collision safety](https://linear.app/unnamed-system/issue/SDK-119)         | The Fold adjudicates one Path claim per output; `stellaris-ids` is a hard dependency (ADR-0006, amended 2026-08-13), so vanilla path evidence always checks every claim                           |
| [Generalize CWT-backed lowering for GFX definitions](https://linear.app/unnamed-system/issue/SDK-120)         | GFX rides the general content protocol via declarative layout metadata; fork-first rule fixes; audited casing; one envelope per file                                                              |
| [Define GFX identity, references, placement, and grouping](https://linear.app/unnamed-system/issue/SDK-121)   | All GFX names minted (default + closed shape mints, no exact-name escape); branded references with containment checking; canonical placement                                                      |
| [Set the Dawn verification gates and implementation handoff](https://linear.app/unnamed-system/issue/SDK-122) | Seven dependency-ordered slices; generic SDK gates; Dawn-owned conformance and live-load evidence                                                                                                 |

# SDK source organization

> **Accepted proposal, 2026-08-04 — not yet implemented.** This document records the
> agreed target structure for the handwritten source under `packages/sdk/src/` and
> the migration plan for reaching it. The migration is organizational: it must not
> change the public package interface, authored behavior, generated PDXScript, or
> launcher installation behavior.

## Decision

Organize the SDK's handwritten source around six responsibilities:

1. mod authoring;
2. script construction;
3. content and event lowering;
4. compilation;
5. output materialization;
6. installed-game integration.

Keep `generated/` as one generator-owned island. Its files are expected to be
large, and maintainers do not navigate or edit them like handwritten
implementation. Generated import paths may change as handwritten interfaces move,
but generated files are not themselves a target of this reorganization.

Nest vanilla-content support beneath the broader Stellaris integration:

```text
stellaris/
├── installation/
├── launcher/
└── vanilla/
```

This makes the distinction visible in the path:

- `stellaris/installation` locates and describes an installed copy of the game;
- `stellaris/launcher` locates the launcher-owned mod directory;
- `stellaris/vanilla` models and patches content shipped by the game.

The optional identifier-package contracts are a neutral SDK concern rather than
an installed-game adapter. Script bindings consume their declaration-merge
contracts, while compilation consumes their runtime version-pin diagnostics, so
they live in a top-level `identifiers/` module that both may depend on.

The public `stellaris` namespace remains unchanged. This is an internal
reorganization, not a consumer migration.

## Why change the current structure

The architecture is stronger than the current folder layout suggests. The public
authoring interface is mod-bound and immutable, compilation is a deterministic
fold, rendering is pure, and installation is an impure adapter at the end of the
pipeline. Those seams should be apparent from the source tree.

Today, most handwritten files sit together at the root of `src/`, and several
large files combine interfaces with multiple independent implementation concerns:

- [`build.ts`](../../packages/sdk/src/build.ts) owns configuration validation,
  localization, canonical grouping and ordering, vanilla collision checks,
  dangling-reference validation, patch planning, identifier-package diagnostics,
  and immutable output construction in addition to coordinating the compile.
- [`content.ts`](../../packages/sdk/src/content.ts) contains public authoring
  types, the descriptor protocol consumed by generated code, reusable block
  encoders, recursive field lowering, localization behavior, and
  `ContentAuthoring`.
- [`effect-core.ts`](../../packages/sdk/src/effect-core.ts) contains scope
  references, script contexts, modifier encoding, localization-key mechanics,
  conditional control flow, structural effects, recorder lifecycle, proxy
  dispatch, and event firing.
- [`events.ts`](../../packages/sdk/src/events.ts) contains both the public event
  model and its lowering implementation.
- [`render.ts`](../../packages/sdk/src/render.ts) contains pure rendering,
  generic filesystem writing, and atomic launcher installation.

The existing `stellaris/` and `vanilla/` directories are peers even though they
are layers of one feature. `stellaris/load.ts` is the local-install adapter that
constructs the domain model in `vanilla/surface.ts`. Someone unfamiliar with the
history has to inspect imports to learn that relationship.

Line count is evidence of accumulated responsibility, not the design criterion.
The goal is not uniformly small files. The goal is deep modules with clear
interfaces, strong locality, and a dependency direction that a maintainer can
infer from paths.

## Target structure

```text
packages/sdk/src/
├── index.ts
│
├── authoring/
│   ├── mod.ts
│   ├── feature.ts
│   └── discover.ts
│
├── script/
│   ├── triggers.ts
│   ├── scalar.ts
│   ├── scripted.ts
│   └── effects/
│       ├── types.ts
│       ├── modifiers.ts
│       ├── structural.ts
│       └── recorder.ts
│
├── content/
│   ├── types.ts
│   ├── schema.ts
│   ├── blocks.ts
│   ├── lower.ts
│   ├── authoring.ts
│   └── situations.ts
│
├── events/
│   ├── types.ts
│   ├── lower.ts
│   └── on-actions.ts
│
├── compiler/
│   ├── compile.ts
│   ├── config.ts
│   ├── model.ts
│   ├── localization.ts
│   ├── references.ts
│   ├── patches.ts
│   └── freeze.ts
│
├── output/
│   ├── render.ts
│   ├── write.ts
│   └── install.ts
│
├── stellaris/
│   ├── index.ts
│   ├── installation/
│   │   ├── locate.ts
│   │   ├── describe.ts
│   │   └── version.ts
│   ├── launcher/
│   │   └── mod-directory.ts
│   ├── vanilla/
│   │   ├── load.ts
│   │   ├── cache.ts
│   │   ├── view.ts
│   │   ├── technology.ts
│   │   ├── patch.ts
│   │   ├── override-plan.ts
│   │   └── override-rules.ts
│
├── identifiers/
│   ├── contracts.ts
│   ├── trie.ts
│   └── package-pin.ts
│
├── generated/
├── ordering.ts
├── references.ts
└── errors.ts
```

This is a target vocabulary, not a requirement to create every file before its
contents have a coherent interface. During extraction, two proposed files may
remain one if splitting them would produce shallow pass-through modules. A
proposed file may also be split further when the implementation reveals two
independent responsibilities with a clean seam.

## Module responsibilities

### `authoring/`

Owns the modder-facing construction model:

- `mod.ts`: `createMod`, prefix and identifier ownership, namespaces, and the
  immutable `ModCapability`;
- `feature.ts`: the item vocabulary, feature placement, collection flattening,
  and ownership validation;
- `discover.ts`: the impure directory adapter that discovers named feature
  exports.

`createMod` remains the only public authoring entry point. Moving its
implementation must not reintroduce raw definers or a mutable builder as an
alternative interface.

### `script/`

Owns authored triggers and recorded effect closures independently of any
particular content registry:

- trigger expression values and combinators;
- conversion of authored scalar-like values into PDXScript values;
- scripted trigger and scripted effect bindings;
- scope values, scope references, and script context values;
- modifier encoding and modifier-description localization mechanics;
- structural effects and recorder lifecycle.

`recordEffects()` remains the deep interface over the effect recorder. The
recording stack, liveness enforcement, proxy construction, dispatch tables, and
event encoders remain implementation details behind it.

### `content/`

Owns the generic content-definition machinery shared by every generated registry:

- public authored block types;
- the runtime schema emitted by code generation;
- reusable encoders for weights, modifiers, economic resources, and triggered
  modifiers;
- recursive lowering from a generated field schema to PDXScript;
- `ContentAuthoring` and `DefinedContent`;
- situation-specific authored contracts that extend generated content shapes.

The split between `types.ts` and `schema.ts` is important:

- `types.ts` is part of the consumer-facing authoring interface;
- `schema.ts` is the generator/runtime protocol.

Generated content modules should import the narrow interface they consume rather
than depending on a single catch-all `content.ts`.

### `events/`

Owns authored event values, event lowering, localization, and on-action
contributions:

- `types.ts`: `EventDef`, `EventRef`, options, timing and fire argument types;
- `lower.ts`: `buildEvent`, effect recording, localization extraction, and
  emitted event entries;
- `on-actions.ts`: on-action references, authored binding items, canonical
  grouping, and lowering.

### `compiler/`

Owns the deterministic fold from capability-owned features to `PureMod`.

`compile.ts` is the coordinator. It should remain readable as the pipeline:

```text
config
  → placed items
  → content
  → events
  → on-actions
  → contributions
  → references
  → patches
  → immutable PureMod
```

The coordinator delegates deep responsibilities:

- `config.ts`: validate and snapshot `ModConfig`;
- `model.ts`: `PureMod`, emitted-file types, warnings, and compiler-owned
  intermediate values;
- `localization.ts`: validate, deduplicate, sanitize, warn, and preserve
  canonical localization order;
- `references.ts`: validate own event/content references and nested swap
  identities;
- `patches.ts`: collect compatible patches, verify the rule-table version, and
  plan their winning output;
- `freeze.ts`: recursively freeze emitted PDXScript trees.

The descriptor-driven fold is the SDK's strongest internal seam. This
reorganization must deepen it, not replace it with a stateful builder, source
transform, or series of public compiler passes.

### `output/`

Owns the three distinct stages after compilation:

- `render.ts`: pure `PureMod → Map<logical path, contents>`;
- `write.ts`: safely materialize a path map beneath an explicit root;
- `install.ts`: atomically replace a launcher-visible mod installation and write
  its external descriptor.

The filesystem seam should be obvious from imports. `render.ts` must not import
Node filesystem modules. `install.ts` composes `render()` and `write()` and is
the only module that owns launcher installation replacement.

### `stellaris/`

Owns integration with an installed copy of Stellaris and with the data shipped
by it:

- `installation/`: discover and describe a game installation;
- `launcher/`: find the launcher-owned mod directory;
- `vanilla/`: load, parse, cache, inspect, and patch shipped game content.

`vanilla/surface.ts` should become `vanilla/view.ts`. If extracting parsed
technology behavior produces a genuinely independent interface, move it to
`technology.ts`; do not split it merely to reduce line count.

The current `resolver/` directory should not survive as a vague cross-cutting
name:

- generic logical-path normalization and canonical byte ordering move to the
  neutral top-level `ordering.ts` module;
- vanilla whole-object override planning and its calibrated rules move beside
  the vanilla patch model.

### Neutral shared contracts

Three small modules are intentionally outside the responsibility folders:

- `ordering.ts` owns pure UTF-8 comparison and logical-path normalization used
  by authoring, script recording, compilation, rendering, and vanilla override
  planning. It may import `errors.ts`, but no higher-level module.
- `references.ts` owns the `ContentRefUse` data contract and path composition
  helper. Content lowering, event/effect recording, and vanilla patches produce
  these values; the compiler consumes them for the dangling-reference guard.
- `identifiers/` owns the optional `@pdx-ts/stellaris-ids` seam. Script bindings
  consume its declaration-merge contracts, while compilation consumes its
  package-presence and version-pin checks.

These are shared vocabulary, not coordinators. They must remain free of imports
from `authoring/`, `content/`, `events/`, `compiler/`, `output/`, and
`stellaris/`.

### `generated/`

Remains structurally unchanged. It is committed, reviewed public output owned by
`@pdx-ts/codegen-cwt`.

When a handwritten interface moves:

1. update the corresponding emitter in `packages/codegen-cwt`;
2. run `npm run codegen`;
3. inspect the complete generated diff;
4. commit generator and generated changes together.

Do not hand-edit imports in generated files and do not leave compatibility
modules solely to preserve old private source paths.

## Dependency direction

The intended dependency direction is:

```text
authoring ───────────────→ compiler
    │                         │
    ├────────→ content ───────┤
    └────────→ events ────────┤
    content ──────→ script    │
    events ───────→ script    │
generated ←──────→ content    │
generated ←──────→ script     │
                              ├──→ stellaris/vanilla
output ───────────────────────→ compiler/model
output/install ───────────────→ stellaris/launcher
stellaris/vanilla ────────────→ script

content ──────────────────────→ references
events ───────────────────────→ references
script ───────────────────────→ references
stellaris/vanilla ────────────→ references
compiler ─────────────────────→ references
generated ────────────────────→ references

authoring/events/script/compiler/
output/stellaris ─────────────→ ordering

script ───────────────────────→ identifiers/contracts
compiler ─────────────────────→ identifiers/package-pin
generated ────────────────────→ identifiers/trie
```

Rules implied by that direction:

- `script/` knows nothing about authoring, compilation, or output.
- `content/` and `events/` depend on `script/` for trigger values, recorded
  effect closures, modifier encoding, and script contexts.
- `content/` and `events/` do not import the compiler coordinator.
- `compiler/` may depend on content/event lowering and on a supplied vanilla
  view, but lowerers do not depend on the compiler.
- vanilla patches may produce neutral `ContentRefUse` values, preserving the
  compiler's guard for own-prefixed references added by patches without making
  vanilla patching depend on content lowering.
- `output/render.ts` depends only on the compiled model and serialization.
- installed-game adapters do not depend on mod authoring.
- shared ordering and reference contracts never import higher-level modules.
- the bidirectional folder-level relationship between `generated/` and
  `content/` or `script/` is the deliberate generator/runtime protocol:
  generated types import narrow handwritten contracts, while handwritten
  lowerers consume generated descriptors and metadata. Keep the individual
  file graph acyclic where possible and do not broaden those imports.
- `index.ts` may re-export from every public area, but internal modules do not
  import through `index.ts`.
- folder barrels are not required. Prefer direct internal imports so cycles and
  dependency direction remain visible.

## Public interface policy

The migration preserves both published entry points:

```text
@pdx-ts/sdk
@pdx-ts/sdk/stellaris
```

`src/index.ts` may remain large. It is a curated public contract, not a
handwritten implementation hotspot. Moving implementation files is safe because
consumers cannot import unexported source paths from the published package.

No phase should broaden the root export surface. In particular, an
organizational move is not a reason to expose raw constructors, recorder
internals, compiler passes, or generated lowering machinery.

## Migration plan

Each phase should be independently reviewable and behavior-neutral. Do not mix
feature work into these changes.

### Phase 1: make Stellaris integration legible

Move and rename:

```text
stellaris/locate.ts        → stellaris/installation/locate.ts
stellaris/describe.ts      → stellaris/installation/describe.ts
stellaris/version.ts       → stellaris/installation/version.ts
stellaris/mod-dir.ts       → stellaris/launcher/mod-directory.ts
stellaris/load.ts          → stellaris/vanilla/load.ts
stellaris/cache.ts         → stellaris/vanilla/cache.ts
vanilla/surface.ts         → stellaris/vanilla/view.ts
vanilla/patch.ts           → stellaris/vanilla/patch.ts
vanilla/package-pin.ts     → identifiers/package-pin.ts
vanilla-ids.ts             → identifiers/contracts.ts
vanilla-trie.ts            → identifiers/trie.ts
resolver/plan.ts           → stellaris/vanilla/override-plan.ts
resolver/rules.ts          → stellaris/vanilla/override-rules.ts
resolver/path-order.ts     → ordering.ts
content-refs.ts            → references.ts
```

Update `stellaris/index.ts` and the root barrel so the external interface does
not move. Update the package README's source map in the same change.

Do not split `view.ts` or otherwise rewrite its implementation in this phase.
The purpose is to establish names and ownership first.

### Phase 2: separate pure output from filesystem effects

Extract:

```text
render.ts → output/render.ts
          → output/write.ts
          → output/install.ts
```

Keep descriptor and localization rendering in `output/render.ts`.
`output/write.ts` retains containment validation. `output/install.ts` retains
directory-name validation, staging, rollback, and descriptor-last installation.

Acceptance evidence should explicitly show that:

- `render()` is byte-identical;
- `write()` still rejects paths outside its root;
- installation still exactly replaces the owned directory;
- a failed render or staging write leaves the previous install intact.

### Phase 3: organize authoring and events

Move:

```text
mod-capability.ts → authoring/mod.ts
items.ts          → authoring/feature.ts
discover.ts       → authoring/discover.ts
```

Split:

```text
events.ts     → events/types.ts
              → events/lower.ts
on-actions.ts → events/on-actions.ts
```

Retire the vague `definers.ts` name:

- move situation-specific authoring into `content/situations.ts`;
- move `on()` construction beside `events/on-actions.ts`.

Preserve capability ownership, forward event handles, define-site effect
recording, feature layout, and canonical event/on-action ordering.

### Phase 4: split generic content machinery

Split `content.ts` in dependency order:

1. `content/types.ts`;
2. `content/schema.ts`;
3. `content/blocks.ts`;
4. `content/lower.ts`;
5. `content/authoring.ts`.

The exact placement of a helper follows the knowledge it owns:

- author-facing contracts belong in `types.ts`;
- generated field metadata belongs in `schema.ts`;
- reusable PDXScript encoders belong in `blocks.ts`;
- recursive descriptor interpretation belongs in `lower.ts`;
- definition identity, localization registration, warnings, and nested-id
  collection belong in `authoring.ts`.

All content-reference producers import the neutral `references.ts` contract
established in Phase 1. Patch, event, and effect references must continue to
flow into the compiler's single dangling-reference guard.

Update the code generator's emitted imports as part of this phase. Regenerate
once after the handwritten interfaces settle, then inspect the full generated
diff. Expected generated changes are import paths only unless the extraction
reveals an existing coupling that requires an intentional protocol change.

### Phase 5: split the effect recorder

Move trigger and scalar modules under `script/`, then split `effect-core.ts`
along its existing conceptual sections:

```text
script/effects/types.ts
script/effects/modifiers.ts
script/effects/structural.ts
script/effects/recorder.ts
```

Preserve one `recordEffects()` interface. Avoid exposing the recording stack or
introducing an adapter for every generated effect; generated effect metadata is
already the data-driven adapter.

Update codegen import templates and regenerate. Existing effect, event,
scope-safety, scripted-definition, and evaluator tests are the regression
surface.

### Phase 6: deepen the compiler

Decompose `build.ts` last, after the modules it coordinates have stable homes.

Start by extracting leaf responsibilities:

1. `config.ts`;
2. `model.ts`;
3. `localization.ts`;
4. `freeze.ts`;
5. `references.ts`;
6. `patches.ts`.

Then rename the remaining coordinator to `compiler/compile.ts`.

The final coordinator should make fold order and canonical ordering easy to
audit without duplicating their implementation. Do not model each phase as a
public pass object or introduce dependency injection where only one
implementation exists.

## Verification

For every phase:

```sh
npm run typecheck
npm test
npm run build
```

Also run:

```sh
npm run example
```

when a move touches compilation, rendering, discovery, or installation.

For phases that change generator imports or handwritten generator/runtime
interfaces:

```sh
npm run codegen
npm run codegen:check
```

During an intentional uncommitted generated-import change, `codegen:check` may
correctly report the generated diff. Inspect that diff as a public-interface
change before establishing the new baseline.

Standing acceptance criteria:

- no intentional snapshot updates;
- no emitted PDXScript or localization byte changes;
- no public export additions or removals;
- no changes to `createMod`, `mod.feature`, `mod.compile`, `render`, `write`,
  `install`, or `stellaris.*` consumer call shapes;
- no hand-edited generated files;
- no permanent re-export shims for old private source paths;
- no unrelated feature or behavior changes.

If a phase uncovers a behavior defect, capture it separately rather than fixing
it inside the organizational migration. That keeps a structural diff reviewable
and preserves the snapshots as falsification evidence.

## Completion criteria

The migration is complete when:

- the target top-level responsibilities are visible in the source tree;
- `vanilla` is visibly a part of Stellaris integration rather than a peer with
  an unexplained distinction;
- the pure compiler and pure renderer are separated from filesystem adapters;
- no handwritten source file combines the major responsibilities identified in
  this proposal;
- `compile()` and `recordEffects()` remain deep interfaces rather than being
  replaced with shallow pass-through layers;
- the README source map matches the implementation;
- all verification gates pass with unchanged behavioral snapshots.

# Pure-API probe verdict: the fold holds

> **Migrated 2026-08-02.** The dispatch plan below ran to completion on
> `feature/pure-api` in its six chunks (9dd8857 promote, 78871c4 codegen,
> 13f4c56 examples/README, 6b1853b runtime tests, 50a9d95 type tests, then the
> builder deletion). `Mod`, `GeneratedContentMethods`, and
> `GeneratedEventMethods` are gone; the byte-parity claim lives on as the
> goldens in `tests/__snapshots__/pure-api/`, captured from `Mod.render()`
> before the class was deleted. The watch items at the end are still open and
> tracked separately. The body below is the spike's verdict as written and is
> left intact.
>
> **Content ref-integrity landed 2026-08-02.** The first watch item is closed:
> `buildMod` now fails when a content reference carrying the mod's own prefix
> resolves to nothing in the build. References are recorded as the generic
> writer lowers them, from generated field metadata (`refTypes`) naming the
> registries each field may reference, so the check is registry-aware — a
> prerequisite has to be a built _technology_ — and never mistakes a flag,
> localization key, or saved event target for a reference. Defines, technology
> patches, and the ship-of-size-limits contribution are covered; references
> made inside effect closures still are not, beyond the event scan.

The SDK-22 spike: pure authoring functions, `buildMod` as the explicit fold
the `Mod` builder already was, `render`/`write` as free functions. The probe
lives in `design/pure-api-probe/` and stays there — it is the design record,
not the implementation. The only `src/` change is an optional
prefix-violation policy hook on `ContentAuthoring`'s constructor (the
decided warning behavior is unreachable otherwise, since the throw preceded
every other effect of `define`).

The API shape evolved three times inside the spike, each step decided with
Jackson; the final design is registry-typed collection factories. The
[evolution](#design-evolution) is recorded at the end — everything else in
this doc describes the final shape.

## The judgment

**The pure API reproduces the class builder byte-for-byte with no lost
validation, and the refactor is as mechanical as the ticket claimed.**
[probe.test.ts](../design/pure-api-probe/probe.test.ts) pushes a fixture
exercising every emission channel — technology with a cross-reference,
situation type with the `targetScope` graft and desc-bearing weight
modifiers, cross-firing events, an on-action binding, the
ship-of-size-limits contribution, and a vanilla technology patch — through
both APIs: identical file maps, patch plan and win assertions included.
All existing gates (540 tests, typecheck, build) pass untouched; the probe
never ships (`tsconfig.build.json` excludes `design/`).

Acceptance results:

| Check                                                                                                | Result                     |
| ---------------------------------------------------------------------------------------------------- | -------------------------- |
| Byte parity with `Mod` across all emission channels                                                  | Pass                       |
| Patch plan + win assertions identical through `buildMod`                                             | Pass                       |
| Duplicate ids, loc dedupe, on-action contract errors preserved                                       | Pass                       |
| Missing prefix (content id, event namespace) → warning datum                                         | Pass                       |
| Vanilla id collision a hard error under an injected view                                             | Pass                       |
| Event duplicate id errors at the definition site, with namespace                                     | Pass                       |
| Fired-but-not-included event caught by the emission scan                                             | Pass                       |
| One namespace per event file, incl. the same-stem-merge edge                                         | Pass                       |
| Split technology files reserved + enumerated by the patch plan                                       | Pass                       |
| Repeated/reordered builds render byte-identically (WeakMap hazard)                                   | Pass                       |
| Type claims: literal ids, FROM witness, on-action contract, targetScope, collections-only `buildMod` | Pass (`probe-negative.ts`) |
| Full suite, build, dist exclusion                                                                    | Pass (540 tests)           |

## The authoring shape

Every piece of content is created through a **registry-typed collection
factory** ([factories.ts](../design/pure-api-probe/factories.ts)); `buildMod`
takes collections — never loose items (pinned at the type level):

```ts
const techs      = createTechnologies();                        // default file stem
const ascension  = createTechnologies("ascension");             // common/technology/<prefix>_ascension.txt
const events     = createEvents("ascension_events", "pp_mod_ascension"); // file + namespace, co-declared
const hooks      = createOnActions();

const opener = ascension.defineTechnology({ id: "pp_mod_tech_opener", ... });
const hum    = events.defineCountryEvent({ id: 1, ... });        // full id "pp_mod_ascension.1", from birth
hooks.on(onActions.onGameStartCountry, hum);
techs.patchTechnology(vanilla.technology("tech_gene_forging"), (t) => ({ cost: t.cost.value * 2 }));

const mod   = buildMod(config, [techs, ascension, events, hooks], { vanilla });
const files = render(mod);
await write("./out", files);
```

Why this shape won:

- **Creation is registration.** The definers record what they create, so the
  builder's one genuinely good property — you cannot define something and
  forget to register it — comes back without the class. The only thing left
  to forget is a whole collection, a missing _file_, not a missing
  definition (and for events even that is caught — see the scan below).
- **Each factory returns only its registry's definers**, so the surface is
  discoverable and wrong-registry content is unrepresentable. `Collection<T>`
  is generic in its element type: a technology collection's `items` are
  `TechnologyItem[]` (definitions and patches), not an anonymous `ModItem[]`
  — the type says what the collection can contain.
- **`createEvents(file, namespace)` co-declares layout and identity at one
  site** — one namespace per event file holds by construction, visible while
  authoring, not discovered at build (see events section).
- A pack is a module exporting a collection or array of collections
  ([pack.ts](../design/pure-api-probe/pack.ts)); nested arrays flatten.

In the migration the factories are emitted by codegen, one per registry,
replacing the `GeneratedContentMethods`/`GeneratedEventMethods` classes.
`createTechnologies` in the probe is the hand-written template. The
pluralized naming needs a codegen rule (`technology` → `createTechnologies`;
some of the 34 names pluralize awkwardly).

## The open questions, answered

### What guards the define/patch boundary (the ticket's main question)

Two conditions, two severities, exactly as the ticket suspected:

- **Missing prefix** is a naming nudge: a `missing-prefix` warning on the
  built value, in every case. The same policy covers event namespaces: a
  namespace that is not the prefix and does not start with `<prefix>_`
  warns.
- **Collision with a real vanilla id** is a silent override of someone
  else's content: a **hard error** — but only checkable when `buildMod` is
  given a vanilla view (`buildMod(config, collections, { vanilla })`). The
  check is data-driven: the view's per-file `keys` grouped by directory,
  matched against each registry descriptor's `outputDir`. Patch items are
  exempt — they target vanilla keys on purpose.

Honesty note: today's loader only ingests `common/technology` and
`common/scripted_variables`, so in practice only technology ids are guarded;
the mechanism widens automatically as the loader does. Without a view the
prefix warning is all the SDK can honestly offer.

The one-view rule also gets simpler: when a view is injected, every patch
must come from _that_ view (`manifestKey` equality); without one, the first
patch's origin anchors the check, as today.

### The warning channel

Warnings are **data on the returned value** (`mod.warnings`), never console
output. `render` stays pure; callers or a future CLI decide presentation.
The class API's `console.warn` on loc quote replacement becomes a
`loc-quote-replaced` warning datum.

### Duplicate-id error locality

Assembly-locality is enough for content: the error names registry and id
(`Duplicate technology id "x"`), ids are unique greppable strings, and the
probe found no case where the define site was needed. Events actually
_improve_ on the class API: the factory knows its namespace's used numeric
ids, so a duplicate throws at the definition site with a precise stack —
`buildMod` keeps a global full-id check for two factories sharing one
namespace string.

### Events: explicit namespaces, eager closures, plain ids

Decided across the spike discussion, in order: the namespace is **not**
inferred from any filename (identity must never follow layout — saves
persist pending fires by full id, on_actions reference it, so moving an
event between files must never change its id); it is **not** the mod prefix
(DoA-scale mods need per-feature namespaces and per-namespace numeric id
spaces); it is **declared at `createEvents(file, namespace)`**, written in
full, prefix compliance a warning.

Consequences, all pinned by test:

- The namespace is known at definition, so **the recorder closures run
  eagerly at the define site** — exactly the class API's semantics, the
  ticket's blessed non-goal — and the full id is a plain string from birth.
  Nothing about an event is deferred; the item carries
  `{ id, scope, from, entry, locEntries }` as finished data.
- **One namespace per emitted file by construction**, because file and
  namespace are co-declared. The reachable edge — two `createEvents` with
  the same file stem and different namespaces merging — is a hard error at
  `buildMod` naming the file and both namespaces.
- Numeric ids are **per namespace** (`pp_mod_alpha.1` and `pp_mod_beta.1`
  coexist), each namespace's events in its own file with its own
  `namespace = ...` header.
- **The dangling-reference guard is an emission scan**: firing an event
  whose collection was never passed to `buildMod` would silently emit a
  well-formed id with no definition behind it, so `buildMod` walks every
  emitted entry tree for scalars shaped like `<prefix>...N` own-event ids
  and errors when one has no definition in the build. (Loc keys like
  `pp_mod.1.name` don't match the pattern; refs to other mods' events use
  their prefix and are deliberately out of scope, consistent with the
  prefix policy.)

### The `modifierDescKeys` WeakMap hazard

Fold order is sufficient; the desc keys do not need to become threaded
data. The write (loc extraction in the content step) always precedes the
read (lowering in the emission grouping), the derived key
(`${ownerId}_${fieldPath}_${index}`) depends only on the definition, and the
probe's determinism test builds twice from one set of collections and
renders in reverse order, byte-identically.

### File layout and SDK-19

The collection factory is the SDK-19 primitive. Semantics, validated by
test:

- The optional file stem places the factory's content in
  `<outputDir>/<prefix>_<stem>.txt`; no stem → today's default, which is
  what keeps the parity test byte-identical.
- Same stem across factories of one registry merges in item order.
- **Stems are flat, validated snake_case — no `/`.** The game does not read
  registry content out of subdirectories; the subdirs that exist under a
  registry dir (`common/technology/category/`, `tier/`) are _different
  registries_ pinned by name in the loader, not layout. The check (factory
  at construction, re-asserted during flattening for hand-built Collection
  values) also makes the emitted path safe by construction.
- **The path-order constraint holds**: emission grouping happens in
  `buildMod`, so the patch planner reserves and enumerates _every_ own
  technology file, not one fixed stem — a split-tech-plus-patch test pins
  that the computed patch path never lands on an own file. Patch filenames
  are always resolver-computed; the factory's stem names only the mod's own
  definitions file. Localization stays one file — its splitting belongs to
  the standalone-localization work.

`render` is serialize-only over precomputed `contentFiles`/`eventFiles`;
`buildMod(config, collections, options?)` is the whole signature.

### Contribution-style APIs

`addShipOfSizeLimits([...])` lives on `createCountryShipOfSizeLimits` —
a contribution with no id and no author-named file, folded into the shared
additive `default = { ... }` sink at a fixed path. The shape generalizes to
any future non-id-keyed registry.

## Design evolution

Three shapes, each retired for a named reason:

1. **Free definers + flat item array + deferred event stamping.** Free
   `defineCountryEvent(def)` couldn't know its namespace, so event ids were
   WeakMap-stamped getters resolved in `buildMod` — identity-keyed hidden
   state with a "reflects the most recent build" sharp edge, and forward
   references as a side benefit. Retired when explicit namespaces made
   identity available at definition; the forward-ref bonus was knowingly
   traded away (definition order before use, as the class API always
   required). Also rejected along the way: placeholder substitution in
   `PdxEntry` (pollutes the game-semantics-free pdxscript contract), an
   ambient current-namespace global, changing `FireEventArgs`.
2. **A generic `collection()` with `pack.add(...)`** — the collector as
   module idiom and file group, with hint inheritance for nesting. Retired
   because it filed events by layout while identity needed namespaces
   (inconsistent), and its guarantees only landed at build time.
3. **Registry-typed factories** (final): `createTechnologies(file?)`,
   `createEvents(file, namespace)`, ... — creation is registration, the
   surface is registry-scoped, and the event invariants hold by
   construction at the authoring site.

## Findings the probe caught (why probes exist)

1. **The generated `Def` types overload their `Id` parameter.**
   `SituationTypeDef<Id>` uses `Id` both as the definition id and to key the
   nested `stages` record. Sound for the class API's `PrefixedId<P>` pattern
   type; wrong for a literal `Id`, which would force every stage key to
   equal the definition id. The probe's `defineSituationType` works around
   it with an `Omit`/intersection; **the migration must separate "definition
   id type" from "nested repeated-struct key type" in the emitter.**
2. **`EventDef` is contravariant in its scope through the author's
   closures**, so differently-scoped event _definitions_ cannot union. The
   deferred design had to carry `def` opaquely; the final design sidesteps
   it entirely — items carry the built `entry`, never the definition.
3. **The event FROM brand is module-private but reachable by intersection**:
   `EventItem<S, From> = DefinedEvent<S, From> & {...}` carries the phantom
   without naming the symbol. No `src/events.ts` change needed, now or at
   migration.
4. **`OnActionAuthoring` re-expresses cleanly**: ownership becomes "the
   event value appears in a collection passed to the same `buildMod`",
   checked by identity. Error messages unchanged except the ownership one,
   which now says what the pure API means.

## Deviations from the class API, accepted

- **Loc yml line order** follows the fold's grouping (all content, then all
  events), not the author's interleaved call order. The parity test orders
  its class-API calls the same way; migrating tests that interleave defines
  may see loc-line reordering in snapshots — a permissible byte-level
  difference to review once at migration.
- **Patch guard errors move**: duplicate-patch and one-view errors surface
  at `buildMod`, not at the `patchTechnology` call site.
- **`patchPlan` is computed once in `buildMod`** and carried on the value;
  the class API recomputes it per `render()`.
- **Event namespaces are authored**, not implied by the prefix — the
  degenerate `createEvents("events", "<prefix>")` reproduces the class API
  byte-for-byte.

## Migration dispatch plan (sequential subagent chunks)

Six chunks, dispatched to subagents **sequentially** — each leans on the
previous one's green gates. The class API stays alive until the final
chunk, so the byte-parity harness guards every intermediate state.
Expected wall clock: a supervised afternoon, not days.

**Standing orders for every chunk**: end with `npm run typecheck`,
`npm test`, `npm run build` green (plus `npm run codegen` + report review
where codegen inputs changed); Prettier on touched files; snapshots change
only when the serialized output change is intentional, and their contents
get inspected, not accepted; no compatibility shims — the package is
pre-release and breaking changes are preferred (AGENTS.md); one commit per
chunk.

1. **Promote the pure core into `src/`.** Copy the probe's hand-written
   machinery into `src/`: the item vocabulary + stem/namespace asserts
   (items.ts), the `buildMod` fold + `PureMod` (build.ts), `render`/`write`
   (render.ts), and the hand-written factory parts (`makeCollection`,
   `createEvents`, `createOnActions`, the `defineSituationType` graft
   wrapper). Export the new surface from `src/index.ts` alongside `Mod`.
   Port the probe's evidence to permanent homes: `probe.test.ts` →
   `tests/pure-api.test.ts` (parity vs `Mod` included), `probe-negative.ts`
   claims → `tests/pure-api.test-d.ts`. Leave `design/pure-api-probe/`
   untouched (design record). Done when both APIs coexist and all gates
   pass.
2. **Emit the factories from codegen.** `tools/codegen/index.ts`
   `contentRegistry()` additionally emits the 34 content factories
   (literal-preserving definers; `patchTechnology` only on the technology
   factory; skip-list `situation_type`'s definer for the hand-written graft
   wrapper, precedent `HAND_WRITTEN_TRIGGERS`); `tools/codegen/emit/events.ts`
   emits `createEvents`'s 20 definers. Add an explicit `plural` field to
   `CONTENT_MANIFEST` entries rather than an English pluralizer. Fix the
   `Id` double duty (finding 1): nested repeated-struct record keys become
   `string` in the generated `Def` types. Keep emitting the abstract
   classes this chunk. Update codegen snapshot tests, run `npm run
codegen`, read the report, inspect the full `src/generated/` diff as a
   public-API change, commit generated output with the emitter change.
3. **Migrate the examples and README.** `examples/hello-galaxy`,
   `examples/hardening`, `examples/calibration-patch` to
   factories/`buildMod`/`render`/`write`; README samples; any load-bearing
   `docs/` snippets. Regenerate the committed `examples/*/out/` trees and
   inspect diffs (loc-line order may shift — the accepted deviation).
   `npm run example` joins the gates for this chunk.
4. **Migrate the runtime tests.** The 12 runtime test files
   (`tests/content.test.ts`, `events`, `on-actions`, `patches`, `tech`,
   `testing`, `hardening-example`, `real-install`, ...). Mechanical
   rewrites: `mod.defineX(...)` → factory definers, `mod.render()` →
   `render(buildMod(...))`. Assertions stay semantically identical; the
   expected diffs are loc-order in snapshots where defines interleaved, and
   the moved patch-guard/ownership error messages.
5. **Migrate the type-level tests.** The ~6 `.test-d.ts` files — the
   heaviest churn: `Mod<P>`/`PrefixedId` expectations become literal-id
   preservation, factory typing (`Collection<T>` element types), and
   collections-only `buildMod` claims; events/on-actions/situations
   contracts re-pinned through the factories.
6. **Delete the builder and finalize.** Remove `Mod`, stop emitting
   `GeneratedContentMethods`/`GeneratedEventMethods` (delete
   `event-methods.ts`; drop `ContentDefMap`/`DefinedContentMap`/`PrefixedId`
   if nothing references them), overhaul `src/index.ts`. Rework the two
   design records that reference `Mod` so they still compile:
   `design/pure-api-probe/probe.test.ts` swaps its class-API twin for
   goldens captured in chunk 1's parity test, and
   `design/testing-probe/probe-mod.ts` migrates to the factories (records
   stay frozen in intent, not in compiler errors). Update the AGENTS.md
   "Adding a new content type" recipe, roadmap, and doc status headers.
   Full gates plus `npm run codegen:check` and `npm run example`.

Sequencing rationale: 1–2 are purely additive (parity harness live from
chunk 1 on), 3–5 migrate consumers while both APIs exist, 6 deletes. A
chunk that ends red is fixed in place, never worked around by the next.

## Watch items for the implementation

- **The residual forgotten-item exposure** is a whole collection never
  passed to `buildMod`. Events inside it are caught when fired (the
  emission scan); content is not — the planned **content ref-integrity
  check** (a branded reference carrying the mod's own prefix must resolve
  to an item in the build) closes most of the rest, since cross-references
  are the backbone of real mods. True leaves (a standalone edict nothing
  references) remain on the author.
- **Oracle backlog**: one namespace spanning several files (two
  `createEvents` sharing a namespace with distinct stems) is emitted today
  and is standard modding practice, but has no oracle run behind it. The
  JetBrains Paradox plugin's stricter reading (which motivated
  one-namespace-per-file) suggests testing this before relying on it.
- Whether `DefinedContent.toEntries()` survives on the public value or
  lowering becomes `buildMod`-internal (the probe reuses the existing
  `ContentDefinition` via `ContentAuthoring`, deferring the question).
- Packs hardcode their id prefix; a prefix-generic pack is a function of the
  prefix. Decide whether the SDK blesses that pattern in docs or leaves it
  to userland.
- The three component-template registries share one `outputDir`/`fileStem`;
  the class API's `ContentAuthoring.render()` map keying means last-wins
  today (pre-existing bug, spun off separately). The probe's per-registry
  grouping has the same hole — its `contentFiles` can carry one `relPath`
  twice and `render`'s `Map.set` keeps the later one. The pure model makes
  the real fix natural (merge entry lists per `relPath` across registries
  during the fold), but the probe does not implement it; whoever fixes the
  bug should fix both.

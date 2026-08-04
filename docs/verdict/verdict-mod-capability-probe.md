# Mod-capability probe verdict: the boundary earns a migration

> **Spike only, 2026-08-04 (SDK-72).** The probe lives under
> `design/mod-capability-probe/`; no shipping SDK source changed. Escape
> criteria were committed there before the implementation was built.

## Judgment

**Adopt the mod-bound capability in a separate migration.** The probe clears
the six mandatory escape criteria: it remains pure, makes the prefix the
authoring-time id authority, enables genuinely mod-parameterized packs,
supports typed forward/cyclic event references without registration, preserves
both canonical examples byte-for-byte, and keeps feature layout separate from
identity.

This is not a wrapper over the free API. The boundary owns three decisions the
free functions cannot:

1. one snapshotted config and literal prefix mint every own id;
2. one id profile decides each registry's conventional segment once;
3. event refs can exist before their definitions because their namespace,
   number, scope, kind, and FROM contract are already knowable.

`compile` delegates directly to `buildMod`. The fold, canonical emission order,
patch planner, validation, `PureMod`, `render`, and `write` do not move.

**Discovery decision, affirmed by Jackson on 2026-08-04:** one explicit
`feature` export per discovered module. The probe measured both alternatives
before that choice rather than treating byte parity as authority over an
authoring decision.

## Escape-criteria results

| Criterion                                           | Result | Evidence                                                                                                                                                      |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immutable capability; inert definers; existing fold | Pass   | Capability/config/id profile are frozen; feature ownership is immutable and checked at compile; omitted definitions do not appear; `compile` calls `buildMod` |
| Prefix authority and literal minted types           | Pass   | `type_probe_tech_theory`, `type_probe_resonance.2`, rejected caller-supplied `id`, and snake-case logical-name validation in the probe                        |
| Mod-parameterized pack                              | Pass   | One generic pack emits correctly branded alpha and beta technology chains                                                                                     |
| Reference branding and forward/cyclic events        | Pass   | Cross-registry reference rejection plus a two-event cycle declared as handles before either definition                                                        |
| Hello-galaxy and hardening byte parity              | Pass   | Exact `Map` entry equality; hardening patch-plan equality included                                                                                            |
| Feature fan-out and layout non-identity             | Pass   | One feature emits technology and building files; moving one item between stems changes only its path                                                          |
| Honest discovery comparison                         | Pass   | Today's every-export discovery and the explicit-feature alternative render identical file maps                                                                |
| Data-driven codegen                                 | Pass   | All 35 registries derive from `CONTENT_MANIFEST`; the existing graft/patch/contribution overlays remain the only exceptions                                   |
| Compile performance and error quality               | Pass   | 6.04% median slowdown against a 20% ceiling with all 35 real method signatures; errors name the forbidden `id` and building-to-technology brand mismatch      |
| Priced migration                                    | Pass   | Measured below by AST call counts, files, generated surfaces, and public boundaries                                                                           |

## The probed surface

```ts
const mod = createMod(config, { ids: stellarisIds });

const theory = mod.technology("resonance_theory", {
  name: "Crystal Resonance Theory",
  area: "physics",
  tier: 2,
  category: "particles",
});

const events = mod.namespace("resonance");
const followup = events.countryHandle(2);
const opener = events.countryHandle(1);

const openerDefinition = opener.define({
  isTriggeredOnly: true,
  immediate: (country) => country.countryEvent({ id: followup }),
});

const followupDefinition = followup.define({
  isTriggeredOnly: true,
  immediate: (country) => country.countryEvent({ id: opener }),
});

const feature = mod.feature("resonance", [theory, openerDefinition, followupDefinition]);
const compilation = mod.compile([feature]);
```

The content method removes `id` from its definition argument and returns the
existing branded `ContentItem`, narrowed to a template-literal id:

```ts
type Id = "hello_galaxy_tech_resonance_theory";
```

Logical names are themselves lowercase snake_case. That is an authoring
boundary check before id minting, not an accidental rejection later in a
serializer: the capability can point at the logical name that needs changing.

The event handle is an immutable `EventRef` plus a pure `define` function. It
contains no entry and registers nowhere. Once every handle in a cycle exists,
each definition closure may safely record references to the others. `buildEvent`
still performs the lowering and `buildMod` still catches duplicate full ids and
missing definitions.

For the root namespace, the probe uses `mod.namespace("")` to reproduce the
examples' current bytes. The migration should expose `mod.namespace()` for that
case and reserve `mod.namespace("resonance")` for
`<prefix>_resonance`; an empty-string public spelling is needless ceremony.

## What the prefix authority buys

The capability-authored equivalents contain no full content-id literals:

- hello-galaxy replaces both explicit `hello_galaxy_tech_*` ids and all five
  loop-generated prefixes with logical names;
- hardening replaces six full content ids with `"marker"` under registry-specific
  segments;
- references keep using the returned branded values, so changing a logical
  name changes its definition and every in-module reference together;
- a definition cannot accidentally become a vanilla override because callers
  cannot supply its full id. Deliberate overrides remain `patchTechnology`.

The id profile is real policy, not decoration. The byte-parity profile maps
`technology → tech`, `traditionCategory → tradition_category`, and so on. A
production profile needs one reviewed row for all 35 registries, generated from
the same manifest as the methods. It should be a built-in default; most mods
should not spell 35 segments at setup. An explicit profile remains useful for a
house convention or reusable pack test.

This deliberately reverses SDK-22's decision to drop prefix typing. SDK-22 was
right for context-free functions: without a bound prefix, accepting a full
string and warning later was the honest shape. SDK-72 changes the premise. Once
the mod capability owns a literal prefix, asking the caller to repeat it is
duplicated authority, and minting is both simpler and stronger.

## Reusable packs and capability threading

A pack takes the full capability so `config.prefix` is a covariant literal
inference site:

```ts
function resonancePack<P extends string, I extends IdProfile>(mod: ModCapability<P, I>) {
  // ...
}
```

The same function compiled under `alpha_mod` and `beta_mod`; each emitted its
own minted ids and prerequisites. This is the composability gap the current API
cannot close: a free-definer pack must either hardcode one prefix or accept an
id-building convention as a parallel, unenforced argument.

Threading cost is one value at a module boundary, not one argument per
definition:

- an application feature module imports its mod capability from the mod root;
- a reusable pack receives the capability explicitly;
- every definition inside uses ordinary method calls.

The pack currently uses only `technology` and `feature`, but no structural
slice helper is introduced for that one consumer: the full capability keeps
literal inference intact, and a narrower abstraction needs a second real use
before it earns a contract.

The full capability hello-galaxy equivalent is 151 lines versus 226 lines
across the current two content modules plus `mod.ts` (comments included).
Hardening is 191 versus 209 lines. Line count is not the reason to migrate, but
it falsifies the concern that binding the capability necessarily adds
ceremony.

## Discovery: explicit `feature` decided

Both alternatives preserve feature colocation, canonical order, and byte
output. They disagree about what an ES module export means.

| Concern                             | Every export registers (today)                    | Explicit `feature` export                         |
| ----------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| Placement spelling                  | No wrapper                                        | One `mod.feature(stem, items)`                    |
| Output stem                         | Derived from source basename                      | Authored in the feature value                     |
| Source-file rename                  | Renames emitted files                             | Changes no output                                 |
| Exporting a ref for sibling modules | Also places it                                    | Ordinary module API                               |
| Re-exporting a ref                  | Duplicate placement/build error                   | Harmless unless added to the feature              |
| Missing placement                   | Missing export; lint/ref-integrity mitigate       | Missing from feature; lint/ref-integrity mitigate |
| Discovery check                     | At least one recognized item export               | Exactly one `feature: Collection` export          |
| Reusable pack                       | Export items/arrays and inherit consumer filename | Return a feature or feature factory explicitly    |

**Decision: explicit `feature`.** `createMod` makes the feature a first-class
value already; discovery collects that value instead of reconstructing it from
all exports. It restores ordinary ESM meaning to named exports and keeps output
layout stable when source is reorganized. The one extra wrapper is visible
policy, not accidental coordination.

The probe's `discoverExplicitFeatures` reads only the named `feature` export and
allows the module to export `theory` and `lab` for reuse. Its output is
byte-identical to today's `discoverContent` over equivalent exports.

Do not support both conventions. Treating named exports as placement alongside
an explicit feature would make placement ambiguous and restore the re-export
hazard the decision removes.

## Codegen cost

The capability does not need a new per-registry model:

- `CONTENT_MANIFEST` currently resolves to 35 registry rows;
- codegen emits 34 mechanical `defineX` functions, with `situation_type` as the
  one existing hand-written graft;
- the same overlays already identify one patch method (`technology`) and one
  contribution method (`country_ship_of_size_limit`);
- event codegen emits 20 scoped event definers from the event-kind table.

The probe's `capabilityMethodRows()` derives all 35 content methods from the
manifest and proves the existing overlay sets select exactly those three
exceptions. No `if (registry === "...")` is introduced.

A migration changes two emitter functions and their two generated outputs:

| Surface                                               |        Current size | Change                                                                                    |
| ----------------------------------------------------- | ------------------: | ----------------------------------------------------------------------------------------- |
| `contentDefiners()` / `generated/content-definers.ts` | 601 generated lines | Move the same resolved `Def`/scope signatures behind prefix-minting capability methods    |
| `emitEvents()` / `generated/event-definers.ts`        | 267 generated lines | Generate direct methods plus immutable handle constructors; continue calling `buildEvent` |
| Hand-written capability core                          |     New, one module | Snapshot config/profile, mint ids/namespaces, expose `feature` and delegate `compile`     |
| `build.ts`, `content.ts`, `render.ts`                 |            Existing | No design change                                                                          |

The shipping emitter must retain the current scope-parameter arm and the
hand-written situation graft. Those are existing generic/overlay decisions,
not costs discovered by SDK-72.

## Type performance and error quality

`measure-compile.ts` runs five fresh `tsc --noEmit` processes per shape,
alternating order. Each fixture authors 64 literal technologies. The capability
fixture also forces a 35-registry completion surface so the measurement does
not accidentally price only the six runtime methods needed by the two parity
examples.

Measured on this checkout:

| Shape                | Samples (ms)                                |     Median |
| -------------------- | ------------------------------------------- | ---------: |
| Current free definer | 1718.82, 1738.53, 1689.50, 1666.05, 1680.45 | 1689.50 ms |
| Capability           | 1800.47, 1787.46, 1826.45, 1791.58, 1747.84 | 1791.58 ms |

The capability median is **6.04% slower**, inside the pre-stated 20% ceiling.
Unlike the initial surface-only check, the capability fixture now instantiates
every one of the 35 method parameters and exact branded `ContentItem` returns,
including the scope-parameterized decision method and hand-written situation
graft. The spread between runs also shows why median and alternating order
matter more than a single wall-clock sample.

The negative fixture preserves actionable errors at the authoring boundary:

- caller-supplied `id`: `'id' does not exist in type Omit<TechnologyDef<...>, "id">'`;
- building in `prerequisites`: the error names the `ContentItem<"building">` to
  `TechnologyRef` mismatch and shows the `"building"` versus `"technology"`
  brand.

No giant prefix union appears in either message.

## Migration blast radius

`measure-blast-radius.ts` parses call expressions with the TypeScript compiler,
so declarations and prose do not inflate the counts.

| Slice                 | Files touched | `defineX` | `namespace` | `collection` | `buildMod` | `discoverContent` | `on` | `patchTechnology` | contribution adder |
| --------------------- | ------------: | --------: | ----------: | -----------: | ---------: | ----------------: | ---: | ----------------: | -----------------: |
| Examples              |        7 of 8 |        19 |           2 |            9 |          3 |                 1 |    1 |                 2 |                  0 |
| SDK tests             |      30 of 53 |       434 |          64 |          197 |        215 |                30 |   25 |                18 |                 10 |
| `stellaris-ids` tests |        2 of 3 |         2 |           0 |            0 |          0 |                 0 |    0 |                 0 |                  0 |

The large test count is genuine: the public authoring boundary is the primary
test surface. This is a breaking migration, not a compatibility-layer change.
The package is unreleased, so the right execution is a staged parity migration
followed by deletion:

1. Add `createMod` and generated capability methods beside the free surface.
2. Port the byte-parity, feature-ownership, logical-name, and negative claims into permanent SDK tests.
3. Implement discovery over one explicit `feature` export per module.
4. Migrate examples, then runtime/type tests in bounded chunks.
5. Delete free content/event definers and redundant public `collection`
   ceremony; keep `buildMod` as the capability's tested fold, whether or not it
   remains an advanced public export.
6. Update README, repository guidance, scaffold output, and historical verdict
   status notes together.

Do not ship both authoring surfaces as long-lived aliases. That would give own
content two id authorities—minted logical names and caller-authored full
strings—and erase the guarantee the migration exists to buy.

## Accepted costs and watch items

1. **Event duplicate locality changes for handles, with an ESLint mitigation.**
   Calling one handle's `define` twice is pure and produces two values; the
   complete duplicate check therefore remains at `compile`. A one-use mutable
   bit would make the same call return different results based on history and
   violate the premise.

   `create-stellaris-mod` already gives consumers ESLint 9,
   `typescript-eslint`'s type-checked configuration, and an inline `pdx` plugin
   containing `one-namespace-per-file`. Add a second rule there: resolve local
   bindings whose type is `CapabilityEventHandle`, track direct
   `.define(...)` references to the same symbol, and report the second call at
   its source location. This needs no new consumer dependency or configuration
   boundary, and it puts the diagnostic in the generated project where mod
   authors actually work.

   The rule is deliberately an author-facing early check, not the authority.
   Aliases passed through helpers, cross-module flows, and mutually exclusive
   control-flow paths prevent lint from proving the runtime property in
   general, so `compile` still rejects every duplicate it observes. Pin the
   rule with an executed generated-project lint test: two direct calls must go
   red at the second call, one call must stay green, and alias/control-flow
   cases must document whether they are supported rather than silently
   expanding the claim.

2. **A root namespace needs a zero-argument overload.** The probe's empty-string
   spelling is evidence, not the proposed API.
3. **Default id segments need review.** They are public emitted identity. Seed
   them from current ecosystem convention and freeze them in one generated
   profile, with explicit overrides rather than ad hoc per-call strings.
4. **Prefix minting intentionally removes arbitrary own ids.** Third-party and
   vanilla references stay strings/refs; whole-object overrides stay patch
   methods. If a real own-definition use case cannot fit the profile, add a
   named escape hatch with a loud type/runtime distinction rather than putting
   `id` back on every method.
5. **The compile timing is a representative fixture, not an editor benchmark.**
   The probe now instantiates all 35 real signatures and returns; rerun the
   completion-latency budget after any generated surface change.
6. **Features have a capability owner.** `feature` carries an unforgeable
   module-local marker holding a frozen owner object with the literal prefix.
   Its type rejects differing prefixes; `compile` compares object identity, so
   two capabilities with the same prefix still cannot exchange features. This
   closes the direct-legacy-collection and cross-mod feature escape hatches
   without a registration set. JavaScript and casts receive the same runtime
   check; vanilla patches and contribution sinks remain valid feature items
   because they are deliberately not own-prefixed definitions.

## Reproduction

```sh
./node_modules/.bin/vitest run design/mod-capability-probe/probe.test.ts --project root
./node_modules/.bin/tsc --noEmit
node design/mod-capability-probe/measure-compile.ts
node design/mod-capability-probe/measure-error-quality.ts
node design/mod-capability-probe/measure-blast-radius.ts
```

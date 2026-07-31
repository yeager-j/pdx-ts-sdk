# Handoff: one emitter, many registries

The API-breadth phase. Written after the patches slice landed and passed its
in-game calibration (2026-07-31), for whoever generalizes the content-type
codegen before `defineTradition`, `defineEdict`, and the rest get built.

Read [verdict-patches.md](verdict-patches.md) for the state of the world and
[verdict-effects-probe.md](verdict-effects-probe.md) for the precedent that
matters most here: codegen-at-scale already worked once (1054 triggers, 976
effects, 87 scope clusters from one pipeline). This slice applies the same
move to content types.

## The problem

`vendor/cwtools-stellaris-config/config/common/` holds **130 rule files** —
one per content family. The SDK loads exactly one
(`technologies_consolidated.cwt`, via the pinned `RULE_FILES` allowlist in
`tools/codegen/cwt/rules.ts`), and emits it through a **bespoke emitter**
(`tools/codegen/emit/technology.ts`). If the second content type gets a
second emitter file, the eightieth gets an eightieth, and "flesh out the
API" becomes O(registries) handwork — the exact treadmill the design doc
warned about when it chose codegen in the first place.

The trap is subtle because the first copy feels cheap: `emit/tradition.ts`
would be a 200-line paste-and-tweak. The cost shows up as drift — eighty
near-identical files that each accrete their own fixes and stop agreeing
about what a field lowering means.

## What is actually type-specific (audit result, 2026-07-31)

`emit/technology.ts` is ~183 lines, and almost all of it is already
general-purpose machinery wearing a technology-shaped name:

| Function | What it does | Technology-specific? |
| --- | --- | --- |
| `flatten` | folds `subtype[…]` blocks into optional fields with the predicate in TSDoc | no — pure rule-shape |
| `mergeByName` | groups overloaded rule keys | no |
| `pickDeclaration` | picks the first declaration the SDK can type | no |
| `memberType` | trigger-block / bare-refs / scalar lowering via `Emitter.valueFor`/`unionFor` | no |
| `localisationMembers` | loc slots from the cwt `localisation = { ... }` block | no — driven by `ContentType.localisation` |
| interface name, docs header | `TechnologyFields`, `type[technology]` | trivially parameterizable |

The genuinely per-type content is **three overlay entries**:
`TECHNOLOGY_EMITTED_FIELDS` (which fields the runtime writer can emit),
two `FIELD_WIDENINGS` rows (`technology.category`, `technology.tier`), and
one `REQUIRED_LOCALISATION` row (`technology.name`). That is the right
size for a per-type cost: rows in an audited table, not files.

The **other half of a vertical is not in codegen at all**, and it is the
real question of this slice: `src/tech.ts` is a hand-written runtime writer
(`Technology.toEntries()` — nine `if (def.x !== undefined) body.push(...)`
blocks) that must agree, by hand, with `TECHNOLOGY_EMITTED_FIELDS`; and
`Mod.defineTechnology` wires the prefix guard, duplicate check, loc
registration, and output file. Eighty of those classes is the same
treadmill wearing runtime clothes.

## The goal

```ts
const ascension = mod.defineTradition({
  id: "pp_mod_tradition_ascension",
  name: "Synthetic Ascension",
  category: "pp_mod_tradition_category_machines",
  possible: hasAuthority("auth_machine_intelligence"),
  modifier: { pop_growth_speed: 0.1 },
});
```

with the marginal cost of the *n*-th content type being: **one manifest
entry** (cwt source file, type name), **overlay rows** where the type is
genuinely weird, and **goldens** — no new emitter file, no new writer
class, no new `Mod` method written by hand.

## The design center: where does the writer live?

Two architectures fit the existing code; deciding between them is most of
this slice's thinking.

**A. Generic emitter, hand-written writers (the minimal move).**
Parameterize `emit/technology.ts` into `emit/content-type.ts`, emit
`TraditionFields` etc., keep writing `src/tradition.ts` classes by hand.
Cheap now; the treadmill survives at runtime and the emitted-fields
allowlist stays a hand-synced contract between two files that cannot see
each other.

**B. Generated field table, one generic writer (the deep-module move).**
Codegen emits, per type, not just the interface but a *field manifest* —
data, not code:

```ts
// generated
export const TRADITION_FIELDS: readonly ContentField[] = [
  { key: "possible", member: "possible", shape: "trigger", scope: "country", optional: true },
  { key: "modifier", member: "modifier", shape: "modifierBlock", optional: true },
  ...
];
```

One hand-written `contentToEntries(def, fields)` walks the manifest —
scalar → `kv`, refs → `list` of `refId`, trigger → splice `entries`,
weight block → the `Modifier` data lowering that `randomList` arms already
use. `Technology.toEntries()` becomes the first consumer and its nine
hand-written blocks become the conformance test: the generic writer must
reproduce today's goldens byte-for-byte before it earns a second type.
Per-type classes shrink to a thin branded wrapper (something must still
`implements TechRef`), or disappear into a generic `DefinedContent<T>`.

B is the recommendation this handoff argues for — the allowlist becomes
*derivable* (a field is emittable iff its shape has a lowering), the
runtime and the types can no longer disagree, and the per-type cost drops
to overlay rows. The risk to respect: a generic writer that starts
accreting `if (type === "technology")` branches is worse than eighty
honest files. The overlay is the pressure valve — a genuinely weird field
gets a named per-type lowering in one audited place, and adding one should
feel expensive.

## What you already have for free

|  |  |
| --- | --- |
| The near-generic emitter | `tools/codegen/emit/technology.ts` — see audit table above |
| Scalar/ref/enum lowering | `Emitter.valueFor`/`unionFor` (`emit/types.ts`), shared by triggers and effects already |
| Output-folder + loc slots per type | `ContentType.path` and `.localisation`, parsed from the cwt `type[...]` block |
| The weight-block shape | `randomList`'s arm modifiers (`{ factor, when: Trigger }` as data) — `weight_modifier`/`ai_weight` on definitions are the same lowering without the closure |
| Codegen-at-scale precedent | effects clustering (87 clusters, 41 interfaces) — including how to report what was skipped |
| Generated methods on a hand-written class | `src/events.ts` module augmentation onto generated scope interfaces — the pattern if `Mod.defineX` methods end up generated |
| The overlay discipline | `tools/codegen/overlay.ts` + drift baseline; per-type rows slot straight in |
| Byte-stable conformance oracle | `tests/tech.test.ts`, `tests/example-mod.test.ts` goldens — the generic writer must reproduce them before touching a second type |

## The open questions

**1. Emit-allowlist or emit-everything?** Today `TECHNOLOGY_EMITTED_FIELDS`
is a curated allowlist and codegen reports the unemitted remainder. Under
architecture B the natural default flips: emit every field whose shape has
a lowering, report the rest. Decide deliberately — the allowlist is also a
quality gate (a field nobody has thought about is a field nobody has
tested), and "typeable" is not "correct".

**2. Subtypes at scale.** `flatten` turns `subtype[!repeatable]` gates into
optional fields with the predicate in TSDoc. Fine for technology's two
subtypes; traditions (`tradition_swap` filtering), edicts, and civics lean
harder on subtyping. Discriminated unions are the honest encoding and a
real emitter complication. A recorded judgment either way beats drift.

**3. Swap authoring.** `technology_swap`/`tradition_swap` as *new content*
is a mini-definition nested in a definition — its own name, trigger, loc,
and field overrides. Not sketched anywhere. It is data-shaped (no
closures), so it should fall out of the same field-manifest machinery if
the manifest can nest; that is a good stress test to run on paper before
committing to B's manifest shape.

**4. The `Mod` surface.** Hand-written `defineTechnology` carries real
per-type choices (loc slots to register, prefix guard on which field).
Options: generated `defineX` methods via module augmentation (the events
precedent), or one generic `defineContent(TYPE, def)` with `defineX` as
sugar. Whichever wins, duplicate-id and prefix guards are generic already.

**5. How `RULE_FILES` grows.** The pinned eight-file allowlist was right
for one type; at eighty it needs a policy. Load-all-report-unparseable
matches the no-silent-caps convention, but note the technology rules came
from a hand-*consolidated* cwt file — check whether `traditions.cwt` (and
friends) parse cleanly with the existing reader or whether consolidation
was load-bearing.

**6. Patch surfaces are out of scope, but leave the door aligned.** The
parsed surface (`ParsedTechnology`) stays hand-written and demand-driven —
patching needs per-registry evidence anyway (see the rule table; traditions
are not a spiked registry, so `patchTradition` needs an oracle run before
it can exist). But the field manifest B generates is plausibly the same
data a future parsed surface wants to consume; keep the shapes compatible
if it costs nothing, and refuse the temptation to build it now.

## Suggested first slice

Tradition as the driver, buildings as the control. Buildings because the
rules are simpler and the registry is already spiked (verified last-wins,
whole-object — so `patchBuilding` becomes possible for free later);
tradition because it is messy enough to be honest: swaps, categories as a
sibling type, subtype-gated fields, `ai_weight`.

Order of work: (1) make the generic writer reproduce the technology
goldens byte-for-byte from a generated field manifest — no behavior
change, pure refactor, every existing test green; (2) add buildings as a
manifest entry + overlay rows + goldens; (3) add traditions, which will
surface the swap and subtype questions with real stakes; (4) retire
`emit/technology.ts` into the generic emitter.

**Gate — the model holds iff:** the third content type costs a manifest
entry, overlay rows, and goldens — zero new emitter files, zero new
writer classes; the technology goldens never changed; every skipped or
unemitted field is reported per type, never filtered; `npm run
codegen:check` still gates drift. **Escape hatch needed means:** the
generic writer grows a type-name conditional, an overlay row needs an
essay to justify its shape, or the second type's cwt file cannot be read
without hand-consolidation — any of these is the signal to stop and
reconsider architecture A for that seam instead of forcing B.

## Conventions worth keeping

- Overlay rows, not emitter forks: every per-type departure lives in
  `overlay.ts` with a stated reason. Adding one should feel expensive.
- Reports, not filters: codegen prints what it could not emit, per type,
  exactly as it does today for technologies and effects.
- Goldens are the acceptance test; the existing technology goldens are the
  conformance oracle for the generic writer and must not change.
- The define/patch boundary stands: `defineX` needs no override evidence
  (prefixed ids cannot collide); `patchX` is gated by the rule table and
  is not this slice.

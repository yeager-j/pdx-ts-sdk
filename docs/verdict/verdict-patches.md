# Patches verdict: the model holds

The "patches that provably win" slice, per the
[handoff doc](../handoff/handoff-patches.md). No probe stage this time — the typed
surface was probed (`../../design/parser-probe`, its record unchanged), so this
went straight to `src/` with the handoff's three probe scenarios landing as
committed acceptance tests.

## The judgment

**A transform patch of a vanilla technology emits the complete object into a
file whose name is computed from the parsed enumeration to byte-sort after
every surviving file defining the key — and everything the build cannot
prove, it refuses with the open cell named.** The mainline reads exactly as
the handoff sketched it:

```ts
const vanilla = stellaris.load(); // located, hashed, parsed, cached by content

mod.patchTechnology(vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites"), (t) => ({
  cost: t.cost.value * 2,
  prerequisites: [...t.prerequisites, myNewTech],
}));

await mod.synth("./out");
```

Acceptance results:

| Check | Result |
| --- | --- |
| Real install: all 33 technology files build typed surfaces (679 techs) | Pass — the probe's 5-file OR-prerequisites refusal is retired |
| Real `tech_gene_tailoring` patch: name computed, win asserted | Pass — `00_soc_tech_pp_real_patch.txt`, beats `common/technology/00_soc_tech.txt`, the assertion's list equals the parsed definer set |
| Adversarial fixture: last definer `zz_zz_late.txt` | Pass — computed `zz_zz_late_<prefix>_patch.txt`; the stem-append lemma is also a fast-check property, and the engine re-verifies every name against every definer at build time anyway |
| Refusal paths: ship-components, first-wins registries, localization | Pass — messages golden-pinned, each citing its open cell and the build pin |
| `load()` speed (the named escape hatch: too slow means skipped) | 28 ms cold, 13 ms cached for the technology slice |
| Full suite | 307 tests, 28 files, all green |

## Findings the implementation caught (reality, again)

1. **File-local `@variables` do not travel, and the first golden was wrong
   because of it.** The first emitted patch file carried
   `@tech_gene_forging_POINTS` — a variable vanilla declares at the top of
   *its* file, which the game scopes per file. In-game that reference would
   have corrupted the definition silently (the spike's `r7` failure mode).
   The emission now re-declares every file-local variable the patched body
   references (globals from `common/scripted_variables` stay bare — `r1`
   proved they resolve cross-file), refuses when two source files need the
   same name at different values, and refuses bodies carrying `@[ ... ]`
   inline math, whose variable dependencies are textually invisible.
2. **`common/technology` is not flat on disk.** It contains `category/` and
   `tier/` — different registries. The loader pins those two by name and
   still errors on any unknown subdirectory: a silent skip would be a silent
   cap, a silent widen would put unmeasured files into the enumeration.
3. **Block costs exist.** `tech_storm_manipulation` writes
   `cost = { factor = @tier2cost2 inline_script = { ... } }`. The surface
   does not model it as a number: the entry rides in `rest` (carried
   byte-exact), the typed `cost` stays undefined, and `require("cost")` on
   such a tech throws honestly. A patch may still *set* a scalar cost — the
   in-place substitution replaces the block.

## Decisions taken (and where they can be revisited)

- **Comparator vendored in TS** ([src/resolver/path-order.ts](../src/resolver/path-order.ts)),
  spec cited from stellaris-docs `technical-design.md` ("Installation
  identity"). The Rust resolver is inside a Tauri binary; there is no sharing
  mechanism, so the shared artifact is the spec plus the same property pin
  (byte order ≡ code-point order). Extraction into a shared package remains
  deliberate future work.
- **Rule table** ([src/resolver/rules.ts](../src/resolver/rules.ts)): three
  states — `verified` (cites oracle runs), `assumed` (named judgment with a
  paper trail; megastructures' whole-object cell carries Jackson's
  2026-07-31 call and every win through it is flagged `assumed`), `refused`
  (ship-components duplicate winner, localization). One deviation from the
  handoff table, on the spike's own text: ship-component *fields* are
  verified whole-object (`r8`); only the duplicate-winner cell refuses.
- **Stale build = error with override**: render-time `StaleRuleTableError`
  when the install's version differs from the 4.4.6 pin;
  `acceptGameVersion: "<exact version>"` proceeds, per-version.
- **`stellaris.load()` is synchronous**, matching the handoff snippet; the
  cache ([src/stellaris/cache.ts](../src/stellaris/cache.ts)) is
  content-addressed JSON under `../../node_modules/.cache/pdx-ts-sdk`. Honesty
  note: at technology-only scope it saves ~15 ms; it exists so the load
  layer keeps its shape when the full `common/` tree lands, and the manifest
  hashing it rides on is the version-drift input regardless.
- **Filename scheme**: stem-append off the byte-max definer
  (`00_soc_tech.txt` → `00_soc_tech_<prefix>_patch.txt`), ASCII-only,
  200-byte basename cap as the honest "no winning name" boundary, collision
  escalation capped and loud. The construction is never trusted: the final
  name is re-compared against every definer on every build.
- **One patch file per registry**, emitted alongside the mod's own content;
  the mod's own files join the enumeration the name is computed against.

## The calibration anchor (verified 2026-07-31)

Jackson ran the in-game check against **Stellaris Pegasus v4.4.6**, using
the mod built by [examples/calibration-patch/build.ts](../../examples/calibration-patch/build.ts)
(`tech_gene_tailoring`: `cost.value * 2` → 8000, plus one appended
prerequisite on a tier-0 start tech the mod defines):

- The mod's own `pdx_calib_tech_marker` was present in-game — the SDK's
  generated content loads.
- Gene Tailoring showed the **increased cost** — the override in
  `00_soc_tech_pdx_calib_patch.txt` won against `00_soc_tech.txt`, exactly
  as the win assertion claimed.
- Nuance worth recording: the game displays technology cost after dynamic
  modifiers, so the shown number was *near* 8000, not exactly it. In-game
  cost checks are directional (doubled vs. vanilla), not byte-exact; the
  byte-exact claim lives in the emitted file and its goldens.

With this, every layer of the chain has touched reality once: the spike's
oracle runs (in-game, dual-channel), this slice's byte-order reproduction
of them, and one end-to-end patched technology observed in the running
game.

## Follow-ups, deliberately not in this slice

- Migrate the three duplicated `STELLARIS_DIR` literals
  (`../../packages/pdxscript/tests/corpus.test.ts`, `differential.test.ts`,
  `../../design/parser-probe/probe.test.ts`) onto `locateInstall()`.
- A lockfile-style drift warning: the emitted header records each patch's
  source sha256, but nothing yet diffs a *previously shipped* mod against a
  changed install ("vanilla changed under your patch, review the diff").
- Events patching (before-first emission): the rule table row exists and the
  engine refuses it by name; flipping it is one row plus the emission
  direction.
- Playset awareness (`launcher-v2.sqlite`): upgrades "beats vanilla" to
  "beats your playset" without changing the API.
- `technology_swap` patching stays refused (`SwapPatchError`) until oracle
  evidence exists; swaps ride through `rest` untouched.

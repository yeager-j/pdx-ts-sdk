# Handoff: the PDXScript parser (round-trip fidelity)

The next spike. Written after the mod-testing evaluator passed its gate, for
whoever picks this up.

Read [verdict-testing-probe.md](verdict-testing-probe.md) for how the last
spike was gated — this one follows the same playbook. This file only covers
what is specific to the parser.

## The goal

Everything landed so far is the "write new content from scratch" half of the
thesis. The other half — patches, typed namespaces, the load-order linter —
is entirely unproven, and it all sits behind one capability: parse a vanilla
file, surface it as a typed object, transform it, re-emit it.

```ts
const vanilla = parseVanilla(files);
const geneTailoring = vanilla.technology("tech_gene_tailoring");

mod.patchTechnology(geneTailoring, (t) => ({
  cost: t.cost.value * 2, // .value, deliberately — see decision below
  prerequisites: [...t.prerequisites, myNewTech],
}));
```

The design notes call the load-order linter arguably a bigger selling point
than the syntax. The linter, `patchTechnology`, typed namespaces
(`stellaris.tech_solar_panel_network`), and the version-drift hash check are
four consumers of the same parsed model; round-trip fidelity is their shared
prerequisite and the risk to retire first.

## Why this next, and why the risk is different this time

The evaluator's risk was semantic (a second implementation of the engine).
This spike's risk is a *type-unification* question: **does a parsed vanilla
technology actually unify with `TechnologyDef`, or do vanilla's untyped
corners leak everywhere?** The corners are concrete:

- `cost = @tier3cost1` — a cross-file scripted variable, not a number. The
  design notes' own flagship example `cost: vanilla.cost * 2` does arithmetic
  on it directly, which cannot survive contact with this.
- `weight_modifier`, `ai_weight`, `technology_swap`, `modifier`, `gateway`,
  `feature_flags` — real fields on nearly every vanilla tech that
  `TechnologyFields` does not model and `Technology.toEntries()` cannot emit.
  "Always emit complete objects" is the override policy's cornerstone; if
  unmodelled fields don't survive the round trip, patching is unsound, full
  stop.
- Duplicate keys in order (six `modifier` blocks inside one
  `weight_modifier`), inline comments, vanilla's loose formatting.

Parsing itself is the well-understood part — PDXScript is a small language
and the repo already contains a recursive-descent parser for its `.cwt`
cousin ([tools/codegen/cwt/parser.ts](../tools/codegen/cwt/parser.ts), whose
header explicitly disclaims being this parser). The typed surface over the
parse is where the thesis gets tested.

## Existing parsers, researched (2026-07-30)

No usable existing TypeScript parser. The candidates and why not:

- **jomini** (nickbabcock, Rust/WASM on npm, actively maintained, MIT) —
  parses everything (all operators, `@var`, `@[..]` math verbatim,
  `hsv{}`/`rgb{}`, quoted keys) and is battle-tested against real game files.
  But its ergonomic APIs collapse duplicate keys and can reorder
  integer-like keys; the faithful mode is a verbose tuple-encoded JSON, and
  there is no high-level writer — we would build the AST and emitter layers
  ourselves anyway, on top of an async-initialized WASM dependency. Its
  sweet spot (200 MB/s over huge save files) buys nothing for a few MB of
  `common/`. **Keep it in mind as a differential-testing oracle** (devDep,
  never runtime): parse all of vanilla `common/` with both parsers and
  compare trees. That is an implementation step, not a spike step.
- **shroudingers-parser** (pure TS, 0.0.3) — the right AST shape
  (order-preserving, duplicate-allowing, operators, `stringify`), but the
  README says "only tested with map scripts", no `@[..]`/color handling.
  Validation of the approach, not a dependency.
- **@kongyo2/stellaris-ts** (npm, days old as of this writing) — a
  near-identical product vision (TS mod definitions, emitter,
  cwtools-rules validation) with a hand-rolled ~1300-line
  lexer/parser/emitter inside. Worth studying for positioning; its syntax
  layer is not exported as a public API.
- **cwtools** (F#) — not callable from Node; its rules files are already
  vendored here.
- **tree-sitter grammars** — hobby-grade, no npm distribution, and a CST
  plus `web-tree-sitter` is more machinery than a ~300-line language needs.

Conclusion: hand-roll, modeled on the cwt lexer/parser. Two independent
data points put lexer+parser at 300–500 lines.

## What you already have for free

|                                                                |                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| The AST the parse must lower into (`PdxEntry`/`PdxValue`)      | [src/ast.ts](../src/ast.ts)                                |
| A serializer that already emits `@name` bare                   | [src/serialize.ts](../src/serialize.ts) — `BARE_STRING` includes `@`, so variable refs re-emit with zero `src/` changes |
| The unification target                                         | `TechnologyFields` in [src/generated/technology.ts](../src/generated/technology.ts) |
| A recursive-descent parser for the sibling format, as template | [tools/codegen/cwt/](../tools/codegen/cwt/) — lexer 118 lines, parser 266 |
| Refs designed for this moment                                  | `TypedRef`'s brand is optional *so that* "the parser slice can narrow these to real unions without breaking a single caller" ([src/generated/refs.ts](../src/generated/refs.ts)) |
| Parsed trigger blocks can wear the brand                       | `trigger<S>(entries)` in [src/trigger-core.ts](../src/trigger-core.ts) |
| The probe harness itself                                       | `design/**` is typechecked and `design/**/*.test.ts` runs in vitest — a landed probe gates itself forever |
| A local game install to test against                           | `~/Library/Application Support/Steam/steamapps/common/Stellaris` |

## Decisions already made (in discussion, 2026-07-30)

- **Variable references resolve with provenance.** A parsed `@tier3cost1`
  surfaces as `{ readonly name: "@tier3cost1"; readonly value: 4000 }` — the
  value resolved from `common/scripted_variables` at parse time, the name
  kept. TypeScript itself poisons `t.cost * 2` (arithmetic on an object);
  the author chooses `.value` to bake a number visibly, or keeps the ref and
  it re-emits as `@tier3cost1`. The design notes' literal `vanilla.cost * 2`
  becomes a pinned negative claim, not the blessed spelling. (Rejected:
  resolve-to-plain-number, which silently detaches patches from
  scripted-variable updates; emit-inline-math `@[...]`, which would write a
  construct vanilla technology files never use.)
- **The fixture is a hand-written structural clone, not Paradox's text.**
  The repo cannot ship game data. The probe's input replicates
  `tech_gene_tailoring`'s every construct shape-for-shape under different
  names; an optional, non-gating test parses the real install when present.
- **jomini differential testing is deferred to the implementation.** The
  spike's gate is type unification, not parser completeness; the spike adds
  zero dependencies.
- **Semantic fixpoint, not byte fidelity.** Comments and formatting are not
  preserved; re-emission is in repo formatting. The fidelity claim is:
  re-parsing the emission yields an identical tree — every entry present, in
  original order, every `@reference` still a reference.
- **Unmodelled fields ride in a carry-through, not on the type.** The typed
  surface exposes what `TechnologyFields` models; everything else stays in
  an ordered `rest` of parsed entries that patching cannot drop. Phantom
  properties (`t.gateway`) are compile errors — the surface is honest about
  what it types.
- **Patches substitute in place.** A patched field keeps its slot in the
  original entry order; only genuinely new entries append. This is what
  makes "always emit complete objects" hold for fields the SDK cannot
  author.

## The four open questions

**1. Where does `@[ ... ]` inline math land?** It occurs in zero technology
files (verified against the install), so the spike carries it at token level
only — lexed as one opaque token, re-emitted verbatim, semantics deferred.
The implementation needs a real story when the parser meets `defines` and
ship sizes.

**2. What does the trigger brand mean on parsed content?** Surfacing a
parsed `potential` as `Trigger<"country">` un-erases a brand the parser
cannot verify — vanilla is trusted to be scope-correct. That is defensible
(vanilla ships working) but it is a *trust* decision, and third-party mod
content will eventually flow through the same door.

**3. How do parsed refs meet generated namespaces?** `prerequisites` parses
to strings; the surface wraps them as `TechnologyRef`s via the optional
brand. The real narrowing — `stellaris.tech_solar_panel_network` as a
generated const with the parsed definition attached — is the namespaces
slice. The spike should confirm the brand unifies cleanly and go no further.

**4. Does `src/ast.ts` grow a `var` node?** The spike keeps `ParsedValue`
(with `var`/`math` kinds) parser-side and lowers to `PdxValue` at emit,
leaning on `BARE_STRING`. Whether the core AST should model variables
first-class — so authored content can also reference scripted variables — is
an implementation decision the verdict should record with a recommendation.

## The trap that will get you

**Formatting-fidelity creep.** The moment byte-identity with vanilla feels
within reach — preserve comments, preserve `2.0` vs `2`, preserve blank
lines — the probe becomes a pretty-printer project, and the type-unification
question the spike exists to answer goes unadjudicated. Semantic fixpoint is
the line; hold it. (Comment preservation becomes real work only if the
patch story ever needs to emit diffs against files users read. It does not
today.)

## Suggested first probe

Same playbook as last time: hand-write the goldens for the nastiest
realistic case before building anything, in `design/parser-probe/`. The
case, chosen from the install:

> A structural clone of `tech_gene_tailoring` (`common/technology/00_soc_tech.txt`),
> the nastiest realistic tech: cost and weight referencing cross-file
> scripted variables, a file-local `@..._POINTS` variable used inside
> `modifier.description_parameters`, `gateway`, a `feature_flags` list,
> `technology_swap` with a nested trigger, `potential` with `OR`, a
> `weight_modifier` with an inline comment and six nested `modifier` blocks
> (one reaching `NOT` → `any_owned_species`, one `factor = @boost_var`), and
> `ai_weight`. Parse it plus a scripted-variables fixture; read typed fields;
> patch it (`cost: t.cost.value * 2`, `prerequisites: [...t.prerequisites,
> myNewTech]`); emit both the untouched and the patched tech against
> hand-written goldens.

**Gate — the model holds iff:** the mainline reads clean with zero casts and
zero `any`; the hand-written round-trip golden byte-matches — every field of
the fixture tech, including the six `TechnologyFields` does not model,
survives parse → typed surface → re-emit in original order; the patched
golden byte-matches with exactly the two intended changes; `@variable`
references re-emit as references except where the author visibly took
`.value`; and every vanilla/type-model mismatch is a compile error or a loud
named error — never a silent widening to `string`. **Escape hatch needed
means:** any mainline cast, any field dropped or reordered on re-emit, any
`any`/`unknown` on the author-facing surface, variables baked to numbers
unasked, or a typed surface so hedged with `| string | undefined` that it
types nothing. On failure, write the finding and stop — that outcome is a
success of the spike.

## Conventions worth keeping

- The probe stays in `design/`, the verdict goes in `docs/`, golden files
  remain the acceptance test — written by hand before the implementation
  runs, immutable; a wrong golden is a recorded finding, not an edit.
- Nothing dropped silently: an unknown `@variable`, an unlexable character,
  an invalid enum value all throw with file and line. Loud failure is the
  parser's version of "nothing silently evaluated."
- The probe's parser is probe-local. The real one lands in `src/` only after
  the verdict, shaped by what the probe learned.
- No new dependencies in the spike. jomini enters (as a devDep oracle) only
  with the implementation.

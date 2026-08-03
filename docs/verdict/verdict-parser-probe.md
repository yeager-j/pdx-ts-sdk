# Parser probe verdict: the model holds

Stage 0 of the PDXScript parser, per the
[handoff doc](../handoff/handoff-pdxscript-parser.md)'s suggested first probe. The probe
lives in `../../design/parser-probe` and stays there — it is the design record,
not the implementation.

## The judgment

**A parsed vanilla technology unifies with the SDK's typed model — per-field,
with honest widenings — and survives parse → typed surface → patch → re-emit
with nothing dropped, nothing reordered, and nothing resolved silently.**
[probe.ts](../../design/parser-probe/probe.ts) is the mainline: parse the
fixture (a structural clone of `tech_gene_tailoring`, the nastiest realistic
tech — cross-file `@variables`, a file-local variable, `technology_swap`,
`potential` with `OR`, a six-modifier `weight_modifier` with inline comments,
`ai_weight`), read typed fields, define a new SDK tech, patch with plain
TypeScript (`cost: t.cost.value * 2`, `prerequisites: [...t.prerequisites,
chimericGrafts]`), emit both the untouched and the patched tech. Both
hand-written goldens matched on the first run.

Acceptance results:

| Check | Result |
| --- | --- |
| Mainline (`probe.ts`) reads clean, zero casts | Pass |
| 7 negative claims pinned with `@ts-expect-error` | Pass |
| Hand-written goldens byte-match (round-trip and patched) | Pass, first run |
| All six unmodelled fields survive re-emit, in original order | Pass |
| `@references` re-emit as references; only the patched `cost` baked | Pass |
| Emission is a fixpoint: parse → emit → re-parse → emit is byte-stable | Pass |
| Real install: fixpoint over `common/technology`, refusals pinned | Pass — 28 of 33 files (525 KiB, 546 techs, ~10 ms); 5 refused for OR-prerequisites, list pinned |
| Full suite: `../../examples` and `tests/` goldens untouched | Pass (134 tests) |

## Findings the probe caught (why probes exist)

1. **Vanilla mixes bare values and assignments in one block.** Five of 33
   technology files write `prerequisites = { tech_stingers OR = { ... } }` —
   OR-prerequisites. The strict list/block split (`src/ast.ts` and the
   probe's parser alike) cannot represent a mixed block, and the typed
   surface's `prerequisites: TechnologyRef[]` cannot express the semantics.
   The probe's parser recognizes the construct and refuses loudly; the
   real-install test pins the five files by name, so a vanilla patch that
   grows the list fails visibly. This is the implementation's biggest open
   design item (see watch items).
2. **The serializer's bare-string rule was empirically too narrow.** Vanilla
   writes `script = technologies/rare_technologies_weight_modifiers`
   unquoted; `BARE_STRING` lacked `/`, so re-emission quoted it and the
   re-parsed tree differed. One-character widening in
   [src/serialize.ts](../src/serialize.ts) — the probe's only `src/` change —
   with every existing golden unaffected.
3. **The discussed `number | VariableRef` union cannot give a zero-cast
   mainline.** `.value` on a union forces narrowing boilerplate into every
   patch. The shape that holds is one uniform
   `ParsedNumber { value, ref? }` for every numeric field: arithmetic is
   poisoned by the object type either way, `.value` always typechecks, and
   provenance rides along only when the file used a reference.
4. **Fields the rules make optional need a presence witness.** TypeScript
   property narrowing does not flow into a generic callback, so a guard
   before `patchTechnology` cannot type the patch's view.
   `technology(id).require("cost", "prerequisites")` checks presence at
   parse time and records it in the type — one line, loud on failure. The
   typed-namespaces slice removes even that (per-tech generated types know
   which fields each vanilla tech defines).
5. **The parsed surface does not literally extend `TechnologyFields`.**
   `name` (required there) and `desc` are localization-side — a parsed
   technology file simply does not contain them. Unification is per-field:
   typed where the file speaks, widened to `ParsedNumber` for numerics,
   `rest` for everything unmodelled. The gate's question — "does the parsed
   shape unify?" — has a yes with this precise shape, not with `extends`.

## Error-message quality (checked by hand)

- Undefined variable: `common/technology/broken.txt:2: @nope is not defined
  in common/technology/broken.txt or common/scripted_variables (defined:
  none)` — file, line, and the searched scopes.
- Invalid area: `common/technology/bad.txt:3: area must be one of physics,
  society, engineering — got "underwater_basket_weaving"` — parse-don't-
  validate; a raw string never silently becomes a `ResearchArea`.
- Unknown technology: `Unknown technology "tech_missing"; the parsed files
  define: tech_gene_forging`.
- Missing required field: `tech_gene_forging
  (common/technology/pp_soc_tech.txt) has no isRare — require() asserts only
  fields the file defines`.
- Inline math at emit: names the source text and states the deferral ("the
  probe carries it at token level only").

## Decisions validated (now binding for the implementation)

- **Resolve-with-provenance holds.** `t.cost * 2` is a compile error (pinned
  as claim 1 — the design notes' literal example, adjudicated);
  `t.cost.value * 2` bakes visibly; an untouched `weight = @t3weight`
  re-emits as the reference. Nothing bakes unasked.
- **In-place substitution keeps the file's order.** The patched `cost` stays
  in slot one; the six unmodelled fields flow through `rest` untouched.
  "Always emit complete objects" holds for fields the SDK cannot author.
- **One serializer.** The probe lowers `ParsedValue` into `PdxValue` and
  delegates to `src/serialize.ts` — authored and parsed content share one
  emitter, and `@name` rides through `BARE_STRING` with no `var` node in the
  core AST.
- **Semantic fixpoint is the right fidelity claim.** Comments and formatting
  drop; re-parsing the emission yields an identical tree, byte-stable on the
  second emit. Byte-identity with vanilla was never the claim (the handoff's
  trap).
- **Eager, loud validation.** Areas checked and every `@variable` resolved
  at parse, before the view is returned; `@[ ... ]` inline math is lexed as
  one verbatim token and refuses to emit.
- **The trigger brand is trust, on purpose.** A parsed `potential` surfaces
  as `Trigger<"country">` and scope branding survives the boundary (claim
  7 rejects a planet trigger in a patch) — vanilla is trusted to be
  scope-correct, as the handoff decided.

## Deviations from the handoff, for the record

- `ParsedNumber { value, ref? }` replaced the discussed
  `VariableRef { name, value }` union shape (finding 3). Both halves of the
  decision — provenance kept, arithmetic poisoned — are intact.
- The mainline gained `.require("cost", "prerequisites")` before the patch;
  the handoff pseudocode read `t.cost.value` directly (finding 4).
- The real-install fixpoint covers 28 of 33 files rather than all: the five
  OR-prerequisite files are refused by name (finding 1), not silently
  skipped.

## Watch items for the implementation

- **OR-prerequisites need a first-class story.** Options when the parser
  lands in `src/`: let block entries admit bare scalars in `PdxValue` (a
  core AST change rippling into the serializer and the testing probe's
  interpreter), or model `prerequisites` as its own union type
  (`TechnologyRef | AnyOf<TechnologyRef>`) at the surface. Either way the
  game semantics ("any one of these satisfies the slot") must be encoded,
  and the five pinned files are the test corpus.
- **jomini as differential oracle.** Still the named implementation step:
  parse all of vanilla `common/` with both parsers (jomini's
  duplicate-key-preserving mode) and compare trees — devDependency only.
- **`@[ ... ]` inline math is token-level only.** Zero occurrences in
  technology or scripted-variable files; `defines` and ship sizes will force
  real semantics.
- **The core AST kept no `var` node — keep it that way until authored
  content wants variables.** Lowering to bare strings round-trips perfectly;
  a first-class node is only worth its weight when `defineTechnology` can
  reference a scripted variable.
- **Quoted keys and duplicate typed fields are unhandled by declared
  scope.** Keys emit raw (a quoted key would round-trip unquoted), and a
  technology defining `cost` twice collapses to the first on patched
  emission. Neither occurs in vanilla technology files; both should throw
  loudly if the wider corpus surfaces them.
- **Only `common/technology` and `common/scripted_variables` parse today.**
  Other folders bring `hsv {}` / `rgb {}` headers and inline math — named
  lexer deferrals, in dependency order for the linter slice.

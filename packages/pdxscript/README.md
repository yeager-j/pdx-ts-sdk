# @pdx-ts/pdxscript

A parser and serializer for PDXScript, the Clausewitz engine script format
used by Paradox games (Stellaris, EU4, CK3, HOI4, Victoria 3). Order-
preserving, duplicate-preserving, with a semantic round-trip guarantee:
parse → serialize → parse yields an identical tree.

```ts
import { parse, serialize } from "@pdx-ts/pdxscript";

const doc = parse(source, "00_soc_tech.txt");
// doc.items: entries, bare scalars, containers, [[PARAM]] blocks — in file order
// doc.diagnostics: repairs applied to malformed-but-shipped input, never silent

const text = serialize(doc.items); // canonical rendering, tabs, one style
```

The AST is the grammar's shape, not a lossy projection: duplicate keys stay
duplicated in order, `prerequisites = { tech_a OR = { ... } }` mixed
containers are ordinary data, comparison operators (`< > <= >= !=`) survive,
`@variable` references and `@[ inline math ]` are first-class nodes carried
verbatim, `hsv { }`-style headers are kept, and every entry records its
source line for diagnostics. [GRAMMAR.md](GRAMMAR.md) is the grammar of
record — the whole language in a page, including the repair policy for
defects Paradox actually ships (a missing `=`, a missing final brace) and the
named deferrals.

## Scope

- **Game-definition files**, not save files. `EU4txt` magic, container-as-key
  templates, and other save-only constructs are out of scope.
- **Stellaris-tested.** The suite parses the entire vanilla Stellaris
  `common/` tree and asserts the round-trip fixpoint on every file, and
  differential-tests the trees against
  [jomini](https://github.com/rakaly/jomini) (the differential found real
  jomini defects, pinned by name in the tests; this parser reads several
  shipped vanilla files jomini cannot). Sibling games should mostly work, but
  are unverified; unsupported `?=`/`==` operators fail loudly instead of
  producing a wrong tree.
- **The API takes decoded strings.** File reading and encoding are the
  caller's job; Stellaris is UTF-8 with optional BOM. The lexer itself is
  8-bit clean.
- **Comments are dropped** (the round-trip claim is semantic, not textual),
  and serialization is canonical — one rendering style, tabs.
- **No game semantics.** Variable resolution, math evaluation, and override
  rules are consumer concerns; this package is syntax only. Keep it that way:
  anything that knows what a technology _is_ belongs in a consumer.

## Where stuff lives

```
src/
├── index.ts      the public surface: parse, serialize, classification helpers
├── ast.ts        the unified item-sequence AST (scalar | entry | container | param)
├── lexer.ts      tokenization; quoting/classification symmetric with serialize
├── parser.ts     items + same-line-only repair rules, diagnostics
├── serialize.ts  the one serializer; @refs pass bare
└── normalize.ts  tree normalizations shared with the differential tests
tests/            per-claim suite, full-vanilla fixpoint, jomini differential,
                  fast-check properties
```

## Testing

Four gates, each covering a different failure class:

- **Per-claim suite** (`tests/parser.test.ts`) — one test per grammatical
  claim, many mined from jomini's corpus knowledge.
- **Full-vanilla fixpoint** (`tests/corpus.test.ts`) — every file of a real
  install's `common/` tree round-trips to an identical tree (install-gated;
  skips where no install exists).
- **Jomini differential** (`tests/differential.test.ts`) — tree-for-tree
  comparison after shared normalizations, with jomini's own defects pinned by
  name so a disagreement is always attributable.
- **Property tests** (`tests/properties.test.ts`, fast-check) — generator
  round-trip, quoting symmetry, crash-freedom on arbitrary input, repair
  idempotence.

Parser changes are expected to keep all four green; the fixpoint and the
differential are the gates that catch what hand-written cases miss.

## Status

0.x — the API may still move while the SDK consumes it. Built as
the foundation of [@pdx-ts/sdk](../sdk/README.md); the parser is deliberately
standalone and game-semantics-free.

## Vocabulary

This package is the [PDXScript Syntax](./CONTEXT.md) context. Its glossary is the authority
for what these words mean; the [context map](../../CONTEXT-MAP.md) shows how they change
at the boundaries with the other contexts.

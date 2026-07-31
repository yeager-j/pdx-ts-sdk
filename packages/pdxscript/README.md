# @pdx-ts/pdxscript

A parser and serializer for PDXScript, the Clausewitz engine script format
used by Paradox games (Stellaris, EU4, CK3, HOI4, Victoria 3). Order-
preserving, duplicate-preserving, with a semantic round-trip guarantee:
parse → serialize → parse yields an identical tree.

```ts
import { parse, serialize } from "@pdx-ts/pdxscript";

const doc = parse(source, "00_soc_tech.txt");
// doc.items: entries, bare scalars, containers, [[PARAM] blocks — in file order
// doc.diagnostics: repairs applied to malformed-but-shipped input, never silent

const text = serialize(doc.items); // canonical rendering, tabs, one style
```

The AST is the grammar's shape, not a lossy projection: duplicate keys stay
duplicated in order, `prerequisites = { tech_a OR = { ... } }` mixed
containers are ordinary data, comparison operators (`< > <= >= !=`) survive,
`@variable` references and `@[ inline math ]` are first-class nodes carried
verbatim, `hsv { }`-style headers are kept, and every entry records its
source line for diagnostics. See [GRAMMAR.md](GRAMMAR.md) for the whole
language in a page — including the repair policy for defects Paradox
actually ships (a missing `=`, a missing final brace) and the named
deferrals.

## Scope, honestly stated

- **Game-definition files**, not save files. `EU4txt` magic, container-as-key
  templates, and other save-only constructs are out of scope.
- **Stellaris-tested.** The test suite parses the entire vanilla Stellaris
  `common/` tree and asserts the round-trip fixpoint on every file, and
  differential-tests the trees against [jomini](https://github.com/rakaly/jomini)
  (the differential found real jomini defects, pinned by name in the tests;
  this parser reads several shipped vanilla files jomini cannot). Sibling
  games should mostly work — `?=`/`==` are known, named gaps — but are
  unverified.
- **The API takes decoded strings.** File reading and encoding are the
  caller's job; Stellaris is UTF-8 with optional BOM. The lexer itself is
  8-bit clean.
- **Comments are dropped** (the round-trip claim is semantic, not textual),
  and serialization is canonical — one rendering style, tabs.
- **No game semantics.** Variable resolution, math evaluation, and override
  rules are consumer concerns; this package is syntax only.

## Testing

Four gates: a per-claim suite (one test per grammatical claim, many mined
from jomini's battle-tested corpus knowledge), the full-vanilla fixpoint,
the jomini tree differential, and fast-check property tests (generator
round-trip, quoting symmetry, crash-freedom on arbitrary input, repair
idempotence).

## Status

0.x — the API may still move. Built as the foundation of
[@pdx-ts/sdk](../../README.md), a CDK-style TypeScript SDK for Stellaris
modding; the parser is deliberately standalone and game-semantics-free.

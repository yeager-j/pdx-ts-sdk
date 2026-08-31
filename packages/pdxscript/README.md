# @pdx-ts/pdxscript

`@pdx-ts/pdxscript` parses and serializes PDXScript, the Clausewitz engine
script format used by Stellaris and other Paradox games. Its syntax tree keeps
file order, duplicate keys, mixed containers, comparison operators, variable
references, inline math, and conditional parameter regions.

The package knows syntax only. It does not know what a technology, trigger,
scope, or override means.

## Installation

The package requires Node.js 22 or newer and uses ESM.

```bash
npm install @pdx-ts/pdxscript
```

## Parse and serialize

```ts
import { parse, serialize } from "@pdx-ts/pdxscript";

const document = parse(source, "00_soc_tech.txt");

for (const diagnostic of document.diagnostics) {
  console.error(`${diagnostic.fileName}:${diagnostic.line}: ${diagnostic.text}`);
}

const canonical = serialize(document.items);
```

`parse` accepts a decoded string and a filename used in diagnostics. File I/O
and decoding belong to the caller; `parse` strips one UTF-8 BOM opening the
document, and `serialize` refuses to emit a document that would open with one.
`serialize` uses one canonical style with tabs and a final newline.

The round-trip contract is semantic, and it is a claim about items rather than
documents:

```ts
const document = parse(source);
const reparsed = parse(serialize(document.items));
withoutLines(reparsed.items); // equals withoutLines(document.items)
```

`withoutLines` is part of the claim. Canonical spacing moves entries onto
different lines, so `line` differs even where nothing else does, and repaired
input is written in its repaired form, so the reparse reports no diagnostics.
Comments are normally dropped, whitespace is normalized, and quote choices may
change. Order, duplicate keys, values, and structure remain stable.

## AST model

The AST follows the grammar rather than projecting PDXScript into JavaScript
objects:

```ts
type PdxItem =
  | PdxEntry
  | PdxScalar
  | PdxContainer
  | PdxParamBlock
  | PdxParamText;
```

An entry is a `key op value` triple. A container is an ordered list of Items,
not a map, because it may contain duplicate entries, bare scalars, nested
containers, or a mixture of them.

```pdx
prerequisites = {
  tech_stingers
  OR = {
    tech_lasers_1
    tech_mass_drivers_1
  }
}
```

Numeric nodes keep their digits without passing through a JavaScript `number`,
which would lose values such as `9007199254740993`. Redundant signs and zeros
are canonicalized, so `+0.10` becomes `0.1`. Use `numberValue()` or
`tryNumberValue()` when a consumer explicitly wants an arithmetic projection.

Every parsed entry carries a one-based source line. Hand-built entries omit it,
and structural comparison can remove line metadata with `withoutLines`.

## Constructing syntax trees

The exported constructors cover ordinary scalars, entries, and containers from
the same language that the parser produces:

```ts
import { block, cmp, kv, list, numeral, scalar, serialize } from "@pdx-ts/pdxscript";

const items = [
  kv("@cost", numeral("9007199254740993")),
  block("technology", [
    kv("area", "physics"),
    cmp("tier", ">=", 2),
    list("prerequisites", [scalar("tech_lasers_1"), scalar("tech_physics_1")]),
  ]),
];

const text = serialize(items);
```

Other constructors cover quoted strings, variable references, inline math,
container headers such as `hsv { ... }`, and raw entry operators. Conditional
regions use the exported `PdxParamBlock` and `PdxParamText` interfaces directly;
there are no dedicated constructors for them. Dedicated constructors reject
invalid names, numerals, and string contents immediately. Manually shaped
conditional-region nodes are validated when serialized.

Use `walkItems(items, context, visit, regions)` for pre-order traversal. Balanced
`PdxParamBlock` regions are traversed normally. Pass `"skip"` to omit verbatim
`PdxParamText` bodies or `{ read: true, fileName }` to lex those bodies as a flat
item sequence. `itemChildren`, `skipChildren`, and `stopWalk` support controlled
tree analysis.

## Conditional parameter regions

Stellaris scripted definitions use `[[PARAM] ... ]` regions. The engine splices
their text before parsing. A balanced body is represented as `PdxParamBlock`
with nested Items. A body that crosses brace boundaries cannot honestly be a
tree, so it is represented as `PdxParamText` and preserved verbatim, including
comments inside that region.

This distinction lets the parser accept real large-mod constructs without
pretending malformed intermediate text has a tree structure.

## Diagnostics and repairs

Some shipped game files contain syntax the engine repairs, including an omitted
`=`, a stray closing brace, or a missing final brace. The parser applies only
documented repair rules and returns a `PdxDiagnostic` for each repair.

Repairs are never written to the console and are never silent. A strict caller
can reject every document with a non-empty `diagnostics` array. A tolerant
caller can retain the repaired AST and report the exact file and line.

Unrecognized syntax throws `PdxSyntaxError`. Unsupported operators such as `?=`
and `==` fail rather than producing a plausible but wrong tree.

## Scope and limits

- The parser targets game-definition files, not save files.
- Stellaris is the verified corpus. Other Clausewitz games may work but are not
  covered by the full corpus gates.
- Variable resolution, inline-math evaluation, scope rules, and load order are
  consumer responsibilities.
- Comments outside verbatim parameter text are not retained.
- Serialization is canonical rather than byte-identical.
- Any syntax the parser accepts must also be constructible and serializable.

[GRAMMAR.md](GRAMMAR.md) is the grammar of record. It lists the complete node
language, repair policy, and named deferrals.

## Implementation

The package is strict TypeScript and ESM with no runtime dependencies. It uses a
hand-written lexer, recursive-descent parser, explicit AST constructors, and one
canonical serializer.

```text
src/
|-- ast.ts            AST types and checked constructors
|-- representable.ts lexical classification shared across all stages
|-- lexer.ts          tokenization and syntax errors
|-- parser.ts         recursive descent and repair diagnostics
|-- serialize.ts      canonical rendering
|-- walk.ts           tree traversal
|-- normalize.ts      comparison normalizations
`-- index.ts          public exports
```

Keeping lexical classification in one module makes parsing and writing
symmetric. The parser is deliberately independent of `@pdx-ts/sdk`; the SDK
depends on this package, not the reverse.

## Verification

Five test families cover different failure classes:

1. `tests/parser.test.ts` has focused examples for individual grammar claims.
2. `tests/properties.test.ts` uses fast-check for generated round trips, quoting
   symmetry, arbitrary-input crash freedom, and repair idempotence.
3. `tests/differential.test.ts` compares normalized trees with jomini and names
   known jomini differences explicitly.
4. `tests/walk.test.ts` verifies traversal order, context, region policy, skip,
   and early termination.
5. `tests/corpus.test.ts` parses and round-trips PDXScript `.txt` files under the
   vanilla Stellaris `common/` tree when a local installation is available. It
   excludes two documented `.txt` files whose contents are not PDXScript.

Families 3 and 5 are the only external evidence here: the rest establish that
the package is consistent with itself, which would hold just as well if it read
every file wrongly but consistently. Both need a Stellaris install, so `npm
test` skips them. `npm run test:vanilla` refuses to skip — a missing install
fails with the path it looked for — and `npm run release:check` runs that, and
records a skipped install-gated gate as a failed one.

Run the repository gates from the workspace root:

```bash
npm run typecheck
npm test
npm run build

# Requires a Stellaris install; set STELLARIS_PATH if it is not in the
# default Steam location.
npm run test:vanilla
```

The package is pre-1.0 and its API may still change. It is the syntax foundation
for [@pdx-ts/sdk](../sdk/README.md), but it remains independently usable and
game-semantics-free. See the [PDXScript Syntax glossary](./CONTEXT.md) for its
terms.

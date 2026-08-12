# PDXScript Syntax

Parsing and serializing Paradox's script format. This context is deliberately
game-semantics-free: it can tell you that a block contains a key with a block
value, and nothing about what that means.

The explicit no is the point. There are no scopes here, no triggers, no
effects, no registries, no localization. A term from any other context that
implies game meaning does not belong in this one. See the
[context map](../../CONTEXT-MAP.md).

## Language

**Item**:
A node in the parsed tree — an entry, a scalar, a container, or a conditional
region. Unrelated to Authoring's `ModItem`, which is an authored value; these
two meanings meet in several modules.

**Entry**:
A `key op value` triple. Both order and duplicate keys are preserved, because
the game is sensitive to both.

**Container**:
A braced list of items. Deliberately not called an object or a map — it may
hold entries, bare scalars, or both, and its keys may repeat.

**Conditional region**:
A `[[NAME] ... ]` span, whose body the engine splices as text when NAME is
defined. Called a region rather than a block because its body is delimited
text, not a container: brace balance holds only after substitution. A body
that happens to balance on its own is also read as a tree (`param`); one that
does not is kept verbatim (`param-text`), which is the honest answer, not a
degraded one.

**Repair**:
A recorded fix for malformed input that the game itself tolerates. Paradox
ships files the engine repairs rather than rejects, so the parser does the
same: parsing succeeds and each repair is reported as a diagnostic, never a
silent correction.

**Diagnostic**:
One reported repair or observation about the source. Data returned to the
caller, never console output.

**Lexeme**:
The source spelling of a token, kept as the value itself. Numbers are the
case that matters: the AST carries `9007199254740993` as those digits, not as
the double that would round them. A *projection* to a JS number is a separate,
refusable step, not what the node is.

**Representable**:
Writable in this syntax and readable back as itself. The property is
load-bearing rather than decorative: the parser, the constructors and the
serializer must accept the same set, or the package is not closed under its
own language and a parse can produce a value nothing can emit.

**Semantic round trip**:
The guarantee this package actually makes: `serialize(parse(x))` means the same
as `x`, not that it is byte-identical to it.

**Fixpoint**:
The stronger property, verified across the whole vanilla tree:
`parse(serialize(parse(x)))` equals `parse(x)`. One reparse settles everything
serialization normalized.

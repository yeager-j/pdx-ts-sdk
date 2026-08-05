# Vanilla Extraction

Deriving vanilla Stellaris's identifiers from an installed copy of the game and
emitting them as `@pdx-ts/stellaris-ids`. Covers both
`packages/codegen-vanilla` (the generator, where this context's language is
decided) and `packages/stellaris-ids` (its output).

Distinct from [CWT Codegen](../codegen-cwt/CONTEXT.md) on purpose: install-derived
and rules-derived are different sources, with different regeneration triggers
and different failure modes. See the [context map](../../CONTEXT-MAP.md).

## Language

**Chokepoint**:
The licensing gate every emitted string literal passes through. Enforced by the
generator rather than left to convention, because the boundary is what makes
this package publishable: identifiers, definition names, parameter lists, event
ids and namespaces cross it; script bodies, localized text, descriptions, and
asset data do not.

**Registry**:
A content registry read out of the install — `technology`, `sprite`, `sound`.
_Avoid_: using this for the scripted-definition kind; that is `ScriptedKind`

**ScriptedKind**:
Which of the two scripted-definition kinds a definition is: `trigger` or
`effect`.

**Inferred scope**:
The scope a scripted definition is legal in, _derived_ rather than read off
anything — the intersection of the scopes cwtools already declares for the keys
the body evaluates. The one thing here computed from a body rather than
extracted from one, which is why the body never reaches an emitter.

**Caller-relative**:
Navigation that says nothing about legality — `this`, `root`, `prev`, `from`.
Excluded from inference, because a body that only navigates constrains nothing.

**Universal**:
The identity element of scope intersection: legal everywhere, because nothing
in the body narrowed it. An unreadable body widens rather than narrows, so a
collapse toward universal means the types got quieter, not that the build broke.

**Call site**:
A place in vanilla's own script where a scripted definition is invoked, in a
scope the rules already know.

**Contradiction**:
A call site whose scope the inference says is illegal. The standing
falsification gate measures the emitted scopes against thousands of real call
sites and fails on any of these.

**Oversized**:
A registry with too many ids to put in one completion menu, navigated through a
trie instead of a flat union.

**Bucket**:
One node's worth of a trie, grouped by stripped filename, filename, or
directory.

**Basename**:
A vanilla source file's name without its extension, used for bucketing.
Unrelated to Authoring's **stem**, which is an output filename the SDK chooses.

**Package pin**:
The check that the installed `@pdx-ts/stellaris-ids` version matches the game
version it was generated from.

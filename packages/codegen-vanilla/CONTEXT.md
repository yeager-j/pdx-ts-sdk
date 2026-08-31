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
The licensing gate every emitted string passes through. Enforced by the
generator rather than left to convention, because the boundary is what makes
this package publishable: identifiers, definition names, parameter lists, event
ids and namespaces cross it; script bodies, localized text, descriptions, and
asset data do not. Three doors, one counter — a name, a path, and a **module
stem**, which is install text that names a generated file rather than sitting
inside one.

**Module stem**:
One path component of a generated module's name, and the third thing the
chokepoint inspects. A **bucket** key and an event namespace both become one,
and both are install text, so a stem is a name plus the rules that keep it a
single component: no separators, no drive letter, no leading or trailing dot,
no space.

**Extraction gap**:
A part of an inventory this package publishes as *exact* that no reader read —
a complex-enum file that would not parse, a localization line whose shape the
reader does not know. Recorded rather than skipped, because these inventories
are membership the SDK rejects against: a short one ships as a wrong answer,
not as a missing completion. Emission refuses while any gap is open. A file
*proved* unable to hold a member is not a gap: the install ships prose under
`.txt` where enums search, and an unreadable file whose text does not contain
the identifier a member requires cannot bear on the answer under any parse.
_Avoid_: confusing this with CWT Codegen's **corpus gap**, which is a field the
game writes that no author can produce. Different context, different problem.

**Parser repair**:
A malformed construct in a shipped file that the parser fixed the way the game
does. Counted per registry and never fatal — the file was read whole. The
opposite number to an **extraction gap**, and the distinction is load-bearing:
a file nothing read used to be counted as a repair.

**Registry**:
A content registry read out of the install — `technology`, `sprite`, `sound`.
_Avoid_: using this for the scripted-definition kind; that is `ScriptedKind`

**ScriptedKind**:
Which of the two scripted-definition kinds a definition is: `trigger` or
`effect`.

**Region**:
A `[[FLAG] ... ]` block in a scripted definition's body, active only when the
caller supplies `FLAG`. Recorded as a **forcing region** when activating it
makes some other parameter necessary — that is a dependency between parameters,
not two independent optional ones, and flattening it published a signature that
accepted `{ FLAG: true }` and emitted a body with nothing to substitute.

**Call shape**:
One combination of a definition's forcing regions being on or off, emitted as
one member of the parameter type's union. A definition with no forcing region
has exactly one, which is the flat object almost every definition gets.

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

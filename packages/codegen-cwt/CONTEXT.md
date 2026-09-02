# CWT Codegen

Reading the pinned cwtools config fork and emitting the SDK's typed authoring
surface into `packages/sdk/src/generated/`. Its output is committed, reviewed
as a public-API change, and never hand-edited.

See the [context map](../../CONTEXT-MAP.md) for what these terms become when
they cross into Authoring.

## Language

### The pipeline

**Lower**:
To translate a higher-level description into one closer to the target, losing
abstraction and gaining explicitness. Standard compiler vocabulary — LLVM's
`TargetLowering`, rustc's AST lowering, MLIR's progressive lowering — used here
in its ordinary sense. The pipeline is `parse → lower → emit`.
`LoweredValue` and `LoweredRule` are semantic middle-stage values. A
`FieldProjection` is different: it contains generated TypeScript and therefore
belongs to emission.

**Emit**:
To write TypeScript. In Authoring the same word means writing PDXScript; the
two contexts never share a reader, but the collision is real and worth knowing.

**Registry**:
A content type the SDK exposes, keyed by id — `technology`, `ascension_perk`.
The unit that adding a new content type adds.
_Avoid_: content type (the rules use `ContentType` for the parsed `type[...]`
declaration, which is a different thing)

**Content manifest**:
The explicit allowlist of registries exposed by the SDK. A registry the rules
declare but the manifest omits is simply not generated.

**Overlay**:
Every place the generated API deliberately departs from a mechanical reading of
the rules, each row carrying its reason. The audited exception list, not a
patch file.

**Supported authoring model**:
The canonical post-overlay representation of the game forms the SDK chooses to
author. The public TypeScript surface is its generated projection; Scaffolding
proves built-in recipes against that surface rather than consuming a second
schema projection.
_Avoid_: raw CWT model, prompt schema, runtime descriptor

**Graft**:
A hand-written definer re-exported in place of the mechanical one, where the
generic emitter cannot produce the right surface.

**Widening**:
An intentionally more permissive input form than the rules describe, added for
ergonomics.

**Declined field**:
A field the emitter _can_ lower, kept out of the authoring surface anyway. The
bar is high: a field whose lowered shape is merely wrong should be fixed, not
withheld.

### Shape and structure

**Shape**:
The runtime writer's dispatch kind for a field — `value`, `struct`,
`repeatedStruct`, `weightBlock`, `aliasStruct`, and the rest. What the writer
switches on.

**Form**:
What the author passes, or what the game's own files were observed to write —
`scalar`, `list`, `trigger`, `closure`, `block`. Computed once at codegen time
and written into the field descriptor, so the runtime reads `field.form` rather
than reclassifying a shape itself.

**Arity**:
Whether a key repeats among its siblings within one block.

**Splice**:
An alias category inlined unkeyed into a definition body, so its members appear
as if declared there.

**Interior**:
What lives inside a block-valued field — the second half of a shape check, and
the part a naive reader stops before.

**Descent**:
How the corpus reader walks into a block field, and in which of the structural
modes it does so.

**Clause**:
A spliced condition or effect body — the `trigger`, `effect`, and
`modifier_rule` alias categories.

**Value set**:
Names that script _invents_ as it runs, such as flags, as opposed to names a
registry defines.

### Evidence

**Corpus**:
Derived observations of every definition the real game ships — field names,
forms, counts. A lower bound on what is legal, never an upper one: a field the
game never writes may still be valid.

**Corpus gate**:
The hermetic test measuring the emitted interface against the committed corpus
fixture, for both presence and shape. It runs in plain `npm test` because it
reads the fixture, not an install.

**Presence floor**:
The occurrence count at which a field the game writes becomes something an
author must be able to produce. A property of the gate, defined in the tests.

**Conformance**:
Whether every field the corpus observed is present on the emitted interface.

**Shape conformance**:
The separate question of whether the present fields have the right form, arity,
literals, and scope. Two questions, deliberately not one.

**Invented**:
A field the emitter produced that no shipped definition writes. Not
automatically wrong, but worth verifying by hand.

**Unauthorable**:
A field the game writes that no author can produce through the emitted
interface. A gate failure unless acknowledged with a reason and an issue.

**Drift**:
Disagreement between the pinned `.cwt` rules and the game's own documentation
dumps. Recorded in the drift baseline and accepted deliberately, never
rebaselined reflexively.

# Authoring

What a mod author writes, and the fold that turns it into a mod. Everything
here is a pure value: authoring records intent, and nothing reaches disk until
`render` or `write` is called.

See the [context map](../../CONTEXT-MAP.md) for how these terms change meaning
at the boundaries with the parser, the generators, and the interpreter.

## Language

### The authoring surface

**Capability**:
The immutable, mod-bound object `createMod(config)` returns. It owns the mod's
prefix and id profile, and every authoring method hangs off it.
_Avoid_: builder, factory, registry object

**Feature**:
One authored unit of capability-owned Items, named by a stem. The stem groups
output whose placement the SDK owns; an Item with a complete logical path,
such as an Asset file, keeps that path.
_Avoid_: collection, group, module

**Item**:
A value an authoring method returns, tagged with an `itemKind` — content, event,
on-action hook, patch, or contribution. Items register nothing; placing them in
a feature is what makes them real.
_Avoid_: entry, definition, node

**Definer**:
The raw `defineX` function under a capability method. Internal lowering
machinery: the item unions are public, their constructors are not.
_Avoid_: factory, constructor

**Fold**:
The deterministic pass from placed features to a `PureMod`. It is where
duplicate ids, dangling references, and namespace collisions are caught.

**PureMod**:
The assembled mod as a value rather than a builder — the thing `render`
consumes to produce a Rendered mod.

**Rendered mod**:
The immutable, canonically ordered files `render` derives from one `PureMod`.
It is the value `write` and `install` materialize; repeated renders promise the
same paths and bytes, not the same object identity.

**Rendered file**:
One logical path and immutable payload in a Rendered mod. Text remains an
inspectable string; opaque bytes can be copied out deliberately but are not
exposed as mutable SDK-owned storage.

**Materialization**:
Making an output directory exactly match one Rendered mod after proving the
directory still matches the SDK's last successful materialization. Distinct
from installation, which also owns the launcher-side descriptor.

**Materialization drift**:
Any added, removed, type-changed, or byte-changed path since the SDK last
materialized an output. Ordinary materialization refuses drift rather than
silently destroying it.

**Materialization manifest**:
The SDK-owned record of the paths and byte identities from its last successful
materialization. It proves ownership and detects Materialization drift; it is
not mod content.

**Asset file**:
An opaque sequence of bytes deliberately included at one logical path and
preserved byte-for-byte in the assembled mod.
_Avoid_: passthrough (that is the parsed-patch sense)

**GFX definition**:
A typed graphical declaration — such as a sprite, mesh, or particle — that
becomes part of a `.gfx` file. Distinct from an asset file: the SDK lowers a
definition rather than preserving authored bytes.

**Envelope**:
The root container block (`spriteTypes`, `objectTypes`) holding every GFX
definition in a `.gfx` file. A lowering fact, never authored: an emitted file
carries exactly one, while shipped files may repeat it — a reading-side fact
carrying no meaning.
_Avoid_: wrapper, root key (that is the CWT `skip_root_key` sense)

**Contribution**:
An item that adds to a shared, non-id-keyed object several features write into
together, rather than defining something of its own.
_Avoid_: sink (the sink is where a contribution lands, not the contribution)

### Identity and placement

**Prefix**:
The mod's id namespace. Every generated content id and nested definition id
must carry it. Not a load-order device — the game's `zz_` filename folklore is
solved by the patch plan instead.

**Logical name**:
The short name an author supplies (`"resonance"`), before the prefix and id
segment are added.

**Id segment**:
The per-registry component minted between the prefix and the logical name, as
in `hello_galaxy_tech_resonance`.

**Mint**:
To construct a prefixed or branded value through its single constructor. Ids,
namespaces, and logical paths are minted, never assembled by hand.

**Shape mint**:
Minting a sprite name through a rules-derived inference pattern — a shape the
game uses to compute a sprite name from a content key, such as the text-icon
or fleet-order-button forms — rather than through the default prefix position.
The pattern's target may be an authored item or an intentional raw third-party
key.
_Avoid_: pinned name, exact name

**Stem**:
The output filename component the SDK controls, before the extension. One stem
can produce several files across directories.
_Avoid_: file, basename, name

**Logical path**:
A normalized, case-preserving, `/`-separated path relative to the mod root, in
the form the game resolves overrides by. Its spelling must be reproducible on
every supported materialization filesystem; portable aliases and file/directory
conflicts are refused rather than collapsed.

**Path claim**:
One output producer's exclusive assembly-time ownership of a logical path.
Items that deliberately share a generated file are combined before its claim;
a second claim is a collision even when it would produce identical bytes.

**Vanilla path inventory**:
The version-pinned, content-free set of logical paths the base game and its
official DLC occupy. Assembly unions every matching live and
`@pdx-ts/stellaris-ids` inventory available, so ordinary output cannot silently
replace a vanilla file.
_Avoid_: file map (there are no mapped values or file contents)

**Enumeration order**:
The byte-sorted file list the patch plan reasons against — the order the game
loads files in.

### Script

**Trigger**:
A declarative expression tree describing a condition. Narrower than the game's
sense: a `Trigger<S>` is a value that can be inspected and interpreted, not a
block of text.

**Effect**:
A closure executed once at build time to record AST entries. This is the sharp
break from the game's meaning — an effect is not a value describing a mutation,
it is a recording of one.

**Scope**:
The object a block evaluates against, narrowed here to a compile-time type
parameter `S` that removes the methods which would be illegal. Distinct from a
`ScopeValue` (a runtime navigation path) and from the scopes a _rule_ is legal
in.

**Witness**:
The value passed as `from:` at a fire site, proving the FROM-scope contract the
CWT rules cannot state.

**Contract**:
A compile-time promise the rules do not express, carried in the types so a
violation fails to build rather than failing in game.

### Vanilla and patching

**Patch**:
A whole-object override of one vanilla definition. Not the game's other sense
(a released game version), and not "any file that overrides".

**Patch plan**:
The computed emission filename that provably byte-sorts after every file
defining the patched key, together with the assertions backing that claim.

**Parsed definition**:
A shipped definition as read from the install — its body and provenance,
tagged with the registry it belongs to. The value a patch transforms.
_Avoid_: view object, source object

**Passthrough**:
A parsed value placed directly in a patch input and emitted verbatim rather
than re-lowered. How vanilla's own blocks survive a patched member unchanged.
_Avoid_: raw copy, echo

**Patch widening**:
An intentional extra input form a patch member admits beyond what the rules
can state, recorded as an audited departure — the patch-surface counterpart
of a field widening.
_Avoid_: special case, escape hatch

**Defining file**:
A surviving vanilla or mod file that defines a given key. The patch plan beats
every one of them.
_Avoid_: definer (that is the `defineX` sense)

**Bar**:
The byte-maximum defining file — the one the computed filename must sort after.

**Win assertion**:
The recorded claim that one emission beats every defining file for one key,
marked `verified` or `assumed` according to the weakest rule cell it rests on.

**Oracle run**:
An observation made in the running game that established an override-rule cell.
The only thing that upgrades a rule from `assumed` to `verified`.

**Swap**:
A nested named identity inside a definition (`technology_swap`,
`tradition_swap`). Patching into one is refused: there is no oracle evidence for
swap override semantics.

**Localization**:
Author-supplied display text, which rides with the definition that needs it and
is never authored standalone. Spelled `localisation` only when naming the game's
directory or a cwtools rule keyword.

**Rename**:
Replacement text a patch writes under a key vanilla already defines, emitted to
`localisation/replace/`. A layer, not a load-order claim — no win assertion is
involved, because filename order never decides a localisation winner.
_Avoid_: loc override, retitle

**On-action hook**:
A named engine callback a feature binds events to. Only scoped hooks are
supported; a scopeless one throws rather than being guessed at.
_Avoid_: binding, contribution, registration

**Namespace**:
An event namespace, in strict bijection with an event file — one namespace per
file, one file per namespace. A constraint the SDK imposes, not the game.

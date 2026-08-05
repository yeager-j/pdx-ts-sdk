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
One output file's worth of items, named by a stem. One feature fans out across
every registry its items belong to, keeping its stem in each.
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
The assembled mod as a value rather than a builder — the thing `render`,
`write`, and `install` consume.

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

**Stem**:
The output filename component the SDK controls, before the extension. One stem
can produce several files across directories.
_Avoid_: file, basename, name

**Logical path**:
A normalized, `/`-separated path relative to the mod root, in the form the game
resolves overrides by.

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

**On-action hook**:
A named engine callback a feature binds events to. Only scoped hooks are
supported; a scopeless one throws rather than being guessed at.
_Avoid_: binding, contribution, registration

**Namespace**:
An event namespace, in strict bijection with an event file — one namespace per
file, one file per namespace. A constraint the SDK imposes, not the game.

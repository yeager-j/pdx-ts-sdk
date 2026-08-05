# `@pdx-ts/pdxscript` knows no game semantics

The parser is syntax-only and stays that way. It preserves order and duplicate
keys, reports repairs to the malformed files Paradox actually ships, and
promises a semantic rather than byte-identical round trip — but it cannot tell
a technology from a trigger, and no scope, registry, or localization concept
may enter it.

This is the explicit no, not an accident of scheduling. A parser that knew game
semantics would be untestable against the property that makes it trustworthy —
full-vanilla fixpoint plus a jomini differential — because every game-shaped
special case is a place the fixpoint could be made to pass by cheating. It also
keeps the package independently useful to anyone parsing Paradox script for any
game.

The cost, accepted: callers that need meaning must supply it themselves, and
some things that would be convenient to fix in the parser get fixed in the SDK
instead.

Evidence: `packages/pdxscript/GRAMMAR.md` for the stated grammar, and the
standing gates that would catch a game-semantics shortcut —
`packages/pdxscript/tests/corpus.test.ts` (full-vanilla fixpoint),
`differential.test.ts` (jomini), and `properties.test.ts`.

# @pdx-ts/stellaris-ids is a hard dependency

ADR-0003 split install-derived identifiers into their own package and made that
package optional: absent it, vanilla references degraded to unchecked `string`
per registry. The split stands. The optionality is reversed — `@pdx-ts/sdk`
requires `@pdx-ts/stellaris-ids` as a peer dependency, and the degraded mode is
deleted.

Optionality was insurance against two risks, and charged every feature a
standing premium: each new capability had to define its evidence-absent
behavior (the empty merge-target interfaces, the unchecked-`string` mode,
SDK-119's carve-out making vanilla path evidence mandatory only for
author-minted paths, the `PDX_UNCHECKED_VANILLA_PATHS` escape).

The first risk — a game patch outrunning the package — turns out to be insured
elsewhere. The SDK's typed surface is game-version-locked through the pinned
CWT config fork, while
`stellaris-ids` regenerates self-serve from an install. Whenever the SDK
supports a game version at all, the matching identifier package can exist the
same day; a game version without rules has no typed surface regardless. The
degraded mode never rescued a user the SDK could otherwise serve.

The second risk — a licensing objection forcing an unpublish, where an optional
package degrades the SDK instead of bricking it — is real and is consciously
accepted. The audited licensing chokepoint in the generator is the defense; the
firebreak insured a near-never event at a permanent complexity cost.

Consequences: the SDK imports the package's types directly and the empty
merge-target interfaces in `packages/sdk/src/identifiers/contracts.ts` are
deleted; every Path claim is checked against the packaged Vanilla path
inventory unconditionally; the missing-evidence escape is retired
unimplemented. Projects keep supplying the game-version range
`create-stellaris-mod` emits, and explicit game-version acceptance still
governs intentional mismatch.

Evidence: the 2026-08-13 amendment on
[Define logical-path ownership and collision safety](https://linear.app/unnamed-system/issue/SDK-119/define-logical-path-ownership-and-collision-safety);
`packages/stellaris-ids/PROVENANCE.md` for the licensing chokepoint this
decision leans on.

# Features are declared from the root, not discovered from the filesystem

`discoverFeatures(dir)` walked the manifest's `contentDirectory`, imported
every `.ts` file that did not carry a companion suffix (`.test.ts`, `.spec.ts`,
`.d.ts`, and their kin), and read each module's named `feature` export. It was
the SDK's one impure shell before the fold, and its only check, that every
selected file exports a feature, ran at runtime, after the walk had already
imported the file.

A file convention earns its place when the path is the identity: a Next.js
route is its file, so enumerating the directory is the routing table. Here the
stem is authored in `mod.feature(stem, ...)` and the path is deliberately not
identity ([ADR-0005](./0005-emission-order-is-content-not-position.md)), so
enumeration bought exactly one thing, that an author cannot forget to list a
file, and paid for it with a runtime walk, an include pattern, a
companion-suffix rule, and a class of error only a build could raise.

The decision: a project declares its module tree the way a Rust crate does
with `lib.rs` and its `mod` lines. `src/features.ts` re-exports each feature
module's `feature`; `project.build(features)` and `mod.compile(features)` take
that module namespace, or an explicit array, and every export of it must be a
Feature. `mod.feature(stem, bag)` takes a namespace too and keeps only its
Item-valued exports, so a feature module can be the root of its own private
tree. `contentDirectory`, `discoverFeatures`, `DEFAULT_CONTENT_PATTERN`, and
the `discover` and `additionalFeatures` build options are deleted; a manifest
still carrying `contentDirectory` is refused with the fix rather than ignored.

The consequences. A wrong export in the list is a type error, because `build`
accepts only this capability's Features. TypeScript's import graph is now the
module tree, so a file no line reaches is a lint finding rather than silently
absent content; scaffolded projects run knip for exactly that. knip checks
reachability, not declaration: a module a declared feature imports for a
helper is reached, and if it mints a Feature of its own that Feature is
nowhere in the list. `project.build` owns that case, since every
`mod.feature` call runs at module evaluation: a Feature this project's `mod`
minted that the list does not include is refused by name, as content the
author wrote that the build would otherwise drop. The fold keeps refusing an
Item that is referenced but placed nowhere. The order of the list's
exports is irrelevant, because the fold owns emission order (ADR-0005). The
scaffold and the docs follow: `src/build.ts` is the one module that imports
both `mod` and the list, since feature modules import `mod` and `mod.ts` cannot
import them back without evaluating them before `mod` exists.

Evidence: `packages/sdk/tests/feature-bags.test.ts` and
`feature-bags.test-d.ts` for what a bag accepts and refuses, and the unchanged
hello-galaxy goldens in `packages/stellaris-ids/tests/__snapshots__/hello-galaxy/`
across its restructure from a discovered `content/` directory to a declared
`features.ts`.

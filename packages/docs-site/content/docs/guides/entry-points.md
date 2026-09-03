---
title: Entry points
description: Which `@pdx-ts/sdk` module each import comes from, and why.
---

`@pdx-ts/sdk` publishes five modules. Each carries one kind of name, and each
name has exactly one home — an auto-import always resolves to the right place.

| Module                     | What it carries                                                               | Typical names                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pdx-ts/sdk`              | The pipeline a build script calls                                             | `createModProject`, `createMod`, `render`, `write`, `install`, `runBuild`, `runInspect`, `runInstall`, the error classes                        |
| `@pdx-ts/sdk/stellaris`    | The game vocabulary an author types inside defs and expressions               | `and`, `hasCountryFlag`, `owner`, `countryFlags`, `eventTarget`, `onActions`, `vanilla`, `scriptedTrigger`, content types like `TechnologyItem` |
| `@pdx-ts/sdk/installation` | The installed copy of the game                                                | `locateInstall`, `load`, `modDir`, `VanillaView`, `viewFromFiles`                                                                               |
| `@pdx-ts/sdk/reference`    | Machine-readable facts about the SDK, for tools that reason about the surface | `CONTENT_REGISTRIES`, `SCRIPT_REFERENCE_SCOPES`, `PROJECT_LAYOUT_FIELDS`, `EVENT_KINDS`, `SUPPORTED_STELLARIS_BUILD`                            |
| `@pdx-ts/sdk/internals`    | Unstable machinery with no compatibility guarantee                            | the effect recorder, policy tables, recovery operations                                                                                         |

The rule of thumb: a name you write inside a def, trigger, or effect closure
comes from `/stellaris`; a name your build script calls comes from the root.
A content module usually imports from `/stellaris` alone, and `mod.ts` and
`build.ts` from the root alone.

```ts
// content/resonance.ts — vocabulary only
import { and, hasCountryFlag, not, vanilla } from "@pdx-ts/sdk/stellaris";
```

```ts
// build.ts — pipeline only
import { render, write } from "@pdx-ts/sdk";
```

Anything under `/internals` may change or disappear in any release. If a mod
build needs a name from there, that usually means the name is missing from
the public surface — file an issue rather than depending on it.

The reasoning behind this split is recorded in
[ADR-0007](https://github.com/yeager-j/pdx-ts-sdk/blob/main/docs/adr/0007-subpath-exports-encode-package-boundaries.md).

---
title: The pipeline
description: Follow a mod from `createMod` to compiled, rendered, and written files.
---

Every build passes through four steps:

```text
createMod → mod.compile (the Fold) → render → write or install
```

Each step returns a value for the next step. Only the last step writes to disk.

In a scaffolded project, `createModProject` provides the conventional
interface for the first two steps. It creates the immutable capability
immediately, then `project.build(features)` compiles the declared Features and
performs one Fold when called. The lower-level functions remain available for a
custom pipeline.

```ts
import { createMod, install, render, write } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Crystal Resonance",
  prefix: "crystal_resonance",
  supportedVersion: "v4.4.*",
});

const feature = mod.feature("resonance", [
  // Technologies, events, localization, Asset files, and other mod items.
]);

const compiled = mod.compile([feature]);
const rendered = render(compiled);

// Build into a project directory:
await write(new URL("../../out/", import.meta.url), rendered);

// ...or, in the install entry point, install for the launcher:
await install(rendered);
```

A scaffolded project reads the name, prefix, source layout, and supported
version from `stellaris-mod.json`; they are written out here so the snippet
stands alone.

Its `src/mod.ts` uses the standard project interface:

```ts
import { createModProject } from "@pdx-ts/sdk";

import manifest from "../stellaris-mod.json" with { type: "json" };

export const project = createModProject(manifest, {
  projectRoot: new URL("../", import.meta.url),
});

export const { config, mod } = project;
```

and `src/build.ts` hands it the feature list, `src/features.ts`, as a
namespace:

```ts
import { project } from "#mod";

import * as features from "./features.ts";
import { loadVanilla } from "./vanilla.ts";

export async function buildTheMod() {
  return project.build(features, { vanilla: loadVanilla() });
}
```

The scaffolded entry points use the opt-in terminal module instead of spelling
out this pipeline and its presentation in every project:

```ts
import { runBuild } from "@pdx-ts/sdk";

await runBuild(buildTheMod(), {
  outDir: new URL("../out/", import.meta.url),
  previewsDir: new URL("../previews/", import.meta.url),
});
```

`runBuild` and `runInstall` accept the `PureMod` or its promise, run the same
low-level operations shown above, display warnings and structured failures with
Clack, and return the write or install report on success. `runInspect` instead
prints one deterministic YAML document from the Fold and the project's
`package.json`. It does not render or write the mod. The three runners set the command exit code
after a reported failure, which prevents Node from printing the same raw stack
a second time. Advanced build scripts can continue to call `render`, `write`,
and `install` directly.

## 1. `createMod`: bind the mod's identity

`createMod` validates the launcher configuration and returns an immutable
`mod` object bound to your prefix — the SDK calls this the authoring
capability. Its methods create definitions, references, events, localization,
[Asset files](/concepts/assets/), and Features that belong to that mod.

This step does not assemble or serialize the mod. Definitions stay ordinary
TypeScript values until a [Feature](/guides/features/) carries
them into `mod.compile`.

## 2. `mod.compile`: the Fold

`mod.compile(features)` is **the Fold**. It combines the selected Features into
one immutable `PureMod`. Source file layout is not part of the result: Feature
stems (which also name event files, one namespace per stem), content
registries, localization rules, explicit Asset paths, and shared-output rules
decide the logical output paths — the mod-relative paths, such as
`common/technology/crystal_resonance_resonance.txt`, that do not depend on
where the mod is later written.

The Fold is also the main validation boundary. It refuses a build when it can
prove that the assembled mod is inconsistent: duplicate ids, dangling
references, conflicting or aliased path claims, collisions with SDK-reserved
or [known vanilla paths](/guides/patching-vanilla/), and mixed or split event
namespaces. [Warnings and diagnostics](/guides/warnings-and-diagnostics/)
lists the full set.

These checks happen before serialization and before disk access. A successful
Fold therefore has one owner for every logical output path.

Not every uncertain condition is an error. For example, a raw Asset path that
is neither captured by this build nor known as a vanilla path becomes a warning
because it may come from a DLC, another mod, or a file managed outside the SDK.
The `PureMod` that `mod.compile` returns carries these non-blocking
diagnostics on its `warnings` array. It also retains each Feature's stem, Item
count and authored ids, plus vanilla evidence supplied directly or through a
patch, so inspection tools do not need to reconstruct inputs from output
filenames.

## 3. `render`: produce the finished bytes

`render(compiled)` serializes the `PureMod` into an immutable `RenderedMod`.
The snapshot contains every output the Fold assigned an owner, including
PDXScript, localization, captured Asset bytes, and `descriptor.mod`. It does
not contain `.pdx-sdk-manifest.json`, the ownership record that `write` and
`install` add beside the content — see step 4.

A `RenderedMod` is an iterable collection keyed by logical path. Each
`RenderedFile` says whether it contains text or bytes and exposes its byte
length and SHA-256 digest. The whole snapshot also has a file count and digest.
Use `rendered.text(path)` for text or `rendered.file(path)?.bytes()` for the
exact bytes.

Rendering does not choose an output directory and does not write anything. The
same rendered snapshot can be inspected, tested, written to a build directory,
or installed for the launcher.

## 4. `write` or `install`: materialize the snapshot

Both functions materialize the `RenderedMod` content, but they target
different places:

| Function                      | Destination                                               | Launcher descriptor                                  |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `write(outDir, rendered)`     | Any output directory you choose                           | Does not create one                                  |
| `install(rendered, options?)` | The Stellaris launcher mod directory, or `options.modDir` | Creates `<dirName>.mod` beside the content directory |

`install` accepts two options: `modDir` picks the launcher's mod directory,
defaulting to the platform location or to the `STELLARIS_MOD_DIR` environment
variable when it is set, and `dirName` names the installed content folder,
defaulting to the mod prefix.

The rendered snapshot already contains the mod's own `descriptor.mod`. That
file lives inside the mod directory and describes the mod. The launcher-side
`<dirName>.mod` file lives beside the installed content directory and adds a
`path="..."` line that points to it. `render` cannot create this second file
because its contents depend on the final install location. `install` renders it
from the same snapshot once the content directory is known.

Both functions also write `.pdx-sdk-manifest.json`, which records SDK ownership
and digests for later drift checks. This is materialization metadata, not a
file in the `RenderedMod` snapshot.

Files in the target that the SDK does not own are preserved, not deleted: the
materialization carries them through unchanged, and a rendered path that lands
on a foreign entry is refused rather than overwritten. `write` returns the
resolved `outDir`; `install` returns both `contentDir` and `descriptorPath`.
Each report also says whether anything on disk changed and lists the
`foreignEntries` it preserved, and both functions refuse to silently replace
SDK-owned output that has drifted since the previous run.

A refusal is not a dead end. A drift refusal carries a receipt; pass it to
`replaceMaterialization` or `replaceInstallation` (from
`@pdx-ts/sdk/internals`) to replace the drifted output deliberately. An
interrupted run leaves a transaction that `recoverMaterialization` or
`recoverInstallation` (same module) completes or rolls back.

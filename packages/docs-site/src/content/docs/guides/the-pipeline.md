---
title: The pipeline
description: Follow a mod from its authoring capability to compiled, rendered, and materialized files.
sidebar:
  order: 2
---

Every build passes through four steps:

```text
createMod → mod.compile (the Fold) → render → write or install
```

Each step returns a value for the next step. Only the last step writes to disk.

```ts
import { createMod, install, render, write } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Crystal Resonance",
  prefix: "crystal_resonance",
  supportedVersion: "v4.0.*",
});

const feature = mod.feature("resonance", [
  // Technologies, events, localization, Asset files, and other mod items.
]);

const compiled = mod.compile([feature]);
const rendered = render(compiled);

// Build into a project directory:
await write(new URL("../../out/", import.meta.url), rendered);

// Or install for the Stellaris launcher:
await install(rendered);
```

In a real entry point, choose `write` or `install` for the job you are running.

## 1. `createMod`: establish ownership

`createMod` validates the launcher configuration and returns an immutable,
prefix-bound authoring capability. Its methods create definitions, references,
events, localization, Asset files, and Features that belong to that mod.

This step does not assemble or serialize the mod. Definitions remain ordinary
TypeScript values until you place them in a Feature and pass that Feature to
`mod.compile`.

## 2. `mod.compile`: the Fold

`mod.compile(features)` is **the Fold**. It combines the selected Features into
one immutable `PureMod`. Source file layout is not part of the result: Feature
stems, content registries, event namespaces, and localization rules decide the
logical output paths.

The Fold is also the main validation boundary. It refuses a build when it can
prove that the assembled mod is inconsistent, including:

- **Duplicate or colliding ids:** two definitions would compete for one id, an
  event id appears twice, or a new definition would silently replace known
  vanilla content.
- **Dangling references:** a reference that carries this mod's identity names
  no definition or event among the selected Features. A typed Asset file
  reference also fails when no selected Feature places that file.
- **Event namespace collisions:** one output file would mix namespaces, or one
  namespace would be split across multiple file stems.
- **Conflicting path claims:** two producers claim one path, a file and a
  directory need the same path, spellings alias on common filesystems, or a
  claim conflicts with an SDK-reserved or known vanilla path.

These checks happen before serialization and before disk access. A successful
Fold therefore has one owner for every logical output path.

Not every uncertain condition is an error. For example, a raw Asset path that
is neither captured by this build nor known as a vanilla path becomes a warning
because it may come from a DLC, another mod, or a file managed outside the SDK.
Read non-blocking diagnostics from `compiled.warnings`.

## 3. `render`: produce an exact snapshot

`render(compiled)` serializes the `PureMod` into an immutable `RenderedMod`.
The snapshot contains every mod-root-relative output, including PDXScript,
localization, captured Asset bytes, and `descriptor.mod`.

A `RenderedMod` is an iterable collection keyed by logical path. Each
`RenderedFile` says whether it contains text or bytes and exposes its byte
length and SHA-256 digest. The whole snapshot also has a file count and digest.
Use `rendered.text(path)` for text or `rendered.file(path)?.bytes()` for the
exact bytes.

Rendering does not choose an output directory and does not write anything. The
same rendered snapshot can be inspected, tested, written to a build directory,
or installed for the launcher.

## 4. `write` or `install`: materialize the snapshot

Both functions materialize the exact `RenderedMod`, but they target different
places:

| Function | Destination | Launcher descriptor |
| --- | --- | --- |
| `write(outDir, rendered)` | Any output directory you choose | Does not create one |
| `install(rendered, options?)` | The Stellaris launcher mod directory, or `options.modDir` | Creates a sibling `<dirName>.mod` file |

The rendered snapshot already contains the mod's own `descriptor.mod`. That
file lives inside the mod directory and describes the mod. The launcher-side
`<dirName>.mod` file lives beside the installed content directory and adds a
`path="..."` line that points to it. `render` cannot create this second file
because its contents depend on the final install location.

`write` returns the resolved `outDir`; `install` returns both `contentDir` and
`descriptorPath`. Both also report whether anything changed and refuse to
silently replace SDK-owned output that has drifted since the previous run.

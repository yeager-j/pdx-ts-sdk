# Job authoring DX prototype

Throwaway prototype for comparing the generated `mod.job` interface with a
semantic Jobs recipe module. It models a Physicist-like specialist with five
swap targets, conditional local and overlord economy, modifiers, assignment
weight, localization, and a building that adds four positions.

- `physicist.raw.prototype.ts` uses only the current SDK.
- `physicist.proposed.prototype.ts` shows the proposed authoring interface.
- `jobs.stub.prototype.ts` is a local implementation stub. It deliberately
  hides one `unchecked()` call behind the proposed modifier seam and does not
  implement the Fold reference evidence required by SDK-222.
- `compare.prototype.ts` renders both versions and reports whether their output
  is identical.

Run it from the repository root:

```sh
npx tsx packages/sdk/prototypes/job-authoring-dx/compare.prototype.ts
```

This code must not be promoted in place. Its only purpose is to decide which
interface, if any, should be implemented against the canonical generated
`JobDef`, modifier recorder, and Fold.

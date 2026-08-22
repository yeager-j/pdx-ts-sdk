import { describe, expect, it } from "vitest";

import { createMod, PdxSdkError, render, type PureMod } from "../src/index.ts";
import {
  CapturedBytes,
  createRenderedMod,
  renderedFileBytes,
  type RenderedClaim,
} from "../src/output/rendered.ts";

const capability = createMod({
  name: "Rendered Probe",
  prefix: "rendered_probe",
  supportedVersion: "4.4.*",
});
const compiled = capability.compile([
  capability.feature("probe", [
    capability.technology("marker", {
      name: "Marker",
      cost: 1,
      area: "physics",
      tier: 1,
      category: "particles",
    }),
  ]),
]);

describe("RenderedMod", () => {
  it("owns immutable hash-identified artifacts in canonical path order", () => {
    const rendered = render(compiled);
    const paths = [...rendered.values()].map((file) => file.path);
    expect(paths).toEqual([...paths].sort());
    expect(rendered.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(rendered)).toBe(true);

    const file = rendered.file("common/technology/rendered_probe_probe.txt")!;
    expect(Object.isFrozen(file)).toBe(true);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    const bytes = file.bytes();
    bytes[0] = 0;
    expect(file.bytes()[0]).not.toBe(0);
  });

  it("refuses to build two files for one path", () => {
    // Path ownership is adjudicated in the fold; what survives here is the one
    // invariant this object cannot hold without. A duplicate would leave `size`
    // over-counting, the hash folding the path twice, and the tree writer
    // writing it twice with the second silently winning.
    expect(() =>
      createRenderedMod("rendered_probe", "", [
        { path: "gfx/blob.bin", text: "a" },
        { path: "gfx/blob.bin", text: "b" },
      ])
    ).toThrow(TypeError);
  });

  it("refuses to serialize a path the ledger never adjudicated", () => {
    // The other half of moving adjudication into the fold: a channel that
    // emitted an unadjudicated file would reopen exactly the hole the ledger
    // closes, and the damage would show up as a stale mod directory rather
    // than as an error.
    const forged = { ...compiled, paths: compiled.paths.slice(1) } as PureMod;
    expect(() => render(forged)).toThrow(PdxSdkError);
    // A throw caches nothing: the same forged mod throws again, and a valid
    // mod renders as if the failed attempt never happened.
    expect(() => render(forged)).toThrow(PdxSdkError);
    expect(() => render(compiled)).not.toThrow();
  });

  it("returns the same RenderedMod for repeated renders of an assetless mod", () => {
    const first = render(compiled);
    const second = render(compiled);
    expect(second).toBe(first);
    expect(second.sha256).toBe(first.sha256);
    expect([...second.values()].map((file) => file.path)).toEqual(
      [...first.values()].map((file) => file.path)
    );
  });
});

describe("a rendered file's bytes", () => {
  const BLOB = "gfx/blob.bin";

  function withClaim(claim: Omit<RenderedClaim, "path">) {
    return createRenderedMod("rendered_probe", "", [{ path: BLOB, ...claim }]).file(BLOB)!;
  }

  it("copies a plain byte claim, so a later mutation cannot rewrite content", () => {
    // The hash is taken once, at construction. A caller who keeps their array
    // and edits it would otherwise change what the file serves under a hash
    // that no longer describes it.
    const source = new Uint8Array([1, 2, 3]);
    const file = withClaim({ bytes: source });

    source[0] = 9;

    expect([...file.bytes()]).toEqual([1, 2, 3]);
    expect(file.byteLength).toBe(3);
  });

  it("adopts captured bytes without copying them", () => {
    // The write path hands the buffer straight to `writeFile`. Copying every
    // captured artifact on the way in would double the memory an asset costs
    // for a guarantee the capture side already gives by not retaining it.
    const source = new Uint8Array([1, 2, 3]);
    const file = withClaim({ captured: new CapturedBytes(source) });

    expect(file.kind).toBe("bytes");
    expect(renderedFileBytes(file).buffer).toBe(source.buffer);
    const handed = file.bytes();
    handed[0] = 9;
    expect(file.bytes()[0]).toBe(1);
  });

  it("adopts a captured view at its own offset and length", () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5]);
    const view = backing.subarray(1, 4);

    const file = withClaim({ captured: new CapturedBytes(view) });

    expect(renderedFileBytes(file).buffer).toBe(backing.buffer);
    expect(renderedFileBytes(file).byteOffset).toBe(view.byteOffset);
    expect(file.byteLength).toBe(3);
    expect([...file.bytes()]).toEqual([2, 3, 4]);
  });

  it("adopts a captured Buffer as a plain view, keeping the defensive copy", () => {
    // A capture producer that read a file hands over a `Buffer`, whose `slice`
    // returns a shared window rather than a copy. Stored as-is, `bytes()` would
    // dispatch to it and let a caller rewrite content already hashed.
    const source = Buffer.from([1, 2, 3]);
    const file = withClaim({ captured: new CapturedBytes(source) });

    const handed = file.bytes();
    handed[0] = 9;
    expect(file.bytes()[0]).toBe(1);
    // And the adoption is still zero-copy: one write through the original
    // buffer is visible to the write path, which never copies either.
    expect(renderedFileBytes(file).buffer).toBe(source.buffer);
    source[0] = 7;
    expect(renderedFileBytes(file)[0]).toBe(7);
  });

  it("lets exactly one rendered file own a captured buffer", () => {
    const captured = new CapturedBytes(new Uint8Array([1]));
    withClaim({ captured });

    expect(() => withClaim({ captured })).toThrow(TypeError);
  });

  it.each([
    ["nothing", {}],
    ["text and bytes", { text: "x", bytes: new Uint8Array([1]) }],
    ["text and captured", { text: "x", captured: new CapturedBytes(new Uint8Array([1])) }],
    [
      "bytes and captured",
      { bytes: new Uint8Array([1]), captured: new CapturedBytes(new Uint8Array([1])) },
    ],
  ])("rejects a claim carrying %s", (_label, claim) => {
    expect(() => withClaim(claim)).toThrow(TypeError);
  });
});

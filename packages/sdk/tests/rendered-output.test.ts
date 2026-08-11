import { describe, expect, it } from "vitest";

import type { ContentFile } from "../src/compiler/model.ts";
import { createMod, PathOwnershipError, render, type PureMod } from "../src/index.ts";

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

  it.each([
    ["duplicate", "common/technology/rendered_probe_probe.txt"],
    ["portable alias", "COMMON/technology/rendered_probe_probe.txt"],
    ["file-directory conflict", "common"],
    ["reserved manifest", ".pdx-sdk-manifest.json"],
  ])("rejects a %s before any sink sees it", (_label, relPath) => {
    const first = compiled.contentFiles[0]!;
    const forgedFile: ContentFile = { ...first, relPath };
    const forged = { ...compiled, contentFiles: [...compiled.contentFiles, forgedFile] } as PureMod;
    expect(() => render(forged)).toThrow(PathOwnershipError);
  });

  it("reports ownership conflicts independently of claim order", () => {
    const first = compiled.contentFiles[0]!;
    const alias: ContentFile = { ...first, relPath: first.relPath.toUpperCase() };
    const forward = { ...compiled, contentFiles: [first, alias] } as PureMod;
    const backward = { ...compiled, contentFiles: [alias, first] } as PureMod;

    const conflicts = (candidate: PureMod) => {
      try {
        render(candidate);
      } catch (error) {
        return (error as PathOwnershipError).conflicts;
      }
      throw new Error("expected a path ownership conflict");
    };

    expect(conflicts(backward)).toEqual(conflicts(forward));
  });
});

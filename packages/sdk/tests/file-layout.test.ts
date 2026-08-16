/**
 * The two places the fold reads a registry's declared file layout.
 *
 * Unit-measured here, and end-to-end in `content.test.ts` since `spriteType`,
 * `pdxmesh` and `pdxparticle` became real `.gfx` registries with a root
 * envelope. Both levels are worth keeping: these two witness the descriptor's
 * layout reaching the emitted path and the emitted entries for any registry,
 * including the extensions and envelopes no manifested registry declares.
 */

import { describe, expect, it } from "vitest";

import { emissionPath, fileRootEnvelope } from "../src/compiler/compile.ts";
import { normalizeLogicalPath } from "../src/ordering.ts";

describe("minting a content file's path", () => {
  it("uses the registry's declared extension", () => {
    expect(emissionPath("mymod", "gfx/interface/icons", "icons", ".gfx")).toBe(
      "gfx/interface/icons/mymod_icons.gfx"
    );
  });

  it("keeps the ordinary `.txt` shape unchanged", () => {
    expect(emissionPath("mymod", "common/technology", "technology", ".txt")).toBe(
      "common/technology/mymod_technology.txt"
    );
  });
});

describe("deciding a content file's root block", () => {
  const path = normalizeLogicalPath("gfx/interface/icons/mymod_icons.gfx");
  const envelopes = new Map([
    ["sprite", "spriteTypes"],
    ["corner_sprite", "spriteTypes"],
    ["technology", undefined],
  ]);
  const envelopeOf = (type: string): string | undefined => envelopes.get(type);

  it("states no block for a file of registries that declare none", () => {
    expect(fileRootEnvelope(path, ["technology"], envelopeOf)).toBeUndefined();
  });

  it("states the shared block for registries that agree on one", () => {
    expect(fileRootEnvelope(path, ["sprite", "corner_sprite"], envelopeOf)).toBe("spriteTypes");
  });

  it("refuses a file whose registries disagree, naming the path and both types", () => {
    expect(() => fileRootEnvelope(path, ["sprite", "technology"], envelopeOf)).toThrow(
      /gfx\/interface\/icons\/mymod_icons\.gfx.*"sprite".*"spriteTypes".*"technology".*no root block/s
    );
  });
});

/**
 * The two places the fold reads a registry's declared file layout.
 *
 * Both are unit-measured because no manifested registry declares a layout other
 * than the default yet: the first registry whose files are `.gfx` and whose
 * definitions sit inside a root block arrives with its own end-to-end evidence,
 * and until then these are the only witnesses that the descriptor's layout
 * reaches the emitted path and the emitted entries at all.
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

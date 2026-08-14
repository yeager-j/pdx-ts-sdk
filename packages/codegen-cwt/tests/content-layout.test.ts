/**
 * The layout half of a generated registry descriptor.
 *
 * Measured against synthetic types rather than against the vendored rules: no
 * manifested registry declares `path_extension` or `skip_root_key` today, so
 * the vendored corpus can only witness the `.txt` default, and the two branches
 * that matter for a `.gfx` registry would otherwise go unread until one is
 * manifested.
 */

import { contentFileLayout } from "@pdx-ts/codegen-cwt/content-layout";
import type { ContentType } from "@pdx-ts/codegen-cwt/cwt/rules";
import { describe, expect, it } from "vitest";

function syntheticType(layout: Partial<ContentType>): ContentType {
  return {
    name: "sprite",
    path: "game/gfx/interface/icons",
    nameField: "name",
    keyFilter: null,
    subtypes: [],
    localisation: [],
    ...layout,
  };
}

describe("a registry's declared file layout", () => {
  it("defaults to the game's `.txt` when the rules declare no path_extension", () => {
    expect(contentFileLayout("technology", syntheticType({}))).toEqual({ fileExtension: ".txt" });
  });

  it("carries the declared extension and the single concrete root key", () => {
    const layout = contentFileLayout(
      "sprite",
      syntheticType({ pathExtension: ".gfx", skipRootKeys: ["spriteTypes"] })
    );
    expect(layout).toEqual({ fileExtension: ".gfx", rootEnvelope: "spriteTypes" });
  });

  it("states no envelope when the type declares no skip_root_key", () => {
    const layout = contentFileLayout("sound", syntheticType({ pathExtension: ".asset" }));
    expect(layout.rootEnvelope).toBeUndefined();
  });

  it("refuses `skip_root_key = any`, which names no one block to write", () => {
    expect(() =>
      contentFileLayout("swapped_ascension_perk", syntheticType({ skipRootKeys: ["any"] }))
    ).toThrow(/names no single concrete root block/);
  });

  // The block form is a descent path, so two segments means the definitions
  // sit inside another definition — `swapped_job`'s `{ any swappable_data }` is
  // any job id, then that job's `swappable_data` block. There is no file-level
  // wrapper there for the fold to write.
  it("refuses a path deeper than one segment, which names no file-level envelope", () => {
    expect(() =>
      contentFileLayout("swapped_job", syntheticType({ skipRootKeys: ["any", "swappable_data"] }))
    ).toThrow(/names no single concrete root block/);
  });

  it("refuses a deep path of concrete segments too", () => {
    expect(() =>
      contentFileLayout("sprite", syntheticType({ skipRootKeys: ["spriteTypes", "objectTypes"] }))
    ).toThrow(/names no single concrete root block/);
  });
});

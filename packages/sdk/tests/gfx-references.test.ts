/**
 * GFX references and asset paths (SDK-121, the second half of SDK-176).
 *
 * Two rules meet here, and both are measured falsification-first. The sprite
 * dangling-reference rule refuses a name that carries this mod's prefix and
 * resolves to nothing — after exempting names that are simply vanilla's — so
 * every acceptance below is a case containment alone would have rejected. The
 * asset-path rule refuses only what it can prove (an `AssetFileItem` no Feature
 * places) and warns about everything it merely cannot confirm.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { contentDescriptor } from "../src/content/descriptors.ts";
import { createMod, render, type AssetFileItem, type ModWarning } from "../src/index.ts";

const temps: string[] = [];

afterEach(() => {
  for (const directory of temps.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function gfxMod<const P extends string>(prefix: P) {
  return createMod({ name: "GFX references", prefix, supportedVersion: "4.4.*" });
}

/** One captured Asset, from a real file, at the logical path the caller names. */
function assetAt(capability: ReturnType<typeof gfxMod>, path: string): AssetFileItem {
  const directory = mkdtempSync(join(tmpdir(), "pdx-gfx-refs-"));
  temps.push(directory);
  const source = join(directory, "blob.dds");
  writeFileSync(source, Buffer.from([1, 2, 3]));
  return capability.assetFile({ source, path });
}

function assetPathWarnings(warnings: readonly ModWarning[]) {
  return warnings.filter((warning) => warning.code === "unverified-asset-path");
}

describe("sprite dangling references", () => {
  it("accepts a reference that is exactly a vanilla sprite name", () => {
    // The amendment this ordering exists for. The prefix `ui` occurs inside
    // vanilla's own `GFX_astral_rift_ui_icon` as a whole `_`-delimited
    // segment, so containment alone reads this vanilla reference as one of
    // this mod's and demands a definition that could never exist. The exact
    // match is asked first, so it never gets that far.
    const mod = gfxMod("ui");
    expect(`_GFX_astral_rift_ui_icon_`).toContain("_ui_");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.spriteType("panel", {
          textureFile: "gfx/a.dds",
          parent: "GFX_astral_rift_ui_icon",
        }),
      ]),
    ]);
    expect(render(pure).get("interface/ui_sprites.gfx")).toContain(
      "parent = GFX_astral_rift_ui_icon"
    );
  });

  it("refuses a contained reference this build does not define", () => {
    const mod = gfxMod("council");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [
          mod.spriteType("panel", { textureFile: "gfx/a.dds", parent: "GFX_council_missing" }),
        ]),
      ])
    ).toThrow(
      /references sprite "GFX_council_missing" in "parent".*contains this mod's prefix "council" as a "_"-delimited name segment and matches no vanilla sprite/s
    );
  });

  it("accepts the same reference once the sprite is defined", () => {
    // The negative control for the refusal above: nothing changes but the
    // presence of the definition.
    const mod = gfxMod("council");
    const target = mod.spriteType("missing", { textureFile: "gfx/a.dds" });
    expect(target.id).toBe("GFX_council_missing");
    const pure = mod.compile([
      mod.feature(undefined, [
        target,
        mod.spriteType("panel", { textureFile: "gfx/a.dds", parent: target }),
      ]),
    ]);
    expect(render(pure).get("interface/council_sprites.gfx")).toContain(
      "parent = GFX_council_missing"
    );
  });

  it("resolves a shape-minted name through containment rather than a leading prefix", () => {
    // `GFX_text_council_icon` does not *start* with the prefix — the shape's
    // own literal does — which is exactly the case the old `startsWith` rule
    // could not see, in either direction: it would neither find the definition
    // nor demand one.
    const mod = gfxMod("council");
    const icon = mod.spriteTextIcon("icon", { textureFile: "gfx/a.dds" });
    expect(icon.id).toBe("GFX_text_council_icon");
    const pure = mod.compile([
      mod.feature(undefined, [
        icon,
        mod.spriteType("panel", { textureFile: "gfx/a.dds", parent: icon }),
      ]),
    ]);
    expect(render(pure).get("interface/council_sprites.gfx")).toContain(
      "parent = GFX_text_council_icon"
    );
  });

  it("refuses a shape-minted name that is contained but undefined", () => {
    const mod = gfxMod("council");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [
          mod.spriteType("panel", { textureFile: "gfx/a.dds", parent: "GFX_text_council_icon" }),
        ]),
      ])
    ).toThrow(/no such sprite is among the features passed to buildMod/);
  });

  it("passes an assumed third-party reference through in silence", () => {
    const mod = gfxMod("council");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.spriteType("panel", { textureFile: "gfx/a.dds", parent: "GFX_othermod_icon" }),
      ]),
    ]);
    expect(render(pure).get("interface/council_sprites.gfx")).toContain(
      "parent = GFX_othermod_icon"
    );
  });

  it("does not read a prefix that is only part of a segment as containment", () => {
    // `council` inside `councilx` is not a `_`-delimited segment, which is what
    // the `_`-padding buys: no regex, no start/end special cases.
    const mod = gfxMod("council");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.spriteType("panel", { textureFile: "gfx/a.dds", parent: "GFX_councilx_icon" }),
      ]),
    ]);
    expect(render(pure).get("interface/council_sprites.gfx")).toContain(
      "parent = GFX_councilx_icon"
    );
  });

  it("leaves `pdxparticle.type` outside the guard entirely", () => {
    // A `<particle_type>` resolves to no SDK registry, so a value carrying the
    // prefix in every position the sprite rule looks at still writes through
    // untouched. No code does this; the absence of a registry does.
    const mod = gfxMod("council");
    const pure = mod.compile([
      mod.feature(undefined, [mod.pdxparticle("dust", { type: "council_missing_particle" })]),
    ]);
    expect(render(pure).get("gfx/particles/council_particles.gfx")).toContain(
      "type = council_missing_particle"
    );
  });
});

describe("the head-less registries", () => {
  it("leaves mesh and particle on the plain prefix rule", () => {
    // Which rule applies is read off `mintHead` and nothing else, so this is
    // the whole gate. Neither registry is reachable behaviourally: no
    // generated field references a `<model_mesh>` or a `<particle>` — those
    // ids are named from `.asset` files the SDK carries as opaque Assets — so
    // the descriptors are where the claim can be measured.
    expect(contentDescriptor("spriteType")?.mintHead).toBe("GFX_");
    expect(contentDescriptor("pdxmesh")?.mintHead).toBeUndefined();
    expect(contentDescriptor("pdxparticle")?.mintHead).toBeUndefined();
  });

  it("still refuses an own-prefixed reference nothing defines, with the old wording", () => {
    // The rule the mint-headed path had to leave alone, exercised through a
    // registry that has both a reference field and no mint head.
    const mod = gfxMod("hulls");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [
          mod.technology("dependent", {
            name: "Dependent",
            cost: 1000,
            area: "physics",
            tier: 2,
            category: "particles",
            prerequisites: ["hulls_tech_orphan"],
          }),
        ]),
      ])
    ).toThrow(/the id carries this mod's prefix "hulls_"/);
  });
});

describe("asset paths", () => {
  it("lowers a placed Asset to its declared logical path", () => {
    const mod = gfxMod("icons");
    const asset = assetAt(mod, "gfx/interface/icons/council.dds");
    const pure = mod.compile([
      mod.feature(undefined, [asset, mod.spriteType("council", { textureFile: asset })]),
    ]);
    expect(render(pure).get("interface/icons_sprites.gfx")).toContain(
      "textureFile = gfx/interface/icons/council.dds"
    );
    expect(assetPathWarnings(pure.warnings)).toEqual([]);
  });

  it("refuses an Asset that no Feature places", () => {
    // The one asset-path failure that is provable: the file will not be in the
    // mod, and the definition names it anyway.
    const mod = gfxMod("icons");
    const asset = assetAt(mod, "gfx/interface/icons/orphan.dds");
    expect(() =>
      mod.compile([mod.feature(undefined, [mod.spriteType("council", { textureFile: asset })])])
    ).toThrow(
      /spriteType "GFX_icons_council" references the Asset file "gfx\/interface\/icons\/orphan.dds" in "textureFile", but no Feature passed to buildMod places it/
    );
  });

  it("says nothing about a raw string naming a captured path", () => {
    // Same path as the Item case, written as a string. The check is on the
    // path, not on which arm the author reached for.
    const mod = gfxMod("icons");
    const asset = assetAt(mod, "gfx/interface/icons/council.dds");
    const pure = mod.compile([
      mod.feature(undefined, [
        asset,
        mod.spriteType("council", { textureFile: "gfx/interface/icons/council.dds" }),
      ]),
    ]);
    expect(assetPathWarnings(pure.warnings)).toEqual([]);
  });

  it("says nothing about a raw string naming a vanilla file", () => {
    const mod = gfxMod("icons");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.spriteType("council", { textureFile: "gfx/interface/icons/resources/energy.dds" }),
      ]),
    ]);
    expect(assetPathWarnings(pure.warnings)).toEqual([]);
  });

  it("warns, with the path, field and owner, about a path it cannot account for", () => {
    const mod = gfxMod("icons");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.spriteType("council", { textureFile: "gfx/interface/icons/nowhere.dds" }),
      ]),
    ]);
    expect(assetPathWarnings(pure.warnings)).toEqual([
      {
        code: "unverified-asset-path",
        message: expect.stringContaining("gfx/interface/icons/nowhere.dds"),
        path: "gfx/interface/icons/nowhere.dds",
        field: "textureFile",
        owner: 'spriteType "GFX_icons_council"',
      },
    ]);
  });

  it("names a nested field by its whole path", () => {
    const mod = gfxMod("icons");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.spriteType("council", {
          textureFile: "gfx/interface/icons/nowhere.dds",
          animation: [{ animationmaskfile: "gfx/interface/icons/mask.dds" }],
        }),
      ]),
    ]);
    expect(assetPathWarnings(pure.warnings).map((warning) => warning.field)).toEqual([
      "textureFile",
      "animation.animationmaskfile",
    ]);
  });

  it("warns rather than crashing on a string that will not normalize", () => {
    const mod = gfxMod("icons");
    const pure = mod.compile([
      mod.feature(undefined, [mod.spriteType("council", { textureFile: "../outside.dds" })]),
    ]);
    expect(assetPathWarnings(pure.warnings)).toEqual([
      expect.objectContaining({ path: "../outside.dds", field: "textureFile" }),
    ]);
    expect(render(pure).get("interface/icons_sprites.gfx")).toContain(
      "textureFile = ../outside.dds"
    );
  });

  it("warns once per occurrence of a repeated member, in authored order", () => {
    // `animation` is the repeated member the three GFX registries actually
    // generate — the pdxparticle registry emits only `type` and `scale`, so
    // there is no `subsystem` to repeat. Order is the author's, which is what
    // makes the two warnings tellable apart.
    const mod = gfxMod("icons");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.spriteType("council", {
          textureFile: "gfx/interface/icons/council.dds",
          animation: [
            { animationmaskfile: "gfx/first.dds" },
            { animationmaskfile: "gfx/second.dds" },
          ],
        }),
      ]),
    ]);
    expect(assetPathWarnings(pure.warnings).map((warning) => warning.path)).toEqual([
      "gfx/interface/icons/council.dds",
      "gfx/first.dds",
      "gfx/second.dds",
    ]);
    const emitted = render(pure).get("interface/icons_sprites.gfx")!;
    expect(emitted.indexOf("gfx/first.dds")).toBeLessThan(emitted.indexOf("gfx/second.dds"));
  });

  it("checks a pdxmesh file the same way", () => {
    const mod = gfxMod("hulls");
    const asset = assetAt(mod, "gfx/models/hulls/frigate.mesh");
    const pure = mod.compile([
      mod.feature(undefined, [asset, mod.pdxmesh("frigate", { file: asset })]),
    ]);
    expect(render(pure).get("gfx/models/hulls_meshes.gfx")).toContain(
      "file = gfx/models/hulls/frigate.mesh"
    );
    expect(assetPathWarnings(pure.warnings)).toEqual([]);
  });
});

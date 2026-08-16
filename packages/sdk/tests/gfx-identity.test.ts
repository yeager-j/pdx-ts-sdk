/**
 * GFX identity, placement and refusal (SDK-121).
 *
 * Written falsification-first: every rule this slice adds is a rule that
 * *refuses* something, so each is measured by the build that must fail, and the
 * neighbouring build that must not. `content.test.ts` carries the goldens for
 * what a passing build emits; this carries the edges around them.
 */

import { describe, expect, it } from "vitest";

import { createFeature } from "../src/authoring/feature.ts";
import { buildMod } from "../src/compiler/compile.ts";
import { always, createMod, render } from "../src/index.ts";

function gfxMod<const P extends string>(prefix: P) {
  return createMod({ name: "GFX identity", prefix, supportedVersion: "4.4.*" });
}

describe("minted GFX names", () => {
  it("refuses two sprites minting the same name", () => {
    const mod = gfxMod("dup_sprite");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [
          mod.spriteType("icon", { textureFile: "gfx/a.dds" }),
          mod.spriteType("icon", { textureFile: "gfx/b.dds" }),
        ]),
      ])
    ).toThrow(/Duplicate spriteType id "GFX_dup_sprite_icon"/);
  });

  it("refuses a default mint and a shape mint that land on one name", () => {
    // The shapes do not partition the name space, and nothing pretends they
    // do: with the prefix `text`, `spriteType("text_icon")` mints
    // `GFX_text_text_icon` and `spriteTextIcon("icon")` mints the very same
    // name. It is the final name that has to be unique, and it is the final
    // name the duplicate check sees.
    const mod = gfxMod("text");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [
          mod.spriteType("text_icon", { textureFile: "gfx/a.dds" }),
          mod.spriteTextIcon("icon", { textureFile: "gfx/b.dds" }),
        ]),
      ])
    ).toThrow(/Duplicate spriteType id "GFX_text_text_icon"/);
  });

  it("accepts a mesh and a particle sharing one minted name", () => {
    // Contract: no cross-family duplicate check. It holds by construction —
    // the two registries emit to different directories, so the game never
    // merges them — and this is the build that proves the SDK does not invent
    // a check the contract says it must not have.
    const mod = gfxMod("shared_name");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.pdxmesh("hull", { file: "gfx/models/x.mesh" }),
        mod.pdxparticle("hull", { type: "x_particle" }),
      ]),
    ]);
    const files = render(pure);
    expect(files.has("gfx/models/shared_name_meshes.gfx")).toBe(true);
    expect(files.has("gfx/particles/shared_name_particles.gfx")).toBe(true);
    // The mesh's `file` path is nothing this build captures, so it warns; that
    // is the asset-path check doing its job and not a duplicate complaint.
    expect(pure.warnings.map((warning) => warning.code)).toEqual(["unverified-asset-path"]);
  });
});

describe("exact-name identity (SDK-183)", () => {
  it("accepts interior uppercase in a mesh or particle logical name", () => {
    // Mesh and particle names are raw engine labels referenced verbatim from
    // `.asset` files, so their charset is the engine's, not the SDK's stem
    // rule. The leading letter stays lowercase: the widened rule is interior.
    const mod = gfxMod("acme");
    const mesh = mod.pdxmesh("tracer_M1S1_mesh", { file: "gfx/models/x.mesh" });
    const particle = mod.pdxparticle("flash_M1S1", { type: "x_particle" });
    expect(mesh.id).toBe("acme_tracer_M1S1_mesh");
    expect(particle.id).toBe("acme_flash_M1S1");
    expect(() => mod.pdxmesh("M1S1_mesh", { file: "gfx/models/x.mesh" })).toThrow(
      /led by a lowercase letter/
    );
  });

  it("keeps every other registry on the lowercase stem rule", () => {
    // Negative control for the widening: the charset is per-registry data,
    // so a sprite (the nearest GFX neighbour) and a segmented registry both
    // still refuse what the two asset-label registries accept.
    const mod = gfxMod("acme");
    expect(() => mod.spriteType("icon_M1S1", { textureFile: "gfx/a.dds" })).toThrow(
      /must be lowercase snake_case/
    );
    expect(() => mod.technology("laser_M1", {} as never)).toThrow(/must be lowercase snake_case/);
  });

  it("accepts an exact name carrying the prefix at the head, inside, and at the tail", () => {
    const mod = gfxMod("acme");
    const head = mod.pdxmesh(
      "acme_hull_MK2_mesh",
      { file: "gfx/models/x.mesh" },
      {
        prefix: false,
      }
    );
    const interior = mod.pdxparticle(
      "small_acme_flash_particle",
      { type: "x_particle" },
      {
        prefix: false,
      }
    );
    const tail = mod.pdxmesh("Turret_acme", { file: "gfx/models/y.mesh" }, { prefix: false });
    expect(head.id).toBe("acme_hull_MK2_mesh");
    expect(interior.id).toBe("small_acme_flash_particle");
    expect(tail.id).toBe("Turret_acme");
    // An explicit `prefix: true` is the default mint, spelled out.
    expect(mod.pdxmesh("hull", { file: "gfx/models/z.mesh" }, { prefix: true }).id).toBe(
      "acme_hull"
    );
  });

  it("refuses an exact name that does not carry the prefix as a segment", () => {
    // `prefix: false` opts out of the prepend, never of the prefix: a name
    // with no `_`-delimited prefix segment is unownable, and so is the bare
    // prefix alone or a run-on containment that is not a whole segment.
    const mod = gfxMod("acme");
    expect(() =>
      mod.pdxmesh("small_flash_mesh" as never, { file: "gfx/models/x.mesh" }, { prefix: false })
    ).toThrow(/must carry the mod prefix "acme" as a "_"-delimited segment/);
    expect(() =>
      mod.pdxmesh("acme" as never, { file: "gfx/models/x.mesh" }, { prefix: false })
    ).toThrow(/must carry the mod prefix "acme" as a "_"-delimited segment/);
    expect(() =>
      mod.pdxparticle("acmeX_flash" as never, { type: "x_particle" }, { prefix: false })
    ).toThrow(/must carry the mod prefix "acme" as a "_"-delimited segment/);
    expect(() =>
      mod.pdxmesh("acme mesh" as never, { file: "gfx/models/x.mesh" }, { prefix: false })
    ).toThrow(/must be one bare word/);
  });

  it("refuses an exact name that lands on a real vanilla mesh name", () => {
    // The same packaged-evidence refusal the default mint gets: the prefix
    // `background` sits inside vanilla's `AI_background_details_mesh` as a
    // whole segment, so the exact name is spellable — and still refused.
    const mod = gfxMod("background");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [
          mod.pdxmesh(
            "AI_background_details_mesh",
            { file: "gfx/models/x.mesh" },
            {
              prefix: false,
            }
          ),
        ]),
      ])
    ).toThrow(
      /pdxmesh name "AI_background_details_mesh" collides with a vanilla pdxmesh of the same name/
    );
  });

  it("refuses a default mint and an exact name that land on one id", () => {
    // The two paths share one namespace: it is the final id the duplicate
    // check sees, however it was spelled.
    const mod = gfxMod("acme");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [
          mod.pdxmesh("hull", { file: "gfx/models/x.mesh" }),
          mod.pdxmesh("acme_hull", { file: "gfx/models/y.mesh" }, { prefix: false }),
        ]),
      ])
    ).toThrow(/Duplicate pdxmesh id "acme_hull"/);
  });

  it("places and emits an exact name without a missing-prefix warning", () => {
    const mod = gfxMod("acme");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.pdxparticle("small_acme_flash_particle", { type: "x_particle" }, { prefix: false }),
      ]),
    ]);
    expect(pure.warnings).toEqual([]);
    expect(render(pure).get("gfx/particles/acme_particles.gfx")).toContain(
      "name = small_acme_flash_particle"
    );
  });

  it("keeps the ownership check through the direct buildMod door", () => {
    // `mod.feature` is not the only entrance; the fold measures the same
    // segment containment, so the exact name raises no complaint there either.
    const mod = gfxMod("acme");
    const particle = mod.pdxparticle(
      "small_acme_flash_particle",
      { type: "x_particle" },
      {
        prefix: false,
      }
    );
    const pure = buildMod(mod.config, [createFeature(undefined, [particle])]);
    expect(pure.warnings).toEqual([]);
  });

  it("refuses an exact name placed in another capability's feature", () => {
    // The recorded mint is the ownership evidence, exactly as for a shape
    // mint: the record names the minting capability, so placement refuses a
    // foreign one before any string is measured.
    const first = gfxMod("first_mod");
    const second = gfxMod("second_mod");
    const particle = first.pdxparticle(
      "small_first_mod_flash",
      { type: "x_particle" },
      {
        prefix: false,
      }
    );
    expect(() => second.feature(undefined, [particle])).toThrow(
      /exact-name pdxparticle "small_first_mod_flash" was minted by a different capability — the one for mod prefix "first_mod", not this one for "second_mod"/
    );
  });

  it("refuses a foreign exact name even when it carries the placing mod's prefix too", () => {
    // A name can carry two mods' prefixes as segments, so containment alone
    // would let either capability claim it. The record cannot: it names one
    // capability, and only that one places the item.
    const first = gfxMod("first_mod");
    const second = gfxMod("second_mod");
    const particle = first.pdxparticle(
      "second_mod_first_mod_flash",
      { type: "x_particle" },
      {
        prefix: false,
      }
    );
    expect(() => second.feature(undefined, [particle])).toThrow(
      /exact-name pdxparticle "second_mod_first_mod_flash" was minted by a different capability — the one for mod prefix "first_mod", not this one for "second_mod"/
    );
    // The rightful owner still places and compiles the very same item.
    const pure = first.compile([first.feature(undefined, [particle])]);
    expect(pure.warnings).toEqual([]);
    expect(render(pure).get("gfx/particles/first_mod_particles.gfx")).toContain(
      "name = second_mod_first_mod_flash"
    );
  });

  it("measures a record-less copy by its name, like any hand-built item", () => {
    // Spreading an item makes a new object the module-private table has never
    // seen, so the string is the only evidence left — the same fallback a
    // forged shape-mint provenance gets. Containment still refuses a name
    // with no segment of the placing mod's prefix, and still cannot tell two
    // prefixes apart, which is exactly why the record exists for real mints.
    const first = gfxMod("first_mod");
    const second = gfxMod("second_mod");
    const particle = first.pdxparticle(
      "small_first_mod_flash",
      { type: "x_particle" },
      {
        prefix: false,
      }
    );
    expect(() => second.feature(undefined, [{ ...particle }])).toThrow(
      /Content id "small_first_mod_flash" does not belong to mod prefix "second_mod"/
    );
  });
});

describe("vanilla-name collision", () => {
  it("refuses a sprite whose mint lands on a real vanilla sprite name", () => {
    // `GFX_evt_ship_in_orbit` is a vanilla sprite, and the prefix `evt` plus
    // the name `ship_in_orbit` mints exactly it. The evidence is the packaged
    // id set, not a loaded view: nothing in this build parsed vanilla.
    const mod = gfxMod("evt");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [mod.spriteType("ship_in_orbit", { textureFile: "gfx/a.dds" })]),
      ])
    ).toThrow(
      /spriteType name "GFX_evt_ship_in_orbit" collides with a vanilla spriteType of the same name/
    );
  });

  it("says overriding is out of scope rather than offering a patch", () => {
    // The loaded-view refusal next to it ends "patch it instead". There is no
    // GFX patch surface and deliberate shadow-override is ruled out (SDK-125),
    // so this one must not send an author looking for one.
    const mod = gfxMod("evt");
    let message = "";
    try {
      mod.compile([
        mod.feature(undefined, [mod.spriteType("ship_in_orbit", { textureFile: "gfx/a.dds" })]),
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(
      /overriding a vanilla spriteType is out of scope; mint a different name/
    );
    expect(message).not.toMatch(/patch it instead/);
  });

  it("refuses a mesh whose bare mint lands on a real vanilla mesh name", () => {
    // The segmentless mesh mint is what makes this reachable at all: with a
    // registry segment, `abandoned_pdxmesh_ship_mesh` could never be vanilla's.
    const mod = gfxMod("abandoned");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [mod.pdxmesh("ship_mesh", { file: "gfx/models/x.mesh" })]),
      ])
    ).toThrow(
      /pdxmesh name "abandoned_ship_mesh" collides with a vanilla pdxmesh of the same name/
    );
  });

  it("leaves a near miss alone", () => {
    // Negative control for the refusal above: one character off the vanilla
    // name and the same build succeeds, so the check is matching the id rather
    // than the registry.
    const mod = gfxMod("abandoned");
    const pure = mod.compile([
      mod.feature(undefined, [mod.pdxmesh("ship_mesh_2", { file: "gfx/models/x.mesh" })]),
    ]);
    expect(render(pure).has("gfx/models/abandoned_meshes.gfx")).toBe(true);
  });
});

describe("canonical placement", () => {
  it("writes each registry to its canonical stem", () => {
    const mod = gfxMod("stems");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.spriteType("icon", { textureFile: "gfx/a.dds" }),
        mod.pdxmesh("hull", { file: "gfx/models/x.mesh" }),
        mod.pdxparticle("dust", { type: "x_particle" }),
      ]),
    ]);
    expect([...render(pure).keys()]).toEqual(
      expect.arrayContaining([
        "interface/stems_sprites.gfx",
        "gfx/models/stems_meshes.gfx",
        "gfx/particles/stems_particles.gfx",
      ])
    );
  });

  it("composes a Feature stem the same way `common/` does", () => {
    const mod = gfxMod("stems");
    const pure = mod.compile([
      mod.feature("councils", [
        mod.spriteType("icon", { textureFile: "gfx/a.dds" }),
        mod.pdxmesh("hull", { file: "gfx/models/x.mesh" }),
        mod.pdxparticle("dust", { type: "x_particle" }),
      ]),
    ]);
    expect([...render(pure).keys()]).toEqual(
      expect.arrayContaining([
        "interface/stems_councils.gfx",
        "gfx/models/stems_councils.gfx",
        "gfx/particles/stems_councils.gfx",
      ])
    );
  });
});

describe("shape mints", () => {
  it("mints from a typed target, a raw string, and the selected variant", () => {
    const mod = gfxMod("shapes");
    const stance = mod.bombardmentStance("scorched", {
      name: "Scorched",
      desc: "Scorched.",
      trigger: always(),
      default: false,
      aiWeight: { base: 1 },
    });
    const owned = mod.spriteFleetOrderButtonGroundSupport(stance, { textureFile: "gfx/a.dds" });
    // A stance this build does not contain — a vanilla one, or another mod's.
    // The mint carries no mod prefix at all, which is the case the string
    // ownership test cannot hold and the provenance can.
    const foreign = mod.spriteFleetOrderButtonGroundSupport("indiscriminate_bombardment", {
      textureFile: "gfx/b.dds",
    });
    const selected = mod.spriteFleetOrderButtonGroundSupport(
      stance,
      { textureFile: "gfx/c.dds" },
      { selected: true }
    );
    expect(owned.id).toBe(
      "GFX_fleet_order_button_ground_support_shapes_bombardment_stance_scorched"
    );
    expect(foreign.id).toBe("GFX_fleet_order_button_ground_support_indiscriminate_bombardment");
    expect(selected.id).toBe(
      "GFX_fleet_order_button_ground_support_shapes_bombardment_stance_scorched_selected"
    );
    expect(mod.spriteTextIcon("council", { textureFile: "gfx/d.dds" }).id).toBe(
      "GFX_text_shapes_council"
    );
  });

  it("carries its mint provenance onto the item", () => {
    const mod = gfxMod("shapes");
    const icon = mod.spriteTextIcon("council", { textureFile: "gfx/a.dds" });
    expect(icon.minted).toEqual({ prefix: "shapes", shape: "spriteTextIcon" });
    // An ordinary mint records none: its name is the evidence.
    expect(mod.spriteType("council", { textureFile: "gfx/a.dds" }).minted).toBeUndefined();
  });

  it("places and emits a prefix-less shape mint without a missing-prefix warning", () => {
    const mod = gfxMod("shapes");
    const pure = mod.compile([
      mod.feature(undefined, [
        mod.spriteFleetOrderButtonGroundSupport("indiscriminate_bombardment", {
          textureFile: "gfx/a.dds",
        }),
      ]),
    ]);
    // Only the uncaptured `textureFile` path warns — a prefix-less shape mint
    // is a legitimate name, so nothing complains about the name itself.
    expect(pure.warnings.map((warning) => warning.code)).toEqual(["unverified-asset-path"]);
    expect(render(pure).get("interface/shapes_sprites.gfx")).toContain(
      "name = GFX_fleet_order_button_ground_support_indiscriminate_bombardment"
    );
  });

  it("refuses a shape mint placed in another capability's feature", () => {
    // The recorded mint is what makes this checkable: the name says nothing
    // about which mod minted it, so without the record the item would place
    // anywhere.
    const first = gfxMod("first_mod");
    const second = gfxMod("second_mod");
    const icon = first.spriteTextIcon("council", { textureFile: "gfx/a.dds" });
    expect(() => second.feature(undefined, [icon])).toThrow(
      /spriteTextIcon sprite "GFX_text_first_mod_council" was minted by a different capability — the one for mod prefix "first_mod", not this one for "second_mod"/
    );
  });

  it("refuses a hand-forged mint provenance", () => {
    // `ContentItem.minted` is a public object, so an author can attach one to
    // anything. It is informational, never the proof: the ownership record
    // lives in a table only the mint itself writes to, so a forged property
    // buys nothing and the foreign name is measured the ordinary way.
    const first = gfxMod("first_mod");
    const second = gfxMod("second_mod");
    const foreign = first.spriteType("council", { textureFile: "gfx/a.dds" });
    const forged = { ...foreign, minted: { prefix: "second_mod", shape: "spriteTextIcon" } };
    expect(() => second.feature(undefined, [forged])).toThrow(
      /Content id "GFX_first_mod_council" does not belong to mod prefix "second_mod"/
    );
  });

  it("refuses a forged provenance reaching the fold directly", () => {
    // `mod.feature` is not the only door: `buildMod` can be reached without a
    // capability at all, so the fold reads the same record rather than
    // trusting that placement already vouched for the item.
    const first = gfxMod("first_mod");
    const second = gfxMod("second_mod");
    const foreign = first.spriteType("council", { textureFile: "gfx/a.dds" });
    const forged = { ...foreign, minted: { prefix: "second_mod", shape: "spriteTextIcon" } };
    const pure = buildMod(second.config, [createFeature(undefined, [forged])]);
    expect(pure.warnings.map((warning) => warning.code)).toContain("missing-prefix");
  });

  it("keeps a genuine shape mint working through that same door", () => {
    // Negative control for the two above: the record survives the fold, so a
    // real prefix-less shape mint raises no ownership complaint. The one
    // warning left is the uncaptured `textureFile` path, which is the
    // asset-path check and says nothing about the name.
    const mod = gfxMod("shapes");
    const icon = mod.spriteFleetOrderButtonGroundSupport("indiscriminate_bombardment", {
      textureFile: "gfx/a.dds",
    });
    const pure = buildMod(mod.config, [createFeature(undefined, [icon])]);
    expect(pure.warnings.map((warning) => warning.code)).toEqual(["unverified-asset-path"]);
  });

  it("refuses a target that is not one bare word", () => {
    const mod = gfxMod("shapes");
    expect(() =>
      mod.spriteFleetOrderButtonGroundSupport("two words", { textureFile: "a" })
    ).toThrow(/must be one bare word/);
    expect(() => mod.spriteFleetOrderButtonGroundSupport("", { textureFile: "a" })).toThrow(
      /must be one bare word/
    );
  });

  it("holds a name-derived shape mint to the same logical-name rule as every mint", () => {
    const mod = gfxMod("shapes");
    expect(() => mod.spriteTextIcon("Council Icon", { textureFile: "a" })).toThrow(
      /must be lowercase snake_case/
    );
  });

  it("refuses a shape mint that collides with vanilla, like any other name", () => {
    // Nothing about a shape mint exempts it: the final name is what the
    // packaged evidence is asked about.
    const mod = gfxMod("shapes");
    expect(() =>
      mod.compile([
        mod.feature(undefined, [
          mod.spriteFleetOrderButtonGroundSupport("indiscriminate_bombardment", {
            textureFile: "gfx/a.dds",
          }),
          mod.spriteFleetOrderButtonGroundSupport("indiscriminate_bombardment", {
            textureFile: "gfx/b.dds",
          }),
        ]),
      ])
    ).toThrow(/Duplicate spriteType id/);
  });
});

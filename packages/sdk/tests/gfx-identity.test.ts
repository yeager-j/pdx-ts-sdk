/**
 * GFX identity, placement and refusal (SDK-121).
 *
 * Written falsification-first: every rule this slice adds is a rule that
 * *refuses* something, so each is measured by the build that must fail, and the
 * neighbouring build that must not. `content.test.ts` carries the goldens for
 * what a passing build emits; this carries the edges around them.
 */

import { describe, expect, it } from "vitest";

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
    expect(pure.warnings).toEqual([]);
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
    expect(pure.warnings).toEqual([]);
    expect(render(pure).get("interface/shapes_sprites.gfx")).toContain(
      "name = GFX_fleet_order_button_ground_support_indiscriminate_bombardment"
    );
  });

  it("refuses a shape mint placed in another capability's feature", () => {
    // The provenance is what makes this checkable: the name says nothing about
    // which mod minted it, so without the record the item would place anywhere.
    const first = gfxMod("first_mod");
    const second = gfxMod("second_mod");
    const icon = first.spriteTextIcon("council", { textureFile: "gfx/a.dds" });
    expect(() => second.feature(undefined, [icon])).toThrow(
      /spriteTextIcon sprite "GFX_text_first_mod_council" was minted by the capability for mod prefix "first_mod", not "second_mod"/
    );
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

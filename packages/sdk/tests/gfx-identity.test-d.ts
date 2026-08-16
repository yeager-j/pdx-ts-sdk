/**
 * The minted GFX names as *types* (SDK-121).
 *
 * The runtime side is `gfx-identity.test.ts`. This is the half a mod author
 * actually feels: an authored sprite's `id` is the literal `GFX_`-led name, so
 * it flows into a `<sprite>` field spelled as a literal, and the shape methods
 * type their holes rather than taking any string.
 */

import { describe, expectTypeOf, it } from "vitest";

import { always, createMod, type SpriteRef } from "../src/index.ts";

const mod = createMod({ name: "GFX types", prefix: "gfx_types", supportedVersion: "4.4.*" });

describe("minted GFX name types", () => {
  it("mints a sprite name with the `GFX_` head and no registry segment", () => {
    const icon = mod.spriteType("council", { textureFile: "gfx/a.dds" });
    expectTypeOf(icon.id).toEqualTypeOf<"GFX_gfx_types_council">();
  });

  it("mints a bare mesh and particle name", () => {
    const mesh = mod.pdxmesh("hull", { file: "gfx/models/x.mesh" });
    const particle = mod.pdxparticle("dust", { type: "x_particle" });
    expectTypeOf(mesh.id).toEqualTypeOf<"gfx_types_hull">();
    expectTypeOf(particle.id).toEqualTypeOf<"gfx_types_dust">();
  });

  it("keeps the three registries out of the id profile", () => {
    // A segmentless registry has no segment to override, so a profile naming
    // one is a compile error rather than a silently ignored member.
    createMod(
      { name: "Custom", prefix: "custom", supportedVersion: "4.4.*" },
      {
        ids: {
          // @ts-expect-error — `spriteType` is not an `IdProfile` member
          spriteType: "sprite_type",
        },
      }
    );
  });
});

describe("shape mint signatures", () => {
  it("types a name-derived mint as its own literal", () => {
    const icon = mod.spriteTextIcon("council", { textureFile: "gfx/a.dds" });
    expectTypeOf(icon.id).toEqualTypeOf<"GFX_text_gfx_types_council">();
    // Still an ordinary sprite: it reaches every `<sprite>` field.
    const asSprite: SpriteRef = icon;
    void asSprite;
  });

  it("carries a raw target through to the literal, and the variant with it", () => {
    const plain = mod.spriteFleetOrderButtonGroundSupport("indiscriminate_bombardment", {
      textureFile: "gfx/a.dds",
    });
    expectTypeOf(
      plain.id
    ).toEqualTypeOf<"GFX_fleet_order_button_ground_support_indiscriminate_bombardment">();
    const selected = mod.spriteFleetOrderButtonGroundSupport(
      "indiscriminate_bombardment",
      { textureFile: "gfx/a.dds" },
      { selected: true }
    );
    expectTypeOf(
      selected.id
    ).toEqualTypeOf<"GFX_fleet_order_button_ground_support_indiscriminate_bombardment_selected">();
  });

  it("reads a typed target's own literal id out of the item", () => {
    const stance = mod.bombardmentStance("scorched", {
      name: "Scorched",
      desc: "Scorched.",
      trigger: always(),
      default: false,
      aiWeight: { base: 1 },
    });
    const button = mod.spriteFleetOrderButtonGroundSupport(stance, { textureFile: "gfx/a.dds" });
    expectTypeOf(
      button.id
    ).toEqualTypeOf<"GFX_fleet_order_button_ground_support_gfx_types_bombardment_stance_scorched">();
  });

  it("refuses a target of the wrong registry", () => {
    const mesh = mod.pdxmesh("hull", { file: "gfx/models/x.mesh" });
    // @ts-expect-error — the hole takes a bombardment stance, not a mesh
    mod.spriteFleetOrderButtonGroundSupport(mesh, { textureFile: "gfx/a.dds" });
  });
});

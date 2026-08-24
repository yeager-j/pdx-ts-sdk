/**
 * The minted GFX names as *types* (SDK-121).
 *
 * The runtime side is `gfx-identity.test.ts`. This is the half a mod author
 * actually feels: an authored sprite's `id` is the literal `GFX_`-led name, so
 * it flows into a `<sprite>` field spelled as a literal, and the shape methods
 * type their holes rather than taking any string.
 */

import { describe, expectTypeOf, it } from "vitest";

import * as sdk from "../src/index.ts";
import { createMod, type AssetFileItem } from "../src/index.ts";
import * as stellaris from "../src/stellaris.ts";
import {
  always,
  type PdxmeshFields,
  type PdxparticleFields,
  type SpriteRef,
  type SpriteTypeFields,
} from "../src/stellaris.ts";

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

describe("exact-name mint types (SDK-183)", () => {
  it("keeps the default mint's minted literal under the widened charset", () => {
    const mesh = mod.pdxmesh("tracer_M1S1_mesh", { file: "gfx/models/x.mesh" });
    expectTypeOf(mesh.id).toEqualTypeOf<"gfx_types_tracer_M1S1_mesh">();
    const explicit = mod.pdxmesh("hull_explicit", { file: "gfx/models/x.mesh" }, { prefix: true });
    expectTypeOf(explicit.id).toEqualTypeOf<"gfx_types_hull_explicit">();
  });

  it("types an exact name as its own literal in all three positions", () => {
    const head = mod.pdxmesh(
      "gfx_types_hull_MK2",
      { file: "gfx/models/x.mesh" },
      {
        prefix: false,
      }
    );
    expectTypeOf(head.id).toEqualTypeOf<"gfx_types_hull_MK2">();
    const interior = mod.pdxparticle(
      "small_gfx_types_flash",
      { type: "x_particle" },
      {
        prefix: false,
      }
    );
    expectTypeOf(interior.id).toEqualTypeOf<"small_gfx_types_flash">();
    const tail = mod.pdxmesh("Turret_gfx_types", { file: "gfx/models/y.mesh" }, { prefix: false });
    expectTypeOf(tail.id).toEqualTypeOf<"Turret_gfx_types">();
  });

  it("refuses an exact name missing the prefix segment at compile time", () => {
    // @ts-expect-error — no `_`-delimited "gfx_types" segment anywhere in the name
    mod.pdxmesh("small_flash_mesh", { file: "gfx/models/x.mesh" }, { prefix: false });
    // @ts-expect-error — the bare prefix alone names nothing
    mod.pdxmesh("gfx_types", { file: "gfx/models/x.mesh" }, { prefix: false });
    // @ts-expect-error — containment must be a whole segment, not a substring
    mod.pdxparticle("gfx_typesX_flash", { type: "x_particle" }, { prefix: false });
  });

  it("offers no options argument outside the two asset-label registries", () => {
    // @ts-expect-error — spriteType takes name and def only
    mod.spriteType("options_icon", { textureFile: "gfx/a.dds" }, { prefix: false });
    // @ts-expect-error — a segmented registry takes name and def only
    mod.edict("options_edict", { name: "x", length: 1 }, { prefix: false });
  });
});

describe("the sprite brand join", () => {
  // `referenceName: "sprite"` is the whole mechanism: an authored sprite and
  // the packaged `vanilla.sprite` names brand alike, so every generated
  // `<sprite>` field takes either without knowing which registry defined it.
  // Nothing new was built for this — these are the proofs that the descriptor's
  // one word did the joining.
  it("flows an authored sprite into an unrelated registry's sprite field", () => {
    const icon = mod.spriteType("edict_icon", { textureFile: "gfx/a.dds" });
    mod.edict("survey", { name: "Survey", length: 360, icon });
  });

  it("refuses a mesh where a sprite belongs", () => {
    const mesh = mod.pdxmesh("hull", { file: "gfx/models/x.mesh" });
    // @ts-expect-error — `icon` is a `<sprite>` field; a mesh is not one
    mod.edict("survey_mesh", { name: "Survey", length: 360, icon: mesh });
  });
});

describe("asset path members", () => {
  it("accepts a captured Asset and a plain string on the same field", () => {
    expectTypeOf<PdxmeshFields["file"]>().toEqualTypeOf<AssetFileItem | string>();
    expectTypeOf<NonNullable<SpriteTypeFields["textureFile"]>>().toEqualTypeOf<
      AssetFileItem | string
    >();
    expectTypeOf<
      NonNullable<NonNullable<SpriteTypeFields["animation"]>[number]["animationmaskfile"]>
    >().toEqualTypeOf<AssetFileItem | string>();
  });

  it("leaves `pdxparticle.type` an ordinary unchecked string", () => {
    // Not a path and not a reference: the `<particle_type>` ids live in opaque
    // `.asset` files, so neither this slice's Item arm nor the reference guard
    // has anything to say about it.
    expectTypeOf<PdxparticleFields["type"]>().toEqualTypeOf<string>();
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

  it("lets a consumer name the type of the sprite they just authored", () => {
    // The point of exporting the aliases: a shape-minted name is not
    // `MintedContentId`-shaped, so without them a consumer holding one of
    // these items has no way to write its type down.
    const icon: stellaris.SpriteTextIconName<"gfx_types", "council"> = "GFX_text_gfx_types_council";
    const button: stellaris.SpriteFleetOrderButtonGroundSupportName<"vanilla_stance", true> =
      "GFX_fleet_order_button_ground_support_vanilla_stance_selected";
    void icon;
    void button;
    expectTypeOf(mod.spriteTextIcon("council", { textureFile: "a" }).id).toEqualTypeOf<
      stellaris.SpriteTextIconName<"gfx_types", "council">
    >();
  });

  it("refuses a target of the wrong registry", () => {
    const mesh = mod.pdxmesh("hull", { file: "gfx/models/x.mesh" });
    // @ts-expect-error — the hole takes a bombardment stance, not a mesh
    mod.spriteFleetOrderButtonGroundSupport(mesh, { textureFile: "gfx/a.dds" });
  });
});

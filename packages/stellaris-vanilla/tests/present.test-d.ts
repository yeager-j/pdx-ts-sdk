/**
 * The package-present world (SDK-12 seam D).
 *
 * This file's whole point is the side-effect import below: it is the standing
 * proof that `src/augment.ts` merges into `@pdx-ts/sdk`'s empty
 * `VanillaIds`/`VanillaTries`/`VanillaScriptedTriggers` targets through the
 * barrel's named re-export (experiment E1), resolved via this package's own
 * tsconfig `paths` (E2). Its mirror image is
 * `packages/sdk/tests/vanilla-refs.test-d.ts`, which the root program compiles
 * with this package excluded and therefore models the package-absent world.
 * Every assertion here should have an opposite there.
 */

import { describe, expectTypeOf, it } from "vitest";

import "../src/index.ts";

import {
  defineTechnology,
  vanilla,
  type SpriteRef,
  type StaticModifierRef,
  type TechnologyRef,
  type VanillaId,
  type VanillaScriptedTriggers,
  type VanillaTries,
} from "@pdx-ts/sdk";

describe("checked registry helpers", () => {
  it("preserves the literal id and brands it for its own registry", () => {
    const tech = vanilla.technology("tech_gene_tailoring");
    expectTypeOf(tech.id).toEqualTypeOf<"tech_gene_tailoring">();
    expectTypeOf(tech).toExtend<TechnologyRef>();
  });

  it("rejects a typo", () => {
    // @ts-expect-error `tech_gene_tailorng` is not a vanilla technology.
    vanilla.technology("tech_gene_tailorng");
  });

  it("rejects a real id that belongs to a different registry", () => {
    // `building_capital` exists — as a building. A registry's helper only
    // accepts that registry's ids, which is the whole point of splitting the
    // union per registry rather than pooling every vanilla identifier.
    // @ts-expect-error
    vanilla.technology("building_capital");
    expectTypeOf(vanilla.building("building_capital").id).toEqualTypeOf<"building_capital">();
  });

  it("still accepts a plain string in a ref field, for other mods' content", () => {
    // The escape hatch SDK-12 deliberately keeps: `XRef | string` everywhere,
    // so a reference to content this install has never heard of stays legal.
    defineTechnology({
      id: "probe_tech",
      name: "Probe",
      area: "physics",
      tier: 1,
      category: "computing",
      prerequisites: ["tech_from_another_mod", vanilla.technology("tech_lasers_1")],
    });
  });
});

describe("oversized registries: the checked call form", () => {
  it("accepts a real sprite id and rejects a typo", () => {
    const sprite = vanilla.sprite("GFX_evt_ship_in_orbit");
    expectTypeOf(sprite.id).toEqualTypeOf<"GFX_evt_ship_in_orbit">();
    expectTypeOf(sprite).toExtend<SpriteRef>();
    // @ts-expect-error `CheckedVanillaId` resolves to `InvalidVanillaId<"sprite", ...>`.
    vanilla.sprite("GFX_evt_ship_in_orbti");
  });
});

describe("oversized registries: trie navigation", () => {
  it("navigates sprites by their .gfx file, id spelled verbatim at the leaf", () => {
    // `interface/eventpictures.gfx` defines `GFX_evt_ship_in_orbit`. The bucket
    // is the file and no part of the id, so the leaf key is the whole id —
    // there is no `GFX`/`evt`/`ship` ladder, because a shared prefix is not a
    // category.
    const leaf = vanilla.sprite.eventpictures.GFX_evt_ship_in_orbit;
    expectTypeOf(leaf.id).toEqualTypeOf<"GFX_evt_ship_in_orbit">();
    expectTypeOf(leaf).toExtend<SpriteRef>();
  });

  it("gives a file bucket no id of its own", () => {
    // `eventpictures` is a filename, not a sprite. Only the types decide what
    // is a leaf — the runtime proxy would happily hand back a `.id` here.
    // @ts-expect-error
    vanilla.sprite.eventpictures.id;
  });

  it("rejects an id that file does not define", () => {
    // @ts-expect-error
    vanilla.sprite.eventpictures.GFX_evt_ship_in_orbti;
  });

  it("navigates a sound by every directory level of its source path", () => {
    // `sound/toxoids/events/tox_events.asset`: the `sound/` tree is deep and
    // each level is a real category, so each is a navigation segment.
    expectTypeOf(
      vanilla.soundEffect.toxoids.events.tox_events.event_first_contact_toxoid.id
    ).toEqualTypeOf<"event_first_contact_toxoid">();
  });

  it("carries an id no property name could spell, as a quoted key", () => {
    // `sound/nomads/ships/nom_dyson_gun.asset` defines 100-odd names with dots
    // in them. A verbatim leaf key is a legal quoted property, so they are
    // navigable rather than flat-union-only.
    expectTypeOf(
      vanilla.sound.nomads.ships.nom_dyson_gun["dyson_arm_laser_2s_fadeinout_0.5s_01"].id
    ).toEqualTypeOf<"dyson_arm_laser_2s_fadeinout_0.5s_01">();
  });

  it("navigates static_modifier the same way, by vanilla source file", () => {
    // `static_modifier` is a `CONTENT_MANIFEST` registry (it has a `defineX`),
    // not a `VANILLA_REF_EXTRAS` row — it earns the trie purely on size
    // (3,081 vanilla ids), via `ContentManifestEntry.oversized`. Its files are
    // `common/`-style, so the bucket is the stem with the load-order number
    // and the registry token stripped (`19_static_modifiers_paragon.txt`).
    expectTypeOf(vanilla.staticModifier.deficit.food_deficit.id).toEqualTypeOf<"food_deficit">();
    expectTypeOf(vanilla.staticModifier.deficit.food_deficit).toExtend<StaticModifierRef>();
    expectTypeOf(
      vanilla.staticModifier.paragon.crisis_studied.id
    ).toEqualTypeOf<"crisis_studied">();
    expectTypeOf(vanilla.staticModifier("food_deficit").id).toEqualTypeOf<"food_deficit">();
  });

  it("puts ids from a subject-less file at the trie root", () => {
    // `00_static_modifiers.txt` strips to nothing, so there is no bucket to
    // name its ids after and they sit one level up.
    expectTypeOf(vanilla.staticModifier.empire_base.id).toEqualTypeOf<"empire_base">();
  });
});

describe("VanillaId resolution", () => {
  it("is a real union for a registry this package covers", () => {
    expectTypeOf<VanillaId<"technology">>().not.toEqualTypeOf<string>();
    expectTypeOf<"tech_gene_tailoring">().toExtend<VanillaId<"technology">>();
  });

  it("degrades to string for a registry the package does not carry", () => {
    // Per-registry degradation, not all-or-nothing: a package that predates a
    // registry the SDK later asks about leaves only that registry unchecked.
    expectTypeOf<VanillaId<"registry_that_never_existed">>().toEqualTypeOf<string>();
  });
});

describe("scripted trigger parameters (the SDK-13 payload)", () => {
  it("carries a parameterless trigger as an empty object", () => {
    expectTypeOf<"is_fallen_empire">().toExtend<keyof VanillaScriptedTriggers>();
    expectTypeOf<VanillaScriptedTriggers["is_fallen_empire"]>().toEqualTypeOf<{}>();
  });

  it("carries a defaulted parameter as optional", () => {
    // Cross-checked by hand against the install:
    // `common/scripted_triggers/00_scripted_triggers.txt` writes
    // `has_crisis_stage = { has_global_flag = crisis_stage_$STAGE|1$ }`, above
    // a comment stating the default is 1. `|default` is exactly what makes a
    // parameter optional here, and no default value is ever emitted.
    expectTypeOf<VanillaScriptedTriggers["has_crisis_stage"]>().toEqualTypeOf<{
      readonly STAGE?: string | number;
    }>();
  });

  it("carries an undefaulted parameter as required", () => {
    // `common/scripted_triggers/09_scripted_triggers_nomads.txt` writes
    // `can_colonize_planet_trigger` with a bare `$SCOPE$` and no default.
    expectTypeOf<VanillaScriptedTriggers["can_colonize_planet_trigger"]>().toEqualTypeOf<{
      readonly SCOPE: string | number;
    }>();
  });
});

describe("the two sides' oversized thresholds agree", () => {
  it("gives a trie to exactly the registries the SDK emits as oversized", () => {
    // The generator decides by measured id count
    // (`packages/vanilla-codegen/src/trie.ts`); the SDK decides by the
    // `oversized` flags in `packages/codegen/src/content-manifest.ts`. Nothing
    // links them but
    // this assertion — if either side's threshold moves, an SDK export loses
    // its navigation (or gains a 3,000-member union parameter) silently, and
    // this is what goes red instead.
    expectTypeOf<keyof VanillaTries>().toEqualTypeOf<
      "static_modifier" | "sound" | "sound_effect" | "sprite"
    >();
  });
});

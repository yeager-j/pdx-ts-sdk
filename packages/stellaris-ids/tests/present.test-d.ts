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

import type { PdxEntry } from "@pdx-ts/pdxscript";
import {
  createMod,
  makeScope,
  scriptedTriggerModifier,
  vanilla,
  type EventRef,
  type EventScopelessRef,
  type ScopeName,
  type ScriptedEffectCall,
  type SituationLogCategoryRef,
  type SpriteRef,
  type StaticModifierRef,
  type TechnologyRef,
  type Trigger,
  type VanillaId,
  type VanillaScriptedTriggers,
  type VanillaTries,
} from "@pdx-ts/sdk";

import { giveTechNoErrorEffect, setMerchantGovernmentEffect } from "../src/effects.ts";
import {
  canColonizePlanetTrigger,
  hasAnyMegastructureInEmpire,
  hasCrisisStage,
  isFallenEmpire,
  isMachineEmpire,
  isPirateSystem,
} from "../src/triggers.ts";

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

  it("checks situation-log category ids", () => {
    const category = vanilla.situationLogCategory("anomalies");
    expectTypeOf(category.id).toEqualTypeOf<"anomalies">();
    expectTypeOf(category).toExtend<SituationLogCategoryRef>();
    // @ts-expect-error this category does not exist in vanilla.
    vanilla.situationLogCategory("definitely_not_a_category");
  });

  it("still accepts a plain string in a ref field, for other mods' content", () => {
    // The escape hatch SDK-12 deliberately keeps: `XRef | string` everywhere,
    // so a reference to content this install has never heard of stays legal.
    const mod = createMod({ name: "Probe", prefix: "probe", supportedVersion: "4.4.*" });
    mod.technology("probe", {
      name: "Probe",
      area: "physics",
      tier: 1,
      category: "computing",
      prerequisites: ["tech_from_another_mod", vanilla.technology("tech_lasers_1")],
    });
  });
});

describe("vanilla events", () => {
  it("preserves each event's scope, subtype, and full id", () => {
    const storySiteFound = vanilla.event.story.$5;
    expectTypeOf(storySiteFound.id).toEqualTypeOf<"story.5">();
    expectTypeOf(storySiteFound).toExtend<EventRef<"country", undefined, "country">>();
    // @ts-expect-error bare install-derived references carry scope only as a phantom brand.
    storySiteFound.scope;
    // @ts-expect-error vanilla references declare no runtime FROM metadata.
    storySiteFound.from;

    const observerDestroyed = vanilla.event.observer.$1;
    expectTypeOf(observerDestroyed).toExtend<EventRef<"country", undefined, "observer">>();

    const astralSpawn = vanilla.event.astral_planes.$1;
    expectTypeOf(astralSpawn).toExtend<EventScopelessRef>();
  });

  it("rejects a typed vanilla event at the wrong fire effect", () => {
    const mod = createMod({
      name: "Event probe",
      prefix: "event_probe",
      supportedVersion: "4.4.*",
    });
    mod.namespace().ship(1, {
      isTriggeredOnly: true,
      immediate: (ship) => {
        // @ts-expect-error story.5 is a country event, not a ship event.
        ship.shipEvent({ id: vanilla.event.story.$5 });
      },
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

describe("the generated bindings", () => {
  it("carries the ticket's own example at exactly its inferred scope", () => {
    // `is_fallen_empire` is `OR = { is_country_type = fallen_empire
    // is_country_type = awakened_fallen_empire }` and nothing else, so the
    // inference has one country-scoped key to intersect. DoA calls it 214 times.
    expectTypeOf(isFallenEmpire()).toEqualTypeOf<Trigger<"country">>();
  });

  it("takes no arguments when the definition takes no parameters", () => {
    // @ts-expect-error a parameterless binding's argument list is empty, so an
    // argument object is not merely ignored — it does not typecheck.
    isFallenEmpire({ ANYTHING: 1 });
  });

  it("accepts an explicit boolean for a parameterless trigger, negated included (SDK-43)", () => {
    // `isMachineEmpire(false)` was the ticket's own example of a compile
    // error with nothing at the call site to explain it — `isNomadic(false)`,
    // a native trigger, compiled beside it. The negated and affirmative forms
    // return the exact same type; only the emitted `yes`/`no` differs.
    expectTypeOf(isMachineEmpire(false)).toEqualTypeOf(isMachineEmpire());
    expectTypeOf(isFallenEmpire(true)).toEqualTypeOf(isFallenEmpire());
  });

  it("keeps the boolean form off a trigger that takes parameters", () => {
    // Vanilla always substitutes `$PARAM$`s into a block, never into the call
    // site itself — there is no `has_crisis_stage = no` to widen for, so this
    // one stays object-args only even though its one parameter is optional.
    // @ts-expect-error
    hasCrisisStage(false);
  });

  it("makes a defaulted parameter optional and a bare one required", () => {
    expectTypeOf(hasCrisisStage()).toEqualTypeOf<Trigger<ScopeName>>();
    expectTypeOf(hasCrisisStage({ STAGE: 2 })).toEqualTypeOf<Trigger<ScopeName>>();
    // @ts-expect-error `can_colonize_planet_trigger` writes a bare `$SCOPE$`.
    canColonizePlanetTrigger();
  });

  it("rejects a parameter the definition does not declare", () => {
    // @ts-expect-error `STAGE` is the only parameter `has_crisis_stage` takes.
    hasCrisisStage({ STAEG: 2 });
  });

  it("accepts a branded reference where the package types a bare scalar", () => {
    // The package types every parameter `string | number` because a scripted
    // definition substitutes text. The SDK widens that to the references it
    // already models, so an id does not have to be unwrapped by hand.
    expectTypeOf(hasCrisisStage({ STAGE: vanilla.resource("energy") })).toEqualTypeOf<
      Trigger<ScopeName>
    >();
  });

  it("accepts a boolean where the game reads the substitution as yes/no", () => {
    // The package types every parameter `string | number` — it cannot know a
    // slot is boolean — but vanilla writes `give_tech_no_error_effect = {
    // MESSAGE = no }` at 51 sites. The SDK widens so `true` means here what it
    // means everywhere else rather than needing `"yes"` in this one position.
    expectTypeOf(
      giveTechNoErrorEffect({ MESSAGE: false, TECH: vanilla.technology("tech_lasers_1") })
    ).toEqualTypeOf<ScriptedEffectCall<"country">>();
  });

  it("carries a multi-scope definition as the union the inference derived", () => {
    // `has_any_megastructure_in_empire` iterates `any_owned_planet`, which the
    // rules make legal in country and sector, and nothing in the body narrows
    // further. A union is not a failure to infer: against `ScopeName`'s 41
    // members it still rejects 39.
    expectTypeOf(hasAnyMegastructureInEmpire()).toEqualTypeOf<Trigger<"country" | "sector">>();
    // And a narrowing derived through a scope link rather than a plain key.
    expectTypeOf(isPirateSystem()).toEqualTypeOf<Trigger<"system">>();
  });

  it("keeps a wrong-scope binding out of a narrower slot", () => {
    const inCountry = (_condition: Trigger<"country">): void => undefined;
    inCountry(hasAnyMegastructureInEmpire());
    // @ts-expect-error a system-scoped trigger is not a country condition.
    inCountry(isPirateSystem());
  });

  it("binds effects as calls that only `run` accepts", () => {
    expectTypeOf(setMerchantGovernmentEffect()).toEqualTypeOf<ScriptedEffectCall<"country">>();
    // A trigger and an effect call serialize alike and are still different
    // things; each brand refuses the other's position.
    expectTypeOf(setMerchantGovernmentEffect()).not.toExtend<Trigger<"country">>();
  });

  it("rejects a wrong-scope effect call at `run`", () => {
    const sink: PdxEntry[] = [];
    makeScope<"country">(sink).run(setMerchantGovernmentEffect());
    // @ts-expect-error a country-scoped effect cannot run in a planet closure.
    makeScope<"planet">(sink).run(setMerchantGovernmentEffect());
  });
});

describe("scriptedTriggerModifier with the package (bug bash #16 finding 5)", () => {
  it("rejects a typo in the trigger name", () => {
    // @ts-expect-error `check_galaxy_setup_vaule` is not a vanilla scripted
    // trigger — the exact typo shape the finding named.
    scriptedTriggerModifier("check_galaxy_setup_vaule");
  });

  it("checks a real scripted trigger's parameters, required and optional alike", () => {
    // has_crisis_stage's one parameter (STAGE) is defaulted, so it is
    // optional; can_colonize_planet_trigger's SCOPE is bare, so it is
    // required. Both edges the same distinction scriptedTrigger already
    // pins in `present.test-d.ts` above, exercised through this row-shaped
    // entry point instead of a direct call.
    scriptedTriggerModifier("has_crisis_stage");
    scriptedTriggerModifier("has_crisis_stage", { STAGE: 2 });
    // @ts-expect-error `STAGE` is the only parameter `has_crisis_stage` takes.
    scriptedTriggerModifier("has_crisis_stage", { STAEG: 2 });
    scriptedTriggerModifier("can_colonize_planet_trigger", { SCOPE: "root" });
    // @ts-expect-error can_colonize_planet_trigger's SCOPE has no default.
    scriptedTriggerModifier("can_colonize_planet_trigger");
  });

  it("spreads into a legal ComplexTriggerModifier row", () => {
    // The row itself is content.ts's own type; this file only proves the
    // checked half composes with it the way the runtime evidence in
    // packages/sdk/tests/content.test.ts assumes.
    const row = { ...scriptedTriggerModifier("has_crisis_stage", { STAGE: 2 }), mode: "factor" };
    expectTypeOf(row.trigger).toEqualTypeOf<"has_crisis_stage">();
  });
});

describe("the two sides' oversized thresholds agree", () => {
  it("gives a trie to exactly the registries the SDK emits as oversized", () => {
    // The generator decides by measured id count
    // (`packages/codegen-vanilla/src/trie.ts`); the SDK decides by the
    // `oversized` flags in `packages/codegen/src/content-manifest.ts`. Nothing
    // links them but
    // this assertion — if either side's threshold moves, an SDK export loses
    // its navigation (or gains a 3,000-member union parameter) silently, and
    // this is what goes red instead.
    expectTypeOf<keyof VanillaTries>().toEqualTypeOf<
      "event" | "static_modifier" | "sound" | "sound_effect" | "sprite"
    >();
  });
});

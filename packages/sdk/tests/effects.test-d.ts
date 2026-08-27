/**
 * Scope safety over the GENERATED effect interfaces — the same claims the
 * probe pinned against its hand-written samples, now held against the real
 * emitted surface.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expectTypeOf, it } from "vitest";

import type { ScopeObjOf } from "../src/generated/effects.ts";
import type { AmbientObjectRef, BuildingRef, MegastructureRef } from "../src/generated/refs.ts";
import type { ScopeName } from "../src/generated/scopes.ts";
import {
  ambientObjectFlags,
  countryFlags,
  megastructureFlags,
  planetFlags,
} from "../src/generated/value-sets.ts";
import { eventTarget, makeScope, scopeValue } from "../src/script/effects/recorder.ts";
import { hasPlanetFlag, hasStarFlag, isAtWar } from "../src/script/triggers.ts";
import { external, vanilla, type EffectPath, type EffectPathOf } from "../src/stellaris.ts";

const sink: PdxEntry[] = [];
const flags = planetFlags("effects_type_test_flag");
const ambientFlags = ambientObjectFlags("effects_type_test_ambient_flag");
const ambientRef: AmbientObjectRef = { id: "effects_type_test_ambient" };
const buildingRef = { id: "effects_type_test_building" } as BuildingRef;
const megastructureRef = { id: "effects_type_test_megastructure" } as MegastructureRef;
const megastructureFlag = megastructureFlags(
  "effects_type_test_megastructure_flag"
).effects_type_test_megastructure_flag;

type MethodBlockArgument<T, Name extends string> =
  T extends Record<Name, (...args: any[]) => unknown> ? Parameters<T[Name]>[0] : never;

type EffectBlockArgument<Name extends string> = {
  [Scope in ScopeName]: MethodBlockArgument<ScopeObjOf<Scope>, Name>;
}[ScopeName];

describe("generated scalar-or-block effect forms", () => {
  it("requires each block form's required members", () => {
    // @ts-expect-error — add_building's block requires building
    const addBuilding: EffectBlockArgument<"addBuilding"> = {};
    // @ts-expect-error — add_district's block requires districtType
    const addDistrict: EffectBlockArgument<"addDistrict"> = {};
    // @ts-expect-error — add_pop_amount's block requires amount
    const addPopAmount: EffectBlockArgument<"addPopAmount"> = {};
    // @ts-expect-error — add_relic's block requires key
    const addRelic: EffectBlockArgument<"addRelic"> = {};
    // @ts-expect-error — add_trait's block requires trait
    const addTrait: EffectBlockArgument<"addTrait"> = {};
    // @ts-expect-error — auto_follow_fleet's block requires target
    const autoFollowFleet: EffectBlockArgument<"autoFollowFleet"> = {};
    // @ts-expect-error — change_country_flag's block requires icon, background, and colors
    const changeCountryFlag: EffectBlockArgument<"changeCountryFlag"> = {};
    // @ts-expect-error — change_government's optional authority is not numeric
    const changeGovernment: EffectBlockArgument<"changeGovernment"> = { authority: 1 };
    // @ts-expect-error — change_pc's block requires class and inheritEntity
    const changePc: EffectBlockArgument<"changePc"> = {};
    // @ts-expect-error — create_fleet_from_naval_cap's block requires fraction and shipOwnerType
    const createFleetFromNavalCap: EffectBlockArgument<"createFleetFromNavalCap"> = {};
    // @ts-expect-error — damage_ship's block requires amount and attacker
    const damageShip: EffectBlockArgument<"damageShip"> = {};
    // @ts-expect-error — delete_dimensional_fleet's block requires target
    const deleteDimensionalFleet: EffectBlockArgument<"deleteDimensionalFleet"> = {};
    // @ts-expect-error — delete_fleet's block requires target
    const deleteFleet: EffectBlockArgument<"deleteFleet"> = {};
    // @ts-expect-error — destroy_fleet's block requires target
    const destroyFleet: EffectBlockArgument<"destroyFleet"> = {};
    // @ts-expect-error — end_fleet_contract's block requires initiator and reason
    const endFleetContract: EffectBlockArgument<"endFleetContract"> = {};
    // @ts-expect-error — guarantee_country's block requires target
    const guaranteeCountry: EffectBlockArgument<"guaranteeCountry"> = {};
    // @ts-expect-error — log's block form is a closure, not an object
    const log: EffectBlockArgument<"log"> = {};
    // @ts-expect-error — play_sound's block requires sound and location
    const playSound: EffectBlockArgument<"playSound"> = {};
    // @ts-expect-error — refuse_covenant's block requires patron
    const refuseCovenant: EffectBlockArgument<"refuseCovenant"> = {};
    // @ts-expect-error — remove_pop_amount's block requires amount
    const removePopAmount: EffectBlockArgument<"removePopAmount"> = {};
    // @ts-expect-error — set_location's block requires target
    const setLocation: EffectBlockArgument<"setLocation"> = {};
    // @ts-expect-error — set_name's block requires key
    const setName: EffectBlockArgument<"setName"> = {};
    // @ts-expect-error — start_terraform_process's block requires class and inheritEntity
    const startTerraformProcess: EffectBlockArgument<"startTerraformProcess"> = {};
    // @ts-expect-error — start_terraform_progress's block requires class
    const startTerraformProgress: EffectBlockArgument<"startTerraformProgress"> = {};

    void [
      addBuilding,
      addDistrict,
      addPopAmount,
      addRelic,
      addTrait,
      autoFollowFleet,
      changeCountryFlag,
      changeGovernment,
      changePc,
      createFleetFromNavalCap,
      damageShip,
      deleteDimensionalFleet,
      deleteFleet,
      destroyFleet,
      endFleetContract,
      guaranteeCountry,
      log,
      playSound,
      refuseCovenant,
      removePopAmount,
      setLocation,
      setName,
      startTerraformProcess,
      startTerraformProgress,
    ];
  });
});

describe("generated effect scope safety", () => {
  it("types structured-only effect fields and rejects scalar substitutes", () => {
    const country = makeScope<"country">(sink);
    country.fireOnAction({
      onAction: "effects_type_test_on_action",
      scopes: { from: scopeValue<"country">("root") },
    });
    // @ts-expect-error — scopes is a structured block, not a scalar scope path
    country.fireOnAction({ onAction: "effects_type_test_on_action", scopes: "root" });

    const federation = makeScope<"federation">(sink);
    federation.setDiplomacyActionSetting({
      action: "effects_type_test_diplomatic_action",
      settings: { voteType: "unanimous_vote", acceptanceType: "default" },
    });
    federation.setDiplomacyActionSetting({
      action: "effects_type_test_diplomatic_action",
      // @ts-expect-error — settings is a structured block, not a bare enum value
      settings: "default",
    });
  });

  it("types bare-value lists, mixed list arms, and bare effect clauses", () => {
    const country = makeScope<"country">(sink);
    country.addTimelineEvent({
      type: "effects_type_test_timeline_event",
      overrideText: ["button:effects_type_test_text"],
      overrideTexture: ["button:GFX_effects_type_test_button"],
    });
    country.copyAscensionPerksFrom({
      target: scopeValue<"country">("root"),
      exceptions: ["effects_type_test_perk_a", "effects_type_test_perk_b"],
    });
    country.copyTechsFrom({ target: scopeValue<"country">("root"), except: ["tech_a", "tech_b"] });
    country.copyTraditionsFrom({
      target: scopeValue<"country">("root"),
      exceptions: ["effects_type_test_tradition_a", "effects_type_test_tradition_b"],
    });
    country.createBalancedFleet({ size: 10 });
    country.createRandomFleet({
      shipDesigns: [
        vanilla.localization("corvette"),
        { design: vanilla.localization("destroyer"), weight: 2, min: 1, max: 3 },
      ],
    });
    const system = makeScope<"system">(sink);
    system.spawnPlanet({
      class: "pc_continental",
      modifier: ["effects_type_test_modifier_a", "effects_type_test_modifier_b"],
    });
    country.startStormAreaPlacing({
      cosmicStorm: "storm_test",
      reticleRadius: [],
      maxRange: [],
      onConfirm: () => country.log("confirmed"),
    });
    country.stormApplyAftermathModifier({
      severity: [
        { modifier: "effects_type_test_storm_a", days: 30 },
        { modifier: "effects_type_test_storm_b", days: 60 },
      ],
    });

    country.addTimelineEvent({
      type: "effects_type_test_timeline_event",
      // @ts-expect-error — override pairs author as a list of complete key:value strings
      overrideText: "button:effects_type_test_text",
    });
    // @ts-expect-error — a bare-value list must be wrapped in an array
    country.copyTechsFrom({ target: scopeValue<"country">("root"), except: "tech_a" });
    country.createRandomFleet({
      // @ts-expect-error — a structured list arm requires its design field
      shipDesigns: [{ weight: 2 }],
    });
    country.startStormAreaPlacing({
      cosmicStorm: "storm_test",
      reticleRadius: [],
      maxRange: [],
      // @ts-expect-error — an anonymous effect clause authors as a closure
      onConfirm: "set_country_flag = confirmed",
    });
    system.spawnPlanet({
      class: "pc_continental",
      // @ts-expect-error — repeated modifier entries author as an array
      modifier: "effects_type_test_modifier",
    });
    country.stormApplyAftermathModifier({
      // @ts-expect-error — repeated severity blocks author as an array
      severity: { modifier: "effects_type_test_storm", days: 30 },
    });
  });

  it("types repeated nested fields as arrays and rejects single values", () => {
    const planet = makeScope<"planet">(sink);
    const fleet = makeScope<"fleet">(sink);
    const country = makeScope<"country">(sink);

    planet.createColony({
      owner: scopeValue<"country">("root"),
      ethos: { ethic: ["ethic_militarist", "ethic_xenophobe"] },
    });
    fleet.setFleetFormation({ position: [{ x: 1.5, y: -2.5 }] });
    country.createMessage({
      type: "effects_type_test_message_type",
      variable: [{ type: "name", localization: "EFFECTS_TYPE_TEST_PLANET" }],
    });

    planet.createColony({
      owner: scopeValue<"country">("root"),
      // @ts-expect-error — repeated ethic entries author as an array
      ethos: { ethic: "ethic_militarist" },
    });
    planet.createColony({
      // @ts-expect-error — a single-occurrence field does not accept an array
      owner: [scopeValue<"country">("root")],
    });
    // @ts-expect-error — repeated position blocks author as an array
    fleet.setFleetFormation({ position: { x: 1.5, y: -2.5 } });
  });

  it("types an enclosing-scope clause by the scope the effect is recorded in", () => {
    const country = makeScope<"country">(sink);
    country.createMessage({
      type: "effects_type_test_message_type",
      variable: [{ type: "name", scope: scopeValue<"planet">("this"), trigger: isAtWar() }],
    });
    country.createMessage({
      type: "effects_type_test_message_type",
      // @ts-expect-error — has_planet_flag is planet-scoped and this message is recorded in country
      variable: [{ type: "name", trigger: hasPlanetFlag(flags.effects_type_test_flag) }],
    });
  });

  it("types ambient-object placement refs, locations, and scalar/range offsets", () => {
    const system = makeScope<"system">(sink);
    system.createAmbientObject({
      type: ambientRef,
      location: scopeValue<"planet">("from"),
      entityOffset: 2,
      entityOffsetAngle: { min: 10, max: 20 },
      entityOffsetHeight: { min: -1, max: 1 },
      target: scopeValue<"country">("root"),
      effect: (ambient) =>
        ambient.setAmbientObjectFlag(ambientFlags.effects_type_test_ambient_flag),
    });
    system.createAmbientObject({
      type: "effects_type_test_raw_ambient",
      entityOffset: { min: 0, max: 4 },
    });
  });

  it("rejects invalid ambient-object placement forms", () => {
    const system = makeScope<"system">(sink);
    // @ts-expect-error — create_ambient_object.type accepts ambient_object refs, not buildings
    system.createAmbientObject({ type: buildingRef });
    system.createAmbientObject({
      type: "effects_type_test_raw_ambient",
      // @ts-expect-error — location is narrowed to the spatial_object scope group
      location: scopeValue<"country">("from"),
    });
    // @ts-expect-error — the structured arm requires both range bounds
    system.createAmbientObject({ type: "effects_type_test_raw_ambient", entityOffset: { min: 1 } });
    // @ts-expect-error — offsets accept one scalar or one range block, not arrays
    system.createAmbientObject({ type: "effects_type_test_raw_ambient", entityOffset: [1, 2] });
    system.createAmbientObject({
      type: "effects_type_test_raw_ambient",
      effect: (ambient) =>
        // @ts-expect-error — the pushed scope is ambient_object, not country
        ambient.setCountryFlag(
          countryFlags("effects_type_test_country_flag").effects_type_test_country_flag
        ),
    });
  });

  it("types spawn-megastructure refs, names, ranges, and its pushed scope", () => {
    const system = makeScope<"system">(sink);
    system.spawnMegastructure({
      type: megastructureRef,
      name: {
        key: external.localization("effects_type_test_megastructure_name"),
        variableString: ["effects_type_test_variable"],
      },
      orbitAngle: { min: 10, max: 20 },
      initEffect: (megastructure) => megastructure.setMegastructureFlag(megastructureFlag),
    });
  });

  it("rejects invalid spawn-megastructure forms", () => {
    const system = makeScope<"system">(sink);
    system.spawnMegastructure({
      // @ts-expect-error — spawn_megastructure.type accepts megastructure refs, not buildings
      type: buildingRef,
      name: "effects_type_test_name",
    });
    system.spawnMegastructure({
      type: megastructureRef,
      name: {
        key: external.localization("effects_type_test_name"),
        // @ts-expect-error — repeated variable_string entries author as an array
        variableString: "effects_type_test_variable",
      },
    });
    system.spawnMegastructure({
      type: megastructureRef,
      name: "effects_type_test_name",
      initEffect: (megastructure) =>
        // @ts-expect-error — the pushed scope is megastructure, not country
        megastructure.setCountryFlag(
          countryFlags("effects_type_test_country_flag").effects_type_test_country_flag
        ),
    });
    const country = makeScope<"country">(sink);
    // @ts-expect-error — spawn_megastructure is declared only in system scope
    country.spawnMegastructure({ type: megastructureRef, name: "effects_type_test_name" });
  });

  it("rejects an effect outside its declared scopes", () => {
    const country = makeScope<"country">(sink);
    // @ts-expect-error — destroy_colony is declared for colony/planet/ship/carrier, not country
    country.destroyColony();
  });

  it("rejects a wrong-scope trigger in an iterator's limit", () => {
    const country = makeScope<"country">(sink);
    // @ts-expect-error — isAtWar is country-scoped; every_owned_planet's limit runs in planet scope
    country.everyOwnedPlanet({ limit: isAtWar() }, () => {});
  });

  it("rejects saving a target under the wrong declared scope", () => {
    const target = eventTarget<"country">("wrong_scope_target");
    const country = makeScope<"country">(sink);
    country.everyOwnedPlanet({}, (planet) => {
      // @ts-expect-error — the target was declared as a country target; this save site is a planet
      planet.saveEventTargetAs(target);
    });
  });

  it("rejects a flag from another value set", () => {
    const country = makeScope<"country">(sink);
    // @ts-expect-error — set_country_flag takes a CountryFlag, not a PlanetFlag
    country.setCountryFlag(flags.effects_type_test_flag);
  });

  it("types the pushed scope of a generated iterator", () => {
    const country = makeScope<"country">(sink);
    country.everyOwnedPlanet({}, (planet) => {
      planet.destroyColony();
    });
  });

  it("rejects a redundant same-scope callback parameter", () => {
    const country = makeScope<"country">(sink);
    // @ts-expect-error — if preserves country scope; capture country instead
    country.if(hasCountryFlag("ready"), (same) => same.log("redundant"));
  });

  it("types a scope path's terminal body to the final link's output scope", () => {
    const planet = makeScope<"planet">(sink);
    expectTypeOf(planet.owner).toExtend<EffectPath<"country">>();
    expectTypeOf(planet.owner).toExtend<EffectPathOf<"country">>();
    expectTypeOf(planet.hiddenEffect).toExtend<EffectPath<"planet", "same">>();
    planet.owner.effects((country) => {
      country.everyOwnedPlanet({}, (owned) => owned.destroyColony());
    });
  });

  it("keeps repeated hidden paths same-scope until a generated link pushes", () => {
    const planet = makeScope<"planet">(sink);
    planet.hiddenEffect.hiddenEffect.effects(() => {
      planet.log("hidden twice");
    });
    // @ts-expect-error — repeated same-scope hidden paths do not receive a scope parameter
    planet.hiddenEffect.hiddenEffect.effects((same) => same.log("redundant"));
    planet.hiddenEffect.owner.hiddenEffect.effects((country) => {
      country.log("owner path pushed");
    });
  });

  it("rejects an out-of-scope effect inside a path's terminal body", () => {
    const planet = makeScope<"planet">(sink);
    planet.owner.effects((country) => {
      // @ts-expect-error — the link lands in country scope; destroy_colony is not valid there
      country.destroyColony();
    });
  });

  it("rejects a scope link outside its input scopes at any hop", () => {
    const planet = makeScope<"planet">(sink);
    // @ts-expect-error — overlord only navigates from country scope
    planet.overlord.effects(() => {});

    // @ts-expect-error — owner lands in country scope; army_leader starts from an army
    planet.owner.armyLeader.effects(() => {});
  });

  it("rejects the legacy callable spelling", () => {
    const planet = makeScope<"planet">(sink);
    // @ts-expect-error — scope navigation is a property path terminated by effects()
    planet.owner(() => {});
    // @ts-expect-error — hiddenEffect is the same kind of composable path node
    planet.hiddenEffect(() => {});
  });

  it("exposes the asserted target link only where the game allows it", () => {
    const situation = makeScope<"situation">(sink);
    situation.target<"planet">((planet) => planet.destroyColony());
    const planet = makeScope<"planet">(sink);
    // @ts-expect-error — planets have no target link; it exists on situation/spy_network/espionage_operation/agreement
    planet.target<"country">(() => {});
  });
});

describe("a spliced alias category's authoring type", () => {
  it("types each action by the one member the item names", () => {
    const fleet = makeScope<"fleet">(sink);
    fleet.queueActions([
      { wait: 10 },
      { wait: { duration: 10, random: 2 } },
      { moveTo: scopeValue<"planet">("this") },
      { orbitPlanet: "random" },
    ]);
    // @ts-expect-error — move_to takes a scope, not a number
    fleet.queueActions([{ moveTo: 5 }]);
    // @ts-expect-error — the queue holds fleet actions, and there is no `warp`
    fleet.queueActions([{ warp: 5 }]);
    // An item naming two actions is a union member's excess property to
    // TypeScript and no error at all, so the recorder refuses it instead
    // (effects.test.ts).
    fleet.queueActions([{ wait: 10, orbitPlanet: "random" }]);
  });

  it("types a nested action list by the scope its search pushes", () => {
    const fleet = makeScope<"fleet">(sink);
    fleet.queueActions([
      {
        findRandomSystem: {
          trigger: { id: "effects_type_test.1", conditions: hasStarFlag("effects_type_test_flag") },
          foundSystem: [{ wait: 5 }],
        },
      },
    ]);
    fleet.queueActions([
      {
        findRandomSystem: {
          // @ts-expect-error — the search pushes system scope, so a planet trigger is not one of its conditions
          trigger: { id: "effects_type_test.2", conditions: hasPlanetFlag(flags) },
          foundSystem: [],
        },
      },
    ]);
  });
});

describe("a repeated argument the rules bound", () => {
  it("admits the lengths CWT declares and no others", () => {
    const country = makeScope<"country">(sink);
    country.createCountry({
      type: "effects_type_test_country_type",
      ethos: { ethic: ["ethic_a", "ethic_b", "ethic_c"] },
    });
    country.createCountry({
      type: "effects_type_test_country_type",
      // @ts-expect-error — the rules declare 1..3 ethics, so an empty list is none
      ethos: { ethic: [] },
    });
    country.createCountry({
      type: "effects_type_test_country_type",
      // @ts-expect-error — the rules declare 1..3 ethics, and this is four
      ethos: { ethic: ["ethic_a", "ethic_b", "ethic_c", "ethic_d"] },
    });
  });
});

describe("an effect field the game documents as optional", () => {
  it("lets createCountry omit removeInvalidCivics", () => {
    const country = makeScope<"country">(sink);
    country.createCountry({ type: "effects_type_test_country_type", nameList: "random" });
    // @ts-expect-error — the overlay corrects the field's cardinality, not its type
    country.createCountry({ type: "effects_type_test_country_type", removeInvalidCivics: "no" });
  });
});

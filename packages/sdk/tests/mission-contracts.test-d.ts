import { describe, expectTypeOf, it } from "vitest";

import { createMod } from "../src/index.ts";
import {
  always,
  eventTarget,
  type MissionCategoryContractRef,
  type MissionLocationContract,
  type ScopeRef,
} from "../src/stellaris.ts";

const CONFIG = { name: "Contracts", prefix: "contract_test", supportedVersion: "4.4.*" } as const;

describe("contract missions", () => {
  it("retains the contract-category witness and requires an event chain", () => {
    const mod = createMod(CONFIG);
    const category = mod.missionCategory("contracts", {
      isContract: true,
      mapIcon: "GFX_nomad_contract_icon",
      logIcon: "gfx/interface/icons/contracts/contract_icon_log.dds",
    });
    const ordinary = mod.missionCategory("ordinary", {
      isContract: false,
      mapIcon: "GFX_nomad_contract_icon",
      logIcon: "gfx/interface/icons/contracts/contract_icon_log.dds",
    });
    const qualified: MissionCategoryContractRef = category;
    expectTypeOf(category.def.isContract).toEqualTypeOf<true>();
    expectTypeOf(ordinary.def.isContract).toEqualTypeOf<false>();
    void qualified;

    // @ts-expect-error — a contract category requires eventChain
    mod.mission("missing_chain", { category, picture: "GFX_event_pictures_space_battle" });
    // @ts-expect-error — contract-only fields are unavailable on an ordinary mission
    mod.mission("ordinary", {
      category: ordinary,
      picture: "GFX_event_pictures_space_battle",
      timeToAccept: 30,
    });
    mod.mission("plain", { category: ordinary, picture: "GFX_event_pictures_space_battle" });
    // @ts-expect-error — only a contract declares the location its callbacks read
    mod.mission("located_plain", {
      category: ordinary,
      picture: "GFX_event_pictures_space_battle",
      locationScope: "planet",
    });
    mod.mission("uncategorised", { picture: "GFX_event_pictures_space_battle" });
    mod.mission("vanilla_category", {
      category: "a_vanilla_category",
      picture: "GFX_event_pictures_space_battle",
    });
  });

  it("models issuer, operator, lifecycle, and weight ambient scopes", () => {
    const mod = createMod(CONFIG);
    const category = mod.missionCategory("ambient", {
      isContract: true,
      mapIcon: "GFX_nomad_contract_icon",
      logIcon: "gfx/interface/icons/contracts/contract_icon_log.dds",
    });
    const chain = mod.eventChain("ambient", {});
    const mission = mod.mission("ambient", {
      category,
      eventChain: chain,
      picture: "GFX_event_pictures_space_battle",
      locationScope: "planet",
      potentialIssuer: (ctx) => {
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"system">>();
        expectTypeOf(ctx.fromfrom).toEqualTypeOf<ScopeRef<"country">>();
        return always();
      },
      potentialOperator: (ctx) => {
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"planet">>();
        expectTypeOf(ctx.fromfrom).toEqualTypeOf<ScopeRef<"country">>();
        return always();
      },
      possibleOperator: (ctx) => {
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"planet">>();
        expectTypeOf(ctx.fromfrom).toEqualTypeOf<ScopeRef<"country">>();
        return always();
      },
      onStart: (_country, ctx) => {
        expectTypeOf(ctx.fromfrom).toEqualTypeOf<ScopeRef<"planet">>();
        expectTypeOf(ctx.prev).toEqualTypeOf<ScopeRef<"country">>();
      },
      onIssue: (_country, ctx) => {
        expectTypeOf(ctx.fromfrom).toEqualTypeOf<ScopeRef<"planet">>();
      },
      onAccept: (_country, ctx) => {
        expectTypeOf(ctx.fromfrom).toEqualTypeOf<ScopeRef<"planet">>();
        expectTypeOf(ctx.prev).toEqualTypeOf<ScopeRef<"country">>();
      },
      aiWeight: (ctx) => {
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"planet">>();
        expectTypeOf(ctx.fromfrom).toEqualTypeOf<ScopeRef<"country">>();
        return { base: 1 };
      },
    });
    expectTypeOf(mission.locationScope).toEqualTypeOf<"planet">();
  });

  it("requires mission effects to use the declared location scope", () => {
    const mod = createMod(CONFIG);
    const category = mod.missionCategory("enable", {
      isContract: true,
      mapIcon: "GFX_nomad_contract_icon",
      logIcon: "gfx/interface/icons/contracts/contract_icon_log.dds",
    });
    const chain = mod.eventChain("enable", {});
    const mission = mod.mission("enable", {
      category,
      eventChain: chain,
      picture: "GFX_event_pictures_space_battle",
      locationScope: "planet",
    });
    const contract: MissionLocationContract<"planet"> = mission;
    const planet = eventTarget<"planet">("contract_test_planet");
    const fleet = eventTarget<"fleet">("contract_test_fleet");
    const events = mod.namespace();
    events.country(1, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.enableMission({ name: contract, location: planet });
        // @ts-expect-error — this mission declares a planet location
        country.enableMission({ name: contract, location: fleet });
        // @ts-expect-error — a declared location must be supplied
        country.enableMission({ name: contract });
        country.enableMission({ name: "a_vanilla_mission", location: fleet });
        country.issueContract({ contract, location: planet });
        // @ts-expect-error — this contract declares a planet location
        country.issueContract({ contract, location: fleet });
        country.issueContract({ contract: "a_vanilla_contract", location: fleet });
      },
    });
  });
});

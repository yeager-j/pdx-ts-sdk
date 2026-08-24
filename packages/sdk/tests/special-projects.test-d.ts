/**
 * The declared special-project location contract: `locationScope` on
 * `mod.specialProject` types the FROM its success callbacks read and the
 * `location` every `enableSpecialProject` call site passes — the same witness
 * pattern the situation target contract uses.
 */

import { describe, expectTypeOf, it } from "vitest";

import type { SpecialProjectItem } from "../src/generated/content-definers.ts";
import type { SpecialProjectRef } from "../src/generated/refs.ts";
import { createMod } from "../src/index.ts";
import {
  eventTarget,
  type ScopeRef,
  type SpecialProjectLocationContract,
  type SpecialProjectLocationScope,
} from "../src/stellaris.ts";

const CONFIG = { name: "Projects", prefix: "sp_test", supportedVersion: "4.4.*" } as const;

describe("the declared special-project location contract", () => {
  it("carries the declared scope on the defined object", () => {
    const mod = createMod(CONFIG);
    const project = mod.specialProject("survey", {
      eventScope: "ship_event",
      locationScope: "planet",
    });
    expectTypeOf(project.locationScope).toEqualTypeOf<"planet">();

    const undeclared = mod.specialProject("undeclared", { eventScope: "ship_event" });
    expectTypeOf(undeclared.locationScope).toEqualTypeOf<undefined>();
  });

  it("types the success callbacks' FROM from the declaration", () => {
    const mod = createMod(CONFIG);
    mod.specialProject("dig", {
      eventScope: "ship_event",
      locationScope: "planet",
      onSuccess: (ship, ctx) => {
        // THIS is still the project scope `eventScope` selects; only FROM is
        // the declaration.
        ship.setShipFlag("sp_test_dig_done");
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"planet">>();
        ctx.from.effects((planet) => planet.setPlanetFlag("sp_test_dig_site"));
      },
      onStart: (_ship, ctx) => {
        ctx.from.effects((planet) => planet.setPlanetFlag("sp_test_dig_started"));
      },
      onProgress50: (_ship, ctx) => {
        // @ts-expect-error — the location was declared a planet, not a fleet
        ctx.from.effects((fleet) => fleet.setFleetFlag("sp_test_dig_half"));
      },
    });
    mod.specialProject("undeclared", {
      eventScope: "ship_event",
      onSuccess: (_ship, ctx) => {
        // @ts-expect-error — no declaration, so FROM stays unreadable
        ctx.from.effects(() => {});
      },
    });
  });

  it("names the declaration's own constraint through the package", () => {
    // The contract type is exported and constrained by this union, so a
    // consumer writing a reusable helper can name both without reaching into
    // a generated module the package does not expose.
    const helper = <L extends SpecialProjectLocationScope>(
      project: SpecialProjectLocationContract<L>
    ): L => project.locationScope;
    const mod = createMod(CONFIG);
    const project = mod.specialProject("helper", {
      eventScope: "ship_event",
      locationScope: "starbase",
    });
    expectTypeOf(helper(project)).toEqualTypeOf<"starbase">();
  });

  it("requires a matching location at enable sites", () => {
    const mod = createMod(CONFIG);
    const events = mod.namespace();
    const project = mod.specialProject("recover", {
      eventScope: "ship_event",
      locationScope: "planet",
    });
    const world = eventTarget<"planet">("sp_test_world");
    events.country(1, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.enableSpecialProject({ name: project, location: world });
        // @ts-expect-error — the project declared a planet location; a country ref does not satisfy it
        country.enableSpecialProject({ name: project, location: ctx.self });
        // @ts-expect-error — a scope is named by a typed path, never a bare word
        country.enableSpecialProject({ name: project, location: "sp_test_world" });
        // @ts-expect-error — a declared FROM the call site never passes is a FROM the game does not supply
        country.enableSpecialProject({ name: project });
        // The rules' other arguments are untouched by the contract.
        country.enableSpecialProject({ name: project, location: world, owner: ctx.self });
      },
    });
  });

  it("rejects a project value that could be either of two declarations", () => {
    // A phantom witness is covariant, so a ternary over two differently
    // declared projects carries `"planet" | "fleet"` and a planet location
    // satisfies it — while the project that actually runs may be the fleet
    // one. There is no single declaration to check, so the call site is
    // rejected rather than checked against the arm that happens to match.
    const mod = createMod(CONFIG);
    const events = mod.namespace();
    const planetProject = mod.specialProject("planet_located", {
      eventScope: "ship_event",
      locationScope: "planet",
    });
    const fleetProject = mod.specialProject("fleet_located", {
      eventScope: "ship_event",
      locationScope: "fleet",
    });
    const world = eventTarget<"planet">("sp_test_either_world");
    const either = (0 as number) > 1 ? planetProject : fleetProject;
    events.country(3, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        // @ts-expect-error — either project could run here, and they declare different locations
        country.enableSpecialProject({ name: either, location: world });
        // Narrowing to one restores the ordinary checked call.
        country.enableSpecialProject({ name: planetProject, location: world });
      },
    });
    // A union of projects that agree is not ambiguous: the declaration is
    // still one scope, so nothing about this needs narrowing.
    const agreeing =
      (0 as number) > 1
        ? planetProject
        : mod.specialProject("also_planet", {
            eventScope: "ship_event",
            locationScope: "planet",
          });
    events.country(4, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.enableSpecialProject({ name: agreeing, location: world });
      },
    });
  });

  it("keeps the declaration through the registry's own item type", () => {
    // `SpecialProjectItem` is the vocabulary a feature's contents are named
    // with, so it is the likeliest place for a declaration to be dropped on
    // the way to an enable site. It carries the witness instead: named with
    // the scope it holds the contract survives, and named bare it widens to
    // every scope the registry admits — which is checkable as none of them,
    // and says so rather than accepting any location at all.
    const mod = createMod({ ...CONFIG, prefix: "sp_test_item" });
    const events = mod.namespace();
    const declared = mod.specialProject("declared", {
      eventScope: "ship_event",
      locationScope: "planet",
    });
    const kept: SpecialProjectItem<"planet"> = declared;
    const widened: SpecialProjectItem = declared;
    const world = eventTarget<"planet">("sp_test_item_world");
    const fleet = eventTarget<"fleet">("sp_test_item_fleet");
    events.country(5, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.enableSpecialProject({ name: kept, location: world });
        // @ts-expect-error — the declaration survived the annotation; a fleet does not satisfy it
        country.enableSpecialProject({ name: kept, location: fleet });
        // @ts-expect-error — widened to every location scope at once, so there is no one scope to check
        country.enableSpecialProject({ name: widened, location: fleet });
        // An undeclared project names the same type with `undefined`, and
        // stays on the unchecked path through it.
        const undeclared: SpecialProjectItem<undefined> = mod.specialProject("plain", {
          eventScope: "ship_event",
        });
        country.enableSpecialProject({ name: undeclared, location: fleet });
      },
    });
  });

  it("keeps the unchecked path for undeclared and vanilla projects", () => {
    const mod = createMod({ ...CONFIG, prefix: "sp_test_vanilla" });
    const events = mod.namespace();
    const undeclared = mod.specialProject("undeclared", { eventScope: "ship_event" });
    const vanillaRef: SpecialProjectRef = { id: "MUTANT_STALKER_PROJECT" };
    const world = eventTarget<"planet">("sp_test_vanilla_world");
    events.country(2, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.enableSpecialProject({ name: "MUTANT_STALKER_PROJECT", location: world });
        country.enableSpecialProject({ name: "MUTANT_STALKER_PROJECT" });
        country.enableSpecialProject({ name: vanillaRef, owner: ctx.self });
        // Undeclared: any location the rules admit, checked against nothing.
        country.enableSpecialProject({ name: undeclared, location: world });
      },
    });
  });
});

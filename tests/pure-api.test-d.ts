/**
 * The type-level half of the pure authoring API's evidence: one
 * `@ts-expect-error` per safety claim, plus the positive claims the factory
 * definers must keep. If any annotation stops firing, the typecheck gate
 * fails — the claims are pinned, not assumed.
 */

import { describe, expectTypeOf, it } from "vitest";

import {
  buildMod,
  createEvents,
  createOnActions,
  createSituationTypes,
  createTechnologies,
  eventTarget,
  onActions,
  type EventItemBase,
  type TechnologyItem,
  type TechnologyRef,
} from "../src/index.ts";

describe("factory definers", () => {
  /**
   * The property `docs/design-consumer-codegen.md` needs for branded literal
   * returns, and the one the class surface (generic only in the mod prefix)
   * widens away.
   */
  it("preserves the literal id type", () => {
    const techs = createTechnologies();
    const tech = techs.defineTechnology({
      id: "probe_neg_tech",
      name: "T",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    expectTypeOf(tech.id).toEqualTypeOf<"probe_neg_tech">();
    // @ts-expect-error — the id is the literal "probe_neg_tech", not just string
    const other: "some_other_id" = tech.id;
    void other;
  });

  /**
   * The item is a `TypedRef` for its own registry and no other. The graft's
   * `targetScope` intersection is the interesting case: a hand-written type
   * rides on top of the generated item, and the brand has to survive it.
   */
  it("brands a definer's return with its own registry, graft included", () => {
    const techs = createTechnologies();
    const situations = createSituationTypes();
    const tech = techs.defineTechnology({
      id: "probe_neg_tech_brand",
      name: "T",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const situation = situations.defineSituationType({
      id: "probe_neg_sit_brand",
      name: "S",
      monthlyProgress: { base: 1 },
    });
    const ownRegistry: TechnologyRef = tech;
    void ownRegistry;
    // @ts-expect-error — a situation type definition is not a technology reference
    const crossRegistry: TechnologyRef = situation;
    void crossRegistry;
  });

  it("types a collection's items with its registry's element type", () => {
    const techs = createTechnologies();
    expectTypeOf(techs.items).toEqualTypeOf<readonly TechnologyItem[]>();
    // @ts-expect-error — a technology collection can never contain event items
    const wrong: readonly EventItemBase[] = techs.items;
    void wrong;
  });
});

describe("the event FROM witness contract", () => {
  it("survives the factory definers", () => {
    const events = createEvents("neg_events", "probe_neg");
    const witnessed = events.definePlanetEvent({ id: 40, from: "country", isTriggeredOnly: true });
    events.defineCountryEvent({
      id: 41,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.everyOwnedPlanet({}, (planet) => {
          planet.planetEvent({ id: witnessed, from: ctx.self });
          // @ts-expect-error — the event declares FROM country; firing without a witness is rejected
          planet.planetEvent({ id: witnessed });
        });
      },
    });
  });

  it("rejects a witness of the wrong scope", () => {
    const events = createEvents("neg_from_events", "probe_neg_from");
    const planetFrom = events.definePlanetEvent({ id: 42, from: "planet", isTriggeredOnly: true });
    events.defineCountryEvent({
      id: 43,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.everyOwnedPlanet({}, (planet) => {
          // @ts-expect-error — ctx.self is a country ref; the event declares FROM planet
          planet.planetEvent({ id: planetFrom, from: ctx.self });
        });
      },
    });
  });
});

describe("the on-action contract", () => {
  it("is checked at the binding", () => {
    const events = createEvents("neg_hook_events", "probe_neg_hooks");
    const hooks = createOnActions();
    const countryEvent = events.defineCountryEvent({ id: 50, isTriggeredOnly: true });
    const planetEvent = events.definePlanetEvent({ id: 51, isTriggeredOnly: true });
    const witnessed = events.defineCountryEvent({ id: 52, from: "country", isTriggeredOnly: true });
    hooks.on(onActions.onGameStartCountry, countryEvent);
    // @ts-expect-error — the hook supplies country scope; a planet event does not satisfy it
    hooks.on(onActions.onGameStartCountry, planetEvent);
    // @ts-expect-error — the hook supplies no FROM; an event declaring FROM country is rejected
    hooks.on(onActions.onGameStartCountry, witnessed);
  });
});

describe("the situation target contract", () => {
  it("rides the factory definer's targetScope graft", () => {
    const situations = createSituationTypes();
    const events = createEvents("neg_sit_events", "probe_neg_sit");
    const planetSit = situations.defineSituationType({
      id: "probe_neg_sit",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    expectTypeOf(planetSit.targetScope).toEqualTypeOf<"planet">();
    const world = eventTarget<"planet">("probe_neg_world");
    events.defineCountryEvent({
      id: 60,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.startSituation({ type: planetSit, target: world });
        // @ts-expect-error — the type declared a planet target; a country ref does not satisfy it
        country.startSituation({ type: planetSit, target: ctx.self });
      },
    });
  });
});

describe("buildMod's input", () => {
  it("takes collections, never loose items", () => {
    const techs = createTechnologies();
    const tech = techs.defineTechnology({
      id: "probe_neg_loose",
      name: "L",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const config = { name: "N", prefix: "probe_neg", supportedVersion: "4.4.*" };
    buildMod(config, [techs]);
    // @ts-expect-error — a bare content item is not a collection
    buildMod(config, [tech]);
  });
});

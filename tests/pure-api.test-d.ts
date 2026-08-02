/**
 * The type-level half of the pure authoring API's evidence: one
 * `@ts-expect-error` per safety claim, plus the positive claims the definers
 * must keep. If any annotation stops firing, the typecheck gate fails — the
 * claims are pinned, not assumed.
 *
 * The collection factories these claims were originally written against are
 * gone (SDK-23). Every claim they pinned is pinned here on the free definers,
 * or in the suite that owns the contract outright: the event FROM witness in
 * events.test-d.ts, the situation target contract in situations.test-d.ts.
 */

import { describe, expectTypeOf, it } from "vitest";

import {
  buildMod,
  collection,
  defineSituationType,
  defineTechnology,
  defineTradition,
  namespace,
  on,
  onActions,
  type Collection,
  type ContentItem,
  type EventItemBase,
  type TechnologyDef,
  type TechnologyItem,
  type TechnologyRef,
  type TraditionItem,
} from "../src/index.ts";

/**
 * The definers, and what a definition is once no collection is in the way:
 * the literal id survives, the situation graft's `targetScope` rides on the
 * one object returned, and the registry brand is on the item rather than on
 * whatever collected it.
 */
describe("free definers", () => {
  it("preserves the literal id with no collection in the way", () => {
    const tech = defineTechnology({
      id: "probe_neg_free_tech",
      name: "T",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    expectTypeOf(tech.id).toEqualTypeOf<"probe_neg_free_tech">();
    expectTypeOf(tech).toEqualTypeOf<
      ContentItem<"technology", TechnologyDef<"probe_neg_free_tech">>
    >();
    // @ts-expect-error — the id is the literal, not just string
    const other: "some_other_id" = tech.id;
    void other;
  });

  it("carries targetScope on the one object it returns", () => {
    // The graft used to push one object and return a second, wider one. Free,
    // there is only the one — it has to be both the item and the contract.
    const situation = defineSituationType({
      id: "probe_neg_free_sit",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    expectTypeOf(situation.targetScope).toEqualTypeOf<"planet">();
    expectTypeOf(situation.itemKind).toEqualTypeOf<"content">();
    const ownRegistry: TechnologyRef = defineTechnology({
      id: "probe_neg_free_brand",
      name: "T",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    void ownRegistry;
    // @ts-expect-error — a situation type definition is still not a technology reference
    const crossRegistry: TechnologyRef = situation;
    void crossRegistry;
  });

  it("types collection() by the items it is given", () => {
    const techs = collection("free_techs", [
      defineTechnology({
        id: "probe_neg_collected",
        name: "T",
        area: "physics",
        tier: 1,
        category: "particles",
      }),
    ]);
    expectTypeOf(techs.items[0]!.type).toEqualTypeOf<"technology">();
    expectTypeOf(techs.items).toEqualTypeOf<
      readonly ContentItem<"technology", TechnologyDef<"probe_neg_collected">>[]
    >();
    const asRegistryCollection: Collection<TechnologyItem> = techs;
    void asRegistryCollection;
    // @ts-expect-error — a technology collection is not a tradition collection
    const wrongRegistry: Collection<TraditionItem> = techs;
    void wrongRegistry;
    // @ts-expect-error — a technology collection's items can never be event items
    const wrongKind: readonly EventItemBase[] = techs.items;
    void wrongKind;
    // Mixed registries are legal and land in one file — the element type is
    // the union, which is what stops it being read as either one alone.
    const mixed = collection("free_mixed", [
      defineTradition({ id: "probe_neg_mixed_trad", name: "T", effects: "None." }),
      defineTechnology({
        id: "probe_neg_mixed_tech",
        name: "T",
        area: "physics",
        tier: 1,
        category: "particles",
      }),
    ]);
    // @ts-expect-error — the union includes the tradition item
    const narrowed: Collection<TechnologyItem> = mixed;
    void narrowed;
  });
});

describe("the free on() contract", () => {
  it("checks scope and FROM against the hook, over the whole list", () => {
    const events = namespace("probe_neg_free_hooks");
    const countryEvent = events.defineCountryEvent({ id: 50, isTriggeredOnly: true });
    const alsoCountry = events.defineCountryEvent({ id: 53, isTriggeredOnly: true });
    const planetEvent = events.definePlanetEvent({ id: 51, isTriggeredOnly: true });
    const witnessed = events.defineCountryEvent({ id: 52, from: "country", isTriggeredOnly: true });
    on(onActions.onGameStartCountry, [countryEvent]);
    on(onActions.onGameStartCountry, [countryEvent, alsoCountry]);
    // @ts-expect-error — the hook supplies country scope; a planet event does not satisfy it
    on(onActions.onGameStartCountry, [planetEvent]);
    // @ts-expect-error — every element is checked, not just the first
    on(onActions.onGameStartCountry, [countryEvent, planetEvent]);
    // @ts-expect-error — the hook supplies no FROM; an event declaring FROM country is rejected
    on(onActions.onGameStartCountry, [witnessed]);
    // @ts-expect-error — a hook bound to nothing is a mistake, not an empty list
    on(onActions.onGameStartCountry, []);
  });
});

describe("buildMod's input", () => {
  it("takes collections, never loose items", () => {
    const tech = defineTechnology({
      id: "probe_neg_loose",
      name: "L",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const techs = collection(undefined, [tech]);
    const config = { name: "N", prefix: "probe_neg", supportedVersion: "4.4.*" };
    buildMod(config, [techs]);
    // @ts-expect-error — a bare content item is not a collection
    buildMod(config, [tech]);
  });
});

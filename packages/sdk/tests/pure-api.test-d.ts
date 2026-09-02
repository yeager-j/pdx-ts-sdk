/**
 * Capability authoring claims are primary: each `@ts-expect-error` pins a
 * public contract. The final two describes intentionally pin internal fold
 * input/output contracts until Layer 6 removes that low-level surface.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expectTypeOf, it } from "vitest";

import { createFeature as createFeatureInternal, type Feature } from "../src/authoring/feature.ts";
import { buildMod as buildInternal } from "../src/compiler/compile.ts";
import { defineSituationType as defineSituationTypeInternal } from "../src/content/situations.ts";
import type { ContentItem } from "../src/content/types.ts";
import { on as onInternal } from "../src/events/on-actions.ts";
import type { EventItemBase } from "../src/events/types.ts";
import {
  defineTechnology as defineTechnologyInternal,
  defineTradition as defineTraditionInternal,
} from "../src/generated/content-definers.ts";
import { namespace as namespaceInternal } from "../src/generated/event-definers.ts";
import { createMod } from "../src/index.ts";
import {
  onActions,
  type TechnologyDef,
  type TechnologyItem,
  type TechnologyRef,
  type TraditionItem,
} from "../src/stellaris.ts";

/**
 * The definers, and what a definition is once no feature is in the way:
 * the literal id survives, the situation graft's `targetScope` rides on the
 * one object returned, and the registry brand is on the item rather than on
 * whatever collected it.
 */
describe("capability authoring", () => {
  it("mints the literal id with no feature in the way", () => {
    const mod = createMod({ name: "Probe", prefix: "probe_neg", supportedVersion: "4.4.*" });
    const tech = mod.technology("free", {
      cost: 100,
      weight: 100,
      name: "T",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    expectTypeOf(tech.id).toEqualTypeOf<"probe_neg_tech_free">();
    // @ts-expect-error — the id is the literal, not just string
    const other: "some_other_id" = tech.id;
    void other;
  });

  it("carries targetScope on the one object it returns", () => {
    // The graft used to push one object and return a second, wider one. Free,
    // there is only the one — it has to be both the item and the contract.
    const mod = createMod({ name: "Probe", prefix: "probe_neg", supportedVersion: "4.4.*" });
    const situation = mod.situationType("free_sit", {
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    expectTypeOf(situation.targetScope).toEqualTypeOf<"planet">();
    expectTypeOf(situation.itemKind).toEqualTypeOf<"content">();
    const ownRegistry: TechnologyRef = mod.technology("free_brand", {
      cost: 100,
      weight: 100,
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

  it("types feature() by the items it is given", () => {
    const mod = createMod({ name: "Probe", prefix: "probe_neg", supportedVersion: "4.4.*" });
    const techs = mod.feature("free_techs", [
      mod.technology("collected", {
        cost: 100,
        weight: 100,
        name: "T",
        area: "physics",
        tier: 1,
        category: "particles",
      }),
    ]);
    expectTypeOf(techs.items[0]!.type).toEqualTypeOf<"technology">();
    expectTypeOf(techs.items[0]!.id).toEqualTypeOf<"probe_neg_tech_collected">();
    const asRegistryFeature: Feature<TechnologyItem> = techs;
    void asRegistryFeature;
    // @ts-expect-error — a technology feature is not a tradition feature
    const wrongRegistry: Feature<TraditionItem> = techs;
    void wrongRegistry;
    // @ts-expect-error — a technology feature's items can never be event items
    const wrongKind: readonly EventItemBase[] = techs.items;
    void wrongKind;
    // Mixed registries are legal and land in one file — the element type is
    // the union, which is what stops it being read as either one alone.
    const mixed = mod.feature("free_mixed", [
      mod.tradition("mixed_trad", { name: "T", effects: "None." }),
      mod.technology("mixed_tech", {
        cost: 100,
        weight: 100,
        name: "T",
        area: "physics",
        tier: 1,
        category: "particles",
      }),
    ]);
    // @ts-expect-error — the union includes the tradition item
    const narrowed: Feature<TechnologyItem> = mixed;
    void narrowed;
  });

  it("keeps handles out of features, on both the content and event sides", () => {
    // Every `ModItem` arm carries a literal `itemKind`; neither handle has one,
    // which is the whole reason a handle cannot be placed. That has been true
    // by construction rather than by assertion, so pin it: a minted id that
    // reached the Fold without a body would emit nothing while every reference
    // to it still resolved.
    const mod = createMod({ name: "Handles", prefix: "handle_neg", supportedVersion: "4.4.*" });

    // @ts-expect-error — a content handle is an identity, not content
    mod.feature("perks", [mod.ascensionPerkHandle("spelltech")]);
    // @ts-expect-error — an event handle is a reference, not an event item
    mod.feature("events", [mod.namespace("chain").countryHandle(1)]);

    // What define() returns does place.
    mod.feature("perks", [mod.ascensionPerkHandle("spelltech").define({ name: "X" })]);
  });
});

describe("the capability on() contract", () => {
  it("checks scope and FROM against the hook, over the whole list", () => {
    const mod = createMod({ name: "Probe", prefix: "probe_neg", supportedVersion: "4.4.*" });
    const events = mod.namespace("free_hooks");
    const countryEvent = events.country(50, { isTriggeredOnly: true });
    const alsoCountry = events.country(53, { isTriggeredOnly: true });
    const planetEvent = events.planet(51, { isTriggeredOnly: true });
    const witnessed = events.country(52, { scopes: { from: "country" }, isTriggeredOnly: true });
    mod.on(onActions.onGameStartCountry, [countryEvent]);
    mod.on(onActions.onGameStartCountry, [countryEvent, alsoCountry]);
    // @ts-expect-error — the hook supplies country scope; a planet event does not satisfy it
    mod.on(onActions.onGameStartCountry, [planetEvent]);
    // @ts-expect-error — every element is checked, not just the first
    mod.on(onActions.onGameStartCountry, [countryEvent, planetEvent]);
    // @ts-expect-error — the hook supplies no FROM; an event declaring FROM country is rejected
    mod.on(onActions.onGameStartCountry, [witnessed]);
    // @ts-expect-error — a hook bound to nothing is a mistake, not an empty list
    mod.on(onActions.onGameStartCountry, []);
  });
});

describe("buildMod's input", () => {
  it("takes features, never loose items", () => {
    const tech = defineTechnologyInternal({
      cost: 100,
      weight: 100,
      id: "probe_neg_loose",
      name: "L",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const techs = createFeatureInternal(undefined, [tech]);
    const config = { name: "N", prefix: "probe_neg", supportedVersion: "4.4.*" };
    buildInternal(config, [techs]);
    // @ts-expect-error — a bare content item is not a feature
    buildInternal(config, [tech]);
  });
});

describe("buildMod's output", () => {
  it("carries the on-action emission as data, not the accumulator", () => {
    const event = namespaceInternal("probe_neg").defineCountryEvent({
      id: 1,
      isTriggeredOnly: true,
    });
    const mod = buildInternal({ name: "N", prefix: "probe_neg", supportedVersion: "4.4.*" }, [
      createFeatureInternal("events", [event]),
      createFeatureInternal(undefined, [onInternal(onActions.onGameStartCountry, [event])]),
    ]);
    expectTypeOf(mod.onActions).toEqualTypeOf<readonly PdxEntry[]>();
    // @ts-expect-error — the accumulator stays inside the fold: registering
    // after buildMod returned would change what render(mod) emits, bypassing
    // the feature fold and its ordering rules.
    mod.onActions.register(onActions.onGameStartCountry, event);
  });
});

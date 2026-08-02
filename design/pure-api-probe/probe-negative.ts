/**
 * The type-level half of the pure-API probe: one `@ts-expect-error` per
 * safety claim, plus positive claims the factory definers must keep. If any
 * annotation stops firing, `npm run typecheck` fails — the claims are
 * pinned, not assumed. Nothing here runs; every case is wrapped in a
 * function that is never called, so the file is inert at runtime.
 */

import { eventTarget } from "../../packages/sdk/src/effect-core.ts";
import { onActions } from "../../packages/sdk/src/generated/on-actions.ts";
import { buildMod } from "./build.ts";
import {
  createEvents,
  createOnActions,
  createSituationTypes,
  createTechnologies,
  type TechnologyItem,
} from "./factories.ts";
import type { EventItemBase } from "./items.ts";

/**
 * Claim 1: factory definers preserve the literal id type — the property
 * `docs/design-consumer-codegen.md` needs for branded literal returns, and
 * the class surface (generic only in the mod prefix) widens away.
 */
export function literalIdPreserved(): void {
  const techs = createTechnologies();
  const tech = techs.defineTechnology({
    id: "probe_neg_tech",
    name: "T",
    area: "physics",
    tier: 1,
    category: "particles",
  });
  const literal: "probe_neg_tech" = tech.id;
  void literal;
  // @ts-expect-error — the id is the literal "probe_neg_tech", not just string
  const other: "some_other_id" = tech.id;
  void other;
}

/** Claim 1b: a collection's items carry its registry's element type. */
export function collectionItemsTyped(): void {
  const techs = createTechnologies();
  const typed: readonly TechnologyItem[] = techs.items;
  void typed;
  // @ts-expect-error — a technology collection can never contain event items
  const wrong: readonly EventItemBase[] = techs.items;
  void wrong;
}

/** Claim 2: the FROM witness contract survives the factory definers. */
export function fromWitnessEnforced(): void {
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
}

/** Claim 3: the on-action scope/FROM contract is checked at the binding. */
export function onActionContractEnforced(): void {
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
}

/** Claim 4: the situation targetScope graft rides the factory definer. */
export function situationTargetContract(): void {
  const situations = createSituationTypes();
  const events = createEvents("neg_sit_events", "probe_neg_sit");
  const planetSit = situations.defineSituationType({
    id: "probe_neg_sit",
    name: "S",
    monthlyProgress: { base: 1 },
    targetScope: "planet",
  });
  const declared: "planet" = planetSit.targetScope;
  void declared;
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
}

/** Claim 5: buildMod takes collections, never loose items. */
export function collectionsOnly(): void {
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
}

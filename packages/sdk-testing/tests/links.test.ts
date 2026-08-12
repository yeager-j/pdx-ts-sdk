/**
 * SDK-145's second half: the `owner` link, and the diagnosis it used to get.
 *
 * `owner` is the single most-used key in Dawn Of Ascension's events (286
 * uses), and the fixture already modeled the relation it walks — a planet's
 * owner is the country it is nested under. What it got instead was the
 * scripted-binding message, which says the interpreter can never model this
 * and to go assert against emitted script: true of a vanilla scripted trigger,
 * wrong here, and the two answers send a reader in opposite directions.
 */

import {
  countryFlags,
  createMod,
  hasCountryFlag,
  owner,
  scriptedTrigger,
  spaceOwner,
} from "@pdx-ts/sdk";
import { describe, expect, it } from "vitest";

import { evaluate, explain, fixture, renderExplanation } from "../src/index.ts";

const flags = countryFlags("sdk145_ascended");

function makeMod(prefix: string) {
  return createMod({ name: prefix, prefix, supportedVersion: "4.4.*" });
}

describe("the owner link", () => {
  const world = () =>
    fixture(
      {
        countries: [
          { name: "player", flags: [flags.sdk145_ascended], planets: [{ name: "homeworld" }] },
          { name: "rival", planets: [{ name: "frontier" }] },
        ],
      },
      { events: [] }
    );

  it("evaluates a country condition from planet scope", () => {
    const players = world();

    expect(
      evaluate(owner(hasCountryFlag(flags.sdk145_ascended)), players.country(0).planet(0))
    ).toBe(true);
    expect(
      evaluate(owner(hasCountryFlag(flags.sdk145_ascended)), players.country(1).planet(0))
    ).toBe(false);
  });

  it("names the owner it navigated to in the explain tree", () => {
    const rendered = renderExplanation(
      explain(owner(hasCountryFlag(flags.sdk145_ascended)), world().country(0).planet(0))
    );

    expect(rendered).toContain("owner");
    expect(rendered).toContain('country "player"');
  });

  it("navigates in effect position too, off the same table", () => {
    const mod = makeMod("sdk145_owner_effect");
    const event = mod.namespace().planet(1, {
      isTriggeredOnly: true,
      immediate: (planet) => {
        planet.owner((country) => country.giveTechnology({ tech: "tech_lasers_1" }));
      },
    });
    const fixtureWorld = fixture(
      { countries: [{ name: "player", planets: [{ name: "homeworld" }] }] },
      { events: [event] }
    );

    fixtureWorld.fire(event, fixtureWorld.country(0).planet(0));

    expect(fixtureWorld.country(0).has("tech_lasers_1")).toBe(true);
  });

  it("refuses the scopes the fixture holds no ownership edge for, by name", () => {
    const situationWorld = fixture(
      {
        countries: [{ name: "player" }],
        situations: [{ name: "crisis", targetCountry: 0 }],
      },
      { events: [] }
    );

    expect(() =>
      evaluate(owner(hasCountryFlag(flags.sdk145_ascended)), situationWorld.situation(0))
    ).toThrow(/owner is a scope link the fixture resolves from planet scope only/);
  });
});

describe("the unmodeled-key diagnosis", () => {
  it("calls an unmodeled link navigation, not a scripted binding it can never read", () => {
    const world = fixture({ countries: [{ name: "player", planets: [{}] }] }, { events: [] });

    let message = "";
    try {
      evaluate(spaceOwner(hasCountryFlag(flags.sdk145_ascended)), world.country(0).planet(0));
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('"space_owner" (to country scope) is a scope link');
    expect(message).toContain("LINK_SEMANTICS");
    expect(message).toContain("Modeled links: from, owner, target, event_target:*");
    expect(message).not.toContain("never reads their bodies");
  });

  it("keeps the scripted-binding answer for a key that really is one", () => {
    const world = fixture({ countries: [{ name: "player" }] }, { events: [] });
    const isFallenEmpire = scriptedTrigger("is_fallen_empire", "country");

    expect(() => evaluate(isFallenEmpire(), world.country(0))).toThrow(/never reads their bodies/);
  });

  it("tells an unmodeled link apart from an unimplemented effect in effect position", () => {
    const mod = makeMod("sdk145_effect_position");
    const event = mod.namespace().planet(1, {
      isTriggeredOnly: true,
      immediate: (planet) => {
        planet.branchOfficeOwner((country) => country.giveTechnology({ tech: "tech_lasers_1" }));
      },
    });
    const world = fixture(
      { countries: [{ name: "player", planets: [{ name: "homeworld" }] }] },
      { events: [event] }
    );

    expect(() => world.fire(event, world.country(0).planet(0))).toThrow(
      /"branch_office_owner" \(to country scope\) is a scope link this interpreter does not model/
    );
  });
});

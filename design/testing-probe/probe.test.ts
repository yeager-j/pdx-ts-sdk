/**
 * Mainline artifact 2 of the testing probe: the handoff's end-to-end case in
 * one file, written against the target testing API before the interpreter
 * existed. The three goldens below were written BY HAND first and are
 * immutable — if one turns out to be wrong, that is a recorded finding, not
 * an edit-until-green.
 *
 * Gate (docs/handoff-mod-testing.md): this file reads clean with zero casts;
 * every interpreted semantic is one we would defend against the real game;
 * the unimplemented path fails with an actionable message; and the explain
 * matcher names the failing subcondition without the reader opening the
 * fixture.
 */

import { kv, serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import {
  evaluate,
  explain,
  renderExplanation,
  run,
} from "../../packages/sdk-testing/src/interpret.ts";
import { installMatchers } from "../../packages/sdk-testing/src/matchers.ts";
import {
  declareFrom,
  fixture,
  renderFired,
  type World,
} from "../../packages/sdk-testing/src/world.ts";
import { trigger } from "../../packages/sdk/src/trigger-core.ts";
import { isAtWar, numOwnedPlanets } from "../../packages/sdk/src/triggers.ts";
import {
  aftershock,
  flags,
  globals,
  humReturns,
  resonancePotential,
  resonanceTheory,
} from "./probe-mod.ts";

installMatchers();

// The PDXScript the probe mod records — hand-written from the example mod's
// golden plus the give_technology follow-up, before the recorder ran.
const GOLDEN_MOD = `planet_event = {
	id = testing_probe.2
	title = testing_probe.2.name
	desc = testing_probe.2.desc
	is_triggered_only = yes
	immediate = {
		from = {
			add_resource = {
				influence = 50
			}
			give_technology = {
				tech = testing_probe_tech_resonance_theory
			}
		}
	}
	option = {
		name = testing_probe.2.a
	}
}

country_event = {
	id = testing_probe.1
	title = testing_probe.1.name
	desc = testing_probe.1.desc
	is_triggered_only = yes
	immediate = {
		random_list = {
			60 = {
				set_country_flag = tp_heard_the_hum
			}
			40 = {
				modifier = {
					factor = 2
					is_at_war = yes
				}
				every_owned_planet = {
					limit = {
						has_owner = yes
					}
					save_event_target_as = tp_storm_world
					planet_event = {
						id = testing_probe.2
						days = 30
					}
				}
			}
		}
		if = {
			limit = {
				has_country_flag = tp_heard_the_hum
			}
			event_target:tp_storm_world = {
				add_deposit = d_minerals_1
			}
		}
		else = {
			log = "the hum went unheard"
		}
	}
	option = {
		name = testing_probe.1.a
	}
}
`;

// The pass/fail tree for resonancePotential against a country holding BOTH
// flags: exactly one subcondition — the NOT — fails, and the tree names it.
const GOLDEN_EXPLAIN = `✗ AND
  ✓ has_global_flag = tp_lattice_awake — set globally
  ✓ has_country_flag = tp_heard_the_hum — set on country "player"
  ✗ NOT
    ✓ has_country_flag = tp_pacifist_path — set on country "player"`;

// The rich fired log after the whole chain has run: the harness fire on day
// 0, then one delayed aftershock per owned planet delivered last-enqueued-first
// on day 30, both carrying the firing country as FROM. The order was corrected
// after the Stellaris 4.4.6 hardening calibration.
const GOLDEN_FIRED = `[day 0] testing_probe.1 @ country(0) "player" via harness
[day 30] testing_probe.2 @ planet(0.1) "beta" from country(0) "player" via effect
[day 30] testing_probe.2 @ planet(0.0) "alpha" from country(0) "player" via effect`;

function makeWorld(): World {
  return fixture(
    {
      globalFlags: [globals.tp_lattice_awake],
      countries: [
        {
          name: "player",
          flags: [flags.tp_heard_the_hum, flags.tp_pacifist_path],
          planets: [{ name: "alpha" }, { name: "beta" }],
        },
        { name: "rival", planets: [{ name: "gamma" }] },
      ],
    },
    { events: [humReturns, declareFrom(aftershock, "country")] }
  );
}

describe("testing probe", () => {
  it("round-trips the probe mod to the hand-written golden", () => {
    expect(serialize([aftershock.entry, humReturns.entry])).toBe(GOLDEN_MOD);
  });

  it("evaluate and explain name the one failing subcondition", () => {
    const world = makeWorld();
    const player = world.country(0);

    expect(evaluate(resonancePotential, player)).toBe(false);
    expect(renderExplanation(explain(resonancePotential, player))).toBe(GOLDEN_EXPLAIN);

    // The matcher surfaces the tree: its failure message names the failing
    // leaf without the reader opening the fixture.
    expect(() => expect(resonancePotential).toHoldFor(player)).toThrow(/tp_pacifist_path/);
  });

  it("runs the chain: forced arm, cascade, advance, delivery with FROM", () => {
    const world = makeWorld();
    const player = world.country(0);

    world.fire(humReturns, player, { arms: [40] });

    // Fired immediately; the two aftershocks are queued, not delivered.
    expect(world.fired).toContainEvent(humReturns, { day: 0 });
    expect(world.fired).not.toContainEvent(aftershock);

    world.advance(30);

    expect(world.fired).toContainEvent(aftershock, { day: 30, from: player });
    expect(renderFired(world)).toBe(GOLDEN_FIRED);

    // The delivered immediates ran: influence per aftershock, the tech grant,
    // and the deposit added through the saved event target (last save wins,
    // so the deposit lands on the second planet).
    expect(player.resource("influence")).toBe(100);
    expect(player.has(resonanceTheory)).toBe(true);
    expect(player.planet(1).deposits).toContain("d_minerals_1");
  });

  it("evaluates numeric literals against fixture-stored numbers", () => {
    const world = makeWorld();
    expect(evaluate(numOwnedPlanets(">=", 2), world.country(0))).toBe(true);
    expect(evaluate(numOwnedPlanets(">", 2), world.country(0))).toBe(false);
  });

  it("throws on the numeric v1 line: script values are out", () => {
    const world = makeWorld();
    const scripted = trigger([kv("num_owned_planets", "some_script_value")]);
    expect(() => evaluate(scripted, world.country(0))).toThrow(/numeric v1/);
  });

  it("throws loudly on an unimplemented trigger, with the coverage summary", () => {
    const world = makeWorld();
    expect(() => evaluate(isAtWar(), world.country(0))).toThrow(/is_at_war/);
    expect(() => evaluate(isAtWar(), world.country(0))).toThrow(/coverage: \d+ triggers/);
  });

  it("requires a forced arm: an unforced random_list throws", () => {
    const world = makeWorld();
    expect(() => world.fire(humReturns, world.country(0))).toThrow(/random_list/);
    expect(() => world.fire(humReturns, world.country(0))).toThrow(/forced/);
  });

  it("throws on delivery of an event that was never registered", () => {
    const world = fixture(
      {
        countries: [{ name: "player", planets: [{ name: "alpha" }] }],
      },
      { events: [humReturns] }
    );
    world.fire(humReturns, world.country(0), { arms: [40] });
    expect(() => world.advance(30)).toThrow(/testing_probe\.2/);
  });

  it("run() is pure: the returned state has the change, the world does not", () => {
    const world = makeWorld();
    const player = world.country(0);

    const result = run((c) => c.setCountryFlag(flags.tp_heard_the_hum), player);

    expect(result.after.hasFlag(flags.tp_heard_the_hum)).toBe(true);
    // `player` already has the flag in the fixture, so assert purity through
    // a flag the fixture does NOT set on the rival.
    const rival = world.country(1);
    const rivalResult = run((c) => c.setCountryFlag(flags.tp_pacifist_path), rival);
    expect(rivalResult.after.hasFlag(flags.tp_pacifist_path)).toBe(true);
    expect(rival.hasFlag(flags.tp_pacifist_path)).toBe(false);
  });
});

/**
 * SDK-49's first half: widening `SimScopeName` beyond country/planet.
 *
 * `fleet` and `archaeological_site` are exercised together, the way the
 * command-center dig probe actually needed them: a fleet event whose FROM is
 * an archaeological site, touching the site's own state through `ctx.from`.
 * `situation` gets the ticket's headline case — a multi-row monthly-progress
 * calculation with variables and thresholds, the exact shape that used to be
 * untestable and fell back to regexing emitted script.
 */
import {
  and,
  checkVariable,
  countryFlags,
  currentSituationApproach,
  defineSituationType,
  hasCountryFlag,
  isVariableSet,
  namespace,
  situationProgress,
  target,
} from "@pdx-ts/sdk";
import { describe, expect, it } from "vitest";

import { declareFrom, evaluateWeightBlock, fixture } from "../src/index.ts";

describe("fleet and archaeological_site scopes", () => {
  it("models a fleet event whose FROM is an archaeological site, and the site's own state", () => {
    const events = namespace("dig_probe");
    const drillEvent = events.defineFleetEvent({
      id: 1,
      from: "archaeological_site",
      isTriggeredOnly: true,
      immediate: (_fleet, ctx) => {
        ctx.from.effects((site) => {
          site.setSiteProgressLocked(true);
        });
      },
    });

    const world = fixture(
      {
        fleets: [{ name: "excavation fleet" }],
        archaeologicalSites: [{ name: "asteroid command center" }],
      },
      { events: [declareFrom(drillEvent, "archaeological_site")] }
    );

    const fleet = world.fleet(0);
    const site = world.archaeologicalSite(0);

    expect(site.progressLocked).toBe(false);
    world.fire(drillEvent, fleet, { from: site });
    expect(site.progressLocked).toBe(true);
  });
});

describe("situation scope", () => {
  const flags = countryFlags("sdk49_loyalist", "sdk49_rebel");

  it("evaluates a situation's own trigger against its state", () => {
    const world = fixture(
      { countries: [{ name: "player" }], situations: [{ name: "crisis", targetCountry: 0 }] },
      { events: [] }
    );
    const situation = world.situation(0);

    expect(situation.progress).toBe(0);
    expect(situation.target.name).toBe("player");
  });

  it("runs `set_variable`/`change_variable`/`multiply_variable` and the situation's own effect-side target link", () => {
    const events = namespace("sdk49_situation_effects");
    const markLoyal = events.defineSituationEvent({
      id: 1,
      isTriggeredOnly: true,
      immediate: (situation) => {
        situation.setVariable({ which: "var_support", value: 4 });
        situation.changeVariable({ which: "var_support", value: 2 });
        situation.multiplyVariable({ which: "var_support", value: 1.5 });
        situation.target<"country">((country) => {
          country.setCountryFlag(flags.sdk49_loyalist);
        });
      },
    });

    const world = fixture(
      { countries: [{ name: "player" }], situations: [{ name: "crisis", targetCountry: 0 }] },
      { events: [markLoyal] }
    );
    const situation = world.situation(0);

    world.fire(markLoyal, situation);

    // (4 + 2) * 1.5
    expect(situation.variable("var_support")).toBe(9);
    expect(world.country(0).hasFlag(flags.sdk49_loyalist)).toBe(true);
  });

  it(
    "computes an 11-row monthly-progress arithmetic block — variables, thresholds and the " +
      "target link — the case a fixture modeling only country/planet could never run",
    () => {
      const world = fixture(
        {
          countries: [{ name: "player", flags: [flags.sdk49_loyalist] }],
          situations: [
            {
              name: "identity crisis",
              targetCountry: 0,
              initialProgress: 50,
              approach: "sdk49_embrace",
              variables: { var_recent_unrest: 3 },
            },
          ],
        },
        { events: [] }
      );
      const situation = world.situation(0);

      const situationType = defineSituationType({
        id: "sdk49_test_situation",
        name: "Test Situation",
        targetScope: "country",
        monthlyProgress: {
          base: 10,
          modifiers: [
            {
              desc: "Loyalist sentiment",
              add: 5,
              when: target<"country">(hasCountryFlag(flags.sdk49_loyalist)),
            },
            {
              desc: "Rebel sentiment",
              subtract: 4,
              when: target<"country">(hasCountryFlag(flags.sdk49_rebel)),
            },
            { desc: "Recent unrest recorded", add: 3, when: isVariableSet("var_recent_unrest") },
            {
              desc: "Unrest accelerant",
              mult: 1.5,
              when: checkVariable({ which: "var_recent_unrest", value: [">", 2] }),
            },
            {
              desc: "The approach amplifies momentum",
              mult: 2,
              when: currentSituationApproach("sdk49_embrace"),
            },
            { desc: "Floor near collapse", minValue: 0, when: situationProgress("<", 5) },
            { desc: "Ceiling near completion", maxValue: 100, when: situationProgress(">", 95) },
            {
              desc: "Both flags somehow",
              add: 100,
              when: and(
                target<"country">(hasCountryFlag(flags.sdk49_loyalist)),
                target<"country">(hasCountryFlag(flags.sdk49_rebel))
              ),
            },
          ],
        },
      });

      // base 10
      // + loyalist flag set (5)              -> 15
      // (rebel flag not set, subtract skipped)
      // + var_recent_unrest is set (3)        -> 18
      // * var_recent_unrest > 2 (1.5)         -> 27
      // * approach is sdk49_embrace (2)       -> 54
      // (progress 50 is neither < 5 nor > 95, both clamps skipped)
      // (rebel flag still unset, the AND row skipped)
      expect(evaluateWeightBlock(situationType.def.monthlyProgress, situation)).toBe(54);
    }
  );

  it("refuses a row that combines more than one operation rather than guessing an order", () => {
    const situation = fixture(
      { countries: [{ name: "player" }], situations: [{ name: "crisis", targetCountry: 0 }] },
      { events: [] }
    ).situation(0);

    expect(() =>
      evaluateWeightBlock(
        {
          base: 0,
          modifiers: [{ desc: "ambiguous", add: 1, mult: 2, when: situationProgress(">=", 0) }],
        },
        situation
      )
    ).toThrow(/evaluates exactly one operation per row/);
  });

  it("throws reading an unset variable with `check_variable` rather than answering false", () => {
    const situation = fixture(
      { countries: [{ name: "player" }], situations: [{ name: "crisis", targetCountry: 0 }] },
      { events: [] }
    ).situation(0);

    expect(() =>
      evaluateWeightBlock(
        {
          base: 0,
          modifiers: [
            {
              desc: "unset read",
              add: 1,
              when: checkVariable({ which: "var_never_set", value: 0 }),
            },
          ],
        },
        situation
      )
    ).toThrow(/check_variable "var_never_set": not previously set/);
  });
});

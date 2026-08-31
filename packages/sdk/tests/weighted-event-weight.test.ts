/**
 * `WeightedEventRow.weight` is a `number`, and `random_events` keys its arms
 * by an `int` (`common/on_actions.cwt`). The gap between the two is reachable
 * by accident — a fraction out of arithmetic, `NaN` out of a missing operand,
 * `Infinity` out of a division — and every one of those has a spelling that
 * would be written out as if it named a share (SDK-324).
 *
 * Both weighted-event surfaces are checked here, because both reach the file
 * through one lowering: the on-action hook and the content `weightedEvents`
 * field.
 */

import { describe, expect, it } from "vitest";

import { createMod, render } from "../src/index.ts";
import { onActions } from "../src/stellaris.ts";

const mod = createMod({
  name: "Weighted event weight tests",
  prefix: "weight_test",
  supportedVersion: "4.0.*",
});

/** Every weight the type admits and no arm key can carry, with its spelling. */
const REFUSED: readonly (readonly [string, number, string])[] = [
  ["a fraction", 1.5, "1.5"],
  ["NaN", Number.NaN, "NaN"],
  ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
  ["negative infinity", Number.NEGATIVE_INFINITY, "-Infinity"],
];

/**
 * Integers the rule admits and an earlier reading of this check refused.
 *
 * `0` is not a hypothetical: `common/on_actions/00_on_actions.txt` writes
 * `0 = crime.1` and `0 = shroud.3`, so refusing it would refuse a row the
 * game ships. Nothing in the 40 shipped files holding a `random_events`
 * block writes a negative one, and nothing there argues for refusing one
 * either — the rule says `int`, and this stops where the rule does.
 */
const ACCEPTED: readonly (readonly [string, number])[] = [
  ["zero, which vanilla itself writes", 0],
  ["a negative, which the `int` rule admits", -3],
];

describe("weighted event weights", () => {
  describe("on an on-action hook", () => {
    it.each(REFUSED)("refuses %s before rendering", (_description, weight, spelling) => {
      const feature = mod.feature(undefined, [
        mod.on(onActions.onFiveYearPulse, {
          randomEvents: [{ weight, event: "third_party.1" }],
        }),
      ]);

      expect(() => mod.compile([feature])).toThrow(
        `On-action "on_five_year_pulse" was given the weighted event weight ${spelling}.`
      );
    });

    it("names the rule the refusal rests on", () => {
      const feature = mod.feature(undefined, [
        mod.on(onActions.onFiveYearPulse, {
          randomEvents: [{ weight: 1.5, event: "third_party.1" }],
        }),
      ]);

      expect(() => mod.compile([feature])).toThrow(/common\/on_actions\.cwt/);
    });

    it.each(ACCEPTED)("emits %s", (_description, weight) => {
      const feature = mod.feature(undefined, [
        mod.on(onActions.onFiveYearPulse, {
          randomEvents: [{ weight, event: "third_party.1" }],
        }),
      ]);

      expect(
        render(mod.compile([feature])).get("common/on_actions/weight_test_on_actions.txt")
      ).toContain(`${weight} = third_party.1`);
    });

    it("still emits whole positive weights, duplicates and all", () => {
      const feature = mod.feature(undefined, [
        mod.on(onActions.onFiveYearPulse, {
          randomEvents: [
            { weight: 25, event: "third_party.1" },
            { weight: 25, event: "third_party.1" },
            { weight: 50 },
          ],
        }),
      ]);

      expect(
        render(mod.compile([feature])).get("common/on_actions/weight_test_on_actions.txt")
      ).toContain("25 = third_party.1\n\t\t25 = third_party.1\n\t\t50 = 0");
    });
  });

  describe("on a content weightedEvents field", () => {
    it.each(REFUSED)("refuses %s and names the field", (_description, weight, spelling) => {
      const situations = mod.feature(undefined, [
        mod.situationType("monthly", {
          name: "Situation",
          monthlyProgress: { base: 1 },
          onMonthly: { randomEvents: [{ weight, event: "third_party.1" }] },
        }),
      ]);

      expect(() => render(mod.compile([situations]))).toThrow(
        `"on_monthly.random_events" was given the weighted event weight ${spelling}.`
      );
    });
  });
});

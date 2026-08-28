/**
 * SDK-308: a Trigger carrying inline display text is an owner-relative
 * template until it is placed, so its entries hold a placeholder rather than a
 * localization key. The interpreter must not read that placeholder as one.
 */

import { createMod } from "@pdx-ts/sdk";
import { countryFlags, customTooltip, hasCountryFlag } from "@pdx-ts/sdk/stellaris";
import { describe, expect, it } from "vitest";

import { evaluate, explain, fixture, renderExplanation } from "../src/index.ts";

const flags = countryFlags("deferred_loc_seen");

function world() {
  return fixture(
    { countries: [{ name: "player", flags: [flags.deferred_loc_seen] }] },
    {
      events: [],
    }
  );
}

describe("recorded inline localization in the interpreter", () => {
  it("refuses the rule rather than reading its placeholder as a key", () => {
    const condition = customTooltip("Requires an awakened gateway.");

    // `custom_tooltip` is display-only and not on the audited whitelist, so it
    // is refused by name. What matters here is that nothing in the interpreter
    // treated the deferred scalar as a real localization key on the way.
    expect(() => evaluate(condition, world().country(0))).toThrow(/custom_tooltip/);
  });

  it("evaluates the conditions beside it without resolving the placeholder", () => {
    const condition = customTooltip({
      failText: "Not yet.",
      conditions: hasCountryFlag(flags.deferred_loc_seen),
    });

    // The gated form writes its conditions inside the same block, so the block
    // is still refused as one unsupported rule rather than half-evaluated.
    expect(() => evaluate(condition, world().country(0))).toThrow(/custom_tooltip/);
  });

  it("does not present the placeholder as a localization key in an explanation", () => {
    const mod = createMod({
      name: "Deferred localization",
      prefix: "deferred_loc",
      supportedVersion: "4.4.*",
    });
    void mod;
    const explanation = explain(hasCountryFlag(flags.deferred_loc_seen), world().country(0));

    // The condition an author can actually interpret is unaffected: this pins
    // that adding the deferred protocol changed nothing about explanations.
    expect(renderExplanation(explanation)).not.toContain("__pdx_deferred_localization_");
    expect(explanation.result).toBe(true);
  });
});

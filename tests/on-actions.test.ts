import { describe, expect, it } from "vitest";

import { Mod, onActions } from "../src/index.ts";

function makeMod(prefix: "on_action_test" | "other_mod" = "on_action_test"): Mod {
  return new Mod({
    name: "On-action runtime tests",
    prefix,
    supportedVersion: "4.0.*",
  });
}

describe("on-action authoring", () => {
  it("renders one deterministic additive file and preserves event order", () => {
    const mod = makeMod();
    const first = mod.defineCountryEvent({ id: 1, isTriggeredOnly: true });
    const second = mod.defineCountryEvent({ id: 2, isTriggeredOnly: true });
    const diplomacy = mod.defineCountryEvent({
      id: 3,
      from: "country",
      isTriggeredOnly: true,
    });

    mod.on(onActions.onGameStartCountry, first);
    mod.on(onActions.onGameStartCountry, second);
    mod.on(onActions.onCustomDiplomacy, diplomacy);

    expect(mod.render().get("common/on_actions/on_action_test_on_actions.txt"))
      .toMatchInlineSnapshot(`
        "on_game_start_country = {
        	events = { on_action_test.1 on_action_test.2 }
        }

        on_custom_diplomacy = {
        	events = { on_action_test.3 }
        }
        "
      `);
    expect(mod.render()).toEqual(mod.render());
  });

  it("rejects duplicate registrations of one event on one hook", () => {
    const mod = makeMod();
    const event = mod.defineCountryEvent({ id: 4, isTriggeredOnly: true });
    mod.on(onActions.onGameStartCountry, event);

    expect(() => mod.on(onActions.onGameStartCountry, event)).toThrow(
      /already registered on on-action "on_game_start_country"/
    );
  });

  it("rejects events owned by a different Mod", () => {
    const owner = makeMod("other_mod");
    const receiver = makeMod();
    const event = owner.defineCountryEvent({ id: 5, isTriggeredOnly: true });

    expect(() => receiver.on(onActions.onGameStartCountry, event)).toThrow(
      /was not defined by the Mod receiving/
    );
  });
});

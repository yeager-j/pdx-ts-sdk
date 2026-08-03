/**
 * SDK-49's second half: the unsupported-scope case is a diagnosis, not a
 * bare TypeScript assignability failure. Before this, the only signal a
 * developer got for a scope outside `SimScopeName` was something like
 * `Type '"leader"' is not assignable to type 'SimScopeName'` — it names the
 * type but never says how many scopes it covers or what to do next, so an
 * unsupported scope and a misspelled one look identical.
 */
import { namespace } from "@pdx-ts/sdk";
import { describe, expect, it } from "vitest";

import {
  describeUnsupportedSimScope,
  fixture,
  SIM_SCOPE_NAMES,
  type SimEvent,
  type SimScopeName,
} from "../src/index.ts";

describe("the unsupported-scope diagnosis", () => {
  it("names how many scopes are modeled, lists them, and says what to do next", () => {
    const message = describeUnsupportedSimScope("leader");

    expect(message).toContain('"leader"');
    expect(message).toContain(`${SIM_SCOPE_NAMES.length} of Stellaris's`);
    for (const scope of SIM_SCOPE_NAMES) {
      expect(message).toContain(scope);
    }
    expect(message).toMatch(/widen SimScopeName in packages\/sdk-testing\/src\/state\.ts/);
    expect(message).toMatch(/check the scope name/);
  });

  it("fixture() throws that diagnosis for a scope built outside the typed definers, instead of a bare assignability failure", () => {
    const events = namespace("sdk49_scope_repro");
    const leaderEvent = events.defineLeaderEvent({ id: 1, isTriggeredOnly: true });

    expect(() =>
      fixture(
        { countries: [{ name: "player" }] },
        // Every real authoring path is caught at compile time by
        // `FixtureOptions.events`'s SimScopeName constraint — this cast
        // simulates the one path that is not: an event assembled from data
        // (a config, a dynamically-built registry) rather than a
        // `defineXEvent` call, which is exactly where a genuinely wrong or
        // misspelled scope would otherwise reach `World` unexplained.
        { events: [leaderEvent as unknown as SimEvent<SimScopeName, undefined>] }
      )
    ).toThrow(/models 5 of Stellaris's ~41 scopes/);
  });
});

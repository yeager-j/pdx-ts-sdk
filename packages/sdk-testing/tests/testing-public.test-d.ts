import type { DefinedEvent } from "@pdx-ts/sdk";

type TestingModule = typeof import("@pdx-ts/sdk-testing");
type MatcherModule = typeof import("@pdx-ts/sdk-testing/matchers");
declare const Testing: TestingModule;
declare const installMatchers: MatcherModule["installMatchers"];
declare const event: DefinedEvent<"country", undefined>;

const spec = {
  countries: [{ name: "player", planets: [{ name: "homeworld" }] }],
} satisfies import("@pdx-ts/sdk-testing").FixtureSpec;

const world = Testing.fixture(spec, { events: [event] });
const player: import("@pdx-ts/sdk-testing").Country = world.country(0);

Testing.evaluate;
Testing.explain;
Testing.run;
Testing.renderFired;
installMatchers;
player.planet(0);

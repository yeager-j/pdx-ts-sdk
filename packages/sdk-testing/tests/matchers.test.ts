import { kv } from "@pdx-ts/pdxscript";
import { trigger } from "@pdx-ts/sdk/stellaris";
import { describe, expect, it } from "vitest";

import { fixture } from "../src/index.ts";
import { installMatchers } from "../src/matchers.ts";

installMatchers();

describe("matcher diagnostics", () => {
  it("uses the same aggregate pre-scan as direct explanations", () => {
    const condition = trigger<"country">([
      kv("sdk149_unknown_one", true),
      kv("sdk149_unknown_two", true),
    ]);
    const country = fixture({ countries: [{}] }, { events: [] }).country(0);

    // The full workspace type-test run also loads the package's built matcher
    // augmentation, whose Country has a distinct private-field identity from
    // this source fixture. The matcher intentionally validates scope at runtime.
    expect(() => expect(condition).toHoldFor(country as never)).toThrow(
      /2 unimplemented: sdk149_unknown_one, sdk149_unknown_two/
    );
  });
});

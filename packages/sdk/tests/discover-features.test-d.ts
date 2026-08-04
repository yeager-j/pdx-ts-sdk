import { describe, expectTypeOf, it } from "vitest";

import { createMod, discoverFeatures, type CapabilityFeature } from "../src/index.ts";

describe("discoverFeatures types", () => {
  it("retains the literal capability prefix needed by compile", async () => {
    const features = discoverFeatures<"feature_types">("./features");
    expectTypeOf(features).toEqualTypeOf<Promise<CapabilityFeature<"feature_types">[]>>();

    const mod = createMod({
      name: "Feature types",
      prefix: "feature_types",
      supportedVersion: "4.4.*",
    });
    const discovered = await features;
    mod.compile(discovered);

    const other = createMod({
      name: "Other feature types",
      prefix: "other_feature_types",
      supportedVersion: "4.4.*",
    });
    // @ts-expect-error — a discovered feature retains its capability's literal prefix.
    other.compile(discovered);
  });
});

import { describe, expectTypeOf, it } from "vitest";

import * as sdk from "../src/index.ts";
import {
  createMod,
  DEFAULT_CONTENT_PATTERN,
  discoverFeatures,
  type TechnologyItem,
} from "../src/index.ts";

describe("the public authoring surface", () => {
  it("keeps capability entry points and item unions public", () => {
    const mod = createMod({
      name: "Public surface",
      prefix: "public_surface",
      supportedVersion: "4.4.*",
    });
    const technology: TechnologyItem = mod.technology("theory", {
      name: "Theory",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const features = discoverFeatures<"public_surface">("./features");

    expectTypeOf(mod.compile).toBeFunction();
    expectTypeOf(technology.type).toEqualTypeOf<"technology">();
    expectTypeOf(features).toMatchTypeOf<Promise<unknown>>();
    expectTypeOf(DEFAULT_CONTENT_PATTERN).toEqualTypeOf<RegExp>();
  });

  it("does not re-export legacy authoring values", () => {
    // @ts-expect-error — assembly is owned by the capability's compile method.
    void sdk.buildMod;
    // @ts-expect-error — direct file placement is package-internal lowering machinery.
    void sdk.collection;
    // @ts-expect-error — item flattening is package-internal fold machinery.
    void sdk.flattenItems;
    // @ts-expect-error — stem validation is package-internal fold machinery.
    void sdk.assertFileStem;
    // @ts-expect-error — namespace validation is package-internal fold machinery.
    void sdk.assertNamespace;
    // @ts-expect-error — the raw stem pattern is package-internal fold machinery.
    void sdk.FILE_STEM_PATTERN;
    // @ts-expect-error — feature discovery replaces every-export discovery.
    void sdk.discoverContent;
    // @ts-expect-error — event namespaces are capability-owned.
    void sdk.namespace;
    // @ts-expect-error — on-action bindings are capability-owned.
    void sdk.on;
    // @ts-expect-error — technology ids are capability-minted.
    void sdk.defineTechnology;
    // @ts-expect-error — vanilla patches are capability methods.
    void sdk.patchTechnology;
    // @ts-expect-error — contributions are capability methods.
    void sdk.addShipOfSizeLimits;
  });
});

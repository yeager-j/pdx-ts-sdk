import { describe, expectTypeOf, it } from "vitest";

import * as sdk from "../src/index.ts";
import {
  createMod,
  DEFAULT_CONTENT_PATTERN,
  discoverFeatures,
  type BuildingItem,
  type BuildingPatchItem,
  type TechnologyItem,
  type TechnologyPatchItem,
} from "../src/index.ts";
import { viewFromFiles } from "../src/stellaris/vanilla/view.ts";

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

  it("lets a consumer name each patchable registry's item type, and place it", () => {
    // The text guard in `tests/codegen/content-snapshot.test.ts` proves the
    // export lines exist for every overlay row; this proves the names are
    // usable — the package publishes no generated-module subpath, so a patch
    // item a consumer cannot annotate is a patch item they cannot hold in a
    // typed variable on the way to `mod.feature`.
    const mod = createMod({
      name: "Public surface",
      prefix: "public_surface",
      supportedVersion: "4.4.*",
    });
    const view = viewFromFiles({
      "common/technology/vanilla.txt": "tech_ps_forging = {\n\tarea = society\n}\n",
      "common/buildings/vanilla.txt": "building_ps_refinery = {\n\tplanet_limit = 1\n}\n",
    });
    const technology: TechnologyPatchItem = mod.patchTechnology(
      view.definition("technology", "tech_ps_forging"),
      () => ({ tier: 2 })
    );
    const building: BuildingPatchItem = mod.patchBuilding(
      view.definition("building", "building_ps_refinery"),
      () => ({ planetLimit: 2 })
    );
    // And each is a member of its own registry's item union, so a feature
    // typed to one registry accepts its patches beside its definitions.
    expectTypeOf(technology).toExtend<TechnologyItem>();
    expectTypeOf(building).toExtend<BuildingItem>();
    expectTypeOf(mod.feature(undefined, [technology, building])).toBeObject();
  });

  it("does not re-export legacy authoring values", () => {
    // @ts-expect-error — assembly is owned by the capability's compile method.
    void sdk.buildMod;
    // @ts-expect-error — direct stem placement is package-internal lowering machinery.
    void sdk.createFeature;
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
    // @ts-expect-error — and that is true of every patchable registry.
    void sdk.patchBuilding;
    // @ts-expect-error — contributions are capability methods.
    void sdk.addShipOfSizeLimits;
  });
});

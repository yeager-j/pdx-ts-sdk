import { describe, expectTypeOf, it } from "vitest";

import * as sdk from "../src/index.ts";
import {
  createMod,
  DEFAULT_CONTENT_PATTERN,
  discoverFeatures,
  type BuildingItem,
  type BuildingPatchItem,
  type MegastructureItem,
  type MegastructurePatchItem,
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

  it("publishes opaque Asset items without exposing their source or bytes", () => {
    const mod = createMod({
      name: "Public assets",
      prefix: "public_assets",
      supportedVersion: "4.4.*",
    });
    expectTypeOf<sdk.AssetFileItem["itemKind"]>().toEqualTypeOf<"asset">();
    expectTypeOf<sdk.AssetFileItem["path"]>().toEqualTypeOf<sdk.LogicalPath>();
    expectTypeOf<sdk.AssetFileItem["byteLength"]>().toEqualTypeOf<number>();
    expectTypeOf<sdk.AssetFileItem["sha256"]>().toEqualTypeOf<string>();
    expectTypeOf<typeof mod.assetFile>().toEqualTypeOf<
      (input: sdk.AssetFileInput) => sdk.AssetFileItem
    >();
    expectTypeOf<typeof mod.assetTree>().toEqualTypeOf<
      (input: sdk.AssetTreeInput) => readonly sdk.AssetFileItem[]
    >();
    // @ts-expect-error — capture does not expose a source location.
    expectTypeOf<sdk.AssetFileItem["source"]>();
    // @ts-expect-error — capture does not expose mutable bytes.
    expectTypeOf<sdk.AssetFileItem["bytes"]>();
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
      "common/megastructures/vanilla.txt": "megastructure_ps_array = {\n\tbuild_time = 1800\n}\n",
    });
    const technology: TechnologyPatchItem = mod.patchTechnology(
      view.definition("technology", "tech_ps_forging"),
      () => ({ tier: 2 })
    );
    const building: BuildingPatchItem = mod.patchBuilding(
      view.definition("building", "building_ps_refinery"),
      () => ({ planetLimit: 2 })
    );
    const megastructure: MegastructurePatchItem = mod.patchMegastructure(
      view.definition("megastructure", "megastructure_ps_array"),
      () => ({ buildTime: 2400 })
    );
    // And each is a member of its own registry's item union, so a feature
    // typed to one registry accepts its patches beside its definitions.
    expectTypeOf(technology).toExtend<TechnologyItem>();
    expectTypeOf(building).toExtend<BuildingItem>();
    expectTypeOf(megastructure).toExtend<MegastructureItem>();
    expectTypeOf(mod.feature(undefined, [technology, building, megastructure])).toBeObject();
  });

  it("returns one report shape from every materialization sink", () => {
    // The sinks are what a build script's last line calls, so the report is
    // the whole answer it gets: where the output went, what was carried, what
    // could not be cleaned up.
    expectTypeOf<Awaited<ReturnType<typeof sdk.write>>>().toEqualTypeOf<sdk.WriteReport>();
    expectTypeOf<
      Awaited<ReturnType<typeof sdk.replaceMaterialization>>
    >().toEqualTypeOf<sdk.WriteReport>();
    expectTypeOf<Awaited<ReturnType<typeof sdk.install>>>().toEqualTypeOf<sdk.InstallReport>();
    expectTypeOf<
      Awaited<ReturnType<typeof sdk.replaceInstallation>>
    >().toEqualTypeOf<sdk.InstallReport>();

    expectTypeOf<sdk.WriteReport>().toExtend<sdk.MaterializationReport>();
    expectTypeOf<sdk.InstallReport>().toExtend<sdk.MaterializationReport>();
    expectTypeOf<sdk.WriteReport["outDir"]>().toEqualTypeOf<string>();
    expectTypeOf<sdk.InstallReport["contentDir"]>().toEqualTypeOf<string>();
    expectTypeOf<sdk.InstallReport["descriptorPath"]>().toEqualTypeOf<string>();
    expectTypeOf<sdk.MaterializationReport["status"]>().toEqualTypeOf<"written" | "unchanged">();
    expectTypeOf<sdk.MaterializationReport["manifestPath"]>().toEqualTypeOf<string>();
    expectTypeOf<sdk.MaterializationReport["foreignEntries"]>().toEqualTypeOf<
      readonly sdk.ForeignReportEntry[]
    >();
    expectTypeOf<sdk.MaterializationReport["warnings"]>().toEqualTypeOf<
      readonly sdk.CleanupWarning[]
    >();
    expectTypeOf<sdk.ForeignReportEntry["kind"]>().toEqualTypeOf<"file" | "directory">();
    expectTypeOf<sdk.CleanupWarning>().toEqualTypeOf<{
      readonly path: string;
      readonly message: string;
    }>();
  });

  it("reports a path conflict as data, not as a message to parse", () => {
    // A caller deciding what to do about a collision — a scaffolder, a build
    // wrapper — needs the reason and the producers as values. `owners` was a
    // list of prose strings and could only be printed.
    expectTypeOf<sdk.PathOwnershipError["conflicts"]>().toEqualTypeOf<
      readonly sdk.PathOwnershipConflict[]
    >();
    expectTypeOf<sdk.PathOwnershipConflict["reason"]>().toEqualTypeOf<sdk.PathConflictReason>();
    expectTypeOf<sdk.PathOwnershipConflict["claimants"]>().toEqualTypeOf<
      readonly sdk.PathClaimant[]
    >();
    expectTypeOf<sdk.PathClaimant["kind"]>().toEqualTypeOf<sdk.PathProducerKind>();
    expectTypeOf<sdk.PathClaimant["stems"]>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<sdk.PathClaimant["role"]>().toEqualTypeOf<"file" | "directory">();
    expectTypeOf<sdk.PureMod["paths"]>().toEqualTypeOf<readonly sdk.PathClaim[]>();
    expectTypeOf<sdk.PathClaim["producer"]>().toEqualTypeOf<sdk.PathProducer>();
    expectTypeOf<sdk.PathClaim["path"]>().toEqualTypeOf<sdk.LogicalPath>();
    // @ts-expect-error — the fold adjudicates, so a PureMod has no raw evidence set.
    expectTypeOf<sdk.PureMod["vanillaPaths"]>();
  });

  it("publishes the canonical byte comparator, not just its logical-path door", () => {
    // `compareUtf8` is public on purpose (SDK-173). The canonical order over
    // plain strings governs more than one artifact — the emission ledger, and
    // now the vanilla path inventory `@pdx-ts/codegen-vanilla` emits — and a
    // second implementation of "byte order" is a second authority that drifts.
    expectTypeOf(sdk.compareUtf8).toBeFunction();
    expectTypeOf<Parameters<typeof sdk.compareUtf8>>().toEqualTypeOf<[string, string]>();
    expectTypeOf<ReturnType<typeof sdk.compareUtf8>>().toEqualTypeOf<-1 | 0 | 1>();
  });

  it("takes no receipt a caller could have written themselves", () => {
    // The brand is required, not optional. An optional one lets `{}` satisfy
    // the parameter, which turns a forged review into a runtime error at the
    // replay call — the place a caller has least reason to expect one.
    expectTypeOf({}).not.toExtend<sdk.MaterializationReceipt>();
    expectTypeOf<
      Parameters<typeof sdk.replaceMaterialization>[2]
    >().toEqualTypeOf<sdk.MaterializationReceipt>();
    expectTypeOf<
      Parameters<typeof sdk.replaceInstallation>[1]
    >().toEqualTypeOf<sdk.MaterializationReceipt>();
    const replay = (_receipt: sdk.MaterializationReceipt): void => {};
    // @ts-expect-error — a plain object is not evidence of an observed state.
    replay({});
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
    // @ts-expect-error — including the newest one.
    void sdk.patchMegastructure;
    // @ts-expect-error — contributions are capability methods.
    void sdk.addShipOfSizeLimits;
    // @ts-expect-error — installing reports, so the bare result type is gone.
    expectTypeOf<sdk.InstallResult>().toBeObject();
  });
});

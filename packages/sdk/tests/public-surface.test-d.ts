import { describe, expectTypeOf, it } from "vitest";

import * as sdk from "../src/index.ts";
import { createMod } from "../src/index.ts";
import * as installation from "../src/installation/index.ts";
import * as internals from "../src/internals.ts";
import * as reference from "../src/reference.ts";
import * as stellaris from "../src/stellaris.ts";
import type {
  AscensionPerkDef,
  BuildingItem,
  BuildingPatchItem,
  MegastructureItem,
  MegastructurePatchItem,
  TechnologyItem,
  TechnologyPatchItem,
} from "../src/stellaris.ts";

describe("the pipeline entry point", () => {
  it("keeps capability entry points public, and item unions on the vocabulary entry", () => {
    const mod = createMod({
      name: "Public surface",
      prefix: "public_surface",
      supportedVersion: "4.4.*",
    });
    const technology: TechnologyItem = mod.technology("theory", {
      cost: 100,
      weight: 100,
      name: "Theory",
      area: "physics",
      tier: 1,
      category: "particles",
    });

    expectTypeOf(mod.compile).toBeFunction();
    expectTypeOf(technology.type).toEqualTypeOf<"technology">();
    // Features are declared from src/features.ts, never walked off the disk
    // (docs/adr/0008).
    // @ts-expect-error — discovery is gone.
    void sdk.discoverFeatures;
    // @ts-expect-error — and so is its file pattern.
    void sdk.DEFAULT_CONTENT_PATTERN;

    // A handle is a value an author holds and annotates, so its types are
    // public; the constructor behind it is internal, like every `defineX`.
    const spelltech: sdk.ContentHandle<
      "ascension_perk",
      AscensionPerkDef<"public_surface_ascension_perk_spelltech">
    > = mod.ascensionPerkHandle("spelltech");
    expectTypeOf(spelltech.define).toBeFunction();
    expectTypeOf<
      sdk.ContentHandleBase<"ascension_perk", "x">["handleKind"]
    >().toEqualTypeOf<"content-handle">();
    // @ts-expect-error — the constructor stays internal
    void sdk.createContentHandle;
  });

  it("publishes the conventional project pipeline without widening the manifest prefix", () => {
    const project = sdk.createModProject(
      {
        mod: {
          public_project: {
            name: "Public project",
            supportedVersion: "4.4.*",
          },
        },
        assetsDirectory: "assets",
      } as const,
      { projectRoot: "/tmp/public-project" }
    );

    expectTypeOf(project.config.prefix).toEqualTypeOf<"public_project">();
    expectTypeOf(project.mod.config.prefix).toEqualTypeOf<"public_project">();
    const extra = project.mod.feature("extra", []);
    expectTypeOf(project.build([extra])).toEqualTypeOf<sdk.PureMod>();
    expectTypeOf(project.build({ extra })).toEqualTypeOf<sdk.PureMod>();
    // @ts-expect-error — the build takes the declared Features; there is no options-only form.
    project.build();
    // @ts-expect-error — nor a form that appends Features to something else.
    project.build({ additionalFeatures: [extra] });
    // @ts-expect-error — its options type went with the discovery form.
    expectTypeOf<sdk.ModProjectBuildOptions<"public_project">>();
    expectTypeOf<sdk.FeaturesModule<"public_project">[string]>().toEqualTypeOf<
      sdk.CapabilityFeature<"public_project">
    >();
    expectTypeOf<sdk.FeaturesInput<"public_project">>().toEqualTypeOf<
      readonly sdk.CapabilityFeature<"public_project">[] | sdk.FeaturesModule<"public_project">
    >();
    expectTypeOf<sdk.ItemBag["itemKind"]>().toEqualTypeOf<undefined>();
    expectTypeOf<sdk.FeatureItemsInput>().toEqualTypeOf<
      sdk.ItemBag | readonly (sdk.ModItem | sdk.ItemBag)[]
    >();
    // @ts-expect-error — bag reading is fold machinery, not part of the API.
    void sdk.itemsOfBag;
    // @ts-expect-error — Item-input normalization is fold machinery too.
    void sdk.itemsOfInput;
    expectTypeOf<sdk.PureMod["compileInputs"]>().toEqualTypeOf<sdk.CompileInputs>();
    expectTypeOf<sdk.CompileInputs["features"]>().toEqualTypeOf<
      readonly sdk.CompiledFeatureInput[]
    >();
    expectTypeOf<sdk.CompileInputs["vanilla"]>().toEqualTypeOf<sdk.CompiledVanillaInput>();
    expectTypeOf(sdk.runInspect).toBeFunction();
    expectTypeOf(reference.PROJECT_LAYOUT_FIELDS.assetsDirectory.pattern).toEqualTypeOf<RegExp>();
    // @ts-expect-error — the manifest no longer names a Feature directory.
    expectTypeOf(reference.PROJECT_LAYOUT_FIELDS.contentDirectory);
    // @ts-expect-error — Project Layout parsing is an implementation detail.
    expectTypeOf(sdk.parseProjectLayout);
    // @ts-expect-error — parser-only types are not part of the root authoring API.
    expectTypeOf<sdk.ProjectLayout>();
  });

  it("publishes opaque Asset items without exposing their source or bytes", () => {
    const mod = createMod({
      name: "Public assets",
      prefix: "public_assets",
      supportedVersion: "4.4.*",
    });
    expectTypeOf<sdk.AssetFileItem["itemKind"]>().toEqualTypeOf<"asset">();
    expectTypeOf<sdk.AssetFileItem["path"]>().toEqualTypeOf<internals.LogicalPath>();
    expectTypeOf<sdk.AssetFileItem["byteLength"]>().toEqualTypeOf<number>();
    expectTypeOf<sdk.AssetFileItem["sha256"]>().toEqualTypeOf<string>();
    expectTypeOf<typeof mod.assetFile>().toEqualTypeOf<
      (input: sdk.AssetFileInput) => sdk.AssetFileItem
    >();
    expectTypeOf<typeof mod.assetTree>().toEqualTypeOf<
      (input: sdk.AssetTreeInput) => readonly sdk.AssetFileItem[]
    >();
    expectTypeOf<sdk.AssetTreeInput["allowMissing"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<sdk.AssetTreeInput["allowEmpty"]>().toEqualTypeOf<boolean | undefined>();
    // @ts-expect-error — capture does not expose a source location.
    expectTypeOf<sdk.AssetFileItem["source"]>();
    // @ts-expect-error — capture does not expose mutable bytes.
    expectTypeOf<sdk.AssetFileItem["bytes"]>();
  });

  it("returns one report shape from every materialization sink", () => {
    // The sinks are what a build script's last line calls, so the report is
    // the whole answer it gets: where the output went, what was carried, what
    // could not be cleaned up. The replace/recover variants live on
    // `/internals` but return the same shapes.
    expectTypeOf<Awaited<ReturnType<typeof sdk.write>>>().toEqualTypeOf<sdk.WriteReport>();
    expectTypeOf<
      Awaited<ReturnType<typeof internals.replaceMaterialization>>
    >().toEqualTypeOf<sdk.WriteReport>();
    expectTypeOf<Awaited<ReturnType<typeof sdk.install>>>().toEqualTypeOf<sdk.InstallReport>();
    expectTypeOf<
      Awaited<ReturnType<typeof internals.replaceInstallation>>
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
    expectTypeOf<sdk.PureMod["paths"]>().toEqualTypeOf<readonly internals.PathClaim[]>();
    expectTypeOf<internals.PathClaim["producer"]>().toEqualTypeOf<internals.PathProducer>();
    expectTypeOf<internals.PathClaim["path"]>().toEqualTypeOf<internals.LogicalPath>();
    // @ts-expect-error — the fold adjudicates, so a PureMod has no raw evidence set.
    expectTypeOf<sdk.PureMod["vanillaPaths"]>();
  });

  it("takes no receipt a caller could have written themselves", () => {
    // The brand is required, not optional. An optional one lets `{}` satisfy
    // the parameter, which turns a forged review into a runtime error at the
    // replay call — the place a caller has least reason to expect one.
    expectTypeOf({}).not.toExtend<sdk.MaterializationReceipt>();
    expectTypeOf<
      Parameters<typeof internals.replaceMaterialization>[2]
    >().toEqualTypeOf<sdk.MaterializationReceipt>();
    expectTypeOf<
      Parameters<typeof internals.replaceInstallation>[1]
    >().toEqualTypeOf<sdk.MaterializationReceipt>();
    const replay = (_receipt: sdk.MaterializationReceipt): void => {};
    // @ts-expect-error — a plain object is not evidence of an observed state.
    replay({});
  });

  it("carries no game vocabulary, no install access, and no machinery", () => {
    // ADR-0007: each name has exactly one entry. The vocabulary lives on
    // `/stellaris`, the install on `/installation`, tables on `/reference`,
    // machinery on `/internals` — none of it on the pipeline entry.
    // @ts-expect-error — combinators are vocabulary.
    void sdk.and;
    // @ts-expect-error — generated triggers are vocabulary.
    void sdk.hasCountryFlag;
    // @ts-expect-error — scope links are vocabulary.
    void sdk.owner;
    // @ts-expect-error — value-set factories are vocabulary.
    void sdk.countryFlags;
    // @ts-expect-error — event targets are vocabulary.
    void sdk.eventTarget;
    // @ts-expect-error — on-action bindings are vocabulary.
    void sdk.onActions;
    // @ts-expect-error — the vanilla ref builders are vocabulary.
    void sdk.vanilla;
    // @ts-expect-error — scripted bindings are vocabulary.
    void sdk.scriptedTrigger;
    // @ts-expect-error — the old root namespace mirror is gone; use /installation.
    void sdk.stellaris;
    // @ts-expect-error — install loading lives on /installation.
    void sdk.viewFromFiles;
    // @ts-expect-error — the recorder is machinery on /internals.
    void sdk.recordEffects;
    // @ts-expect-error — policy tables live on /internals.
    void sdk.MODIFIER_OPERATIONS;
    // @ts-expect-error — recovery ops live on /internals.
    void sdk.recoverInstallation;
    // @ts-expect-error — comparators live on /internals.
    void sdk.compareUtf8;
    // @ts-expect-error — raw PDXScript constructors live on /internals.
    void sdk.kv;
    // @ts-expect-error — registry facts live on /reference.
    void sdk.EVENT_KINDS;
    // @ts-expect-error — the build pin lives on /reference.
    void sdk.SUPPORTED_STELLARIS_BUILD;
  });

  it("no longer exports the zero-consumer names at all", () => {
    // Dropped in SDK-287 while the package is unreleased; the source modules
    // keep them, so re-exporting later is one reviewed line.
    // @ts-expect-error — the override rule table is not public.
    void sdk.REGISTRY_RULES;
    // @ts-expect-error — nor is it public as machinery.
    void internals.REGISTRY_RULES;
    // @ts-expect-error — the modifier operation policy is not public.
    void internals.MODIFIER_OPERATION_POLICY;
    // @ts-expect-error — the launcher descriptor is rendered inside install().
    void sdk.renderLauncherDescriptor;
    // @ts-expect-error — and it is not machinery either.
    void internals.renderLauncherDescriptor;
    // @ts-expect-error — patch planning stays inside the resolver.
    expectTypeOf<sdk.PatchPlan>().toBeObject();
    // @ts-expect-error — as does its win evidence.
    expectTypeOf<sdk.WinAssertion>().toBeObject();
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
    // @ts-expect-error — a declared feature list replaces every-export discovery.
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

describe("the vocabulary entry point", () => {
  it("lets a consumer name each patchable registry's item type, and place it", () => {
    // The generated barrel carries the export line for every overlay row; this
    // proves the names are usable — the package publishes no generated-module
    // subpath, so a patch item a consumer cannot annotate is a patch item they
    // cannot hold in a typed variable on the way to `mod.feature`.
    const mod = createMod({
      name: "Public surface",
      prefix: "public_surface",
      supportedVersion: "4.4.*",
    });
    const view = installation.viewFromFiles({
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

  it("lets a consumer name the generated content types", () => {
    // The consumer end of `generated/content-public.ts`. Each group below is
    // one table's contribution to that barrel: a name missing here cannot be
    // written down at all, since the package publishes no generated-module
    // subpath.
    expectTypeOf<stellaris.TechnologyDef["id"]>().toEqualTypeOf<string>();
    expectTypeOf<stellaris.TechnologyFields>().toBeObject();
    expectTypeOf<stellaris.DefinedTechnology>().toBeObject();
    expectTypeOf<stellaris.SpriteTypeDef>().toBeObject();
    expectTypeOf<stellaris.PdxmeshFields>().toBeObject();
    expectTypeOf<stellaris.DefinedSolarSystemInitializer>().toBeObject();

    // Every patch registry's whole vocabulary, not just the item type above.
    expectTypeOf<stellaris.TechnologyPatch>().toBeObject();
    expectTypeOf<stellaris.PatchedTechnology>().toBeObject();
    expectTypeOf<stellaris.BuildingPatch>().toBeObject();
    expectTypeOf<stellaris.PatchedBuilding>().toBeObject();
    expectTypeOf<stellaris.MegastructurePatch>().toBeObject();
    expectTypeOf<stellaris.PatchedMegastructure>().toBeObject();

    // The repeated-struct interfaces an author fills by key.
    expectTypeOf<stellaris.TraditionSwapFields>().toBeObject();
    expectTypeOf<stellaris.AscensionPerkSwapFields>().toBeObject();
    expectTypeOf<stellaris.SituationStageFields>().toBeObject();
    expectTypeOf<stellaris.SituationApproachFields>().toBeObject();

    // The scope unions a scope-parameterised registry declares.
    expectTypeOf<stellaris.DecisionScope>().toEqualTypeOf<"planet" | "ship">();
    expectTypeOf<stellaris.SpecialProjectScope>().toEqualTypeOf<
      "country" | "planet" | "ship" | "carrier"
    >();
    expectTypeOf<"planet">().toExtend<stellaris.SpecialProjectLocationScope>();

    // The name a shape mint builds, which is not `MintedContentId`-shaped.
    expectTypeOf<
      stellaris.SpriteTextIconName<"prefix", "icon">
    >().toEqualTypeOf<"GFX_text_prefix_icon">();
    expectTypeOf<
      stellaris.SpriteFleetOrderButtonGroundSupportName<"stance", true>
    >().toEqualTypeOf<"GFX_fleet_order_button_ground_support_stance_selected">();

    // The curated nested types, each the type of a member an author fills.
    expectTypeOf<stellaris.EventChainCounterDefinition>().toBeObject();
    expectTypeOf<stellaris.GovernmentTriggerBlock>().toBeObject();
    expectTypeOf<stellaris.GovernmentTriggerClause<string>>().toBeObject();
    expectTypeOf<stellaris.GovernmentTriggerClauseGroup<string>>().toBeObject();
    expectTypeOf<stellaris.MoonInitializerFields>().toBeObject();
    expectTypeOf<stellaris.PlanetInitializerFields>().toBeObject();
    expectTypeOf<stellaris.PdxmeshAnimation>().toBeObject();
    expectTypeOf<stellaris.PdxmeshMeshsettings>().toBeObject();
    expectTypeOf<stellaris.ShipSizeSectionSlots>().toBeObject();
    expectTypeOf<stellaris.SpecialProjectRequirements>().toBeObject();
    expectTypeOf<stellaris.SpecialProjectTriggeredRequirement>().toBeObject();
    expectTypeOf<stellaris.SpriteTypeAnimation>().toBeObject();
  });

  it("keeps generated lowering machinery out of the content barrel", () => {
    // @ts-expect-error — the runtime field table is lowering machinery.
    void stellaris.TECHNOLOGY_FIELDS;
    // @ts-expect-error — so is the localisation descriptor table.
    void stellaris.TECHNOLOGY_LOCALISATION;
    // @ts-expect-error — the base interface a selector resolves through is internal.
    expectTypeOf<stellaris.SpecialProjectFieldsBase>().toBeObject();
    // @ts-expect-error — a nested struct authored inline needs no name of its own.
    expectTypeOf<stellaris.TechnologyPrereqforDesc>().toBeObject();
  });

  it("carries the expression language, and no pipeline", () => {
    expectTypeOf(stellaris.and).toBeFunction();
    expectTypeOf(stellaris.hasCountryFlag).toBeFunction();
    expectTypeOf(stellaris.owner).toBeFunction();
    expectTypeOf(stellaris.countryFlags).toBeFunction();
    expectTypeOf(stellaris.eventTarget).toBeFunction();
    expectTypeOf(stellaris.scriptedTrigger).toBeFunction();
    expectTypeOf(stellaris.vanilla.technology).toBeFunction();
    expectTypeOf(stellaris.onActions).toBeObject();
    expectTypeOf(stellaris.absoluteOrbits).toBeFunction();
    // @ts-expect-error — the pipeline stays on the root entry.
    void stellaris.createMod;
    // @ts-expect-error — so does materialization.
    void stellaris.write;
    // @ts-expect-error — the recorder is machinery on /internals.
    void stellaris.recordEffects;
  });
});

describe("the installation, reference, and internals entry points", () => {
  it("keeps install access on /installation", () => {
    expectTypeOf(installation.locateInstall).toBeFunction();
    expectTypeOf(installation.load).toBeFunction();
    expectTypeOf(installation.modDir).toBeFunction();
    expectTypeOf(installation.viewFromFiles).toBeFunction();
    expectTypeOf(installation.anyOf).toBeFunction();
    expectTypeOf<installation.VanillaView>().toBeObject();
    expectTypeOf<installation.ParsedTechnology>().toBeObject();
    // @ts-expect-error — the pipeline stays on the root entry.
    void installation.install;
  });

  it("keeps SDK facts on /reference", () => {
    expectTypeOf(reference.CONTENT_REGISTRIES).toExtend<readonly unknown[]>();
    expectTypeOf(reference.SCRIPT_REFERENCE_SCOPES).toExtend<readonly unknown[]>();
    expectTypeOf(reference.EVENT_KINDS).toBeObject();
    expectTypeOf(reference.SUPPORTED_STELLARIS_BUILD).toBeString();
    expectTypeOf(reference.aliasStructFieldsOf).toBeFunction();
  });

  it("keeps the recorder and tables on /internals", () => {
    expectTypeOf(internals.recordEffects).toBeFunction();
    expectTypeOf(internals.makeScope).toBeFunction();
    expectTypeOf(internals.isEffectKey).toBeFunction();
    expectTypeOf(internals.scopeLinkOutput).toBeFunction();
    expectTypeOf(internals.MODIFIER_OPERATIONS).toBeObject();
    expectTypeOf(internals.EVENT_FIELD_SUPPORT).toBeObject();
    expectTypeOf(internals.AMBIENT_SCOPE_KEYS).toExtend<readonly string[]>();
    expectTypeOf(internals.compareUtf8).toBeFunction();
    expectTypeOf<Parameters<typeof internals.compareUtf8>>().toEqualTypeOf<[string, string]>();
    expectTypeOf<ReturnType<typeof internals.compareUtf8>>().toEqualTypeOf<-1 | 0 | 1>();
    expectTypeOf(internals.recoverInstallation).toBeFunction();
    expectTypeOf(internals.stampedVanillaPackageVersion).toBeFunction();
    expectTypeOf(internals.kv).toBeFunction();
    expectTypeOf(internals.serialize).toBeFunction();
  });
});

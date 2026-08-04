import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { defineHardening } from "../../examples/hardening/mod.ts";
import { defineHelloGalaxy } from "../../examples/hello-galaxy/mod.ts";
import { discoverContent } from "../../packages/sdk/src/discover.ts";
import { render } from "../../packages/sdk/src/render.ts";
import { load } from "../../packages/sdk/src/stellaris/load.ts";
import { createMod, stellarisIds, type ModCapability, type ProbeIdProfile } from "./capability.ts";
import { capabilityMethodRows, emitCapabilityMethodDeclarations } from "./codegen-shape.ts";
import { discoveryMod } from "./discovery-mod.ts";
import { discoverExplicitFeatures } from "./discovery.ts";
import { defineCapabilityHardening } from "./hardening.ts";
import { defineCapabilityHelloGalaxy } from "./hello-galaxy.ts";

const vanilla = load({
  installPath: join(import.meta.dirname, "../../fixtures/fake-install"),
  cache: false,
});

describe("byte parity", () => {
  it("renders the hello-galaxy equivalent byte-for-byte", async () => {
    const current = render(await defineHelloGalaxy());
    const capability = render(defineCapabilityHelloGalaxy());
    expect([...capability.entries()]).toEqual([...current.entries()]);
  });

  it("renders the hardening equivalent and patch plan byte-for-byte", () => {
    const current = defineHardening(vanilla);
    const capability = defineCapabilityHardening(vanilla);
    expect([...render(capability.mod).entries()]).toEqual([...render(current.mod).entries()]);
    expect(capability.mod.patchPlan).toEqual(current.mod.patchPlan);
  });
});

describe("immutable pure capability", () => {
  it("snapshots config and registers nothing at definition time", () => {
    const tags = ["Technologies"];
    const config = {
      name: "Snapshot",
      prefix: "probe_snapshot",
      supportedVersion: "4.4.*",
      tags,
    };
    const mod = createMod(config, { ids: stellarisIds });
    const omitted = mod.technology("omitted", {
      name: "Omitted",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    config.prefix = "mutated_after_create";
    tags.push("mutated_after_create");

    expect(Object.isFrozen(mod)).toBe(true);
    expect(Object.isFrozen(mod.config)).toBe(true);
    expect(Object.isFrozen(mod.config.tags)).toBe(true);
    expect(mod.config.tags).toEqual(["Technologies"]);
    expect(omitted.id).toBe("probe_snapshot_tech_omitted");
    const empty = render(mod.compile([]));
    expect([...empty.keys()].filter((path) => path.startsWith("common/"))).toEqual([]);
    expect(empty.get("localisation/english/probe_snapshot_l_english.yml")).toBe("﻿l_english:\n");

    const included = render(mod.compile([mod.feature("included", [omitted])]));
    expect(included.has("common/technology/probe_snapshot_included.txt")).toBe(true);
    expect(included.has("common/technology/mutated_after_create_included.txt")).toBe(false);
  });

  it("rejects an invalid minted namespace before any event is defined", () => {
    const mod = createMod(
      {
        name: "Namespace",
        prefix: "namespace_probe",
        supportedVersion: "4.4.*",
      },
      { ids: stellarisIds }
    );
    expect(() => mod.namespace("Bad.Name")).toThrow(
      'Event namespace "namespace_probe_Bad.Name" must be lowercase snake_case'
    );
  });
});

function reusablePack<P extends string, I extends ProbeIdProfile>(
  mod: Pick<ModCapability<P, I>, "technology" | "feature">
) {
  const theory = mod.technology("pack_theory", {
    name: "Pack Theory",
    area: "physics",
    tier: 1,
    category: "particles",
  });
  const application = mod.technology("pack_application", {
    name: "Pack Application",
    area: "physics",
    tier: 2,
    category: "particles",
    prerequisites: [theory],
  });
  return mod.feature("pack", [theory, application]);
}

describe("mod-parameterized packs", () => {
  it("authors one pack under two literal prefixes", () => {
    const alpha = createMod(
      {
        name: "Alpha",
        prefix: "alpha_mod",
        supportedVersion: "4.4.*",
      },
      { ids: stellarisIds }
    );
    const beta = createMod(
      {
        name: "Beta",
        prefix: "beta_mod",
        supportedVersion: "4.4.*",
      },
      { ids: stellarisIds }
    );
    const alphaFile = render(alpha.compile([reusablePack(alpha)])).get(
      "common/technology/alpha_mod_pack.txt"
    );
    const betaFile = render(beta.compile([reusablePack(beta)])).get(
      "common/technology/beta_mod_pack.txt"
    );

    expect(alphaFile).toContain("alpha_mod_tech_pack_theory");
    expect(alphaFile).toContain('prerequisites = { "alpha_mod_tech_pack_theory" }');
    expect(betaFile).toContain("beta_mod_tech_pack_theory");
    expect(betaFile).toContain('prerequisites = { "beta_mod_tech_pack_theory" }');
  });
});

describe("declaration-before-definition event handles", () => {
  it("records a cyclic pair without registration or placeholders", () => {
    const mod = createMod(
      {
        name: "Cycles",
        prefix: "cycle_mod",
        supportedVersion: "4.4.*",
      },
      { ids: stellarisIds }
    );
    const events = mod.namespace("chain");
    const first = events.countryHandle(1);
    const second = events.countryHandle(2);

    const firstDefinition = first.define({
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => country.countryEvent({ id: second }),
    });
    const secondDefinition = second.define({
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => country.countryEvent({ id: first }),
    });
    const files = render(mod.compile([mod.feature("chain", [firstDefinition, secondDefinition])]));
    const source = files.get("events/cycle_mod_chain.txt");

    expect(first.id).toBe("cycle_mod_chain.1");
    expect(second.id).toBe("cycle_mod_chain.2");
    expect(source).toContain("id = cycle_mod_chain.1");
    expect(source).toContain("id = cycle_mod_chain.2");
    expect(source).not.toContain("__");
    expect(source).not.toContain("placeholder");
  });
});

describe("feature layout", () => {
  it("fans one feature across registries", () => {
    const mod = createMod(
      {
        name: "Fanout",
        prefix: "fanout_mod",
        supportedVersion: "4.4.*",
      },
      { ids: stellarisIds }
    );
    const technology = mod.technology("one", {
      name: "One",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const building = mod.building("one", {
      name: "One",
      baseBuildtime: 10,
      category: "research",
      icon: "building_research_lab_1",
      buildingSets: ["research"],
      canBuild: true,
    });
    const files = render(mod.compile([mod.feature("mixed_feature", [technology, building])]));

    expect(files.has("common/technology/fanout_mod_mixed_feature.txt")).toBe(true);
    expect(files.has("common/buildings/fanout_mod_mixed_feature.txt")).toBe(true);
  });

  it("keeps identity and definition bytes independent of the feature stem", () => {
    const mod = createMod(
      {
        name: "Layout",
        prefix: "layout_mod",
        supportedVersion: "4.4.*",
      },
      { ids: stellarisIds }
    );
    const technology = mod.technology("stable", {
      name: "Stable",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const alpha = render(mod.compile([mod.feature("alpha", [technology])]));
    const beta = render(mod.compile([mod.feature("beta", [technology])]));

    expect(technology.id).toBe("layout_mod_tech_stable");
    expect(alpha.get("common/technology/layout_mod_alpha.txt")).toBe(
      beta.get("common/technology/layout_mod_beta.txt")
    );
  });
});

describe("discovery contracts", () => {
  it("renders the same bytes through every-export and explicit-feature discovery", async () => {
    const everyExport = await discoverContent(
      new URL("./discovery/every-export/", import.meta.url)
    );
    const explicitFeature = await discoverExplicitFeatures(
      new URL("./discovery/explicit-feature/", import.meta.url)
    );

    expect([...render(discoveryMod.compile(everyExport)).entries()]).toEqual([
      ...render(discoveryMod.compile(explicitFeature)).entries(),
    ]);
  });

  it("makes non-feature exports ordinary module API under the explicit contract", async () => {
    const explicitFeature = await discoverExplicitFeatures(
      new URL("./discovery/explicit-feature/", import.meta.url)
    );
    const module = await import("./discovery/explicit-feature/resonance.ts");

    expect(Object.keys(module).sort()).toEqual(["feature", "lab", "theory"]);
    expect(explicitFeature).toEqual([module.feature]);
    expect(explicitFeature[0]!.items).toEqual([module.theory, module.lab]);
  });
});

describe("codegen shape", () => {
  it("derives every capability method from the manifest and existing overlays", () => {
    const rows = capabilityMethodRows();
    const registries = rows.map((row) => row.registry);

    expect(rows).toHaveLength(35);
    expect(new Set(registries).size).toBe(rows.length);
    expect(rows.filter((row) => row.handWritten).map((row) => row.registry)).toEqual([
      "situation_type",
    ]);
    expect(rows.filter((row) => row.patchMethod).map((row) => row.registry)).toEqual([
      "technology",
    ]);
    expect(rows.filter((row) => row.contributionMethod).map((row) => row.registry)).toEqual([
      "country_ship_of_size_limit",
    ]);

    const declaration = emitCapabilityMethodDeclarations();
    expect(declaration).toContain(
      'technology<const Name extends string>(name: Name, def: Omit<TechnologyDef<MintId<P, I["technology"], Name>>, "id">): TechnologyItem;'
    );
    expect(declaration).toContain(
      'ascensionPerk<const Name extends string>(name: Name, def: Omit<AscensionPerkDef<MintId<P, I["ascensionPerk"], Name>>, "id">): AscensionPerkItem;'
    );
  });
});

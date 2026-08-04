import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createMod, discoverFeatures, render, type ModConfig } from "../src/index.ts";

const SDK = join(import.meta.dirname, "../src/index.ts");
const config: ModConfig = {
  name: "Explicit discovery",
  prefix: "explicit_discovery",
  supportedVersion: "4.4.*",
};
const temps: string[] = [];

function moduleTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pdx-discover-features-"));
  temps.push(dir);
  for (const [relative, source] of Object.entries(files)) {
    const target = join(dir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source, "utf8");
  }
  return dir;
}

function sdk(names: string): string {
  return `import { ${names} } from ${JSON.stringify(SDK)};\n`;
}

function capabilitySource(prefix = config.prefix): string {
  return (
    sdk("createMod") +
    `export const mod = createMod({ name: "Explicit discovery", prefix: "${prefix}", supportedVersion: "4.4.*" });\n`
  );
}

function featureSource(stem: string, id: string, capabilityImport = "../capability.ts"): string {
  return (
    `import { mod } from ${JSON.stringify(capabilityImport)};\n` +
    `export { mod };\n` +
    `export const technology = mod.technology("${id}", { name: "${id}", area: "physics", tier: 1, category: "particles" });\n` +
    `export const helper = { id: technology.id };\n` +
    `export const feature = mod.feature("${stem}", [technology]);\n` +
    `export default helper;\n`
  );
}

async function importedFeature(dir: string, relative: string) {
  return (await import(pathToFileURL(join(dir, "features", relative)).href)) as {
    readonly mod: ReturnType<typeof createMod>;
  };
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("discoverFeatures", () => {
  it("accepts a directory path and URL, preserves recursive logical-path order, and returns imported identity", async () => {
    const dir = moduleTree({
      "capability.ts": capabilitySource(),
      "features/zeta/feature.ts": featureSource("zeta", "zeta", "../../capability.ts"),
      "features/alpha/feature.ts": featureSource("alpha", "alpha", "../../capability.ts"),
    });
    const root = join(dir, "features");
    const fromPath = await discoverFeatures<"explicit_discovery">(root);
    const fromUrl = await discoverFeatures<"explicit_discovery">(pathToFileURL(`${root}/`));
    const alpha = await import(pathToFileURL(join(root, "alpha/feature.ts")).href);

    expect(fromPath.map((feature) => feature.file)).toEqual(["alpha", "zeta"]);
    expect(fromUrl).toEqual(fromPath);
    expect(fromPath[0]).toBe(alpha.feature);
  });

  it("filters before import with stateless custom patterns and ignores ordinary sibling exports", async () => {
    const dir = moduleTree({
      "capability.ts": capabilitySource(),
      "features/alpha.feature.ts": featureSource("alpha", "alpha"),
      "features/beta.feature.ts": featureSource("beta", "beta"),
      "features/alpha.feature.test.ts": 'throw new Error("excluded companion was imported");\n',
    });
    const root = join(dir, "features");
    const defaultFeatures = await discoverFeatures<"explicit_discovery">(root);
    const features = await discoverFeatures<"explicit_discovery">(root, {
      include: /\.feature\.ts$/gy,
    });

    expect(defaultFeatures.map((feature) => feature.file)).toEqual(["alpha", "beta"]);
    expect(features.map((feature) => feature.file)).toEqual(["alpha", "beta"]);
  });

  it("keeps source basenames out of output identity", async () => {
    const first = moduleTree({
      "capability.ts": capabilitySource(),
      "features/odd-name.ts": featureSource("authored_stem", "theory"),
    });
    const second = moduleTree({
      "capability.ts": capabilitySource(),
      "features/moved/renamed.ts": featureSource("authored_stem", "theory", "../../capability.ts"),
    });
    const firstCapability = await importedFeature(first, "odd-name.ts");
    const secondCapability = await importedFeature(second, "moved/renamed.ts");
    const firstFiles = render(
      firstCapability.mod.compile(
        await discoverFeatures<"explicit_discovery">(join(first, "features"))
      )
    );
    const secondFiles = render(
      secondCapability.mod.compile(
        await discoverFeatures<"explicit_discovery">(join(second, "features"))
      )
    );

    expect([...secondFiles.entries()]).toEqual([...firstFiles.entries()]);
    expect(firstFiles.has("common/technology/explicit_discovery_authored_stem.txt")).toBe(true);
  });

  it("discovers one explicit feature containing content, events, and on-actions", async () => {
    const explicit =
      `import { mod } from "../capability.ts";\n` +
      `export { mod };\n` +
      sdk("onActions") +
      `export const theory = mod.technology("theory", { name: "Theory", area: "physics", tier: 1, category: "particles" });\n` +
      `const events = mod.namespace();\n` +
      `export const pulse = events.country(1, { hideWindow: true, isTriggeredOnly: true });\n` +
      `export const echo = events.country(2, { hideWindow: true, isTriggeredOnly: true });\n` +
      `export const hook = mod.on(onActions.onGameStartCountry, [echo, pulse]);\n` +
      `export const feature = mod.feature("expansion", [theory, pulse, echo, hook]);\n` +
      `export default { theory, pulse, echo };\n`;
    const dir = moduleTree({
      "capability.ts": capabilitySource(),
      "features/expansion.ts": explicit,
    });
    const capability = await importedFeature(dir, "expansion.ts");
    const discovered = render(
      capability.mod.compile(await discoverFeatures<"explicit_discovery">(join(dir, "features")))
    );

    expect(discovered.get("common/technology/explicit_discovery_expansion.txt")).toContain(
      "explicit_discovery_tech_theory"
    );
    expect(discovered.get("events/explicit_discovery_expansion.txt")).toContain(
      "id = explicit_discovery.1"
    );
    expect(discovered.get("common/on_actions/explicit_discovery_on_actions.txt")).toBe(
      "on_game_start_country = {\n\tevents = { explicit_discovery.2 explicit_discovery.1 }\n}\n"
    );
  });

  it("requires every selected module to export a stemmed capability feature", async () => {
    const missing = moduleTree({
      "capability.ts": capabilitySource(),
      "features/missing.ts": `export const value = 1;\n`,
    });
    const wrong = moduleTree({
      "capability.ts": capabilitySource(),
      "features/wrong.ts": `export const feature = "not a feature";\n`,
    });
    const stemless = moduleTree({
      "capability.ts": capabilitySource(),
      "features/stemless.ts":
        `import { mod } from "../capability.ts";\n` +
        `export const feature = mod.feature(undefined, []);\n`,
    });

    await expect(discoverFeatures(join(missing, "features"))).rejects.toThrow(
      /missing\.ts must export one capability feature as "feature"/
    );
    await expect(discoverFeatures(join(wrong, "features"))).rejects.toThrow(
      /wrong\.ts must export one capability feature as "feature"/
    );
    await expect(discoverFeatures(join(stemless, "features"))).rejects.toThrow(
      /stemless\.ts exports "feature" without an authored file stem/
    );
  });

  it("rejects the legacy every-export convention and reports empty selections explicitly", async () => {
    const legacy = moduleTree({
      "capability.ts": capabilitySource(),
      "features/legacy.ts":
        `import { mod } from "../capability.ts";\n` +
        `export const technology = mod.technology("legacy", { name: "Legacy", area: "physics", tier: 1, category: "particles" });\n`,
    });
    const empty = moduleTree({ "features/notes.md": "not TypeScript\n" });
    const unmatched = moduleTree({
      "capability.ts": capabilitySource(),
      "features/feature.ts": featureSource("feature", "feature"),
    });

    await expect(discoverFeatures(join(legacy, "features"))).rejects.toThrow(
      /legacy\.ts must export one capability feature as "feature"/
    );
    await expect(discoverFeatures(join(empty, "features"))).rejects.toThrow(
      /No explicit feature modules.*holds no TypeScript at all/
    );
    await expect(
      discoverFeatures(join(unmatched, "features"), { include: /\.feature\.ts$/ })
    ).rejects.toThrow(/No explicit feature modules.*matched none of the 1 TypeScript files there/);
  });

  it("leaves capability ownership enforcement to compile", async () => {
    const dir = moduleTree({
      "capability.ts": capabilitySource("foreign_discovery"),
      "features/feature.ts": featureSource("feature", "feature"),
    });
    const owner = createMod({
      name: "Owner",
      prefix: "owner_discovery",
      supportedVersion: "4.4.*",
    });
    const features = await discoverFeatures<"owner_discovery">(join(dir, "features"));

    expect(() => owner.compile(features)).toThrow(
      'Feature does not belong to mod prefix "owner_discovery"'
    );
  });
});

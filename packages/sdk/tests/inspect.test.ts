import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createMod, runInspect } from "../src/index.ts";
import { viewFromFiles } from "../src/installation/vanilla/view.ts";
import { TECH_FILE, VARS_FILE } from "./fixtures/vanilla-fixture.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  process.exitCode = undefined;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("runInspect", () => {
  it("writes one compact deterministic YAML project map", async () => {
    const projectRoot = temporaryProject();
    const assetPath = path.join(projectRoot, "icon.bin");
    writeFileSync(assetPath, "asset bytes");
    const mod = createMod({
      name: "Inspection Probe",
      prefix: "inspection_probe",
      version: "0.1.0",
      supportedVersion: "4.4.*",
    });
    const technology = mod.technology("theory", {
      name: "Theory",
      desc: "A theory",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const localization = mod.localization("greeting", 'He said "hello".');
    const asset = mod.assetFile({ source: assetPath, path: "gfx/interface/icon.bin" });
    const compiled = mod.compile([mod.feature("main", [technology, localization, asset])]);
    const first = captureTerminal();
    const second = captureTerminal();
    const options = {
      manifest: {
        mod: { inspection_probe: compiled.config },
        contentDirectory: "src/content",
        assetsDirectory: "assets",
      },
      projectRoot,
    } as const;

    await runInspect(compiled, { ...options, output: first.output });
    await runInspect(compiled, { ...options, output: second.output });

    expect(second.text()).toBe(first.text());
    expect(first.text()).not.toMatch(/[&*][a-z0-9]/i);
    expect(first.text()).not.toContain('He said "hello".');
    expect(first.text()).not.toContain(asset.sha256);
    expect(parse(first.text())).toMatchObject({
      schema: "pdx-sdk-inspection/v1",
      project: {
        contentDirectory: "src/content",
        package: {
          name: "inspection-project",
          version: "0.1.0",
          dependencies: {
            sdk: { requested: "^0.5.0", resolved: "0.5.0" },
            stellarisIds: {
              requested: ">=4.4.6-0 <4.4.6",
              resolved: "4.4.6-r.3",
              gameVersion: "4.4.6",
            },
          },
        },
      },
      vanilla: {
        identifiers: "packaged",
        loadedView: false,
        gameVersion: null,
        pathInventory: "packaged",
      },
      summary: {
        features: 1,
        items: 3,
        patches: 0,
        warnings: 1,
      },
      features: [
        {
          stem: "main",
          itemCount: 3,
          itemIds: ["inspection_probe_tech_theory"],
        },
      ],
      patches: [],
      warnings: [{ code: "loc-quote-replaced" }],
    });
    const report = parse(first.text()) as Record<string, unknown>;
    expect(report).not.toHaveProperty("outputs");
    expect(report).not.toHaveProperty("authoredIds");
    expect(report).not.toHaveProperty("localization");
    expect(report).not.toHaveProperty("assets");
    expect(report.project).not.toHaveProperty("assetsDirectory");
    expect(first.text()).not.toContain("common/technology/inspection_probe_main.txt");
    expect(first.text()).not.toContain("localisation/english");
    expect(first.text()).not.toContain("gfx/interface/icon.bin");
  });

  it("reports one row per Feature when stems match", async () => {
    const projectRoot = temporaryProject();
    const mod = createMod({
      name: "Repeated Stem Probe",
      prefix: "repeated_stem_probe",
      supportedVersion: "4.4.*",
    });
    const firstTechnology = mod.technology("first", {
      name: "First",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const secondTechnology = mod.technology("second", {
      name: "Second",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const compiled = mod.compile([
      mod.feature("shared", [secondTechnology]),
      mod.feature("shared", [firstTechnology]),
    ]);
    const captured = captureTerminal();

    await runInspect(compiled, {
      manifest: {
        mod: { repeated_stem_probe: compiled.config },
        contentDirectory: "src/content",
      },
      projectRoot,
      output: captured.output,
    });

    expect(parse(captured.text()).features).toEqual([
      {
        stem: "shared",
        itemCount: 1,
        itemIds: ["repeated_stem_probe_tech_first"],
      },
      {
        stem: "shared",
        itemCount: 1,
        itemIds: ["repeated_stem_probe_tech_second"],
      },
    ]);
  });

  it("reports vanilla evidence carried only by a patch origin", async () => {
    const projectRoot = temporaryProject();
    const vanilla = viewFromFiles(
      {
        "common/technology/00_technologies.txt": TECH_FILE,
        "common/scripted_variables/00_variables.txt": VARS_FILE,
      },
      { gameVersion: "4.4.6", pathInventory: ["events/live_origin.txt"] }
    );
    const mod = createMod({
      name: "Patch Origin Probe",
      prefix: "patch_origin_probe",
      supportedVersion: "4.4.*",
    });
    const patch = mod.patchTechnology(
      vanilla.definition("technology", "tech_gene_forging"),
      () => ({ tier: 4 })
    );
    const compiled = mod.compile([mod.feature("patches", [patch])]);
    const captured = captureTerminal();

    await runInspect(compiled, {
      manifest: {
        mod: { patch_origin_probe: compiled.config },
        contentDirectory: "src/content",
      },
      projectRoot,
      output: captured.output,
    });

    expect(parse(captured.text()).vanilla).toEqual({
      identifiers: "packaged",
      loadedView: true,
      gameVersion: "4.4.6",
      pathInventory: "packaged-and-loaded",
    });
  });

  it("reads requested versions outside regular dependencies", async () => {
    const projectRoot = temporaryProject({
      devDependencies: { "@pdx-ts/sdk": "workspace:*" },
      optionalDependencies: { "@pdx-ts/stellaris-ids": "4.4.6-r.2" },
    });
    const mod = createMod({
      name: "Dependency Section Probe",
      prefix: "dependency_section_probe",
      supportedVersion: "4.4.*",
    }).compile([]);
    const captured = captureTerminal();

    await runInspect(mod, {
      manifest: {
        mod: { dependency_section_probe: mod.config },
        contentDirectory: "src/content",
      },
      projectRoot,
      output: captured.output,
    });

    expect(parse(captured.text()).project.package.dependencies).toMatchObject({
      sdk: { requested: "workspace:*" },
      stellarisIds: { requested: "4.4.6-r.2" },
    });
  });

  it("writes failures to stderr without partial YAML", async () => {
    const output = captureTerminal();
    const errors = captureTerminal();
    const mod = createMod({
      name: "Inspection Failure",
      prefix: "inspection_failure",
      supportedVersion: "4.4.*",
    }).compile([]);

    await runInspect(mod, {
      manifest: {
        mod: { inspection_failure: mod.config },
        contentDirectory: "src/content",
      },
      projectRoot: temporaryDirectory("pdx-inspection-missing-"),
      output: output.output,
      errorOutput: errors.output,
    });

    expect(process.exitCode).toBe(1);
    expect(output.text()).toBe("");
    expect(errors.text()).toContain("Inspection failed:");
    expect(errors.text()).toContain("package.json");
  });
});

function temporaryProject(
  packageDependencies: Record<string, Record<string, string>> = {
    dependencies: {
      "@pdx-ts/sdk": "^0.5.0",
      "@pdx-ts/stellaris-ids": ">=4.4.6-0 <4.4.6",
    },
  }
): string {
  const directory = temporaryDirectory("pdx-inspection-");
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "inspection-project",
      version: "0.1.0",
      ...packageDependencies,
    })
  );
  return directory;
}

function captureTerminal(): { readonly output: Writable; text(): string } {
  let captured = "";
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      captured += chunk.toString();
      callback();
    },
  });
  return { output, text: () => captured };
}

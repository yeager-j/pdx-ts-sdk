import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createModProject, render, type ProjectModConfig, type PureMod } from "../src/index.ts";
import { parseProjectLayout, ProjectLayoutError } from "../src/project-layout.ts";

const SDK = join(import.meta.dirname, "../src/index.ts");
const temps: string[] = [];

function projectTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pdx-mod-project-"));
  temps.push(root);
  for (const [relative, source] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source, "utf8");
  }
  return root;
}

function projectSource(): string {
  return `
import { createModProject } from ${JSON.stringify(SDK)};

const manifest = {
  mod: {
    project_pipeline: {
      name: "Project pipeline",
      supportedVersion: "4.4.*",
    },
  },
  assetsDirectory: "assets",
} as const;

export const project = createModProject(manifest, {
  projectRoot: new URL("./", import.meta.url),
});
export const { mod } = project;
`;
}

function featuresSource(): string {
  return `export { feature as main } from "./features/main.ts";\n`;
}

/** The one module that imports both sides, as the scaffold's `src/build.ts` does. */
function buildSource(): string {
  return `
import { project } from "../project.ts";
import * as features from "./features.ts";

export function buildTheMod() {
  return project.build(features);
}
`;
}

function featureSource(): string {
  return `
import { mod } from "../../project.ts";

const technology = mod.technology("theory", {
  name: "Theory",
  area: "physics",
  tier: 1,
  category: "particles",
});

export const feature = mod.feature("main", [technology]);
`;
}

afterEach(() => {
  for (const root of temps.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("createModProject", () => {
  it("derives the literal prefix and validates layout without reading source directories", () => {
    const projectRoot = projectTree({});
    const project = createModProject(
      {
        mod: {
          manifest_prefix: {
            name: "Manifest prefix",
            supportedVersion: "4.4.*",
            prefix: "impostor",
          } as unknown as ProjectModConfig,
        },
        assetsDirectory: "assets",
      },
      { projectRoot }
    );

    expect(project.config.prefix).toBe("manifest_prefix");
    expect(project.mod.config).toBe(project.config);
    expect(Object.isFrozen(project)).toBe(true);
  });

  it("requires one manifest mod and normalized project-relative directories", () => {
    const projectRoot = projectTree({});
    expect(() => createModProject({ mod: {} }, { projectRoot })).toThrow(
      /must declare exactly one mod, and declares 0/
    );
    expect(() =>
      createModProject(
        {
          mod: {
            first: { name: "First", supportedVersion: "4.4.*" },
            second: { name: "Second", supportedVersion: "4.4.*" },
          },
        },
        { projectRoot }
      )
    ).toThrow(/must declare exactly one mod, and declares 2/);
    expect(() =>
      createModProject(
        {
          mod: { valid: { name: "Valid", supportedVersion: "4.4.*" } },
          assetsDirectory: "../outside",
        },
        { projectRoot }
      )
    ).toThrow(ProjectLayoutError);
    expect(() =>
      createModProject(
        {
          mod: { valid: { name: "Valid", supportedVersion: "4.4.*" } },
        },
        { projectRoot: "relative/project" }
      )
    ).toThrow(/Project root must be an absolute path or file URL/);
  });

  it("compiles the declared Features, captures Assets, and performs one Fold", async () => {
    const root = projectTree({
      "project.ts": projectSource(),
      "src/build.ts": buildSource(),
      "src/features.ts": featuresSource(),
      "src/features/main.ts": featureSource(),
      "src/features/undeclared.ts":
        'throw new Error("the build imported a module no line declares");\n',
      "assets/gfx/interface/project-icon.txt": "asset bytes",
    });
    // One dynamic import: a second one of `project.ts` would be a second module
    // instance under the test runner, and so a second capability.
    const { buildTheMod } = (await import(pathToFileURL(join(root, "src/build.ts")).href)) as {
      readonly buildTheMod: () => PureMod;
    };

    const compiled = buildTheMod();
    const rendered = render(compiled);

    expect(rendered.get("common/technology/project_pipeline_main.txt")).toContain(
      "project_pipeline_tech_theory"
    );
    expect(rendered.file("gfx/interface/project-icon.txt")?.text).toBeUndefined();
    expect(new TextDecoder().decode(rendered.file("gfx/interface/project-icon.txt")?.bytes())).toBe(
      "asset bytes"
    );
    expect(compiled.compileInputs.features).toEqual([
      { stem: "assets", itemCount: 1, itemIds: [] },
      { stem: "main", itemCount: 1, itemIds: ["project_pipeline_tech_theory"] },
    ]);
    expect(compiled.compileInputs.vanilla).toEqual({
      loadedView: false,
      gameVersion: undefined,
      pathInventory: false,
    });
  });
});

describe("parseProjectLayout", () => {
  it("returns frozen portable segments for schema-approved paths", () => {
    const layout = parseProjectLayout({ assetsDirectory: "assets/source" });

    expect(layout.assetsSegments).toEqual(["assets", "source"]);
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.assetsSegments)).toBe(true);
  });
});

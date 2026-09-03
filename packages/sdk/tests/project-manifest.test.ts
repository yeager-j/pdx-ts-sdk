/**
 * `createModProject` is handed a `stellaris-mod.json` a build script imported,
 * and TypeScript's description of that file is an assertion rather than a
 * check. Every case below is a manifest that type-checks at the call site and
 * used to be spread straight into `ModConfig` — `name: 42` produced a project
 * whose resolved `config.name` was still a number, and a non-array `tags`
 * failed later with an incidental `TypeError` (SDK-328).
 *
 * The casts are what a JSON import gives for free.
 */

import { describe, expect, it } from "vitest";

import { ProjectManifestError } from "../src/errors.ts";
import { createModProject, type ModProjectManifest } from "../src/index.ts";
import { PROJECT_MOD_FIELDS } from "../src/project-manifest.ts";

const PROJECT_ROOT = "/tmp/pdx-manifest-probe";

/** What a JSON import hands `createModProject`: a shape nothing has checked. */
function project(manifest: unknown) {
  return createModProject(manifest as ModProjectManifest, { projectRoot: PROJECT_ROOT });
}

function build(manifest: unknown) {
  return () => project(manifest);
}

/** A manifest that parses, so each case below differs in exactly one field. */
function goodManifest(): Record<string, unknown> {
  return {
    mod: {
      manifest_probe: {
        name: "Manifest Probe",
        version: "0.1.0",
        supportedVersion: "v4.4.*",
        tags: ["Gameplay"],
      },
    },
    assetsDirectory: "assets",
  };
}

/** `goodManifest()` with one launcher-config field replaced. */
function withConfigField(field: string, value: unknown): Record<string, unknown> {
  const manifest = goodManifest();
  const config = (manifest["mod"] as Record<string, Record<string, unknown>>)["manifest_probe"]!;
  if (value === undefined) {
    delete config[field];
  } else {
    config[field] = value;
  }
  return manifest;
}

describe("a manifest that parses", () => {
  it("resolves the fields as the types the pipeline assumes", () => {
    const built = project(goodManifest());

    expect(built.config.name).toBe("Manifest Probe");
    expect(built.config.prefix).toBe("manifest_probe");
    expect(built.config.version).toBe("0.1.0");
    expect(built.config.supportedVersion).toBe("v4.4.*");
    expect(built.config.tags).toEqual(["Gameplay"]);
  });

  it("copies tags rather than aliasing the manifest's array", () => {
    const manifest = goodManifest();
    const built = project(manifest);
    const config = (manifest["mod"] as Record<string, Record<string, unknown>>)["manifest_probe"]!;

    (config["tags"] as string[]).push("Mutated");

    expect(built.config.tags).toEqual(["Gameplay"]);
  });
});

describe("the launcher configuration under the prefix", () => {
  it("refuses a name that is not a string", () => {
    expect(build(withConfigField("name", 42))).toThrow(ProjectManifestError);
    expect(build(withConfigField("name", 42))).toThrow(
      "mod.manifest_probe.name must be a string, and is a number."
    );
  });

  it("refuses a version and a supportedVersion that are not strings", () => {
    expect(build(withConfigField("version", 3))).toThrow(
      "mod.manifest_probe.version must be a string, and is a number."
    );
    expect(build(withConfigField("supportedVersion", ["v4.4.*"]))).toThrow(
      "mod.manifest_probe.supportedVersion must be a string, and is an array."
    );
  });

  it("refuses tags that are not an array of strings", () => {
    expect(build(withConfigField("tags", "Gameplay"))).toThrow(
      "mod.manifest_probe.tags must be an array of strings, and is a string."
    );
    expect(build(withConfigField("tags", ["Gameplay", 7]))).toThrow(
      "mod.manifest_probe.tags must be an array of strings, and is an array."
    );
  });

  it("names a required field that is absent", () => {
    expect(build(withConfigField("name", undefined))).toThrow(
      'mod.manifest_probe has no "name" field, which is required.'
    );
    expect(build(withConfigField("supportedVersion", undefined))).toThrow(
      'mod.manifest_probe has no "supportedVersion" field, which is required.'
    );
  });

  it("accepts an absent optional field", () => {
    expect(project(withConfigField("tags", undefined)).config.tags).toBeUndefined();
  });

  it("refuses a configuration that is not an object", () => {
    expect(build({ ...goodManifest(), mod: { manifest_probe: "Manifest Probe" } })).toThrow(
      "mod.manifest_probe must be a JSON object, and is a string."
    );
  });
});

describe("the manifest envelope", () => {
  it("refuses a manifest that is not an object", () => {
    expect(build(null)).toThrow("A Project Manifest must be a JSON object, and is null.");
    expect(build([])).toThrow("A Project Manifest must be a JSON object, and is an array.");
  });

  it("refuses a mod key that is absent or not an object", () => {
    expect(build({ assetsDirectory: "assets" })).toThrow(
      'A Project Manifest\'s "mod" must be a JSON object, and is absent.'
    );
    expect(build({ ...goodManifest(), mod: [] })).toThrow(
      'A Project Manifest\'s "mod" must be a JSON object, and is an array.'
    );
  });

  it("still requires exactly one prefix, and names the ones it found", () => {
    expect(build({ ...goodManifest(), mod: {} })).toThrow(
      "A Project Manifest must declare exactly one mod, and declares 0."
    );
    expect(
      build({
        ...goodManifest(),
        mod: { one: { name: "a", supportedVersion: "v4.4.*" }, two: {} },
      })
    ).toThrow('declares 2 ("one", "two")');
  });
});

describe("the project-layout fields", () => {
  it("refuses a directory that is not a string, rather than testing its digits", () => {
    const manifest = { ...goodManifest(), assetsDirectory: 42 };
    expect(build(manifest)).toThrow(ProjectManifestError);
    expect(build(manifest)).toThrow('"assetsDirectory" must be a string, and is a number.');
  });

  it("accepts a manifest without an assetsDirectory", () => {
    const { assetsDirectory: _omitted, ...manifest } = goodManifest();
    expect(build(manifest)).not.toThrow();
  });

  it("refuses the retired contentDirectory key and names the fix", () => {
    // Unknown keys pass through, so the one key a past release read has to be
    // refused by name: a manifest that still says where Features live would
    // otherwise build as if it had never said so.
    const manifest = { ...goodManifest(), contentDirectory: "src/content" };
    expect(build(manifest)).toThrow(ProjectManifestError);
    expect(build(manifest)).toThrow(
      '"contentDirectory" is no longer read: features are declared in src/features.ts. ' +
        "Remove the key."
    );
  });
});

describe("the field table", () => {
  it("names every launcher-configuration field the manifest carries", () => {
    expect(Object.keys(PROJECT_MOD_FIELDS)).toEqual([
      "name",
      "version",
      "supportedVersion",
      "tags",
      "acceptGameVersion",
    ]);
    expect(
      Object.entries(PROJECT_MOD_FIELDS)
        .filter(([, field]) => field.required)
        .map(([name]) => name)
    ).toEqual(["name", "supportedVersion"]);
  });
});

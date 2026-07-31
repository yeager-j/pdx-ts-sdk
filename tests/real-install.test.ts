/**
 * Non-gating contact with reality: the handoff's first probe, against the
 * local install. Patch the real `tech_gene_tailoring` (`cost.value * 2`, one
 * appended prerequisite) and assert the computed filename byte-sorts after
 * `00_soc_tech.txt` and every other file defining the key — with the win
 * assertion naming each one. Runs only where the install exists; the
 * committed gates are the hermetic suites.
 *
 * This retires the probe's five-file OR-prerequisites refusal: `load()` is
 * eager, so its mere success proves every vanilla technology file builds a
 * typed surface.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { Mod } from "../src/mod.ts";
import { compareLogicalPaths } from "../src/resolver/path-order.ts";
import { SUPPORTED_STELLARIS_BUILD } from "../src/resolver/rules.ts";
import { load } from "../src/stellaris/load.ts";
import { locateInstall } from "../src/stellaris/locate.ts";

let installPath: string | undefined;
try {
  installPath = locateInstall();
} catch {
  installPath = undefined;
}

const cacheDir = mkdtempSync(join(tmpdir(), "pdx-sdk-real-cache-"));
afterAll(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe.skipIf(installPath === undefined)("real install (non-gating)", () => {
  it("every vanilla technology file builds a typed surface, OR groups included", () => {
    const started = performance.now();
    const vanilla = load({ installPath, cache: cacheDir });
    const elapsed = performance.now() - started;

    const techFiles = vanilla.files.filter((file) => file.path.startsWith("common/technology/"));
    expect(techFiles.length).toBeGreaterThan(30);
    const technologies = vanilla.allTechnologies();
    expect(technologies.length).toBeGreaterThan(100);
    // The construct the probe's parser had to refuse, now typed data.
    const withAnyOf = technologies.filter((tech) =>
      tech.prerequisites?.some((p) => "kind" in p && p.kind === "any-of")
    );
    expect(withAnyOf.length).toBeGreaterThan(0);
    // The escape-hatch clause: an install layer too slow to run every build.
    console.info(
      `load(): ${technologies.length} technologies from ${techFiles.length} files ` +
        `in ${Math.round(elapsed)}ms (build ${vanilla.gameVersion ?? "unknown"})`
    );
  });

  it("a second load is a cache hit with the identical manifest", () => {
    const first = load({ installPath, cache: cacheDir });
    const started = performance.now();
    const second = load({ installPath, cache: cacheDir });
    const elapsed = performance.now() - started;
    expect(second.fromCache).toBe(true);
    expect(second.manifestKey).toBe(first.manifestKey);
    console.info(`cached load(): ${Math.round(elapsed)}ms`);
  });

  it("patches the real tech_gene_tailoring into a provably winning file", () => {
    const vanilla = load({ installPath, cache: cacheDir });
    const mod = new Mod({
      name: "Real Patch Probe",
      prefix: "pp_real",
      supportedVersion: "4.4.*",
      // The hermetic suites gate the staleness check; here the point is the
      // filename computation against whatever build is installed.
      ...(vanilla.gameVersion !== SUPPORTED_STELLARIS_BUILD
        ? { acceptGameVersion: vanilla.gameVersion }
        : {}),
    });
    const myNewTech = mod.defineTechnology({
      id: "pp_real_tech_marker",
      name: "Probe Marker",
      area: "society",
      tier: 1,
      category: "biology",
    });
    mod.patchTechnology(
      vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites"),
      (t) => ({
        cost: t.cost.value * 2,
        prerequisites: [...t.prerequisites, myNewTech],
      })
    );

    const plan = mod.patchPlan()!;
    const assertion = plan.assertions[0]!;
    expect(assertion.key).toBe("tech_gene_tailoring");
    expect(assertion.beats).toContain("common/technology/00_soc_tech.txt");
    for (const beaten of assertion.beats) {
      expect(compareLogicalPaths(plan.relPath, beaten)).toBe(1);
    }
    // The name must also beat every OTHER technology file, or the claim
    // "sorts after every definer" was tested against too small a set.
    const definers = vanilla.files.filter((file) => file.keys.includes("tech_gene_tailoring"));
    expect(definers.map((file) => file.path)).toEqual(assertion.beats);

    const files = mod.render();
    expect(files.get(plan.relPath)).toBe(plan.content);
    console.info(`computed winning path: ${plan.relPath}`);
    console.info(`beats: ${assertion.beats.join(", ")}`);
  });
});

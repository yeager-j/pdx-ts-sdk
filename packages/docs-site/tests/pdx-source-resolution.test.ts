/**
 * Every Vite environment resolves the workspace packages to their sources.
 *
 * This is a gate on the gate. The docs build checks two things for real — that
 * every registry the SDK exposes has a reference page, and that every paired
 * example compiles and renders — and both are worthless if the build reads a
 * `dist/` instead of the sources under review. That is not hypothetical: the
 * condition used to be spelled as `vite.resolve` and `vite.ssr.resolve`, which
 * reach only the environments named `client` and `ssr`, and Astro renders
 * static pages in a third one named `prerender`.
 *
 * So the assertion is deliberately name-blind: whatever environments exist,
 * each one carries the condition. An environment Astro adds later is covered
 * without anyone remembering to come back here.
 */

import { defaultClientConditions, defaultServerConditions, resolveConfig } from "vite";
import { describe, expect, it } from "vitest";

import { pdxSourceResolution } from "../src/pdx-source-resolution.ts";

/**
 * The four environments Astro uses — `client` and `ssr` during a build, plus
 * `prerender` for static pages and `astro` for the dev module runner — and one
 * invented name standing in for the fifth Astro has not added yet.
 */
const ENVIRONMENTS = ["client", "ssr", "prerender", "astro", "invented"] as const;

async function resolveEnvironments() {
  const config = await resolveConfig(
    {
      configFile: false,
      logLevel: "silent",
      plugins: [pdxSourceResolution()],
      environments: Object.fromEntries(ENVIRONMENTS.map((name) => [name, {}])),
    },
    "build"
  );
  return config.environments;
}

describe("pdxSourceResolution", () => {
  it("puts the source condition in every environment", async () => {
    const environments = await resolveEnvironments();

    expect(Object.keys(environments).sort()).toEqual([...ENVIRONMENTS].sort());
    for (const [name, environment] of Object.entries(environments)) {
      expect(environment.resolve.conditions, name).toContain("pdx-source");
    }
  });

  it("adds the condition rather than replacing Vite's defaults", async () => {
    const environments = await resolveEnvironments();

    // A user `conditions` array replaces the defaults instead of extending
    // them, so losing `module`/`node`/`browser` is the near miss worth pinning.
    expect(environments.client.resolve.conditions).toEqual(
      expect.arrayContaining([...defaultClientConditions])
    );
    for (const name of ["ssr", "prerender", "astro", "invented"] as const) {
      expect(environments[name].resolve.conditions, name).toEqual(
        expect.arrayContaining([...defaultServerConditions])
      );
    }
  });

  it("keeps the workspace packages inside Vite's resolver on the server", async () => {
    const environments = await resolveEnvironments();

    // Externalized, these are resolved by Node, which is not passed the
    // condition and would read `dist/`. The client bundles everything anyway.
    for (const name of ["ssr", "prerender", "astro", "invented"] as const) {
      const noExternal = [environments[name].resolve.noExternal].flat();
      expect(
        noExternal.some((entry) => entry instanceof RegExp && entry.test("@pdx-ts/sdk")),
        name
      ).toBe(true);
    }
  });
});

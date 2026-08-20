import { describe, expect, it } from "vitest";

import { PDX_NEXT_CONFIG } from "../src/next-config-values.mjs";
import { withPdxSourceResolution } from "../src/pdx-source-resolution.mjs";

/**
 * The docs build must resolve `@pdx-ts/*` to package sources, never `dist/`
 * — the repo does not build `dist/` during development, and CI proves the
 * end-to-end behavior by running `docs:build` with every `dist/` deleted.
 * These tests pin the two config halves that guarantee it inside webpack:
 * the `pdx-source` condition, and keeping the workspace packages bundled
 * (`transpilePackages`) so Node's condition-blind resolver never sees them.
 */
describe("withPdxSourceResolution", () => {
  it("prepends pdx-source ahead of webpack's defaults", () => {
    const config = withPdxSourceResolution({});
    expect(config.resolve?.conditionNames).toEqual(["pdx-source", "..."]);
  });

  it("preserves conditions a future config might set", () => {
    const config = withPdxSourceResolution({
      resolve: { conditionNames: ["worker", "..."] },
    });
    expect(config.resolve?.conditionNames).toEqual(["pdx-source", "worker", "..."]);
  });

  it("does not double the condition", () => {
    const once = withPdxSourceResolution({});
    const twice = withPdxSourceResolution(once);
    expect(
      twice.resolve?.conditionNames?.filter((name: string) => name === "pdx-source")
    ).toHaveLength(1);
  });
});

describe("the Next.js config", () => {
  it("keeps both workspace packages inside webpack", () => {
    expect(PDX_NEXT_CONFIG.transpilePackages).toEqual(["@pdx-ts/sdk", "@pdx-ts/stellaris-ids"]);
  });

  it("keeps the Astro site's trailing-slash URLs", () => {
    expect(PDX_NEXT_CONFIG.trailingSlash).toBe(true);
  });

  it("is a server build, so proxy.ts can content-negotiate Markdown", () => {
    expect(PDX_NEXT_CONFIG).not.toHaveProperty("output");
  });
});

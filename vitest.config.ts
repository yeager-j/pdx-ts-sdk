import { defineConfig } from "vitest/config";

/**
 * Workspace packages publish `exports` pointing at `dist/`, because Node
 * refuses to strip types under `node_modules` and a published package must ship
 * built JavaScript. This repo never builds during development, so `pdx-source`
 * is the condition that resolves those same packages to their sources instead.
 *
 * It has to be spelled three times because three resolvers are involved: the
 * root tsconfig says `customConditions`, the npm scripts pass Node
 * `--conditions`, and this says both halves of Vite's — `resolve` for what it
 * transforms, `ssr.resolve.externalConditions` for what it externalizes, which
 * is what workspace packages are. Projects do not inherit these from the root
 * config, so each one repeats them.
 */
const resolve = { conditions: ["pdx-source"] };

const ssr = {
  resolve: {
    conditions: ["pdx-source"],
    externalConditions: ["pdx-source"],
  },
};

export default defineConfig({
  resolve,
  ssr,
  test: {
    projects: [
      {
        resolve,
        ssr,
        test: {
          name: "root",
          // The package-absent world: `packages/*/tests/**` would also match
          // `packages/stellaris-ids/tests/**`, so that one has to be
          // excluded here — it gets its own project below, run against its
          // own tsconfig, so the package's augmentation never joins this one.
          include: ["design/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
          exclude: ["packages/stellaris-ids/tests/**"],
          typecheck: {
            enabled: true,
            include: [
              "packages/sdk/tests/**/*.test-d.ts",
              "packages/sdk-testing/tests/**/*.test-d.ts",
            ],
          },
        },
      },
      {
        resolve,
        ssr,
        test: {
          name: "stellaris-ids",
          // The package-present world: this project's typecheck resolves
          // `@pdx-ts/sdk` via the package's own tsconfig, so the augmentation
          // in `packages/stellaris-ids/src/augment.ts` actually activates.
          include: ["packages/stellaris-ids/tests/**/*.test.ts"],
          typecheck: {
            enabled: true,
            include: ["packages/stellaris-ids/tests/**/*.test-d.ts"],
            tsconfig: "./packages/stellaris-ids/tsconfig.json",
          },
        },
      },
    ],
  },
});

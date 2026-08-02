import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "root",
          // The package-absent world: `packages/*/tests/**` would also match
          // `packages/stellaris-vanilla/tests/**`, so that one has to be
          // excluded here — it gets its own project below, run against its
          // own tsconfig, so the package's augmentation never joins this one.
          include: ["design/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
          exclude: ["packages/stellaris-vanilla/tests/**"],
          typecheck: {
            enabled: true,
            include: ["packages/sdk/tests/**/*.test-d.ts"],
          },
        },
      },
      {
        test: {
          name: "stellaris-vanilla",
          // The package-present world: this project's typecheck resolves
          // `@pdx-ts/sdk` via the package's own tsconfig, so the augmentation
          // in `packages/stellaris-vanilla/src/augment.ts` actually activates.
          include: ["packages/stellaris-vanilla/tests/**/*.test.ts"],
          typecheck: {
            enabled: true,
            include: ["packages/stellaris-vanilla/tests/**/*.test-d.ts"],
            tsconfig: "./packages/stellaris-vanilla/tsconfig.json",
          },
        },
      },
    ],
  },
});

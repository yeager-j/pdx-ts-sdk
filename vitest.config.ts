import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
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
            include: ["packages/sdk/tests/**/*.test-d.ts"],
          },
        },
      },
      {
        test: {
          name: "stellaris-ids",
          // The package-present world: this project's typecheck resolves
          // `@pdx-ts/sdk` via the package's own tsconfig, so the augmentation
          // in `packages/stellaris-ids/src/augment.ts` actually activates.
          // `examples/` compiles here too — the showcase imports this package,
          // which is the setup a real mod author has, and an augmentation is
          // global to a program so it cannot also be in the root one.
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

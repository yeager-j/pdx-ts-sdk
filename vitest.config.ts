import { fileURLToPath } from "node:url";
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
const resolve = {
  alias: { "@": fileURLToPath(new URL("./packages/docs-site", import.meta.url)) },
  conditions: ["pdx-source"],
};

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
    // One project over every workspace member. There used to be two, so that
    // the root program could model the world where `@pdx-ts/stellaris-ids` was
    // absent and its own program the world where the augmentation had joined;
    // the SDK now imports the package (ADR-0006), so there is one world.
    include: ["packages/*/tests/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["packages/*/tests/**/*.test-d.ts"],
    },
  },
});

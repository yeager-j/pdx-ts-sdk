/**
 * The webpack half of the source-resolution guarantee.
 *
 * The workspace packages publish a `pdx-source` export condition that maps
 * every entry point to `src/` instead of `dist/`. The repo never builds
 * `dist/` during development, so every resolver that touches `@pdx-ts/*`
 * must know the condition: the root tsconfig spells it as `customConditions`,
 * npm scripts as `node --conditions=pdx-source`, vitest in its own config —
 * and the docs site here, by prepending it to webpack's condition names.
 *
 * The transform alone is not enough: webpack only resolves what it bundles.
 * `transpilePackages` in `next.config.mjs` keeps `@pdx-ts/sdk` and
 * `@pdx-ts/stellaris-ids` inside the bundle on the server too — listed in
 * `serverExternalPackages` they would be resolved by Node at runtime, which
 * never sees the condition and would silently read stale `dist/` output.
 * CI proves the pair works by building with every package's `dist` deleted.
 *
 * Kept as a pure function in its own module so the test in
 * `tests/pdx-source-resolution.test.ts` exercises the exact production code.
 */

const SOURCE_CONDITION = "pdx-source";

/**
 * Prepends the `pdx-source` condition to a webpack config's resolve
 * conditions, preserving webpack's own defaults via `"..."`.
 *
 * @param {import("webpack").Configuration} config
 * @returns {import("webpack").Configuration}
 */
export function withPdxSourceResolution(config) {
  config.resolve ??= {};
  const existing = config.resolve.conditionNames ?? ["..."];
  if (!existing.includes(SOURCE_CONDITION)) {
    config.resolve.conditionNames = [SOURCE_CONDITION, ...existing];
  }
  return config;
}

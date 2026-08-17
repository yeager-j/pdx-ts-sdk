import { defaultClientConditions, defaultServerConditions, type Plugin } from "vite";

/**
 * Resolve the workspace packages to their sources in every Vite environment.
 *
 * Workspace packages publish `exports` pointing at the never-built `dist/`, and
 * `pdx-source` is the condition that resolves them to sources instead — the
 * same condition the root tsconfig, the npm scripts and vitest all spell.
 *
 * Spelling it as `vite.resolve.conditions` and `vite.ssr.resolve.conditions`,
 * the way vitest.config.ts does, is not enough here, and the reason is worth
 * stating because the same mistake is easy to repeat. Those two keys reach
 * exactly two environments: the one named `client` and the one named `ssr`.
 * Astro runs neither during a build. It renders static pages in a third
 * environment, `prerender`, and dev-time modules in a fourth, `astro`; both
 * were left with Vite's stock server conditions, so both read `dist/`. The
 * build failed outright with no `dist/` present and silently read stale output
 * with one — which is why a docs build that gates the registry coverage and the
 * paired examples could pass against yesterday's SDK.
 *
 * `configEnvironment` runs once per environment whatever it is called, so the
 * condition follows the environments rather than a list of their names. Astro
 * adding a fifth needs no change here.
 */

const SOURCE_CONDITION = "pdx-source";

/**
 * Every workspace package, by the scope they all share. Named as a pattern
 * rather than a list because a list is a second place to add a package to.
 * These have to stay inside Vite's resolver: externalized, Node resolves their
 * `exports` itself, and Node is not passed the condition here.
 */
const WORKSPACE_SCOPE = /^@pdx-ts\//;

export function pdxSourceResolution(): Plugin {
  return {
    name: "pdx-source-resolution",
    configEnvironment(name, config) {
      // `consumer` is not resolved yet at this point. This is the rule Vite
      // itself applies a moment later, and it decides which set of stock
      // conditions the environment would otherwise have.
      const consumer = config.consumer ?? (name === "client" ? "client" : "server");

      const resolve = (config.resolve ??= {});

      // The defaults are restored explicitly when the environment carries none,
      // because a `conditions` array replaces Vite's defaults rather than
      // adding to them.
      const conditions =
        resolve.conditions ??
        (consumer === "client" ? [...defaultClientConditions] : [...defaultServerConditions]);
      resolve.conditions = conditions.includes(SOURCE_CONDITION)
        ? conditions
        : [SOURCE_CONDITION, ...conditions];

      if (consumer !== "server") return;

      // `true` already means "externalize nothing", so there is nothing to add.
      const noExternal = resolve.noExternal;
      if (noExternal === true) return;
      const existing = noExternal === undefined ? [] : [noExternal].flat();
      if (!existing.some((entry) => String(entry) === String(WORKSPACE_SCOPE))) {
        resolve.noExternal = [WORKSPACE_SCOPE, ...existing];
      }
    },
  };
}

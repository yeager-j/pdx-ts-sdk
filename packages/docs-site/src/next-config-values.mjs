/**
 * The Next.js config values, in a module with no side effects so the
 * resolution test can assert them without importing `next.config.mjs`
 * (which invokes the fumadocs-mdx wrapper at load).
 *
 * The site deploys to Vercel as a standard prerendered build — every page is
 * SSG, and `proxy.ts` content-negotiates Markdown for AI agents, which a
 * static export could not do. `trailingSlash` keeps the Astro site's URLs.
 * `transpilePackages` is half of the source-resolution guarantee — see
 * `pdx-source-resolution.mjs` for the other half and the reasoning.
 */
export const PDX_NEXT_CONFIG = {
  trailingSlash: true,
  reactStrictMode: true,
  transpilePackages: ["@pdx-ts/sdk", "@pdx-ts/stellaris-ids"],
  allowedDevOrigins: ["jacksons-macbook-air.tailc2a080.ts.net"],
};

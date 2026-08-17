import starlight from "@astrojs/starlight";
import catppuccin from "@catppuccin/starlight";
import { defineConfig } from "astro/config";
import { defaultClientConditions, defaultServerConditions } from "vite";

import { GRAMMARS } from "./src/pdx-languages.ts";

/**
 * The sidebar has two sections and only two: Guides, the hand-written concept
 * pages, and Reference, one page per content registry. Both autogenerate from
 * their directory, so a page joins the navigation by existing.
 */
export default defineConfig({
  integrations: [
    starlight({
      title: "@pdx-ts/sdk",
      description: "TypeScript SDK for generating Stellaris mods",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/yeager-j/pdx-ts-sdk",
        },
      ],
      sidebar: [
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
      ],
      // Catppuccin, at the plugin's own defaults: mocha for dark, latte for
      // light, mauve accent in both. `catppuccin({ dark: { flavor, accent },
      // light: { flavor, accent } })` changes either half.
      plugins: [catppuccin()],
      // The hand-written PDXScript and localization grammars, so a paired
      // example's output tab is highlighted rather than flat grey. Shiki runs
      // at build time only; no grammar reaches the browser.
      //
      // The themes are not a free choice: the theme decides how much of the
      // grammar a reader can see. Starlight's default renders keys, numbers
      // and booleans in near-identical colours; Catppuccin separates the trio
      // that carries the meaning here (key, value, number) and matches the
      // rest of the site.
      expressiveCode: {
        themes: ["catppuccin-mocha", "catppuccin-latte"],
        shiki: { langs: [GRAMMARS.pdxscript, GRAMMARS.pdxloc] },
      },
    }),
  ],
  // The paired examples import `@pdx-ts/sdk` at build time, and workspace
  // packages publish `exports` pointing at the never-built `dist/`. As in
  // vitest.config.ts, `pdx-source` resolves them to sources — spelled for both
  // halves of Vite's resolution, and with the defaults restored because a user
  // `conditions` array replaces them. `noExternal` keeps the workspace
  // packages inside Vite's resolver rather than leaving them to Node, which
  // would resolve their `exports` to `dist/`.
  vite: {
    resolve: { conditions: ["pdx-source", ...defaultClientConditions] },
    ssr: {
      resolve: {
        conditions: ["pdx-source", ...defaultServerConditions],
        externalConditions: ["pdx-source"],
      },
      noExternal: ["@pdx-ts/sdk", "@pdx-ts/pdxscript", "@pdx-ts/stellaris-ids"],
    },
  },
});

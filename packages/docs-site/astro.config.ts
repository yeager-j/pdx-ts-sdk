import starlight from "@astrojs/starlight";
import catppuccin from "@catppuccin/starlight";
import { defineConfig } from "astro/config";

import { GRAMMARS } from "./src/pdx-languages.ts";
import { pdxSourceResolution } from "./src/pdx-source-resolution.ts";

/**
 * The sidebar has three sections and only three: Guides, the hand-written
 * workflow pages; Concepts, the surfaces that span many content types; and
 * Reference, one page per documented content registry. All autogenerate from
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
        { label: "Concepts", items: [{ autogenerate: { directory: "concepts" } }] },
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
  // The paired examples import `@pdx-ts/sdk` at build time, so the site is
  // built against the SDK's sources rather than a `dist/` that may not exist
  // and may be stale. The plugin carries the whole of that; see its comment for
  // why `vite.resolve` and `vite.ssr` cannot.
  vite: {
    plugins: [pdxSourceResolution()],
  },
  server: {
    allowedHosts: ["jacksons-macbook-air.tailc2a080.ts.net"],
  },
});

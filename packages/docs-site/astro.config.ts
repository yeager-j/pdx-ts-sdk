import starlight from "@astrojs/starlight";
import catppuccin from "@catppuccin/starlight";
import { defineConfig } from "astro/config";

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
    }),
  ],
});

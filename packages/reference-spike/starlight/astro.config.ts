/**
 * The second viewer, built on a documentation framework instead of by hand.
 *
 * This directory is the whole of the follow-up spike. Nothing under it owns a
 * fact: the prose is `../content/*.mdx` unmodified, the data is
 * `../data/*.json` unmodified, the stories are the same committed modules the
 * root `npm run typecheck` compiles, and the gates in `../tests/` are unchanged
 * and still the acceptance criteria. Only the thing that renders them is
 * different, which is what makes the two comparable at all.
 *
 * It lives inside `packages/reference-spike` rather than beside it because
 * `tests/quarantine.test.ts` forbids any other package importing the spike —
 * a sibling package would have had to either import it, and fail the gate, or
 * copy the prose and the data, and stop being a comparison.
 */

import { unified } from "@astrojs/markdown-remark";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import type { AstroIntegration } from "astro";
import { defineConfig } from "astro/config";

import { headingIds, storyPanels } from "../src/app/remark-plugins.ts";
import { GRAMMARS, THEMES } from "../src/build/highlight.ts";
import { pageOwnership } from "./src/remark.ts";

/**
 * Starlight adds `@astrojs/sitemap` unless one is already registered, and a
 * sitemap is an instruction to a search-engine crawler. This bundle is an
 * offline page with no origin: emitting one would mean inventing a public URL
 * for the thing whose whole product boundary is that it does not have one.
 *
 * Claiming the name is the supported way to decline it — Starlight's own check
 * is `find(({ name }) => name === '@astrojs/sitemap')`, which exists so a user
 * can bring their own. This one brings none.
 */
const noSitemap: AstroIntegration = { name: "@astrojs/sitemap", hooks: {} };

export default defineConfig({
  srcDir: "./src",
  outDir: "./dist",
  // Server-root only, and this is a real loss against the first viewer.
  //
  // That one built with Vite's `base: "./"`, so every asset reference was
  // relative and the same `dist/` worked from a loopback root, from a
  // subdirectory, or opened straight off the filesystem. Astro resolves `base`
  // into absolute URLs — `/_astro/…`, `/situations/` — and there is no relative
  // setting, because its routing assumes it owns an origin.
  //
  // Inside the product boundary as written: it says a local launcher serves the
  // bundle on a loopback address, which is a root. Outside what the first
  // viewer could also do, which was open the file and read it with no launcher
  // at all.
  base: "/",
  build: { format: "directory" },
  integrations: [
    react(),
    noSitemap,
    starlight({
      title: "Authoring Reference",
      description: "Reference spike — not a product.",
      // No edit links, no social icons, no last-updated: this renders one
      // immutable Reference build with no repository behind it, and every one
      // of those chrome items would be a link out of an offline page.
      editLink: undefined,
      lastUpdated: false,
      pagination: true,
      credits: false,
      customCss: ["./src/styles/tokens.css"],
      // Measured, then declined. Pagefind is offline and finds every term this
      // reference needs, but a result is a page and a `data-pagefind-filter`
      // selects pages too — asking it for known omissions returns "both of
      // them". The truth model needs the claim, not the page that has one.
      // See `src/components/ReferenceSearch.tsx` for the full measurement.
      //
      // Off rather than left running unused: it is a second index in the
      // bundle answering nothing.
      pagefind: false,
      sidebar: [{ label: "Registries", items: ["situations", "technology"] }],
      components: {
        Search: "./src/overrides/Search.astro",
      },
    }),
  ],
  markdown: {
    processor: unified({
      // The same two plugins the first viewer uses, imported rather than
      // reimplemented, so both viewers slug a heading identically and the
      // committed section ids in the snapshot stay valid for both. Third is
      // the one plugin this viewer needed of its own; see `src/remark.ts`.
      remarkPlugins: [headingIds, storyPanels, pageOwnership],
    }),
    shikiConfig: {
      themes: { light: THEMES.light, dark: THEMES.dark },
      langs: [GRAMMARS.pdxscript, GRAMMARS.pdxloc],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: { conditions: ["pdx-source"] },
    ssr: { resolve: { conditions: ["pdx-source"], externalConditions: ["pdx-source"] } },
  },
  // Loopback, spelled out, for the same reason the first viewer spells it out:
  // a documentation viewer listening on every interface is one a colleague can
  // read off the office wifi. One block rather than the first viewer's two,
  // because `astro preview` reads the same `server` config `astro dev` does.
  server: { host: "127.0.0.1", port: 4174 },
});

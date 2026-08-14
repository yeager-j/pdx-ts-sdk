/**
 * The pages, loaded from where they already live.
 *
 * `docsLoader()` would be the idiomatic call, and it is not usable here: it
 * hard-codes `src/content/docs/` as the base, and this port's whole claim is
 * that it renders the *same* prose the first viewer does. Copying two MDX files
 * into a framework-shaped directory would have made the comparison worthless —
 * two copies of a page drift, and the one under `content/` is the one the
 * snapshot builder, the story extractor and the gates all read.
 *
 * So the collection is a plain `glob()` with its base pointed back out at
 * `../content`, carrying Starlight's own schema. That is a supported
 * composition rather than a workaround, and it is the reason the port needed no
 * edit to either page.
 */

import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

export const collections = {
  docs: defineCollection({
    loader: glob({ base: "../content", pattern: "*.mdx" }),
    schema: docsSchema({
      // The two frontmatter keys the pages already carry. `id` is the CWT
      // registry the page projects and `summary` is the one-line description
      // the first viewer prints under the title — both predate this port, and
      // declaring them is cheaper than rewriting the frontmatter of prose that
      // is meant to be untouched.
      extend: z.object({
        id: z.string().optional(),
        summary: z.string().optional(),
      }),
    }),
  }),
};

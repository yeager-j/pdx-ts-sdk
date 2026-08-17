import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection, z } from "astro:content";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // `registries` is how a reference page tells the coverage gate which
    // registries it documents. It is optional in the schema and required by the
    // gate for pages under `reference/`, because the schema cannot see a page's
    // route but the gate can — and the message the gate throws is the one that
    // explains what to do about it.
    schema: docsSchema({ extend: z.object({ registries: z.array(z.string()).optional() }) }),
  }),
};

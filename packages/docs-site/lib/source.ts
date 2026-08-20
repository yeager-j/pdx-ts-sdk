import { loader } from "fumadocs-core/source";
import { pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { z } from "zod";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema.extend({
      /**
       * The registries a reference page documents. The coverage gate
       * (`src/registry-coverage.ts`) requires it on every `reference/` page
       * and forbids it elsewhere.
       */
      registries: z.array(z.string()).optional(),
      /** The canonical generated scope documented by a scope reference page. */
      scope: z.string().optional(),
      /** Identifies committed scope-reference projections without rendering into page content. */
      generatedBy: z.literal("scope-reference").optional(),
    }),
    postprocess: {
      /**
       * The LLM text export (`/llms.txt`, `/llms-full.txt`, the per-page
       * `.md` routes). The named components become placeholders that
       * `lib/get-llm-text.ts` re-renders as Markdown from the same derived
       * models the pages use — without this, the reference pages would
       * export as prose around empty component tags.
       */
      includeProcessedMarkdown: {
        mdxAsPlaceholder: [
          "Callout",
          "EffectsIndex",
          "EventFireMethods",
          "EventKinds",
          "FieldTable",
          "PairedExample",
          "RegistryCoverage",
          "ScopeEffects",
          "ScopeIdentity",
          "ScopeTransitions",
          "StructuralMethods",
          "TraditionTreeTemplates",
        ],
      },
    },
  },
});

// The site serves at the root, like the Astro site did: `/reference/situations/`.
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
});

/** Where a page's Markdown twin is served, for the LLM text routes. */
export function pageMarkdownSegments(page: (typeof source)["$inferPage"]): string[] {
  return [...page.slugs, "content.md"];
}

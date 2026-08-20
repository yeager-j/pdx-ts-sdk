import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { defineConfig } from "fumadocs-mdx/config";

import { GRAMMARS } from "./src/pdx-languages.ts";

/**
 * Global MDX options. Collections are declared with the macro API in
 * `lib/source.ts`; this file only configures highlighting.
 *
 * This file is compiled by esbuild and executed in a separate Node process
 * whose resolver never sees the `pdx-source` condition — an `@pdx-ts/*`
 * import here would silently resolve to stale `dist/` output, or fail with
 * none present. Never import a workspace package from this file or anything
 * it reaches; `./src/pdx-languages.ts` is safe because it imports only a
 * type from `shiki`.
 */
export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      themes: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
      langs: [...(rehypeCodeDefaultOptions.langs ?? []), GRAMMARS.pdxscript, GRAMMARS.pdxloc],
    },
  },
});

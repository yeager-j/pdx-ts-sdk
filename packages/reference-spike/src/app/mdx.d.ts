/**
 * `.mdx` imports, for the browser program.
 *
 * `@types/mdx` declares the module shape; this only has to bring it into scope,
 * because the page is imported by path rather than through a package.
 */

/// <reference types="mdx" />

declare module "*.mdx" {
  import type { MDXProps } from "mdx/types";

  export default function MDXContent(props: MDXProps): JSX.Element;
}

/**
 * The build-time syntax highlighting, supplied by a Vite plugin.
 *
 * Typed loosely on purpose: the keys are page ids and then story ids, which
 * come from the page registry and the MDX rather than from anything a type
 * could enumerate. The viewer already handles a missing entry, so an id with no
 * highlighting is a fallback rather than a crash.
 */
declare module "virtual:highlighted-stories" {
  const highlighted: Record<
    string,
    Record<string, { readonly code: string; readonly output: Readonly<Record<string, string>> }>
  >;
  export default highlighted;
}

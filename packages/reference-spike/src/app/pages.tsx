/**
 * The viewer's half of the page registry: one static import per page.
 *
 * `src/build/pages.ts` is the build's list, and this is the browser's. They are
 * two lists rather than one because a bundler cannot follow a path out of a
 * data structure — an MDX component and a JSON snapshot have to be reached by
 * a literal `import`, or Vite has nothing to compile and nothing to inline.
 * `tests/pages.test.ts` fails when the two disagree, which is the honest way to
 * hold a duplication that the tooling requires.
 *
 * The snapshot is imported, not fetched. The result is one static bundle
 * carrying immutable Reference builds with no service behind it and nothing to
 * configure — offline, read-only, and incapable of looking at the reader's
 * project even if somebody wanted it to.
 */

import type { ComponentType } from "react";

import SituationsPage from "../../content/situations.mdx";
import TechnologyPage from "../../content/technology.mdx";
import situationSnapshot from "../../data/situation-reference.json" with { type: "json" };
import technologySnapshot from "../../data/technology-reference.json" with { type: "json" };
import type { ReferenceBuild } from "../build.ts";

export interface ViewerPage {
  readonly id: string;
  readonly build: ReferenceBuild;
  readonly Content: ComponentType;
}

export const VIEWER_PAGES: readonly ViewerPage[] = [
  {
    id: "situations",
    build: situationSnapshot as unknown as ReferenceBuild,
    Content: SituationsPage,
  },
  {
    id: "technology",
    build: technologySnapshot as unknown as ReferenceBuild,
    Content: TechnologyPage,
  },
];

/**
 * Which page the reader asked for.
 *
 * A query parameter rather than a fragment, because the fragment is already
 * spoken for: every section on a page is an anchor, and a router that took the
 * fragment would have had to reinvent them. `?page=` also survives being opened
 * from a file:// path, which the bundle is built to allow.
 */
export const PAGE_PARAM = "page";

export function selectedPage(search: string): ViewerPage {
  const requested = new URLSearchParams(search).get(PAGE_PARAM);
  return VIEWER_PAGES.find((page) => page.id === requested) ?? VIEWER_PAGES[0]!;
}

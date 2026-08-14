/**
 * The one plugin the framework port needed that the hand-written viewer did
 * not.
 *
 * In the React viewer the derived components are closed over the page: `App`
 * receives one `ViewerPage`, builds a components map bound to that build, and
 * hands it to `MDXProvider`. `<Claim id="registry" />` resolves because the
 * component it reaches already knows which page it is on.
 *
 * Astro has no equivalent. Components reach MDX through a `components` prop on
 * `<Content />`, and an `.astro` component cannot be partially applied — there
 * is no closure to put the build in. Every route could rebuild the map, but the
 * components would still have to be `.astro` files to carry a `client:`
 * directive for the two interactive ones, and an `.astro` file takes only the
 * attributes the MDX wrote.
 *
 * So the page identity is written into the attributes instead. The plugin knows
 * which file it is transforming — remark hands it the vfile — and every derived
 * element gets a `page` attribute naming the Reference page it belongs to. The
 * components then resolve their own data, and nothing needs a closure.
 *
 * This is not a workaround for a missing Astro feature so much as the shape the
 * framework asks for: components that are data-addressed rather than
 * context-bound. It also fixes a real collision the first viewer's outcome
 * report found by reasoning — both pages have a story called `minimal`, and a
 * lookup keyed by story id alone would show the wrong page's code.
 */

import path from "node:path";

import { PAGES } from "../../src/build/pages.ts";

/** The derived components, which are exactly the ones that need a page to resolve against. */
const DERIVED = new Set([
  "Claim",
  "Convention",
  "StoryPanel",
  "FieldTable",
  "SdkContracts",
  "EvidenceSummary",
]);

/**
 * Assignable from a real mdast tree, for the reason `remark-plugins.ts`
 * spells out: mdast's node types are closed interfaces, so an index signature
 * here would make `Root` unassignable and the plugin unusable by Astro's typed
 * `unified()` pipeline.
 */
interface Node {
  type: string;
  name?: string | null;
  attributes?: unknown;
  children?: Node[];
}

interface VFile {
  readonly path?: string;
}

/**
 * Which Reference page a source file is.
 *
 * Read off `PAGES` rather than from the file name, so the mapping is the same
 * registry the build, the extractor and the gates already share. A page whose
 * MDX is not declared there is a page nothing else in the package knows about,
 * and rendering it would be inventing one.
 */
function pageIdOf(file: VFile): string | null {
  if (file.path === undefined) {
    return null;
  }
  const name = path.basename(file.path);
  return PAGES.find((page) => path.basename(page.mdxPath) === name)?.id ?? null;
}

export function pageOwnership(): (tree: Node, file: VFile) => void {
  return (tree: Node, file: VFile): void => {
    const page = pageIdOf(file);
    if (page === null) {
      return;
    }
    const walk = (node: Node): void => {
      if (
        (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
        typeof node.name === "string" &&
        DERIVED.has(node.name)
      ) {
        node.attributes = [
          ...((node.attributes as unknown[] | undefined) ?? []),
          { type: "mdxJsxAttribute", name: "page", value: page },
        ];
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
    };
    walk(tree);
  };
}

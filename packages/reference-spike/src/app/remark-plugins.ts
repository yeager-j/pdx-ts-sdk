/**
 * Two small remark plugins: heading ids, and story panels.
 *
 * Both exist so the MDX can stay markdown. A section used to be a `<Section id
 * title>` element that rendered its own heading, which meant hand-styling an
 * `h2` and opting it out of Typeset — fighting the stylesheet whose entire job
 * is to style headings. A `##` with an explicit id does the same work and gets
 * styled for free.
 *
 * Turning a tagged code fence into the story panel that renders it.
 *
 * Without this the fence would render as a plain code block and the page would
 * have to repeat the story somewhere else to show its output — two copies of
 * one story, guaranteed to disagree eventually. So the fence is replaced
 * outright by `<StoryPanel id="…" />`, and the panel reads the code and the
 * synthesized output back out of the committed snapshot.
 *
 * That means the code the reader sees came through the extractor, the
 * compiler, and the fold — the same path the gates check — rather than being
 * the raw text of the fence. A fence that never made it through extraction
 * renders as a panel with nothing in it, which the assembly step refuses to
 * build in the first place.
 */

interface Node {
  type: string;
  depth?: number;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  children?: Node[];
  data?: { hProperties?: Record<string, string> };
  [key: string]: unknown;
}

/**
 * A heading's anchor, from its text.
 *
 * Explicit ids would be better — `{#progress}` is what most doc toolchains
 * write — but MDX parses `{` as an expression before any plugin can see the
 * heading, so the syntax simply does not survive. Slugifying is the honest
 * alternative rather than a preference: it is derived identity, and rewording
 * a heading moves its anchor.
 *
 * What keeps that from being silent is the snapshot. Section ids are committed,
 * so a reworded heading shows up in review as a changed anchor rather than as
 * a link that quietly stops working. Both the extractor and the viewer call
 * this one function, so the two can never disagree about where a section is.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Puts each heading's slug on the rendered element, so anchors resolve. */
export function headingIds(): (tree: Node) => void {
  return (tree: Node): void => {
    for (const node of tree.children ?? []) {
      if (node.type !== "heading") {
        continue;
      }
      const text = (node.children ?? [])
        .map((child) => child.value ?? "")
        .join("")
        .trim();
      if (text !== "") {
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: slugify(text) } };
      }
    }
  };
}

function storyIdOf(node: Node): string | null {
  if (node.type !== "code" || node.lang !== "ts" || !node.meta) {
    return null;
  }
  return /story="([^"]+)"/.exec(node.meta)?.[1] ?? null;
}

/** `<StoryPanel id="…" />`, as the MDX AST spells it. */
function panelNode(id: string): Node {
  return {
    type: "mdxJsxFlowElement",
    name: "StoryPanel",
    attributes: [{ type: "mdxJsxAttribute", name: "id", value: id }],
    children: [],
  };
}

/**
 * A remark plugin, hand-rolled rather than composed out of `unist-util-visit`.
 *
 * The walk is eight lines and the alternative is a dependency the spike would
 * carry for exactly this. Mutating in place through the parent's `children`
 * array is what lets a fence inside a `<Section>` be replaced as well as one at
 * the top level.
 */
export function storyPanels(): (tree: Node) => void {
  return (tree: Node): void => {
    const walk = (node: Node): void => {
      const children = node.children;
      if (children === undefined) {
        return;
      }
      for (const [index, child] of children.entries()) {
        const id = storyIdOf(child);
        if (id === null) {
          walk(child);
        } else {
          children[index] = panelNode(id);
        }
      }
    };
    walk(tree);
  };
}

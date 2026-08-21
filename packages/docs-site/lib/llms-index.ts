import type * as PageTree from "fumadocs-core/page-tree";

import { SDK_DOCS_REVISION_LINE, SDK_DOCS_VERSION_LINE } from "@/lib/sdk-docs-version";
import { pageMarkdownSegments, source } from "@/lib/source";

/**
 * The `/llms.txt` index. Hand-rolled rather than fumadocs' `llms().index()`
 * because that helper links each page to its HTML URL, and a static export
 * cannot content-negotiate: an agent following a link must land on the
 * Markdown twin (`/llms.mdx/<page path>/content.md`), so the twin is what
 * the index links.
 */
export function llmsIndex(): string {
  const tree = source.getPageTree();
  const out: string[] = [
    `# ${nameOf(tree.name)}`,
    "",
    SDK_DOCS_VERSION_LINE,
    SDK_DOCS_REVISION_LINE,
    "",
  ];
  for (const child of tree.children) {
    out.push(...formatNode(child, 0));
  }
  return out.join("\n");
}

function nameOf(name: PageTree.Node["name"]): string {
  return typeof name === "string" ? name : "Docs";
}

function item(name: string, description: string | undefined, indent: number): string {
  const prefix = "  ".repeat(indent);
  return description === undefined || description.trim() === ""
    ? `${prefix}- ${name}`
    : `${prefix}- ${name}: ${description.trim()}`;
}

function pageItem(node: PageTree.Item, indent: number): string[] {
  const page = source.getNodePage(node);
  if (page == null) {
    return [];
  }
  const url = `/llms.mdx/${pageMarkdownSegments(page).join("/")}`;
  return [item(`[${page.data.title}](${url})`, page.data.description, indent)];
}

function formatNode(node: PageTree.Node, indent: number): string[] {
  switch (node.type) {
    case "page":
      return pageItem(node, indent);
    case "folder": {
      const out = [item(nameOf(node.name), undefined, indent)];
      if (node.index !== undefined) {
        out.push(...pageItem(node.index, indent + 1));
      }
      for (const child of node.children) {
        out.push(...formatNode(child, indent + 1));
      }
      return out;
    }
    case "separator":
      return [];
  }
}

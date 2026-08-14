/**
 * Reading the authored page: sections, conventions, and stories.
 *
 * The MDX file is the source of every authored sentence on the page. This
 * module parses it once, with MDX's own processor rather than a regex, and
 * hands back three things: the section structure (for navigation and anchors),
 * the plain text of each authored block (so search can index prose the viewer
 * renders from the MDX itself), and the fenced stories.
 *
 * Parsing with the real processor matters more than it looks. A regex over
 * fences would find code inside prose, inside comments, and inside the one
 * paragraph that talks about fences — and would silently miss a story nested
 * inside a JSX block. The AST knows the difference.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessor } from "@mdx-js/mdx";

import { slugify } from "../app/remark-plugins.ts";
import type { ReferencePage } from "./pages.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Where a page's MDX lives on disk. */
export function pageFileOf(page: ReferencePage): string {
  return path.join(ROOT, page.mdxPath);
}

/** One `##` section of the MDX, in reading order. */
export interface ParsedSection {
  readonly id: string;
  readonly title: string;
  /** Plain text of everything the section authored, for the search index. */
  readonly text: string;
  /** Ids referenced inside, so assembly can check every one resolves. */
  readonly claims: readonly string[];
  readonly conventions: readonly string[];
  readonly stories: readonly string[];
  /**
   * Which derived components the section renders, by name.
   *
   * Recorded because two of them carry no id and something still has to know
   * where they are: search sends a field hit to whichever section holds the
   * field table, and it used to find that section by looking for one
   * particular Situation claim id. That worked until there was a second page.
   */
  readonly components: readonly string[];
}

/** One fenced `ts` block tagged as a story. */
export interface ParsedStory {
  readonly id: string;
  readonly title: string;
  readonly code: string;
  /** 1-based line in the MDX where the fence opens, for error messages. */
  readonly line: number;
}

/** One `<Convention id>` block's authored prose. */
export interface ParsedConvention {
  readonly id: string;
  readonly text: string;
}

export interface ParsedPage {
  readonly frontmatter: Readonly<Record<string, string>>;
  readonly sections: readonly ParsedSection[];
  readonly conventions: readonly ParsedConvention[];
  readonly stories: readonly ParsedStory[];
}

interface Node {
  readonly type: string;
  readonly name?: string | null;
  readonly value?: string;
  readonly depth?: number;
  readonly lang?: string | null;
  readonly meta?: string | null;
  readonly attributes?: readonly {
    readonly type: string;
    readonly name?: string;
    readonly value?: unknown;
  }[];
  readonly children?: readonly Node[];
  readonly position?: { readonly start?: { readonly line?: number } };
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of node.children ?? []) {
    walk(child, visit);
  }
}

/** Every literal string under a node, which is all the search index needs. */
function textOf(node: Node): string {
  const parts: string[] = [];
  walk(node, (current) => {
    if (current.type === "text" || current.type === "inlineCode") {
      parts.push(current.value ?? "");
    }
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function attribute(node: Node, name: string): string | null {
  for (const entry of node.attributes ?? []) {
    if (
      entry.type === "mdxJsxAttribute" &&
      entry.name === name &&
      typeof entry.value === "string"
    ) {
      return entry.value;
    }
  }
  return null;
}

/** `story="minimal" title="Name and a rate"` off a fence's meta string. */
function fenceMeta(meta: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of meta.matchAll(/(\w+)="([^"]*)"/g)) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

/**
 * A deliberately small frontmatter reader: flat `key: value` pairs only.
 *
 * The page needs an id, a title and a summary. Reaching for a YAML dependency
 * to read three strings would be mechanism the spike does not need, and the
 * moment the frontmatter wants structure it should become a typed module
 * instead — which is exactly what happened to the convention dependencies.
 */
function frontmatterOf(source: string): { frontmatter: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (match === null) {
    return { frontmatter: {}, body: source };
  }
  const frontmatter: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return { frontmatter, body: source.slice(match[0].length) };
}

export function parsePage(page: ReferencePage): ParsedPage {
  const file = pageFileOf(page);
  const source = readFileSync(file, "utf8");
  const { frontmatter, body } = frontmatterOf(source);
  // The frontmatter is stripped before parsing, so every reported line is
  // offset by the lines it occupied.
  const offset = source.slice(0, source.length - body.length).split("\n").length - 1;
  const tree = createProcessor({ jsx: true }).parse(body) as unknown as Node;

  const sections: ParsedSection[] = [];
  const conventions: ParsedConvention[] = [];
  const stories: ParsedStory[] = [];

  const collectStories = (node: Node): ParsedStory[] => {
    const found: ParsedStory[] = [];
    walk(node, (current) => {
      if (current.type !== "code" || current.lang !== "ts" || !current.meta) {
        return;
      }
      const meta = fenceMeta(current.meta);
      const id = meta["story"];
      if (id === undefined) {
        return;
      }
      found.push({
        id,
        title: meta["title"] ?? id,
        code: `${(current.value ?? "").trimEnd()}\n`,
        line: (current.position?.start?.line ?? 0) + offset,
      });
    });
    return found;
  };

  const referenced = (node: Node, name: string): string[] => {
    const ids: string[] = [];
    walk(node, (current) => {
      if (current.type === "mdxJsxFlowElement" && current.name === name) {
        const id = attribute(current, "id");
        if (id !== null) {
          ids.push(id);
        }
      }
    });
    return ids;
  };

  const componentsIn = (node: Node): string[] => {
    const names = new Set<string>();
    walk(node, (current) => {
      if (current.type === "mdxJsxFlowElement" && typeof current.name === "string") {
        names.add(current.name);
      }
    });
    return [...names].sort();
  };

  // Sections are `##` headings, and everything after one belongs to it until
  // the next. Grouping by position is right here in a way it would not be for
  // emitted content: this is a document, and in a document the heading above a
  // paragraph is what the paragraph is under.
  interface Open {
    id: string;
    title: string;
    nodes: Node[];
  }
  let open: Open | null = null;
  const close = (): void => {
    if (open === null) {
      return;
    }
    const body: Node = { type: "root", children: open.nodes };
    const sectionStories = collectStories(body);
    stories.push(...sectionStories);
    walk(body, (current) => {
      if (current.type === "mdxJsxFlowElement" && current.name === "Convention") {
        const conventionId = attribute(current, "id");
        if (conventionId !== null) {
          conventions.push({ id: conventionId, text: textOf(current) });
        }
      }
    });
    sections.push({
      id: open.id,
      title: open.title,
      text: textOf(body),
      claims: referenced(body, "Claim"),
      conventions: referenced(body, "Convention"),
      // A fence declares its own panel through the remark plugin; a story the
      // page did not write as a fence — a Recipe's own output — is placed with
      // an explicit `<StoryPanel id>`. Both are the section's stories.
      stories: [...sectionStories.map((story) => story.id), ...referenced(body, "StoryPanel")],
      components: componentsIn(body),
    });
    open = null;
  };

  for (const child of tree.children ?? []) {
    if (child.type === "heading" && child.depth === 2) {
      close();
      const title = textOf(child);
      open = { id: slugify(title), title, nodes: [] };
      continue;
    }
    if (open !== null) {
      (open as Open).nodes.push(child);
    }
  }
  close();

  const duplicate = stories.find(
    (story, index) => stories.findIndex((other) => other.id === story.id) !== index
  );
  if (duplicate !== undefined) {
    throw new Error(
      `${page.mdxPath}:${duplicate.line}: two stories share the id "${duplicate.id}" — ids name the ` +
        "generated module and the panel on the page, so they have to be unique"
    );
  }

  return { frontmatter, sections, conventions, stories };
}

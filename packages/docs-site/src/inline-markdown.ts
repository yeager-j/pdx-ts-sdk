import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
}

/**
 * Raw HTML in the generated docs prose renders as text, not markup: the
 * ledger's strings describe game syntax like `<id>`, and an angle-bracket
 * placeholder must survive to the page instead of vanishing as an unknown
 * tag. The post-build HTML check pins this behavior.
 */
function renderHtmlAsText() {
  return (tree: MarkdownNode): void => {
    const visit = (node: MarkdownNode): void => {
      if (node.type === "html") {
        node.type = "text";
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(renderHtmlAsText)
  .use(remarkRehype)
  .use(rehypeStringify);

export async function renderInlineMarkdown(source: string): Promise<string> {
  const code = String(await processor.process(source));
  const paragraph = code.match(/^<p>([\s\S]*)<\/p>\n?$/)?.[1];

  if (paragraph === undefined || /<\/?p>/.test(paragraph)) {
    throw new Error(`Expected inline Markdown, received: ${JSON.stringify(source)}`);
  }

  return paragraph;
}

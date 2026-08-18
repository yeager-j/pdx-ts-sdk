import { createMarkdownProcessor, type Node, type RemarkPlugin } from "@astrojs/markdown-remark";

const renderHtmlAsText: RemarkPlugin = () => (tree) => {
  const visit = (node: Node): void => {
    if (node.type === "html") {
      node.type = "text";
    }

    if ("children" in node && Array.isArray(node.children)) {
      node.children.forEach(visit);
    }
  };

  visit(tree);
};

const processor = await createMarkdownProcessor({
  remarkPlugins: [renderHtmlAsText],
  syntaxHighlight: false,
});

export async function renderInlineMarkdown(source: string): Promise<string> {
  const { code } = await processor.render(source);
  const paragraph = code.match(/^<p>([\s\S]*)<\/p>\n?$/);

  if (!paragraph || /<\/?p>/.test(paragraph[1])) {
    throw new Error(`Expected inline Markdown, received: ${JSON.stringify(source)}`);
  }

  return paragraph[1];
}

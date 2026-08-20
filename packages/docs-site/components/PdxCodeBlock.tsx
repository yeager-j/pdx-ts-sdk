import { CodeBlock, Pre, type CodeBlockProps } from "fumadocs-ui/components/codeblock";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import { HIGHLIGHT_THEMES, pdxHighlighter } from "@/src/highlight-options";

/**
 * A code block from a string computed at render time, highlighted with the
 * site's own Shiki instance (which knows the pdx grammars) and rendered in
 * fumadocs' styled `CodeBlock` shell — the same shell fenced code gets, so
 * the two kinds of block look identical.
 */
export async function PdxCodeBlock({
  code,
  lang,
  codeblock,
}: {
  code: string;
  lang: string;
  codeblock?: CodeBlockProps;
}) {
  const highlighter = await pdxHighlighter();
  const hast = highlighter.codeToHast(code, {
    lang,
    themes: HIGHLIGHT_THEMES,
    defaultColor: false,
  });

  return toJsxRuntime(hast, {
    Fragment,
    jsx,
    jsxs,
    development: false,
    components: {
      pre: (props) => (
        <CodeBlock {...props} {...codeblock} className="my-0">
          <Pre>{props.children}</Pre>
        </CodeBlock>
      ),
    },
  });
}

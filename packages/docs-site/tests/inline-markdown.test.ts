import { describe, expect, it } from "vitest";

import { renderInlineMarkdown } from "../src/inline-markdown.ts";

describe("renderInlineMarkdown", () => {
  it("renders inline code and emphasis", async () => {
    await expect(renderInlineMarkdown("Use `planet` where it is *written*.")).resolves.toBe(
      "Use <code>planet</code> where it is <em>written</em>."
    );
  });

  it("renders HTML-looking placeholders as text", async () => {
    const html = await renderInlineMarkdown("not a static <id>-keyed slot");

    expect(html).toContain("&#x3C;id>");
    expect(html).not.toContain("<id>");
  });

  it("rejects block Markdown", async () => {
    await expect(renderInlineMarkdown("first\n\nsecond")).rejects.toThrow(
      /Expected inline Markdown/
    );
  });
});

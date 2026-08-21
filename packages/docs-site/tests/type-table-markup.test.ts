import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TypeTable, type TypeNode } from "../src/components/type-table.tsx";

function render(item: TypeNode): string {
  return renderToStaticMarkup(
    createElement(TypeTable, {
      id: "fields-building",
      type: { conditionalDesc: item },
    })
  );
}

describe("TypeTable detail markup", () => {
  it("repeats the compact type in the detail panel", () => {
    const html = render({
      type: createElement("code", null, "number | WeightBlock"),
    });

    expect(html).toContain(
      '<p class="text-fd-muted-foreground not-prose pe-2">Type</p><p class="my-auto min-w-0 not-prose [overflow-wrap:anywhere]"><code>number | WeightBlock</code></p>'
    );
  });

  it("keeps nested type links available in the detail panel", () => {
    const html = render({
      type: createElement("code", null, "BuildingDesc[]"),
      typeDescriptionLink: "#fields-building-description",
    });

    expect(html).toContain(
      '<a href="#fields-building-description" class="underline"><code>BuildingDesc[]</code></a>'
    );
  });
});

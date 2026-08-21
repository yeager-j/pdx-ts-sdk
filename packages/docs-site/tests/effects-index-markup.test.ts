import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EffectsIndexTable, type EffectsIndexRow } from "../components/EffectsIndexTable.tsx";

const addResource: EffectsIndexRow = {
  method: "addResource",
  anchor: "effects-addResource",
  key: "add_resource",
  category: "structural",
  signature: "(value: AddResource): void",
  signatureSummary: "(value) => void",
  summary: "Adds or removes a resource.",
  summaryHtml: "Adds or removes a resource.",
  availability: { kind: "universal" },
};

function render(rows: readonly EffectsIndexRow[]): string {
  return renderToStaticMarkup(
    createElement(EffectsIndexTable, {
      rows,
      scopeOptions: ["country", "planet"],
      scopePages: [
        {
          scope: "country",
          href: "/scopes-and-effects/scopes/country/",
          title: "Country",
        },
        {
          scope: "planet",
          href: "/scopes-and-effects/scopes/planet/",
          title: "Planet",
        },
      ],
    })
  );
}

describe("EffectsIndexTable markup", () => {
  it("renders named enhancement controls and an ordinary empty state", () => {
    const html = render([]);
    expect(html).toContain('for="effects-filter-text"');
    expect(html).toContain('for="effects-filter-scope"');
    expect(html).toContain('for="effects-filter-category"');
    expect(html).toContain("No methods match the selected filters.");
  });

  it("server-renders native expandable rows with a stable anchor and full panel", () => {
    const html = render([addResource]);
    expect(html).toContain('id="effects-addResource"');
    expect(html).toContain("<summary");
    expect(html).toContain('id="effects-addResource-details"');
    expect(html).toContain("(value: AddResource): void");
    expect(html).toContain("Universal methods are available on every generated scope interface");
  });
});

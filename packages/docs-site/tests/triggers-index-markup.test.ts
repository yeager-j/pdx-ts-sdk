import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TriggersIndexTable, type TriggersIndexRow } from "../components/TriggersIndexTable.tsx";

const hasCountryFlag: TriggersIndexRow = {
  method: "hasCountryFlag",
  anchor: "triggers-hasCountryFlag",
  key: "has_country_flag",
  signature: 'hasCountryFlag(value: CountryFlag): Trigger<"country">',
  signatureSummary: '(value) => Trigger<"country">',
  summary: "Checks whether the country has the flag.",
  summaryHtml: "Checks whether the country has the flag.",
  availability: {
    kind: "scopes",
    scopes: [{ scope: "country" }],
  },
};

function render(rows: readonly TriggersIndexRow[]): string {
  return renderToStaticMarkup(
    createElement(TriggersIndexTable, {
      rows,
      scopeOptions: ["country", "planet"],
      scopePages: [
        {
          scope: "country",
          href: "/scopes-and-effects/scopes/country/",
          title: "Country",
        },
      ],
    })
  );
}

describe("TriggersIndexTable markup", () => {
  it("renders trigger controls without an effect category filter", () => {
    const html = render([]);
    expect(html).toContain('for="triggers-filter-text"');
    expect(html).toContain('for="triggers-filter-scope"');
    expect(html).not.toContain("triggers-filter-category");
    expect(html).toContain("No builders match the selected filters.");
  });

  it("server-renders a stable trigger anchor and full contract", () => {
    const html = render([hasCountryFlag]);
    expect(html).toContain('id="triggers-hasCountryFlag"');
    expect(html).toContain('id="triggers-hasCountryFlag-details"');
    expect(html).toContain("has_country_flag");
    expect(html).toContain("CountryFlag");
  });
});

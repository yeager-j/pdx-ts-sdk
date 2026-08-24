import {
  EVENT_KINDS,
  SCRIPT_EFFECT_REFERENCES,
  SCRIPT_REFERENCE_SCOPES,
  SCRIPT_SCOPE_LINK_REFERENCES,
  SCRIPT_TRIGGER_REFERENCES,
} from "@pdx-ts/sdk/reference";
import { describe, expect, it } from "vitest";

import { renderInlineMarkdown } from "../src/inline-markdown.ts";
import type { ScopePageLink } from "../src/reference-index.ts";
import type { ScopeReferenceSources } from "../src/scope-reference.ts";
import { buildTriggersIndex, type TriggersIndexEntry } from "../src/triggers-index.ts";

const pages: readonly ScopePageLink[] = [
  { scope: "country", href: "/scopes-and-effects/scopes/country/", title: "Country scope" },
  { scope: "planet", href: "/scopes-and-effects/scopes/planet/", title: "Planet scope" },
  { scope: "sector", href: "/scopes-and-effects/scopes/sector/", title: "Sector scope" },
];

const sources = (): ScopeReferenceSources => ({
  scopes: SCRIPT_REFERENCE_SCOPES,
  effects: SCRIPT_EFFECT_REFERENCES,
  triggers: SCRIPT_TRIGGER_REFERENCES,
  scopeLinks: SCRIPT_SCOPE_LINK_REFERENCES,
  eventKinds: EVENT_KINDS,
});
const index = () => buildTriggersIndex(pages);
const entryFor = (method: string): TriggersIndexEntry => {
  const entry = index().entries.find((candidate) => candidate.method === method);
  if (entry === undefined) throw new Error(`no trigger entry for "${method}"`);
  return entry;
};
const scopesOf = (entry: TriggersIndexEntry): readonly string[] =>
  entry.availability.kind === "universal"
    ? index().scopePages.map((target) => target.scope)
    : entry.availability.scopes.map((target) => target.scope);

describe("buildTriggersIndex", () => {
  it("carries every generated builder exactly once in canonical order", () => {
    const { entries } = index();
    expect(entries).toHaveLength(SCRIPT_TRIGGER_REFERENCES.length);
    expect(new Set(entries.map((entry) => entry.method)).size).toBe(entries.length);
    expect(entries.map((entry) => entry.method)).toEqual(
      [...entries.map((entry) => entry.method)].sort((left, right) => left.localeCompare(right))
    );
    for (const entry of entries) {
      expect(entry.anchor).toBe(`triggers-${entry.method}`);
    }
  });

  it("shows the accepted representative contracts and legal scopes", () => {
    expect(entryFor("hasCountryFlag")).toEqual(
      expect.objectContaining({
        key: "has_country_flag",
        signature: 'hasCountryFlag(value: CountryFlag): Trigger<"country">',
      })
    );
    expect(scopesOf(entryFor("hasCountryFlag"))).toEqual(["country"]);
    expect(entryFor("isAi").signature).toBe('isAi(value: boolean = true): Trigger<"country">');
    expect(scopesOf(entryFor("isAi"))).toEqual(["country"]);
    expect(entryFor("numOwnedPlanets").signature).toBe(
      'numOwnedPlanets(op: PdxOp, value: ScriptValue): Trigger<"country" | "sector">'
    );
    expect(scopesOf(entryFor("numOwnedPlanets"))).toEqual(["country", "sector"]);
  });

  it("keeps wrapper evaluation scope separate from availability", () => {
    const wrapper = entryFor("anyActiveFirstContact");
    expect(wrapper.signature).toBe(
      'anyActiveFirstContact(condition: Trigger<"first_contact">): Trigger<"country">'
    );
    expect(scopesOf(wrapper)).toEqual(["country"]);
  });

  it("links published scope pages and preserves universal availability", () => {
    const country = entryFor("hasCountryFlag");
    expect(country.availability).toEqual({
      kind: "scopes",
      scopes: [
        {
          scope: "country",
          href: "/scopes-and-effects/scopes/country/",
          title: "Country scope",
        },
      ],
    });
    expect(entryFor("always").availability.kind).toBe("universal");
    expect(index().scopePages.map((target) => target.scope)).toEqual([
      "country",
      "planet",
      "sector",
    ]);
  });

  it("rejects duplicate builders", () => {
    const input = sources();
    const [first] = input.triggers;
    if (first === undefined) throw new Error("fixture has no triggers");
    expect(() =>
      buildTriggersIndex(pages, { ...input, triggers: [...input.triggers, first] })
    ).toThrow(/Duplicate generated trigger builder/);
  });

  it("renders every generated description as inline Markdown", async () => {
    const failures: string[] = [];
    await Promise.all(
      index().entries.map(async (entry) => {
        try {
          await renderInlineMarkdown(entry.summary);
        } catch (error) {
          failures.push(`${entry.method}: ${String(error)}`);
        }
      })
    );
    expect(failures).toEqual([]);
  });
});

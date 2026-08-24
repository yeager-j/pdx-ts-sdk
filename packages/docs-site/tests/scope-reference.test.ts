import {
  EVENT_KINDS,
  SCRIPT_EFFECT_REFERENCES,
  SCRIPT_REFERENCE_SCOPES,
  SCRIPT_SCOPE_LINK_REFERENCES,
} from "@pdx-ts/sdk/reference";
import { describe, expect, it } from "vitest";

import { scopeEffectsMarkdown } from "../src/llm-markdown.ts";
import { validateScopePages, type ScopePageClaim } from "../src/scope-page-coverage.ts";
import { parseScopePageSource } from "../src/scope-page-source.ts";
import { buildScopeReference, type ScopeReferenceSources } from "../src/scope-reference.ts";

const sources = (): ScopeReferenceSources => ({
  scopes: SCRIPT_REFERENCE_SCOPES,
  effects: SCRIPT_EFFECT_REFERENCES,
  scopeLinks: SCRIPT_SCOPE_LINK_REFERENCES,
  eventKinds: EVENT_KINDS,
});

const methodsOf = (rows: readonly { readonly method: string }[]): readonly string[] =>
  rows.map((row) => row.method);

const page = (routeScope: string, declaredScope: string | null = routeScope): ScopePageClaim => ({
  id: `scopes-and-effects/scopes/${routeScope}`,
  href: `/scopes-and-effects/scopes/${routeScope}/`,
  title: `${routeScope} scope`,
  routeScope,
  ...(declaredScope === null ? {} : { declaredScope }),
});

describe("buildScopeReference", () => {
  it("joins scope identity and every event kind whose body runs in the scope", () => {
    const country = buildScopeReference("country");
    expect(country.interfaceName).toBe("CountryScope");
    expect(country.eventKinds.map((kind) => kind.key)).toEqual(["country_event", "observer_event"]);

    const planet = buildScopeReference("planet");
    expect(planet.interfaceName).toBe("PlanetScope");
    expect(planet.eventKinds.map((kind) => kind.key)).toEqual(["planet_event"]);

    const army = buildScopeReference("army");
    expect(army.interfaceName).toBe("ArmyScope");
    expect(army.eventKinds).toEqual([]);

    const storm = buildScopeReference("storm");
    expect(storm.eventKinds.map((kind) => kind.key)).toEqual(["cosmic_storm_event"]);
  });

  it("builds a complete reference model for every generated scope", () => {
    for (const scope of SCRIPT_REFERENCE_SCOPES) {
      const model = buildScopeReference(scope);
      expect(model.scope).toBe(scope);
      expect(model.interfaceName).toMatch(/Scope$/);
      expect(model.universalEffects.length).toBeGreaterThan(0);
      expect(model.structuralMethods.length).toBeGreaterThan(0);
    }
    expect(buildScopeReference("alliance").scopeEffects).toEqual([]);
  });

  it("keeps universal, scope-specific, structural, and event-fire methods separate", () => {
    const country = buildScopeReference("country");
    const planet = buildScopeReference("planet");
    const army = buildScopeReference("army");

    for (const model of [country, planet, army]) {
      expect(methodsOf(model.universalEffects)).toContain("activateGateway");
      expect(methodsOf(model.structuralMethods)).toContain("if");
    }

    expect(methodsOf(planet.scopeEffects)).toContain("setPlanetName");
    expect(methodsOf(country.scopeEffects)).not.toContain("setPlanetName");
    expect(methodsOf(army.scopeEffects)).not.toContain("setPlanetName");
    expect(methodsOf(country.eventFireMethods)).toEqual(
      expect.arrayContaining(["countryEvent", "observerEvent"])
    );
    expect(methodsOf(country.eventFireMethods)).not.toContain("planetEvent");
    expect(methodsOf(planet.eventFireMethods)).toContain("planetEvent");
  });

  it("keeps scope links in transitions and out of method tables", () => {
    const army = buildScopeReference("army");
    expect(army.transitions.some((row) => row.member === "colony")).toBe(true);
    const allMethods = [
      ...army.universalEffects,
      ...army.scopeEffects,
      ...army.structuralMethods,
      ...army.eventFireMethods,
    ];
    expect(methodsOf(allMethods)).not.toContain("colony");
  });

  it("links to the universal effect inventory instead of repeating it", () => {
    const alliance = buildScopeReference("alliance");
    const markdown = scopeEffectsMarkdown(alliance);
    expect(markdown).toContain(
      `[${alliance.universalEffects.length} universal effects](/scopes-and-effects/effects/)`
    );
    expect(markdown).not.toContain("activateGateway");
  });

  it("rejects an unknown scope with an actionable error", () => {
    expect(() => buildScopeReference("no_such_scope")).toThrow(
      /No generated scope row.*SCRIPT_REFERENCE_SCOPES/
    );
  });

  it("rejects a missing generated scope row", () => {
    const input = sources();
    expect(() =>
      buildScopeReference("country", {
        ...input,
        scopes: input.scopes.filter((scope) => scope !== "country"),
      })
    ).toThrow(/No generated scope row for "country"/);
  });

  it("rejects duplicate generated methods", () => {
    const input = sources();
    const [firstEffect] = input.effects;
    if (firstEffect === undefined) throw new Error("fixture has no effects");
    expect(() =>
      buildScopeReference("country", {
        ...input,
        effects: [...input.effects, firstEffect],
      })
    ).toThrow(/Duplicate generated script method/);
  });

  it("rejects a scope link misclassified as a method", () => {
    const input = sources();
    const [firstEffect] = input.effects;
    const [link] = input.scopeLinks;
    if (firstEffect === undefined || link === undefined) {
      throw new Error("fixture has no effects or scope links");
    }
    expect(() =>
      buildScopeReference("country", {
        ...input,
        effects: [...input.effects, { ...firstEffect, method: link.member }],
      })
    ).toThrow(/Scope link.*also classified as a script method/);
  });
});

describe("scope page coverage", () => {
  it("accepts exactly one page for every generated scope", () => {
    const pages = SCRIPT_REFERENCE_SCOPES.map((scope) => page(scope));
    expect(validateScopePages(SCRIPT_REFERENCE_SCOPES, pages).map((entry) => entry.scope)).toEqual(
      SCRIPT_REFERENCE_SCOPES
    );
  });

  it("reports every missing scope by name", () => {
    expect(() => validateScopePages(["country", "planet"], [page("country")])).toThrow(
      'Missing scope pages: "planet".'
    );
  });

  it("reports every duplicate declared scope by name", () => {
    expect(() =>
      validateScopePages(
        ["country", "planet"],
        [page("country"), page("planet"), page("country-copy", "country")]
      )
    ).toThrow('Duplicate scope pages: "country".');
  });

  it("reports every unknown declared scope by name", () => {
    expect(() => validateScopePages(["country"], [page("country", "empire")])).toThrow(
      'Unknown page scopes: "empire".'
    );
  });

  it("reports pages orphaned by removal from the generated inventory", () => {
    expect(() => validateScopePages(["planet"], [page("planet"), page("country")])).toThrow(
      'Orphaned scope pages: "country".'
    );
  });

  it("reports route and frontmatter mismatches", () => {
    expect(() =>
      validateScopePages(
        ["country", "planet"],
        [page("country", "planet"), page("planet", "country")]
      )
    ).toThrow('Scope page route/frontmatter mismatches: "country -> planet", "planet -> country".');
  });

  it("requires scope frontmatter on every scope page", () => {
    expect(() => validateScopePages(["country"], [page("country", null)])).toThrow(
      'Scope pages missing "scope" frontmatter: "scopes-and-effects/scopes/country".'
    );
  });
});

describe("scope page prose", () => {
  const prose = `# Country

Country scope represents a country.

## Common entry points

Common entry points include country event bodies.`;

  it("parses only the page-owned title and prose", () => {
    expect(parseScopePageSource("country", prose)).toEqual({
      scope: "country",
      title: "Country",
      prose: prose.slice(prose.indexOf("\n") + 1).trim(),
    });
  });

  it("rejects a page-authored generated inventory section", () => {
    expect(() =>
      parseScopePageSource("country", `${prose}\n\n## Ordinary effects\n\n- addResource`)
    ).toThrow(/may not add headings/);
  });

  it("rejects page-authored reference components or data", () => {
    expect(() => parseScopePageSource("country", `${prose}\n\n<EventKinds rows={[]} />`)).toThrow(
      /may not declare MDX components or data/
    );
  });
});

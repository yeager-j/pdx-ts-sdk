import { EVENT_KINDS } from "@pdx-ts/sdk";
import {
  SCRIPT_EFFECT_REFERENCES,
  SCRIPT_REFERENCE_SCOPES,
  SCRIPT_SCOPE_LINK_REFERENCES,
} from "@pdx-ts/sdk/script-reference";
import { describe, expect, it } from "vitest";

import {
  buildEffectsIndex,
  type EffectsIndexEntry,
  type ScopePageLink,
} from "../src/effects-index.ts";
import { renderInlineMarkdown } from "../src/inline-markdown.ts";
import type { ScopeReferenceSources } from "../src/scope-reference.ts";

const sources = (): ScopeReferenceSources => ({
  scopes: SCRIPT_REFERENCE_SCOPES,
  effects: SCRIPT_EFFECT_REFERENCES,
  scopeLinks: SCRIPT_SCOPE_LINK_REFERENCES,
  eventKinds: EVENT_KINDS,
});

/** The pages the site publishes today, as `lib/scope-pages.ts` supplies them. */
const pages: readonly ScopePageLink[] = [
  { scope: "army", href: "/scopes-and-effects/army/", title: "Army scope" },
  { scope: "country", href: "/scopes-and-effects/country/", title: "Country scope" },
  { scope: "planet", href: "/scopes-and-effects/planet/", title: "Planet scope" },
];

const index = () => buildEffectsIndex(pages);

const entryFor = (method: string): EffectsIndexEntry => {
  const entry = index().entries.find((candidate) => candidate.method === method);
  if (entry === undefined) throw new Error(`no index entry for "${method}"`);
  return entry;
};

const scopeNamesOf = (entry: EffectsIndexEntry): readonly string[] =>
  entry.availability.kind === "universal"
    ? entry.availability.publishedScopePages.map((target) => target.scope)
    : entry.availability.scopes.map((target) => target.scope);

describe("buildEffectsIndex", () => {
  it("carries every generated method exactly once, sorted, with a stable anchor", () => {
    const { entries, counts } = index();
    expect(entries.length).toBe(SCRIPT_EFFECT_REFERENCES.length);
    expect(new Set(entries.map((entry) => entry.method)).size).toBe(entries.length);
    expect(entries.map((entry) => entry.method)).toEqual(
      [...entries.map((entry) => entry.method)].sort((left, right) => left.localeCompare(right))
    );
    for (const entry of entries) {
      expect(entry.anchor).toBe(`effects-${entry.method}`);
    }
    expect(counts.effect + counts.structural + counts.eventFire).toBe(entries.length);
  });

  it("keeps scope links out of the index", () => {
    const methods = new Set(index().entries.map((entry) => entry.method));
    for (const link of SCRIPT_SCOPE_LINK_REFERENCES) {
      expect(methods.has(link.member)).toBe(false);
    }
    expect(methods.has("colony")).toBe(false);
  });

  it("classifies representative methods by category and availability", () => {
    expect(entryFor("activateGateway").category).toBe("effect");
    expect(entryFor("activateGateway").availability.kind).toBe("universal");

    expect(entryFor("setPlanetName").category).toBe("effect");
    expect(entryFor("setPlanetName").availability.kind).toBe("scopes");

    expect(entryFor("if").category).toBe("structural");
    expect(entryFor("if").availability.kind).toBe("universal");

    expect(entryFor("addEventChainCounter").category).toBe("structural");
    expect(scopeNamesOf(entryFor("addEventChainCounter"))).toEqual(["country"]);

    expect(entryFor("countryEvent").category).toBe("event-fire");
    expect(entryFor("observerEvent").category).toBe("event-fire");
  });

  it("links a universal method to every published scope page", () => {
    const addResource = entryFor("addResource");
    expect(addResource.anchor).toBe("effects-addResource");
    expect(addResource.key).toBe("add_resource");
    if (addResource.availability.kind !== "universal") {
      throw new Error("addResource should be universal");
    }
    expect(addResource.availability.publishedScopePages).toEqual([
      { scope: "army", href: "/scopes-and-effects/army/", title: "Army scope" },
      { scope: "country", href: "/scopes-and-effects/country/", title: "Country scope" },
      { scope: "planet", href: "/scopes-and-effects/planet/", title: "Planet scope" },
    ]);
  });

  it("lists exactly the legal scopes of a scoped method, linked where published", () => {
    const setPlanetName = entryFor("setPlanetName");
    if (setPlanetName.availability.kind !== "scopes") {
      throw new Error("setPlanetName should be scope-limited");
    }
    expect(setPlanetName.availability.scopes).toEqual([
      { scope: "planet", href: "/scopes-and-effects/planet/", title: "Planet scope" },
    ]);
  });

  it("leaves an unpublished scope unlinked", () => {
    const targets = index().entries.flatMap((entry) =>
      entry.availability.kind === "scopes" ? entry.availability.scopes : []
    );
    expect(targets.find((target) => target.scope === "federation")).toEqual({
      scope: "federation",
    });
    expect(targets.find((target) => target.scope === "country")).toEqual({
      scope: "country",
      href: "/scopes-and-effects/country/",
      title: "Country scope",
    });
  });

  it("states where an event body runs, separately from where the fire call is legal", () => {
    const countryEvent = entryFor("countryEvent");
    expect(countryEvent.eventBodyScope?.scope).toBe("country");
    expect(scopeNamesOf(countryEvent)).toEqual(["country"]);

    const observerEvent = entryFor("observerEvent");
    expect(observerEvent.availability.kind).toBe("universal");
    expect(observerEvent.eventBodyScope?.scope).toBe("country");
    expect(observerEvent.eventBodyScope?.href).toBe("/scopes-and-effects/country/");
  });

  it("gives a non-fire entry no event body scope", () => {
    expect(entryFor("activateGateway").eventBodyScope).toBeUndefined();
    expect(entryFor("if").eventBodyScope).toBeUndefined();
  });

  it("marks a method with no fixed PDXScript key", () => {
    expect(entryFor("run").key).toBeUndefined();
    expect(entryFor("run").category).toBe("structural");
  });

  it("rejects duplicate generated methods", () => {
    const input = sources();
    const [firstEffect] = input.effects;
    if (firstEffect === undefined) throw new Error("fixture has no effects");
    expect(() =>
      buildEffectsIndex(pages, { ...input, effects: [...input.effects, firstEffect] })
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
      buildEffectsIndex(pages, {
        ...input,
        effects: [...input.effects, { ...firstEffect, method: link.member }],
      })
    ).toThrow(/Scope link.*also classified as a script method/);
  });

  it("rejects a scope page naming an unknown scope", () => {
    expect(() =>
      buildEffectsIndex([
        ...pages,
        { scope: "no_such_scope", href: "/scopes-and-effects/no-such-scope/", title: "Nope" },
      ])
    ).toThrow(/names missing generated scope "no_such_scope"/);
  });

  it("rejects a fire method whose event kind is missing", () => {
    const input = sources();
    const { country_event: _removed, ...eventKinds } = input.eventKinds;
    expect(() => buildEffectsIndex(pages, { ...input, eventKinds })).toThrow(
      /names missing event kind "country_event"/
    );
  });

  it("rejects a fire method whose event kind is scopeless", () => {
    const input = sources();
    const countryEvent = input.eventKinds["country_event"];
    if (countryEvent === undefined) throw new Error("fixture has no country_event kind");
    expect(() =>
      buildEffectsIndex(pages, {
        ...input,
        eventKinds: { ...input.eventKinds, country_event: { ...countryEvent, scope: null } },
      })
    ).toThrow(/is scopeless/);
  });

  it("renders every entry summary as inline Markdown", async () => {
    const { entries } = index();
    const failures: string[] = [];
    await Promise.all(
      entries.map(async (entry) => {
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

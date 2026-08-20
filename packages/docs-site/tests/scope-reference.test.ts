import { EVENT_KINDS } from "@pdx-ts/sdk";
import {
  SCRIPT_EFFECT_REFERENCES,
  SCRIPT_REFERENCE_SCOPES,
  SCRIPT_SCOPE_LINK_REFERENCES,
} from "@pdx-ts/sdk/script-reference";
import { describe, expect, it } from "vitest";

import { buildScopeReference, type ScopeReferenceSources } from "../src/scope-reference.ts";

const sources = (): ScopeReferenceSources => ({
  scopes: SCRIPT_REFERENCE_SCOPES,
  effects: SCRIPT_EFFECT_REFERENCES,
  scopeLinks: SCRIPT_SCOPE_LINK_REFERENCES,
  eventKinds: EVENT_KINDS,
});

const methodsOf = (rows: readonly { readonly method: string }[]): readonly string[] =>
  rows.map((row) => row.method);

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

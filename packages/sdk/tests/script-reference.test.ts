import { readFileSync } from "node:fs";
import {
  SCRIPT_EFFECT_REFERENCES,
  SCRIPT_REFERENCE_SCOPES,
  SCRIPT_SCOPE_LINK_REFERENCES,
} from "@pdx-ts/sdk/script-reference";
import { describe, expect, it } from "vitest";

import { STRUCTURAL_EFFECT_METHODS } from "../src/generated/effect-policy.ts";

describe("script reference metadata", () => {
  it("publishes the canonical scope inventory", () => {
    expect(SCRIPT_REFERENCE_SCOPES).toHaveLength(42);
    expect(SCRIPT_REFERENCE_SCOPES).toContain("country");
    expect(new Set(SCRIPT_REFERENCE_SCOPES).size).toBe(SCRIPT_REFERENCE_SCOPES.length);
  });

  it("keeps universal and scoped effect rows machine-readable", () => {
    const universal = SCRIPT_EFFECT_REFERENCES.filter(
      (reference) => reference.method === "countryListTooltip"
    );
    expect(universal).toHaveLength(1);
    expect(universal[0]?.availability).toEqual({ kind: "universal" });

    const scoped = SCRIPT_EFFECT_REFERENCES.find(
      (reference) => reference.method === "addStaticWarExhaustion"
    );
    expect(scoped?.availability).toEqual({ kind: "scopes", scopes: ["country"] });

    const ambient = SCRIPT_EFFECT_REFERENCES.find(
      (reference) => reference.method === "createAmbientObject"
    );
    expect(ambient?.signature).toContain("target?: ScopeValue");
    expect(ambient?.docs.join("\n")).toContain("target = <target>");
  });

  it("projects handwritten effect overloads before their generated fallbacks", () => {
    const start = SCRIPT_EFFECT_REFERENCES.find(
      (reference) => reference.method === "startSituation"
    );
    const startOverload =
      "startSituation<T extends ScopeName>(args: { type: Unambiguous<T, SituationTargetContract<T>>; target: ScopeValue<NoInfer<T>>; effect?: (scope: SituationEffectScope<T>) => void }): void;";
    const startFallback = "startSituation(args: StartSituationArgs): void;";
    const startSignature = start?.signature ?? "";
    expect(startSignature).toBe(`${startOverload}\n${startFallback}`);
    expect(startSignature).not.toContain("startSituation(args: {");

    const project = SCRIPT_EFFECT_REFERENCES.find(
      (reference) => reference.method === "enableSpecialProject"
    );
    const projectOverload =
      'enableSpecialProject<L extends SpecialProjectLocationScope>(args: Omit<EnableSpecialProjectArgs, "name" | "location"> & { name: Unambiguous<L, SpecialProjectLocationContract<L>>; location: ScopeValue<NoInfer<L>> }): void;';
    const projectFallback = "enableSpecialProject(args: EnableSpecialProjectArgs): void;";
    const projectSignature = project?.signature ?? "";
    expect(projectSignature).toBe(`${projectOverload}\n${projectFallback}`);
    expect(projectSignature).not.toContain("enableSpecialProject(args: {");

    const modifierMethods = [
      "addModifier",
      "addStageModifier",
      "exportModifierDurationToVariable",
      "removeModifier",
      "removeStageModifier",
    ];
    for (const method of modifierMethods) {
      const signature = SCRIPT_EFFECT_REFERENCES.find(
        (reference) => reference.method === method
      )?.signature;
      expect(signature).toContain(`<S extends StaticModifierScope>`);
      expect(signature).toContain("Unambiguous<S, StaticModifierHostContract<S>>");
    }
  });

  it("joins event-fire rows to receiving scopes and overload signatures", () => {
    const observer = SCRIPT_EFFECT_REFERENCES.find(
      (reference) => reference.method === "observerEvent"
    );
    expect(observer).toMatchObject({
      kind: "event-fire",
      availability: { kind: "universal" },
    });
    expect(observer?.signature).toContain("FireEventArgs");
    expect(observer?.signature).toContain("WitnessedFireEventArgs");
  });

  it("covers every structural method and keeps structural availability exact", () => {
    const structural = SCRIPT_EFFECT_REFERENCES.filter(
      (reference) => reference.kind === "structural"
    );
    expect(new Set(structural.map((reference) => reference.method))).toEqual(
      new Set(STRUCTURAL_EFFECT_METHODS)
    );
    expect(
      structural.find((reference) => reference.method === "addEventChainCounter")?.availability
    ).toEqual({ kind: "scopes", scopes: ["country"] });
    expect(
      structural.find((reference) => reference.method === "resetEventChainCounter")?.availability
    ).toEqual({ kind: "scopes", scopes: ["country"] });
    expect(structural.find((reference) => reference.method === "target")?.availability).toEqual({
      kind: "scopes",
      scopes: ["agreement", "espionage_operation", "situation", "spy_network"],
    });
    expect(structural.find((reference) => reference.method === "run")?.key).toBeUndefined();
  });

  it("keeps scope links separate from effect references and isolates the subpath", () => {
    expect(
      SCRIPT_SCOPE_LINK_REFERENCES.find((reference) => reference.member === "owner")
    ).toMatchObject({
      fromScopes: expect.arrayContaining(["country"]),
      toScope: "country",
    });
    expect(
      SCRIPT_EFFECT_REFERENCES.some((reference) => (reference.method as string) === "owner")
    ).toBe(false);

    const packageJson = JSON.parse(readFileSync("packages/sdk/package.json", "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(packageJson.exports["./script-reference"]).toBeDefined();
    expect(readFileSync("packages/sdk/src/index.ts", "utf8")).not.toContain("script-reference");
  });
});

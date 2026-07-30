import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const interfaces = readFileSync("src/generated/effects.ts", "utf8");
const meta = readFileSync("src/generated/effect-meta.ts", "utf8");

/** Slices one method signature (possibly wrapped over lines) out of effects.ts. */
function signature(name: string): string {
  const start = interfaces.indexOf(`  ${name}(`);
  if (start === -1) {
    throw new Error(`${name} is not in the generated effect interfaces`);
  }
  const end = interfaces.indexOf("): void;", start);
  return interfaces.slice(start, end + 8).trim();
}

/** Slices one meta entry out of effect-meta.ts. */
function metaEntry(name: string): string {
  const start = meta.indexOf(`  ${name}: {`);
  if (start === -1) {
    throw new Error(`${name} is not in the generated effect meta`);
  }
  const end = meta.indexOf("},\n", start);
  return meta.slice(start, end + 2).trim();
}

describe("emitted effect signatures", () => {
  it("bool: an omitted argument means yes", () => {
    expect(signature("destroyColony")).toMatchInlineSnapshot(
      `"destroyColony(value?: boolean): void;"`
    );
  });

  it("value: a branded value-set argument", () => {
    expect(signature("setCountryFlag")).toMatchInlineSnapshot(
      `"setCountryFlag(value: CountryFlag): void;"`
    );
  });

  it("fields: enum-expanded keys become named optional fields", () => {
    expect(signature("addModifier")).toMatchInlineSnapshot(`
      "addModifier(args: {
          modifier: StaticModifierRef | string;
          days?: number;
          months?: number;
          years?: number;
          mult?: number;
          multiplier?: number;
          timeMultiplier?: number;
          clearOnOwnerChange?: "yes";
        }): void;"
    `);
  });

  it("wrapper: limit args plus a closure typed to the pushed scope", () => {
    expect(signature("everyOwnedPlanet")).toMatchInlineSnapshot(
      `"everyOwnedPlanet(args: { limit?: Trigger<"planet"> }, body: (scope: PlanetScope) => void): void;"`
    );
  });

  it("wrapper with weights: modifiers ride as data", () => {
    expect(signature("randomControlledPlanet")).toMatchInlineSnapshot(`
      "randomControlledPlanet(
          args: { limit?: Trigger<"planet">; weights?: readonly Modifier<"planet">[] },
          body: (scope: PlanetScope) => void
        ): void;"
    `);
  });

  it("meta: the recorder contract for a wrapper", () => {
    expect(metaEntry("everyOwnedPlanet")).toMatchInlineSnapshot(`
      "everyOwnedPlanet: {
          key: "every_owned_planet",
          shape: { kind: "wrapper", fields: [{ prop: "limit", key: "limit", kind: "trigger" }] },"
    `);
  });
});

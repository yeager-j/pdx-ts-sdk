import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const interfaces = readFileSync("packages/sdk/src/generated/effects.ts", "utf8");
const meta = readFileSync("packages/sdk/src/generated/effect-meta.ts", "utf8");

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

  it("scope_group[G]: the group's members, canonicalised and sorted", () => {
    // A group is a coercion, so `target_country` lists every scope the game
    // reads a country out of — not scopes that are countries.
    expect(signature("setOwner")).toMatchInlineSnapshot(`
      "setOwner(
          value: ScopeValue<
            | "agreement"
            | "archaeological_site"
            | "army"
            | "carrier"
            | "country"
            | "debris"
            | "deposit"
            | "first_contact"
            | "fleet"
            | "leader"
            | "megastructure"
            | "planet"
            | "pop_faction"
            | "pop_group"
            | "sector"
            | "ship"
            | "situation"
            | "spy_network"
            | "starbase"
            | "system"
          >
        ): void;"
    `);
  });

  it("bare scope_field: any scope, and no raw-string arm", () => {
    // The unbracketed spelling of `scope[any]`. It used to lower to the
    // useless literal type `"scope_field"`.
    expect(signature("enableMission")).toMatchInlineSnapshot(
      `"enableMission(args: { name: MissionRef | string; location?: ScopeValue }): void;"`
    );
  });

  it("alias_keys_field: an open alias-key name", () => {
    expect(signature("exportModifierToVariable")).toMatchInlineSnapshot(
      `"exportModifierToVariable(args: { modifier: string; variable: Variable }): void;"`
    );
    expect(signature("exportTriggerValueToVariable")).toContain("trigger: string;");
    expect(signature("exportTriggerValueToVariable")).not.toContain("alias_keys_field");
  });

  it("scope meta: the recorder unwraps a scope value through its shared lowering", () => {
    // No `refTypes` — a scope names no registry — so `toScalar`'s `path`
    // unwrapping in `src/script/scalar.ts` is the whole runtime contract.
    expect(metaEntry("setOwner")).toMatchInlineSnapshot(
      `"setOwner: { key: "set_owner", shape: { kind: "value" } },"`
    );
  });

  it("fields: enum-expanded keys become named optional fields", () => {
    // mult/multiplier/timeMultiplier are `effects.cwt`'s `value_field`, not
    // `float`, so they lower to the widened `ScriptValue` (widenedLowering)
    // rather than plain `number` — a number still assigns unchanged.
    expect(signature("addModifier")).toMatchInlineSnapshot(`
      "addModifier(args: {
          modifier: StaticModifierRef | string;
          days?: number;
          months?: number;
          years?: number;
          mult?: ScriptValue;
          multiplier?: ScriptValue;
          timeMultiplier?: ScriptValue;
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

  it("scope link: a body-only closure typed to the link's output scope", () => {
    expect(signature("owner")).toMatchInlineSnapshot(
      `"owner(body: (scope: CountryScope) => void): void;"`
    );
    expect(signature("capitalScope")).toMatchInlineSnapshot(
      `"capitalScope(body: (scope: ColonyScope) => void): void;"`
    );
  });

  it("scope link meta: a field-less wrapper the runtime already dispatches", () => {
    expect(metaEntry("owner")).toMatchInlineSnapshot(
      `"owner: { key: "owner", shape: { kind: "wrapper", fields: null } },"`
    );
  });
});

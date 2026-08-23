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

/** Slices one generated effect-path property out of effects.ts. */
function pathProperty(name: string): string {
  const start = interfaces.indexOf(`  readonly ${name}:`);
  if (start === -1) {
    throw new Error(`${name} is not in the generated effect-path interfaces`);
  }
  const end = interfaces.indexOf(";", start);
  return interfaces.slice(start, end + 1).trim();
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

function structuredMetaEntry(name: string): string {
  const start = meta.indexOf(`  ${name}: {`);
  if (start === -1) {
    throw new Error(`${name} is not in the generated effect meta`);
  }
  const end = meta.indexOf("\n  },", start);
  return meta.slice(start, end + 5).trim();
}

describe("emitted effect signatures", () => {
  it("createAmbientObject exposes its scalar/block offsets and pushed scope", () => {
    const create = signature("createAmbientObject");
    expect(create).toContain("type: AmbientObjectRef | string;");
    expect(create).toContain("location?: ScopeValue<");
    expect(create).toContain("scale?: number;");
    expect(create).toContain("use3dLocation?: boolean;");
    expect(create).toContain("entityOffset?: number | { min: number; max: number };");
    expect(create).toContain("entityOffsetAngle?: number | { min: number; max: number };");
    expect(create).toContain("entityOffsetHeight?: number | { min: number; max: number };");
    expect(create).toContain("scriptedScale?: Variable;");
    expect(create).toContain("effect?: (scope: AmbientObjectScope) => void;");
  });

  it("createAmbientObject metadata preserves nested scalar/block arms", () => {
    const entry = structuredMetaEntry("createAmbientObject");
    expect(entry).toContain('key: "create_ambient_object"');
    expect(entry.match(/kind: "scalar-or-block"/g)).toHaveLength(3);
    expect(entry).toContain('key: "entity_offset"');
    expect(entry).toContain('key: "entity_offset_angle"');
    expect(entry).toContain('key: "entity_offset_height"');
    expect(entry).toContain('{ prop: "effect", key: "effect", kind: "effect" }');
  });

  it("createPopGroup exposes every CWT field and its pushed pop-group effect", () => {
    const create = signature("createPopGroup");
    expect(create).toContain("species?:");
    expect(create).toContain('popGroup?: ScopeValue<"pop_group">;');
    expect(create).toContain('ethos?:\n      | "random"');
    expect(create).toContain("| { ethic: EthicRef | string };");
    expect(create).toContain("category?: PopCategoryRef | string;");
    expect(create).toContain("size?: ScriptValue;");
    expect(create).toContain("random?: ScriptValue;");
    expect(create).toContain("growthCategory?: string;");
    expect(create).toContain("effect?: (scope: PopGroupScope) => void;");
  });

  it("createPopGroup metadata discriminates scope-valued ethos from its structured arm", () => {
    const entry = structuredMetaEntry("createPopGroup");
    expect(entry).toContain('key: "create_pop_group"');
    expect(entry).toContain('prop: "ethos"');
    expect(entry).toContain('kind: "scalar-or-block"');
    expect(entry).toContain('scalar: { objectKinds: ["scope-ref"] }');
    expect(entry).toContain('{ prop: "effect", key: "effect", kind: "effect" }');
  });

  it("emits structured-only field types and metadata", () => {
    const fire = signature("fireOnAction");
    expect(fire).toContain("scopes?: {");
    expect(fire).toContain("from?: ScopeValue;");
    expect(fire).toContain("fromfromfromfrom?: ScopeValue;");
    const setting = signature("setDiplomacyActionSetting");
    expect(setting).toContain("settings: {");
    expect(setting).toContain("voteType?: VoteType");
    expect(setting).toContain("acceptanceType?: AcceptanceType");

    for (const method of ["fireOnAction", "setDiplomacyActionSetting"]) {
      const entry = structuredMetaEntry(method);
      expect(entry).toContain('kind: "fields"');
    }
  });

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

  it("fields: addModifier preserves generated args beneath its host-contract seam", () => {
    // mult/multiplier/timeMultiplier are `effects.cwt`'s `value_field`, not
    // `float`, so they lower to the widened `ScriptValue` (widenedLowering)
    // rather than plain `number` — a number still assigns unchanged.
    expect(signature("addModifier")).toBe("addModifier(args: AddModifierArgs): void;");
    expect(interfaces).toContain(
      "modifier: (StaticModifierRef & { hostScope?: never }) | string;\n" +
        "  days?: number;\n" +
        "  months?: number;\n" +
        "  years?: number;\n" +
        "  mult?: ScriptValue;\n" +
        "  multiplier?: ScriptValue;\n" +
        "  timeMultiplier?: ScriptValue;\n" +
        '  clearOnOwnerChange?: "yes";'
    );
  });

  it("wrapper: limit args plus a closure typed to the pushed scope", () => {
    expect(signature("everyOwnedPlanet")).toMatchInlineSnapshot(
      `"everyOwnedPlanet(args: { limit?: Trigger<"planet"> }, body: (scope: PlanetScope) => void): void;"`
    );
  });

  it("wrapper with weights: modifiers ride as data", () => {
    expect(signature("randomControlledPlanet")).toMatchInlineSnapshot(`
      "randomControlledPlanet(
          args: {
            limit?: Trigger<"planet">;
            /** adds weights to affect the chance a specific object is selected */
            weights?: readonly Modifier<"planet">[];
          },
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

  it("scope links: readonly paths typed to each link's output scope", () => {
    expect(pathProperty("owner")).toMatchInlineSnapshot(
      `"readonly owner: EffectPathOf<\"country\">;"`
    );
    expect(pathProperty("capitalScope")).toMatchInlineSnapshot(
      `"readonly capitalScope: EffectPathOf<\"colony\">;"`
    );
    expect(interfaces).toMatch(
      /export interface CountryEffectPath\s+extends\s+EffectPath<"country">/
    );
    expect(interfaces).toContain("export interface EffectPathMap {");
  });

  it("open-keyed block: the whole argument is a map of its key filter", () => {
    expect(signature("setTradeConversions")).toMatchInlineSnapshot(
      `"setTradeConversions(values: { readonly [resource: string]: ScriptValue }): void;"`
    );
    expect(signature("setCountryCodeFlags")).toMatchInlineSnapshot(
      `"setCountryCodeFlags(values: { readonly [countryFlag: string]: boolean }): void;"`
    );
    expect(signature("addAttunement")).toMatchInlineSnapshot(
      `"addAttunement(values: { readonly [patronType: string]: ScriptValue }): void;"`
    );
  });

  it("open-keyed block: several key families merge into one map", () => {
    expect(signature("setAgreementTerms")).toMatchInlineSnapshot(`
      "setAgreementTerms(values: {
          readonly [agreementTermDiscrete: string]:
            | AgreementTermValueDiscreteRef
            | string
            | AgreementTermValueDiscreteNumberRef
            | AgreementTermValueSpecialistTypeRef
            | ScriptValue;
        }): void;"
    `);
  });

  it("mixed block: the map becomes a member where its declaration stands", () => {
    expect(signature("addResourceFromDebris")).toMatchInlineSnapshot(`
      "addResourceFromDebris(args: {
          resources?: { readonly [resource: string]: ScriptValue };
          system?: ScopeValue<"system">;
          /** optional: multiplies all gained resources by a variable) */
          mult?: ScriptValue;
        }): void;"
    `);
  });

  it("nested open-keyed block: the field's value is the map", () => {
    expect(signature("releaseVivariumFaunaCount")).toContain(
      'owners: { readonly [shipCategories: string]: ScopeValue<"country"> };'
    );
    expect(signature("customTooltipWithParams")).toContain(
      "descriptionParameters?: { readonly [parameter: string]: string };"
    );
  });

  it("int-keyed block: entries keys on number beside its named siblings", () => {
    expect(signature("createLeader")).toContain(
      "traits?: {\n      entries?: {\n        readonly [int: number]: " +
        'TraitLeaderTraitRef | string | "random_trait" | "random_common";\n      };'
    );
  });

  it("reference-keyed and value-set-keyed blocks keep keying on string", () => {
    expect(signature("setTradeConversions")).toContain("readonly [resource: string]");
    expect(signature("setCountryCodeFlags")).toContain("readonly [countryFlag: string]");
    expect(signature("customTooltipWithParams")).toContain("readonly [parameter: string]");
    // Five reference families merged into one map, so no family is numeric.
    expect(signature("setAgreementTerms")).toContain("readonly [agreementTermDiscrete: string]");
  });

  it("map meta: keys, values, minimum entry count, and placement", () => {
    expect(metaEntry("setCountryCodeFlags")).toMatchInlineSnapshot(`
      "setCountryCodeFlags: {
          key: "set_country_code_flags",
          shape: { kind: "map", map: { value: {}, min: 1 } },"
    `);
    expect(structuredMetaEntry("addResourceFromDebris")).toMatchInlineSnapshot(`
      "addResourceFromDebris: {
          key: "add_resource_from_debris",
          shape: {
            kind: "fields",
            fields: [
              {
                prop: "resources",
                key: "resources",
                kind: "map",
                map: { keyRefTypes: ["resource"], value: {}, min: 0, splice: true },
              },
              { prop: "system", key: "system", kind: "value" },
              { prop: "mult", key: "mult", kind: "value" },
            ],
          },
        },"
    `);
  });

  it("value-list block beside a scalar arm records both arms", () => {
    expect(signature("createSpecies")).toContain(
      'popEthics?:\n      | "no"\n      | "random"\n      | EthicRef\n      | string\n' +
        '      | readonly [EthicRef | string | "random"]'
    );
    expect(structuredMetaEntry("createSpecies")).toContain(
      [
        "        {",
        '          prop: "popEthics",',
        '          key: "pop_ethics",',
        '          kind: "scalar-or-block",',
        '          scalar: { booleanLiterals: ["no"], objectKinds: ["typed-ref"] },',
        '          block: { kind: "value-list", scalar: { objectKinds: ["typed-ref"] } },',
        "        },",
      ].join("\n")
    );
  });

  it("scope link meta: a distinct lazy path node", () => {
    expect(metaEntry("owner")).toMatchInlineSnapshot(
      `"owner: { key: "owner", shape: { kind: "scope-link" } },"`
    );
  });
});

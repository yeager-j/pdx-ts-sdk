import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("packages/sdk/src/generated/triggers.ts", "utf8");
const refs = readFileSync("packages/sdk/src/generated/refs.ts", "utf8");
const contentDefiners = readFileSync("packages/sdk/src/generated/content-definers.ts", "utf8");

/** Slices one generated declaration out so signature changes show up in the diff. */
function declaration(name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  if (start === -1) {
    throw new Error(`${name} is not in the generated triggers`);
  }
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 2);
}

function argsInterface(name: string): string {
  const start = source.indexOf(`export interface ${name}`);
  if (start === -1) {
    throw new Error(`${name} is not in the generated triggers`);
  }
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 2);
}

describe("emitted trigger signatures", () => {
  it("bool: an omitted argument means yes", () => {
    expect(declaration("isAi")).toMatchInlineSnapshot(`
      "export function isAi(value: boolean = true): Trigger<"country"> {
        return trigger([kv("is_ai", value)]);
      }"
    `);
  });

  it("value-field comparison: keeps the CWT ScriptValue operand", () => {
    expect(declaration("numMoons")).toMatchInlineSnapshot(`
      "export function numMoons(op: PdxOp, value: ScriptValue): Trigger<"carrier" | "planet" | "ship"> {
        return trigger([cmp("num_moons", op, scriptValueScalar(value))]);
      }"
    `);
  });

  it("plain numeric comparison: keeps an ordinary number operand", () => {
    expect(declaration("aiArmorRatio")).toMatchInlineSnapshot(`
      "export function aiArmorRatio(op: PdxOp, value: number): Trigger<"country"> {
        return trigger([cmp("ai_armor_ratio", op, value)]);
      }"
    `);
  });

  it("type reference: accepts an SDK object or a raw id", () => {
    expect(declaration("hasEdict")).toMatchInlineSnapshot(`
      "export function hasEdict(value: EdictRef | string): Trigger<"country"> {
        const id = refId(value);
        return trigger([kv("has_edict", id)], [{ targets: ["edict"], id, field: "has_edict" }]);
      }"
    `);
  });

  it("enum: resolves to a literal union", () => {
    expect(declaration("hasElectionType")).toMatchInlineSnapshot(`
      "export function hasElectionType(value: ElectionType): Trigger<"country"> {
        return trigger([kv("has_election_type", value)]);
      }"
    `);
  });

  it("scope change: takes the condition, typed to the pushed scope", () => {
    expect(declaration("anyCountry")).toMatchInlineSnapshot(`
      "export function anyCountry(condition: Trigger<"country">): Trigger<ScopeName> {
        return trigger([block("any_country", [...condition.entries])], [...condition.refs]);
      }"
    `);
  });

  it("clause + comparison fields: a nested trigger hole and an operator-or-literal count", () => {
    expect(argsInterface("CountOwnedPopGroupArgs")).toMatchInlineSnapshot(`
      "export interface CountOwnedPopGroupArgs {
        limit?: Trigger<"pop_group">;
        count: ScriptValue | readonly [PdxOp, ScriptValue] | "all";
      }"
    `);
    expect(declaration("countOwnedPopGroup")).toMatchInlineSnapshot(`
      "export function countOwnedPopGroup(
        args: CountOwnedPopGroupArgs
      ): Trigger<
        "carrier" | "colony" | "country" | "planet" | "pop_faction" | "sector" | "ship" | "system"
      > {
        const entries: PdxEntry[] = [];
        const refs: ContentRefUse[] = [];
        if (args.limit !== undefined) {
          entries.push(block("limit", [...args.limit.entries]));
          refs.push(...args.limit.refs);
        }
        entries.push(
          typeof args.count === "object"
            ? cmp("count", args.count[0], scriptValueScalar(args.count[1]))
            : kv("count", scriptValueScalar(args.count))
        );
        return trigger([block("count_owned_pop_group", entries)], refs);
      }"
    `);
  });

  it("splice + fields: the trigger splice becomes an implicit conditions argument", () => {
    expect(argsInterface("CalcTrueIfArgs")).toMatchInlineSnapshot(`
      "export interface CalcTrueIfArgs {
        amount: ScriptValue | readonly [PdxOp, ScriptValue];
        conditions: Trigger<ScopeName>;
      }"
    `);
    expect(declaration("calcTrueIf")).toMatchInlineSnapshot(`
      "export function calcTrueIf(args: CalcTrueIfArgs): Trigger<ScopeName> {
        const entries: PdxEntry[] = [];
        const refs: ContentRefUse[] = [];
        entries.push(
          typeof args.amount === "object"
            ? cmp("amount", args.amount[0], scriptValueScalar(args.amount[1]))
            : kv("amount", scriptValueScalar(args.amount))
        );
        entries.push(...args.conditions.entries);
        refs.push(...args.conditions.refs);
        return trigger([block("calc_true_if", entries)], refs);
      }"
    `);
  });

  it("plain numeric comparison fields stay numeric", () => {
    expect(argsInterface("DistanceArgs")).toContain(
      "minDistance?: number | readonly [PdxOp, number];"
    );
    expect(argsInterface("DistanceArgs")).toContain(
      "maxDistance?: number | readonly [PdxOp, number];"
    );
  });

  it("scope[X]: one branded scope value, and no raw-string arm", () => {
    expect(declaration("canAccessSystem")).toMatchInlineSnapshot(`
      "export function canAccessSystem(value: ScopeValue<"system">): Trigger<"fleet"> {
        return trigger([kv("can_access_system", value.path)]);
      }"
    `);
  });

  it("alias_keys_field: an open alias-key name", () => {
    expect(argsInterface("CheckModifierValueArgs")).toMatchInlineSnapshot(`
      "export interface CheckModifierValueArgs {
        modifier: string;
        value: ScriptValue | readonly [PdxOp, ScriptValue];
      }"
    `);
  });

  it("scope_group[G]: the group's members, canonicalised and sorted", () => {
    // A group is a coercion: `target_species` lists the scopes the game reads
    // a species *out of*, not scopes that are species.
    expect(declaration("isSameSpecies")).toMatchInlineSnapshot(`
      "export function isSameSpecies(
        value: ScopeValue<
          | "army"
          | "carrier"
          | "country"
          | "first_contact"
          | "fleet"
          | "leader"
          | "planet"
          | "pop_group"
          | "ship"
          | "species"
        >
      ): Trigger<"army" | "country" | "leader" | "pop_group" | "ship" | "species"> {
        return trigger([kv("is_same_species", value.path)]);
      }"
    `);
  });

  it("scope overloaded with a reference: one unwrapping call site serves both", () => {
    expect(declaration("isPlanetClass")).toMatchInlineSnapshot(`
      "export function isPlanetClass(
        value:
          | PlanetClassRef
          | string
          | ScopeValue<
              | "archaeological_site"
              | "army"
              | "carrier"
              | "deposit"
              | "fleet"
              | "megastructure"
              | "planet"
              | "pop_group"
              | "ship"
            >
      ): Trigger<"carrier" | "colony" | "dlc_recommendation" | "planet" | "ship"> {
        return trigger([kv("is_planet_class", refId(value))]);
      }"
    `);
  });

  it("block: becomes one options object, optional where cardinality allows", () => {
    expect(declaration("relativePower")).toMatchInlineSnapshot(`
      "export function relativePower(args: RelativePowerArgs): Trigger<"country" | "federation"> {
        const entries: PdxEntry[] = [];
        entries.push(kv("who", args.who.path));
        if (args.category !== undefined) {
          entries.push(kv("category", args.category));
        }
        entries.push(kv("value", args.value));
        return trigger([block("relative_power", entries)]);
      }"
    `);
  });

  it("scalar plus block: preserves both custom_tooltip forms as overloads", () => {
    expect(argsInterface("CustomTooltipArgs")).toMatchInlineSnapshot(`
      "export interface CustomTooltipArgs<S extends ScopeName = ScopeName> {
        text?: \"\" | string;
        failText?: \"default\" | string;
        successText?: string;
        conditions: Trigger<S>;
      }"
    `);
    expect(declaration("customTooltip")).toMatchInlineSnapshot(`
      "export function customTooltip(value: string): Trigger<ScopeName>;
      export function customTooltip<S extends ScopeName = ScopeName>(
        args: CustomTooltipArgs<S>
      ): Trigger<S>;
      export function customTooltip<S extends ScopeName>(
        value: string | CustomTooltipArgs<S>
      ): Trigger<ScopeName> {
        if (typeof value === \"string\") {
          return trigger([kv(\"custom_tooltip\", value)]);
        }
        const args = value;
        const entries: PdxEntry[] = [];
        const refs: ContentRefUse[] = [];
        if (args.text !== undefined) {
          entries.push(kv(\"text\", args.text));
        }
        if (args.failText !== undefined) {
          entries.push(kv(\"fail_text\", args.failText));
        }
        if (args.successText !== undefined) {
          entries.push(kv(\"success_text\", args.successText));
        }
        entries.push(...args.conditions.entries);
        refs.push(...args.conditions.refs);
        return trigger([block(\"custom_tooltip\", entries)], refs);
      }"
    `);
  });
});

describe("scalar lowering ownership", () => {
  it("keeps generated refs rules-derived and imports the handwritten runtime", () => {
    expect(refs).toContain('import type { TypedRef } from "../script/scalar.ts";');
    expect(refs).not.toContain("function refId");
    expect(source).toContain('import { refId } from "../script/scalar.ts";');
    expect(contentDefiners).toContain(
      'import { refId, type TypedRef } from "../script/scalar.ts";'
    );
  });
});

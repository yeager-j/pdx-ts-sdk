import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/generated/triggers.ts", "utf8");

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
  const start = source.indexOf(`export interface ${name} {`);
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

  it("comparison: takes the operator the game writes", () => {
    expect(declaration("numMoons")).toMatchInlineSnapshot(`
      "export function numMoons(op: PdxOp, value: number): Trigger<"carrier" | "planet" | "ship"> {
        return trigger([cmp("num_moons", op, value)]);
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
        count: number | readonly [PdxOp, number] | "all";
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
            ? cmp("count", args.count[0], args.count[1])
            : kv("count", args.count)
        );
        return trigger([block("count_owned_pop_group", entries)], refs);
      }"
    `);
  });

  it("splice + fields: the trigger splice becomes an implicit conditions argument", () => {
    expect(argsInterface("CalcTrueIfArgs")).toMatchInlineSnapshot(`
      "export interface CalcTrueIfArgs {
        amount: number | readonly [PdxOp, number];
        conditions: Trigger<ScopeName>;
      }"
    `);
    expect(declaration("calcTrueIf")).toMatchInlineSnapshot(`
      "export function calcTrueIf(args: CalcTrueIfArgs): Trigger<ScopeName> {
        const entries: PdxEntry[] = [];
        const refs: ContentRefUse[] = [];
        entries.push(
          typeof args.amount === "object"
            ? cmp("amount", args.amount[0], args.amount[1])
            : kv("amount", args.amount)
        );
        entries.push(...args.conditions.entries);
        refs.push(...args.conditions.refs);
        return trigger([block("calc_true_if", entries)], refs);
      }"
    `);
  });

  it("block: becomes one options object, optional where cardinality allows", () => {
    expect(declaration("relativePower")).toMatchInlineSnapshot(`
      "export function relativePower(args: RelativePowerArgs): Trigger<"country" | "federation"> {
        const entries: PdxEntry[] = [];
        entries.push(kv("who", args.who));
        if (args.category !== undefined) {
          entries.push(kv("category", args.category));
        }
        entries.push(kv("value", args.value));
        return trigger([block("relative_power", entries)]);
      }"
    `);
  });
});

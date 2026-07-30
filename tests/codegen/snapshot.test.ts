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
        return trigger([kv("has_edict", refId(value))]);
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
        return trigger([block("any_country", [...condition.entries])]);
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

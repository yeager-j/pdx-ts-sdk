import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("packages/sdk/src/generated/links.ts", "utf8");

/** Slices one generated declaration out so signature changes show up in the diff. */
function declaration(name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  if (start === -1) {
    throw new Error(`${name} is not in the generated links`);
  }
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 2);
}

describe("emitted trigger-position scope links", () => {
  it("owner: condition in the output scope, result valid in every input scope", () => {
    expect(declaration("owner")).toMatchInlineSnapshot(`
      "export function owner(
        condition: Trigger<"country">
      ): Trigger<
        | "agreement"
        | "archaeological_site"
        | "army"
        | "astral_rift"
        | "bypass"
        | "carrier"
        | "colony"
        | "country"
        | "debris"
        | "deposit"
        | "espionage_operation"
        | "first_contact"
        | "fleet"
        | "leader"
        | "megastructure"
        | "mission"
        | "planet"
        | "pop_faction"
        | "pop_group"
        | "sector"
        | "ship"
        | "situation"
        | "spy_network"
        | "starbase"
        | "system"
      > {
        return trigger([block("owner", [...condition.entries])]);
      }"
    `);
  });

  it("overlord: a single-input, single-output link stays narrow", () => {
    expect(declaration("overlord")).toMatchInlineSnapshot(`
      "export function overlord(condition: Trigger<"country">): Trigger<"country"> {
        return trigger([block("overlord", [...condition.entries])]);
      }"
    `);
  });

  it("universal input scopes render as ScopeName", () => {
    expect(declaration("lastCreatedCountry")).toMatchInlineSnapshot(`
      "export function lastCreatedCountry(condition: Trigger<"country">): Trigger<ScopeName> {
        return trigger([block("last_created_country", [...condition.entries])]);
      }"
    `);
  });

  it("system_star: links.cwt's capitalized 'Planet' output canonicalizes", () => {
    expect(declaration("systemStar")).toContain('condition: Trigger<"planet">');
    expect(declaration("systemStar")).toContain('block("system_star"');
  });

  it("capital_scope: snake_case keys become camelCase exports", () => {
    expect(declaration("capitalScope")).toMatchInlineSnapshot(`
      "export function capitalScope(condition: Trigger<"colony">): Trigger<"country"> {
        return trigger([block("capital_scope", [...condition.entries])]);
      }"
    `);
  });

  it("the link literally named no_scope emits mechanically", () => {
    expect(declaration("noScope")).toMatchInlineSnapshot(`
      "export function noScope(condition: Trigger<"no_scope">): Trigger<ScopeName> {
        return trigger([block("no_scope", [...condition.entries])]);
      }"
    `);
  });

  it("declined links stay out of the file", () => {
    // target is runtime-polymorphic (gated on situations); the value links
    // produce numbers, not scopes; pop_faction_parameter is data-driven.
    for (const absent of ["target", "variable", "scriptValue", "popFactionParameter"]) {
      expect(source).not.toContain(`export function ${absent}(`);
    }
  });
});

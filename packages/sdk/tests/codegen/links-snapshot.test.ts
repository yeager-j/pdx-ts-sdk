import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("packages/sdk/src/generated/links.ts", "utf8");

/**
 * Slices one link's whole overload group out — every `export function` line
 * for it plus the implementation — so signature changes show up in the diff.
 *
 * The first `\n}\n` after the opening still terminates it: an overload
 * signature ends in `;`, so the only line that is a bare closing brace is the
 * implementation's, however many signatures precede it.
 */
function declaration(name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  if (start === -1) {
    throw new Error(`${name} is not in the generated links`);
  }
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 2);
}

describe("emitted scope links", () => {
  it("owner: the trigger form's input union sits on the result, the value form's on the parameter", () => {
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
      >;
      /**
       * The same link as a value, from an absolute base: \`from.owner\`.
       * Absolute in, absolute out — the result opens as a block too.
       */
      export function owner(
        base: ScopeRef<
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
        >
      ): ScopeRef<"country">;
      /**
       * The same link from a relative base: \`ctx.self\` writes a bare \`owner\`.
       * Relative in, relative out — a value, never a block.
       */
      export function owner(
        base: ScopeValue<
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
        >
      ): ScopeValue<"country">;
      export function owner(
        arg: Trigger<"country"> | ScopeValue
      ):
        | Trigger<
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
          >
        | ScopeValue<"country"> {
        return "path" in arg
          ? navigateScope<"country">(arg, "owner")
          : trigger([block("owner", [...arg.entries])], [...arg.refs]);
      }"
    `);
  });

  it("overlord: a single-input, single-output link stays narrow", () => {
    expect(declaration("overlord")).toMatchInlineSnapshot(`
      "export function overlord(condition: Trigger<"country">): Trigger<"country">;
      /**
       * The same link as a value, from an absolute base: \`from.overlord\`.
       * Absolute in, absolute out — the result opens as a block too.
       */
      export function overlord(base: ScopeRef<"country">): ScopeRef<"country">;
      /**
       * The same link from a relative base: \`ctx.self\` writes a bare \`overlord\`.
       * Relative in, relative out — a value, never a block.
       */
      export function overlord(base: ScopeValue<"country">): ScopeValue<"country">;
      export function overlord(
        arg: Trigger<"country"> | ScopeValue
      ): Trigger<"country"> | ScopeValue<"country"> {
        return "path" in arg
          ? navigateScope<"country">(arg, "overlord")
          : trigger([block("overlord", [...arg.entries])], [...arg.refs]);
      }"
    `);
  });

  it("universal input scopes render as ScopeName", () => {
    expect(declaration("lastCreatedCountry")).toMatchInlineSnapshot(`
      "export function lastCreatedCountry(condition: Trigger<"country">): Trigger<ScopeName>;
      /**
       * The same link as a value, from an absolute base: \`from.last_created_country\`.
       * Absolute in, absolute out — the result opens as a block too.
       */
      export function lastCreatedCountry(base: ScopeRef<ScopeName>): ScopeRef<"country">;
      /**
       * The same link from a relative base: \`ctx.self\` writes a bare \`last_created_country\`.
       * Relative in, relative out — a value, never a block.
       */
      export function lastCreatedCountry(base: ScopeValue<ScopeName>): ScopeValue<"country">;
      export function lastCreatedCountry(
        arg: Trigger<"country"> | ScopeValue
      ): Trigger<ScopeName> | ScopeValue<"country"> {
        return "path" in arg
          ? navigateScope<"country">(arg, "last_created_country")
          : trigger([block("last_created_country", [...arg.entries])], [...arg.refs]);
      }"
    `);
  });

  it("system_star: links.cwt's capitalized 'Planet' output canonicalizes", () => {
    expect(declaration("systemStar")).toContain('condition: Trigger<"planet">');
    expect(declaration("systemStar")).toContain('block("system_star"');
    // The same canonical output on the value side, where it is the result
    // rather than the condition's scope.
    expect(declaration("systemStar")).toContain('): ScopeRef<"planet">');
    expect(declaration("systemStar")).toContain('navigateScope<"planet">(arg, "system_star")');
  });

  it("the ref overload precedes the value overload, so an absolute base stays openable", () => {
    const owner = declaration("owner");
    expect(owner.indexOf("base: ScopeRef<")).toBeLessThan(owner.indexOf("base: ScopeValue<"));
  });

  it("capital_scope: snake_case keys become camelCase exports", () => {
    expect(declaration("capitalScope")).toMatchInlineSnapshot(`
      "export function capitalScope(condition: Trigger<"colony">): Trigger<"country">;
      /**
       * The same link as a value, from an absolute base: \`from.capital_scope\`.
       * Absolute in, absolute out — the result opens as a block too.
       */
      export function capitalScope(base: ScopeRef<"country">): ScopeRef<"colony">;
      /**
       * The same link from a relative base: \`ctx.self\` writes a bare \`capital_scope\`.
       * Relative in, relative out — a value, never a block.
       */
      export function capitalScope(base: ScopeValue<"country">): ScopeValue<"colony">;
      export function capitalScope(
        arg: Trigger<"colony"> | ScopeValue
      ): Trigger<"country"> | ScopeValue<"colony"> {
        return "path" in arg
          ? navigateScope<"colony">(arg, "capital_scope")
          : trigger([block("capital_scope", [...arg.entries])], [...arg.refs]);
      }"
    `);
  });

  it("the link literally named no_scope emits mechanically", () => {
    expect(declaration("noScope")).toMatchInlineSnapshot(`
      "export function noScope(condition: Trigger<"no_scope">): Trigger<ScopeName>;
      /**
       * The same link as a value, from an absolute base: \`from.no_scope\`.
       * Absolute in, absolute out — the result opens as a block too.
       */
      export function noScope(base: ScopeRef<ScopeName>): ScopeRef<"no_scope">;
      /**
       * The same link from a relative base: \`ctx.self\` writes a bare \`no_scope\`.
       * Relative in, relative out — a value, never a block.
       */
      export function noScope(base: ScopeValue<ScopeName>): ScopeValue<"no_scope">;
      export function noScope(
        arg: Trigger<"no_scope"> | ScopeValue
      ): Trigger<ScopeName> | ScopeValue<"no_scope"> {
        return "path" in arg
          ? navigateScope<"no_scope">(arg, "no_scope")
          : trigger([block("no_scope", [...arg.entries])], [...arg.refs]);
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

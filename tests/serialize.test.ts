import { describe, expect, it } from "vitest";

import { block, cmp, kv, quoted } from "../src/ast.ts";
import { serializeEntries } from "../src/serialize.ts";

describe("serializeEntries", () => {
  it("serializes scalars, booleans, and comparisons", () => {
    const text = serializeEntries([
      block("tech_example", [
        kv("cost", 2000),
        kv("is_rare", true),
        kv("start_tech", false),
        cmp("num_owned_planets", ">=", 3),
        kv("modifier_factor", 0.5),
      ]),
    ]);
    expect(text).toMatchInlineSnapshot(`
      "tech_example = {
      	cost = 2000
      	is_rare = yes
      	start_tech = no
      	num_owned_planets >= 3
      	modifier_factor = 0.5
      }
      "
    `);
  });

  it("indents nested blocks with tabs", () => {
    const text = serializeEntries([
      block("potential", [block("OR", [kv("has_country_flag", "flag_a"), kv("is_ai", true)])]),
    ]);
    expect(text).toMatchInlineSnapshot(`
      "potential = {
      	OR = {
      		has_country_flag = flag_a
      		is_ai = yes
      	}
      }
      "
    `);
  });

  it("quotes strings only when forced or containing special characters", () => {
    const text = serializeEntries([
      kv("bare", "tech_lasers"),
      kv("scoped", "event_target:the_system"),
      kv("forced", quoted("tech_lasers")),
      kv("spaced", "Display Text"),
    ]);
    expect(text).toMatchInlineSnapshot(`
      "bare = tech_lasers

      scoped = event_target:the_system

      forced = "tech_lasers"

      spaced = "Display Text"
      "
    `);
  });

  it("separates top-level definitions with a blank line", () => {
    const text = serializeEntries([
      block("tech_a", [kv("cost", 100)]),
      block("tech_b", [kv("cost", 200)]),
    ]);
    expect(text).toBe("tech_a = {\n\tcost = 100\n}\n\ntech_b = {\n\tcost = 200\n}\n");
  });

  it("serializes empty blocks inline", () => {
    expect(serializeEntries([block("potential", [])])).toBe("potential = {}\n");
  });

  it("rejects numbers that would need exponent notation", () => {
    expect(() => serializeEntries([kv("cost", 1e21)])).toThrow(/exponent notation/);
  });
});

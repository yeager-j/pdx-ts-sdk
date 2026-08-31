import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { RuleField, RuleType } from "../src/cwt/model.ts";
import type { RuleSet } from "../src/cwt/rules.ts";
import { loadRules } from "../src/load-rules.ts";
import { Emitter, type TsValue } from "../src/render/emitter.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));

interface CollectedRuleTypes {
  readonly scalarTypes: RuleType[];
  readonly unions: RuleType[][];
}

function collectRuleTypes(rules: RuleSet): CollectedRuleTypes {
  const scalarTypes: RuleType[] = [];
  const unions: RuleType[][] = [];
  const visited = new Set<RuleType>();

  function visitType(type: RuleType): void {
    if (visited.has(type)) {
      return;
    }
    visited.add(type);
    scalarTypes.push(type);
    if (type.kind !== "block") {
      return;
    }
    const bare = type.bare.map((value) => value.type);
    if (bare.length > 0) {
      unions.push(bare);
      for (const value of bare) {
        visitType(value);
      }
    }
    collectFields(type.fields);
  }

  function collectFields(fields: readonly RuleField[]): void {
    const byName = new Map<string, RuleType[]>();
    for (const field of fields) {
      visitType(field.type);
      if (field.key.kind === "name") {
        byName.set(field.key.name, [...(byName.get(field.key.name) ?? []), field.type]);
      }
    }
    unions.push(...byName.values());
  }

  function collectAliases(
    aliases: ReadonlyMap<string, readonly { readonly type: RuleType }[]>
  ): void {
    for (const declarations of aliases.values()) {
      const types = declarations.map((declaration) => declaration.type);
      unions.push(types);
      for (const type of types) {
        visitType(type);
      }
    }
  }

  collectAliases(rules.triggers);
  collectAliases(rules.effects);
  for (const aliases of rules.aliasCategories.values()) {
    collectAliases(aliases);
  }
  for (const body of rules.bodies.values()) {
    collectFields(body.fields);
  }

  return { scalarTypes, unions };
}

/**
 * The expression each conversion promises to write, so the recorded tag is
 * checked against `toScalar` itself rather than against a coarser reading of
 * it. Tagging `refId(x)` and `x.path` alike is what let a union merge hand one
 * arm's expression to the other arm's values.
 */
const CONVERSION_EXPRESSIONS: Record<TsValue["conversion"], string> = {
  identity: "x",
  refId: "refId(x)",
  stringRefId: "String(refId(x))",
  scopePath: "x.path",
  literalText: "x.text",
};

describe("emitter scalar conversions", () => {
  it("records the conversion implemented by every real scalar value shape", () => {
    const collected = collectRuleTypes(rules);
    const emitter = new Emitter(rules);
    const values = [
      ...collected.scalarTypes
        .map((type) => emitter.valueFor(type))
        .filter((value): value is TsValue => value !== null),
      ...collected.unions
        .map((types) => emitter.unionFor(types))
        .filter((value): value is TsValue => value !== null),
    ];

    expect(values.length).toBeGreaterThan(100);
    expect(values.some((value) => value.type.includes("LiteralText"))).toBe(true);

    for (const value of values) {
      expect(value.toScalar("x")).toBe(CONVERSION_EXPRESSIONS[value.conversion]);
    }
  });

  it("merges a union of differently converting arms onto one that fits them all", () => {
    // `refId` handles a typed reference and a scope reference alike; `.path`
    // handles only the second and yields `undefined` for the first. So a union
    // mixing them has to pick `refId` whichever arm comes first — a distinction
    // the runtime's own `identity`/`ref` vocabulary is too coarse to make.
    const collected = collectRuleTypes(rules);
    const emitter = new Emitter(rules);
    let mixed = 0;

    for (const types of collected.unions) {
      const arms = types.map((type) => emitter.valueFor(type));
      // A union with an arm the emitter cannot lower has no merged value to
      // check; `unionFor` returns null for the whole union rather than a
      // partial one.
      if (!arms.every((arm): arm is TsValue => arm !== null)) {
        continue;
      }
      if (new Set(arms.map((arm) => arm.conversion)).size < 2) {
        continue;
      }
      mixed += 1;
      const merged = emitter.unionFor(types);
      expect(merged?.conversion).toBe("refId");
      expect(merged?.toScalar("x")).toBe("refId(x)");
    }

    expect(mixed).toBeGreaterThan(0);
  });
});

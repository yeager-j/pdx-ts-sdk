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

function conversionInferredFromScalar(value: TsValue): "identity" | "ref" {
  return value.toScalar("x") === "x" ? "identity" : "ref";
}

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
    expect(new Set(values.map((value) => value.conversion))).toEqual(new Set(["identity", "ref"]));
    expect(values.some((value) => value.type.includes("LiteralText"))).toBe(true);

    for (const value of values) {
      expect(value.conversion).toBe(conversionInferredFromScalar(value));
    }
  });
});

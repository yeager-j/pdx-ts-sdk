/**
 * The audited classification of every CWT position that names a localisation
 * key.
 *
 * A bare string in such a position is now English display text, so a second
 * string-backed arm beside it would be two things at once. This walks the
 * whole rule set, classifies each localisation-bearing union, and fails on any
 * arm that has no runtime-distinguishable spelling — so a future CWT change
 * cannot introduce one unnoticed, silently reinterpreting an author's string.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuleType } from "@pdx-ts/codegen-cwt/cwt/model";
import type { AliasDecl } from "@pdx-ts/codegen-cwt/cwt/rules";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/typescript";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));

/** How one localisation position is overloaded, in the terms the plan audits. */
type Classification =
  "pure" | "sentinel" | "raw-scalar" | "content-reference" | "scope" | "block" | "ambiguous";

interface Position {
  readonly where: string;
  readonly types: readonly RuleType[];
}

function classifyArm(type: RuleType): Classification {
  switch (type.kind) {
    case "localisation":
      return "pure";
    case "literal":
      return "sentinel";
    case "scalar":
    case "filepath":
    case "icon":
    case "colour":
      return "raw-scalar";
    case "typeRef":
      return "content-reference";
    case "scope":
    case "scopeGroup":
      return "scope";
    case "block":
      return "block";
    default:
      // An `enum`, a `valueSet`, a `value_field` — every one of them is a bare
      // string in the emitted type, which is exactly the arm that cannot sit
      // beside display text.
      return "ambiguous";
  }
}

function describeType(type: RuleType): string {
  switch (type.kind) {
    case "literal":
      return `literal(${type.text})`;
    case "enum":
      return `enum[${type.name}]`;
    case "typeRef":
      return `<${type.name}>`;
    case "valueSet":
      return `value[${type.name}]`;
    case "scope":
      return `scope[${type.name}]`;
    case "scopeGroup":
      return `scope_group[${type.name}]`;
    case "block":
      return "block";
    default:
      return type.kind;
  }
}

function collectBlock(where: string, type: RuleType, into: Position[]): void {
  if (type.kind !== "block") {
    return;
  }
  const byKey = new Map<string, RuleType[]>();
  for (const field of type.fields) {
    const name = field.key.kind === "name" ? field.key.name : `<${field.key.kind}>`;
    byKey.set(name, [...(byKey.get(name) ?? []), field.type]);
  }
  for (const [name, types] of byKey) {
    collect(`${where}.${name}`, types, into);
  }
  if (type.bare.length > 0) {
    collect(
      `${where}[bare]`,
      type.bare.map((value) => value.type),
      into
    );
  }
}

function collect(where: string, types: readonly RuleType[], into: Position[]): void {
  if (types.some((type) => type.kind === "localisation")) {
    into.push({ where, types });
  }
  for (const type of types) {
    collectBlock(where, type, into);
  }
}

function collectAliases(
  label: string,
  table: ReadonlyMap<string, readonly AliasDecl[]>,
  into: Position[]
): void {
  for (const [name, declarations] of table) {
    collect(
      `${label}:${name}`,
      declarations.map((declaration) => declaration.type),
      into
    );
  }
}

function localisationPositions(): readonly Position[] {
  const positions: Position[] = [];
  collectAliases("trigger", rules.triggers, positions);
  collectAliases("effect", rules.effects, positions);
  for (const [category, table] of rules.aliasCategories) {
    collectAliases(`alias:${category}`, table, positions);
  }
  for (const [name, body] of rules.bodies) {
    collectBlock(`body:${name}`, { kind: "block", fields: body.fields, bare: [] }, positions);
  }
  positions.sort((left, right) => (left.where < right.where ? -1 : 1));
  return positions;
}

const POSITIONS = localisationPositions();

describe("localisation union classification", () => {
  it("finds every localisation position the rules declare", () => {
    // A floor rather than an exact count: the point is that the walk reaches
    // the whole rule set, so a vendored-rules update that adds positions does
    // not have to touch this number to keep the audit honest.
    expect(POSITIONS.length).toBeGreaterThan(600);
    expect(POSITIONS.map((position) => position.where)).toContain(
      "trigger:custom_tooltip.fail_text"
    );
    expect(POSITIONS.map((position) => position.where)).toContain("effect:set_name");
    expect(POSITIONS.map((position) => position.where)).toContain(
      "body:event.<subtype>.option.name"
    );
  });

  it("gives every arm beside a localisation key a distinguishable spelling", () => {
    const ambiguous = POSITIONS.filter((position) =>
      position.types.some((type) => classifyArm(type) === "ambiguous")
    ).map((position) => `${position.where}: ${position.types.map(describeType).join(" | ")}`);
    expect(ambiguous).toEqual([]);
  });

  it("classifies the mixed positions the audit accounts for", () => {
    const mixed = POSITIONS.filter((position) =>
      position.types.some((type) => type.kind !== "localisation")
    );
    const kinds = new Set(
      mixed.flatMap((position) => position.types.map(classifyArm)).filter((kind) => kind !== "pure")
    );
    // Exactly the arm kinds the runtime has a spelling for. A new kind here is
    // a real decision — a new authored form, or a field kept out of the
    // localization surface — not something to widen away.
    expect([...kinds].sort()).toEqual([
      "block",
      "content-reference",
      "raw-scalar",
      "scope",
      "sentinel",
    ]);
  });

  it("refuses to lower a localisation union holding a bare-string enum arm", () => {
    const emitter = new Emitter(rules);
    expect(() =>
      emitter.lowerer.unionFor([{ kind: "localisation" }, { kind: "enum", name: "research_area" }])
    ).toThrow(/whose members are bare strings/);
  });

  it("lowers a raw scalar arm as literal text and a reference arm without a string escape", () => {
    const emitter = new Emitter(rules);
    const rawScalar = emitter.lowerer.unionFor([{ kind: "localisation" }, { kind: "scalar" }]);
    expect(rawScalar === null ? null : emitter.typeOf(rawScalar)).toBe(
      "LocalizationInput | LiteralText"
    );
    expect(rawScalar?.localizationInput).toBe(true);

    const reference = emitter.lowerer.unionFor([
      { kind: "localisation" },
      { kind: "typeRef", name: "job" },
    ]);
    expect(reference === null ? null : emitter.typeOf(reference)).toBe(
      "LocalizationInput | JobRef"
    );
    expect(reference?.objectKinds).toContain("typed-ref");
  });

  it("keeps engine sentinels out of the display-text arm", () => {
    const emitter = new Emitter(rules);
    const value = emitter.lowerer.unionFor([
      { kind: "literal", text: "default" },
      { kind: "localisation" },
    ]);
    expect(value?.localizationLiterals).toEqual(["default"]);
  });
});

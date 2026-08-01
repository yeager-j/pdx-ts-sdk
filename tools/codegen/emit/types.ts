/**
 * Maps a rule type onto a TypeScript type and the expression that turns a
 * value of that type back into something the PDXScript AST accepts.
 */

import type { RuleType } from "../cwt/model.ts";
import { scopeIndex, type RuleSet } from "../cwt/rules.ts";
import { pascalCase } from "../naming.ts";

export interface TsValue {
  readonly type: string;
  /** Given an expression of that type, yields an expression the AST accepts. */
  readonly toScalar: (expression: string) => string;
}

export interface Usage {
  readonly enums: string[];
  readonly refs: string[];
  readonly valueSets: string[];
}

export class Emitter {
  readonly rules: RuleSet;
  /** Everything referenced anywhere, so `enums.ts` and `refs.ts` declare it. */
  readonly usedEnums = new Set<string>();
  readonly usedRefs = new Set<string>();
  readonly usedValueSets = new Set<string>();
  private scopedEnums = new Set<string>();
  private scopedRefs = new Set<string>();
  private scopedValueSets = new Set<string>();
  private readonly scopes: ReadonlyMap<string, string>;

  constructor(rules: RuleSet) {
    this.rules = rules;
    this.scopes = scopeIndex(rules);
  }

  /**
   * Resolves a scope name to its canonical form, or `null` when no scope by that
   * name exists. Rules write whichever alias reads best — `## push_scope = trait`
   * for the scope `scopes.cwt` calls `"Species trait"` — so nothing may reach the
   * emitted types without going through here.
   */
  canonicalScope(name: string): string | null {
    return this.scopes.get(name.toLowerCase()) ?? null;
  }

  /** Starts recording what a single output file references, so it can import it. */
  beginFile(): void {
    this.scopedEnums = new Set();
    this.scopedRefs = new Set();
    this.scopedValueSets = new Set();
  }

  endFile(): Usage {
    return {
      enums: [...this.scopedEnums],
      refs: [...this.scopedRefs],
      valueSets: [...this.scopedValueSets],
    };
  }

  enumTypeName(name: string): string {
    return pascalCase(name);
  }

  refTypeName(name: string): string {
    return `${pascalCase(name)}Ref`;
  }

  valueSetTypeName(name: string): string {
    return pascalCase(name);
  }

  /** Returns `null` for rule types that have no sensible scalar representation. */
  valueFor(type: RuleType): TsValue | null {
    switch (type.kind) {
      case "bool":
        return { type: "boolean", toScalar: (e) => e };
      case "int":
      case "float":
      case "valueField":
        return { type: "number", toScalar: (e) => e };
      case "scalar":
      case "localisation":
      case "filepath":
      case "icon":
      case "colour":
        return { type: "string", toScalar: (e) => e };
      case "valueSet": {
        this.usedValueSets.add(type.name);
        this.scopedValueSets.add(type.name);
        return { type: this.valueSetTypeName(type.name), toScalar: (e) => e };
      }
      case "scope":
      case "scopeGroup":
        return { type: "string", toScalar: (e) => e };
      case "literal":
        return { type: JSON.stringify(type.text), toScalar: (e) => e };
      case "enum": {
        if (!this.rules.enums.has(type.name)) {
          return { type: "string", toScalar: (e) => e };
        }
        this.usedEnums.add(type.name);
        this.scopedEnums.add(type.name);
        return { type: this.enumTypeName(type.name), toScalar: (e) => e };
      }
      case "typeRef": {
        this.usedRefs.add(type.name);
        this.scopedRefs.add(type.name);
        const name = this.refTypeName(type.name);
        return { type: `${name} | string`, toScalar: (e) => `refId(${e})` };
      }
      default:
        return null;
    }
  }

  /** Collapses an overloaded rule into one signature, or `null` if it cannot. */
  unionFor(types: readonly RuleType[]): TsValue | null {
    const values = types.map((type) => this.valueFor(type));
    if (values.some((value) => value === null)) {
      return null;
    }
    // Split compound members (`XRef | string`) so `string` dedupes across
    // arms instead of repeating in the joined union.
    const parts = [...new Set(values.flatMap((value) => value!.type.split(" | ")))];
    const converts = new Set(values.map((value) => value!.toScalar("x")));
    if (converts.size > 1) {
      return { type: parts.join(" | "), toScalar: (e) => `refId(${e})` };
    }
    return { type: parts.join(" | "), toScalar: values[0]!.toScalar };
  }
}

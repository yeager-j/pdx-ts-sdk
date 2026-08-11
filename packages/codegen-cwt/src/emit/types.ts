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
  /**
   * The content types a value of this shape references, when *every* form it
   * admits is a `<type>` reference. Carried into the emitted field metadata so
   * the runtime knows which registry an id belongs to, not merely that it is an
   * id — a technology named as a prerequisite has to be a built technology.
   *
   * Undefined the moment one arm is not a reference: `<technology_tier> | int`
   * admits plain numbers and scalars, so an id-shaped value in it proves
   * nothing about any registry.
   */
  readonly refTypes?: readonly string[];
  /**
   * Every scalar this shape admits, spelled as the game writes it, when the
   * rules close the set: a literal, a bool, or an enum with members. Undefined
   * for open shapes (`scalar`, `int`, a `<type>` reference, an enum CWT
   * declares without listing its values).
   *
   * Spelled in game rather than TypeScript terms — `yes`/`no`, not
   * `true`/`false` — because the only thing that reads it compares against
   * values parsed out of the shipped game files.
   */
  readonly literals?: readonly string[];
  /**
   * Literal boolean tokens this shape admits, including when another arm makes
   * the overall value domain open. Effect metadata uses this at runtime to
   * distinguish a rule-declared `yes`/`no` token from an arbitrary string
   * whose spelling happens to match one.
   */
  readonly booleanLiterals?: readonly ("yes" | "no")[];
  /**
   * True for `value_field`/`int_value_field` only: the emitted expression is
   * a `ScriptValue`, not a plain scalar, so a `@name` scripted-variable input
   * needs `scriptValueScalar` (`trigger-core.ts`) around it before it reaches
   * `kv()` — passed through unchanged, pdxscript's serializer quotes it
   * defensively (round-trip safety for a `str` node), which the game would
   * read as a literal string rather than evaluating the variable.
   *
   * Kept separate from `toScalar` deliberately: `toScalar` stays the
   * identity function for `valueField` (`(e) => e`) so `conversionFor`
   * elsewhere, which reads `toScalar("x") === "x"` to tell an "identity"
   * field from a "ref" one, keeps classifying it correctly. Wrapping the
   * *emitted expression* in a codegen-time template here would corrupt that
   * unrelated signal.
   */
  readonly scriptValue?: true;
}

export interface Usage {
  readonly enums: string[];
  readonly refs: string[];
  readonly valueSets: string[];
}

/**
 * A `scope[X]`/`scope_group[G]` arm, spelled without spaces inside the type
 * argument so {@link Emitter.unionFor}'s `" | "` split cannot cut a group's
 * members apart. The output is written through Prettier, which puts the spaces
 * back.
 */
const SCOPE_ARM = /^ScopeValue(?:<(.+)>)?$/;

function scopeValueType(scopes: readonly string[]): string {
  return `ScopeValue<${scopes.map((scope) => JSON.stringify(scope)).join("|")}>`;
}

/**
 * Collapses several scope arms into one: `ScopeValue<"planet"> |
 * ScopeValue<"ship">` becomes `ScopeValue<"planet"|"ship">`.
 *
 * Rules overload a scope-valued field by writing one declaration per scope
 * (`create_species.gender` names two groups and two bare scopes), and the
 * un-collapsed union is both unreadable and needlessly strict — a value whose
 * own type is already a union of those scopes assigns to the collapsed form
 * and to none of the arms. A bare `ScopeValue` arm says every scope is legal,
 * so it swallows the rest.
 */
function mergeScopeArms(parts: readonly string[]): string[] {
  const arms = parts.filter((part) => SCOPE_ARM.test(part));
  if (arms.length <= 1) {
    return [...parts];
  }
  const members = arms.map((arm) => SCOPE_ARM.exec(arm)![1]);
  const merged = members.includes(undefined)
    ? "ScopeValue"
    : `ScopeValue<${[...new Set(members.flatMap((member) => member!.split("|")))].sort().join("|")}>`;
  const first = parts.findIndex((part) => SCOPE_ARM.test(part));
  return parts.flatMap((part, index) =>
    !SCOPE_ARM.test(part) ? [part] : index === first ? [merged] : []
  );
}

export class Emitter {
  readonly rules: RuleSet;
  /** Everything referenced anywhere, so `enums.ts` and `refs.ts` declare it. */
  readonly usedEnums = new Set<string>();
  readonly usedRefs = new Set<string>();
  readonly usedValueSets = new Set<string>();
  /**
   * `scope[X]` and `scope_group[G]` arguments the rules name and `scopes.cwt`
   * does not declare. Each one keeps its field at `string` rather than
   * guessing a scope, and the codegen report prints them so the widening is
   * never silent.
   */
  readonly unknownScopes = new Set<string>();
  readonly unknownScopeGroups = new Set<string>();
  /** Scope groups actually lowered into a signature, for the report. */
  readonly usedScopeGroups = new Set<string>();
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
        return { type: "boolean", toScalar: (e) => e, literals: ["yes", "no"] };
      case "int":
      case "float":
        return { type: "number", toScalar: (e) => e };
      case "valueField":
        // CWT's `value_field`/`int_value_field` admit a literal number, a
        // scripted variable, a `scope.variable` path, `value:<script_value>`,
        // or `trigger:<name>` — a strictly wider domain than `float`/`int`,
        // which is why the rules give it its own `RuleType` kind rather than
        // folding it into one of those. `ScriptValue` already includes
        // `number` as an arm, so every existing numeric call site keeps
        // typechecking unchanged; only the non-numeric forms are new.
        return { type: "ScriptValue", toScalar: (e) => e, scriptValue: true };
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
      // `scope[X]` and `scope_group[G]` both name a scope the author has to
      // reach by a path the game can follow — `this`, `from`, an event target
      // — which is exactly what a `ScopeValue` is. There is deliberately no
      // `| string` arm: a bare word here is a scope name the compiler cannot
      // check, and the SDK has typed spellings for every path it supports.
      case "scope": {
        const argument = type.name.toLowerCase();
        if (argument === "any" || argument === "all") {
          return { type: "ScopeValue", toScalar: (e) => `${e}.path` };
        }
        const canonical = this.canonicalScope(type.name);
        if (canonical === null) {
          this.unknownScopes.add(type.name);
          return { type: "string", toScalar: (e) => e };
        }
        return { type: scopeValueType([canonical]), toScalar: (e) => `${e}.path` };
      }
      case "scopeGroup": {
        const members = this.rules.scopeGroups.get(type.name);
        if (members === undefined) {
          this.unknownScopeGroups.add(type.name);
          return { type: "string", toScalar: (e) => e };
        }
        const canonical = members.map((member) => this.canonicalScope(member));
        if (canonical.includes(null)) {
          for (const [index, member] of members.entries()) {
            if (canonical[index] === null) {
              this.unknownScopes.add(member);
            }
          }
          this.unknownScopeGroups.add(type.name);
          return { type: "string", toScalar: (e) => e };
        }
        this.usedScopeGroups.add(type.name);
        const scopes = [...new Set(canonical as string[])].sort();
        return { type: scopeValueType(scopes), toScalar: (e) => `${e}.path` };
      }
      case "literal":
        return {
          type: JSON.stringify(type.text),
          toScalar: (e) => e,
          literals: [type.text],
          ...(type.text === "yes" || type.text === "no" ? { booleanLiterals: [type.text] } : {}),
        };
      case "enum": {
        const members = this.rules.enums.get(type.name);
        if (members === undefined) {
          return { type: "string", toScalar: (e) => e };
        }
        this.usedEnums.add(type.name);
        this.scopedEnums.add(type.name);
        return {
          type: this.enumTypeName(type.name),
          toScalar: (e) => e,
          // An enum CWT names but never populates emits as bare `string`, so
          // its set is open however the rules spell it.
          ...(members.length > 0 ? { literals: members } : {}),
        };
      }
      case "typeRef": {
        this.usedRefs.add(type.name);
        this.scopedRefs.add(type.name);
        const name = this.refTypeName(type.name);
        return { type: `${name} | string`, toScalar: (e) => `refId(${e})`, refTypes: [type.name] };
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
    const parts = mergeScopeArms([...new Set(values.flatMap((value) => value!.type.split(" | ")))]);
    const converts = new Set(values.map((value) => value!.toScalar("x")));
    // Only an all-reference overload keeps its target types: one non-reference
    // arm makes an id-shaped value legal for reasons the registries cannot see.
    const refTypes = values.every((value) => value!.refTypes !== undefined)
      ? [...new Set(values.flatMap((value) => [...value!.refTypes!]))]
      : undefined;
    // One open arm opens the whole union, the same rule `refTypes` follows: a
    // scalar arm makes every value legal, so the closed arms prove nothing.
    const literals = values.every((value) => value!.literals !== undefined)
      ? [...new Set(values.flatMap((value) => [...value!.literals!]))]
      : undefined;
    const booleanLiterals = [...new Set(values.flatMap((value) => value!.booleanLiterals ?? []))];
    if (converts.size > 1) {
      return {
        type: parts.join(" | "),
        toScalar: (e) => `refId(${e})`,
        refTypes,
        literals,
        ...(booleanLiterals.length === 0 ? {} : { booleanLiterals }),
      };
    }
    // Propagated only on this branch: `refId(e)` above is not `scriptValueScalar`-
    // wrappable, and a value_field arm overloaded alongside a typeRef is not a
    // shape the real rules exercise.
    const scriptValue = values.every((value) => value!.scriptValue === true) ? true : undefined;
    return {
      type: parts.join(" | "),
      toScalar: values[0]!.toScalar,
      refTypes,
      literals,
      ...(booleanLiterals.length === 0 ? {} : { booleanLiterals }),
      ...(scriptValue === undefined ? {} : { scriptValue }),
    };
  }
}

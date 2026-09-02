/**
 * Maps a rule type onto a TypeScript type and the expression that turns a
 * value of that type back into something the PDXScript AST accepts.
 */

import type { RuleSet } from "../cwt/rules.ts";
import { ValueLowerer, type LoweredValue } from "../lower/value.ts";
import { pascalCase } from "../naming.ts";
import { OverlayAudit } from "../overlay/audit.ts";
import { ImportRecorder, knownSymbol, type SymbolKind } from "../render/symbols.ts";
import type { Usage } from "../render/usage.ts";

/** The symbols and generated aliases referenced while emitting one output file. */
export type { Usage } from "../render/usage.ts";

/**
 * A `scope[X]`/`scope_group[G]` arm, spelled without spaces inside the type
 * argument so type-union projection cannot cut a group's
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
  const scopeArms = parts.flatMap((part, index) => {
    const match = SCOPE_ARM.exec(part);
    return match === null ? [] : [{ index, typeArgument: match[1] }];
  });
  const firstScopeArm = scopeArms[0];
  if (firstScopeArm === undefined || scopeArms.length === 1) {
    return [...parts];
  }
  const typeArguments = scopeArms.map((arm) => arm.typeArgument);
  const hasUnrestrictedScopeArm = typeArguments.includes(undefined);
  const scopeMembers = typeArguments.flatMap((argument) => argument?.split("|") ?? []);
  const mergedScopeArm = hasUnrestrictedScopeArm
    ? "ScopeValue"
    : `ScopeValue<${[...new Set(scopeMembers)].sort().join("|")}>`;
  const scopeArmIndexes = new Set(scopeArms.map((arm) => arm.index));
  return parts.flatMap((part, index) => {
    if (index === firstScopeArm.index) {
      return [mergedScopeArm];
    }
    return scopeArmIndexes.has(index) ? [] : [part];
  });
}

/** The generated module one alias category's interface and field table live in. */
export function aliasCategoryModule(category: string): string {
  return `./${category.replaceAll("_", "-")}.ts`;
}

/**
 * Projects lowered semantic values into TypeScript and records every generated symbol used.
 * Create one emitter per codegen run, and bracket each file with {@link Emitter.beginFile} and
 * {@link Emitter.endFile}.
 */
export class Emitter {
  /** The parsed CWT rules that provide enum, reference, and scope definitions. */
  readonly rules: RuleSet;
  /** The render-free CWT value and scope interpreter composed by this emitter. */
  readonly lowerer: ValueLowerer;
  /**
   * Overlay rows consumed during this codegen run.
   * The entrypoint checks this audit for stale rows; see `overlay/audit.ts` for its run-local contract.
   */
  readonly overlayAudit = new OverlayAudit();
  /** Enum aliases used anywhere in the current codegen run. */
  readonly usedEnums: Set<string>;
  /** Content-reference aliases used anywhere in the current codegen run. */
  readonly usedRefs: Set<string>;
  /** Value-set aliases used anywhere in the current codegen run. */
  readonly usedValueSets: Set<string>;
  private scopedEnums = new Set<string>();
  private scopedRefs = new Set<string>();
  private scopedValueSets = new Set<string>();
  private scopedImports = new ImportRecorder();
  private selfAliasCategory: string | undefined;
  private loweringNameUseCursor = 0;

  /** Creates a run-scoped emitter over one parsed CWT rule set. */
  constructor(rules: RuleSet) {
    this.rules = rules;
    this.lowerer = new ValueLowerer(rules);
    this.usedEnums = this.lowerer.usedEnums;
    this.usedRefs = this.lowerer.usedRefs;
    this.usedValueSets = this.lowerer.usedValueSets;
  }

  /**
   * Resets per-file usage recording before an output module is emitted.
   * Pass the module's alias category so self-references do not create self-imports.
   */
  beginFile(aliasCategory?: string): void {
    this.scopedEnums = new Set();
    this.scopedRefs = new Set();
    this.scopedValueSets = new Set();
    this.scopedImports = new ImportRecorder();
    this.selfAliasCategory = aliasCategory;
    this.loweringNameUseCursor = this.lowerer.nameUseCursor();
  }

  /** Returns a detached snapshot of the imports and aliases recorded for the current file. */
  endFile(): Usage {
    for (const use of this.lowerer.nameUsesSince(this.loweringNameUseCursor)) {
      const names =
        use.kind === "enum"
          ? this.scopedEnums
          : use.kind === "reference"
            ? this.scopedRefs
            : this.scopedValueSets;
      names.add(use.name);
    }
    return {
      enums: [...this.scopedEnums],
      refs: [...this.scopedRefs],
      valueSets: [...this.scopedValueSets],
      imports: this.scopedImports.snapshot(),
    };
  }

  /**
   * Records a fixed SDK symbol for the current output file and returns its spelling.
   * Throws for unknown names; use {@link Emitter.useFrom} for computed symbols.
   */
  use(name: string): string {
    const symbol = knownSymbol(
      name,
      "Add it there, or use `useFrom` for a name the generator computes."
    );
    this.scopedImports.add(symbol.module, name, symbol.kind);
    return name;
  }

  /**
   * Records and returns a computed symbol whose source module the caller knows.
   * Use this for generated names such as `ParsedTechnology` that are not in the fixed symbol table.
   */
  useFrom(module: string, name: string, kind: SymbolKind): string {
    this.scopedImports.add(module, name, kind);
    return name;
  }

  /** Renders a lowered value's authoring type and records its generated imports. */
  typeOf(value: LoweredValue): string {
    const parts = value.types.flatMap((type) => {
      switch (type.kind) {
        case "primitive":
          return [type.name];
        case "sdk":
          return [this.use(type.name)];
        case "literal":
          return [JSON.stringify(type.value)];
        case "scope":
          this.use("ScopeValue");
          return [type.scopes === "any" ? "ScopeValue" : scopeValueType(type.scopes)];
        case "enum":
          this.usedEnums.add(type.name);
          this.scopedEnums.add(type.name);
          return [this.enumTypeName(type.name)];
        case "reference":
          this.usedRefs.add(type.name);
          this.scopedRefs.add(type.name);
          return [
            type.unchecked
              ? `${this.refTypeName(type.name)} | string`
              : this.refTypeName(type.name),
          ];
        case "valueSet":
          this.usedValueSets.add(type.name);
          this.scopedValueSets.add(type.name);
          return [this.valueSetTypeName(type.name)];
      }
    });
    return mergeScopeArms([...new Set(parts.flatMap((part) => part.split(" | ")))]).join(" | ");
  }

  /** Renders the scalar conversion expression and records any helper import. */
  scalarExpression(value: LoweredValue, expression: string): string {
    switch (value.conversion) {
      case "identity":
        return expression;
      case "refId":
        return `${this.use("refId")}(${expression})`;
      case "stringRefId":
        return `String(${this.use("refId")}(${expression}))`;
      case "scopePath":
        return `${this.use("scopeValueScalar")}(${expression})`;
      case "literalText":
        return `${expression}.text`;
    }
  }

  /**
   * Records a reference to another alias category's generated interface.
   * It adds both the type import and registration side-effect import; self-references add neither.
   */
  useAliasCategory(category: string, typeName: string): string {
    if (category !== this.selfAliasCategory) {
      const module = aliasCategoryModule(category);
      this.scopedImports.add(module, typeName, "type");
      this.scopedImports.addSideEffect(module);
    }
    return typeName;
  }

  /**
   * Merges run-wide symbol and scope usage from an isolated child emitter.
   * Per-file imports stay local to the emitter that writes the corresponding file.
   */
  absorb(other: Emitter): void {
    this.lowerer.absorbUsage(other.lowerer);
    for (const name of other.usedEnums) {
      this.scopedEnums.add(name);
    }
    for (const name of other.usedRefs) {
      this.scopedRefs.add(name);
    }
    for (const name of other.usedValueSets) {
      this.scopedValueSets.add(name);
    }
  }

  /** Returns the generated TypeScript type name for a CWT enum. */
  enumTypeName(name: string): string {
    return pascalCase(name);
  }

  /** Returns the generated branded-reference type name for a CWT content type. */
  refTypeName(name: string): string {
    return `${pascalCase(name)}Ref`;
  }

  /** Returns the generated TypeScript type name for a CWT value set. */
  valueSetTypeName(name: string): string {
    return pascalCase(name);
  }
}

/**
 * Maps a rule type onto a TypeScript type and the expression that turns a
 * value of that type back into something the PDXScript AST accepts.
 */

import type { RuleType } from "../cwt/model.ts";
import { scopeGroupIndex, scopeIndex, type RuleSet } from "../cwt/rules.ts";
import type { LoweringContext } from "../lower/context.ts";
import { referenceTargetsOf, type LoweredValue, type ScalarConversion } from "../lower/value.ts";
import { pascalCase } from "../naming.ts";
import { OverlayAudit } from "../overlay/audit.ts";
import { COMPLEX_ENUM_REFERENCE_OVERLAYS } from "../overlay/index.ts";
import { ImportRecorder, knownSymbol, type SymbolKind } from "../render/symbols.ts";
import type { Usage } from "../render/usage.ts";

export { contentConversionOf, recordsLocalization, referenceTargetsOf } from "../lower/value.ts";
export type { LoweredValue as TsValue, ScalarObjectKind } from "../lower/value.ts";

/** The symbols and generated aliases referenced while emitting one output file. */
export type { Usage } from "../render/usage.ts";

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
 * Lowers CWT value types and records every generated symbol used by each output file.
 * Create one emitter per codegen run, and bracket each file with {@link Emitter.beginFile} and
 * {@link Emitter.endFile}.
 */
export class Emitter implements LoweringContext {
  /** The parsed CWT rules that provide enum, reference, and scope definitions. */
  readonly rules: RuleSet;
  /**
   * Overlay rows consumed during this codegen run.
   * The entrypoint checks this audit for stale rows; see `overlay/audit.ts` for its run-local contract.
   */
  readonly overlayAudit = new OverlayAudit();
  /** Enum aliases used anywhere in the current codegen run. */
  readonly usedEnums = new Set<string>();
  /** Content-reference aliases used anywhere in the current codegen run. */
  readonly usedRefs = new Set<string>();
  /** Value-set aliases used anywhere in the current codegen run. */
  readonly usedValueSets = new Set<string>();
  /**
   * Scope names used by rules but absent from `scopes.cwt`.
   * Their fields widen to `string`, and the codegen report exposes each fallback.
   */
  readonly unknownScopes = new Set<string>();
  /** Scope groups that are absent or contain a scope the parsed rules do not declare. */
  readonly unknownScopeGroups = new Set<string>();
  /** Scope groups actually lowered into a signature, for the report. */
  readonly usedScopeGroups = new Set<string>();
  private scopedEnums = new Set<string>();
  private scopedRefs = new Set<string>();
  private scopedValueSets = new Set<string>();
  private scopedImports = new ImportRecorder();
  private selfAliasCategory: string | undefined;
  private readonly scopes: ReadonlyMap<string, string>;
  private readonly scopeGroups: ReadonlyMap<string, readonly string[]>;

  /** Creates a run-scoped emitter over one parsed CWT rule set. */
  constructor(rules: RuleSet) {
    this.rules = rules;
    this.scopes = scopeIndex(rules);
    this.scopeGroups = scopeGroupIndex(rules);
  }

  /**
   * Resolves a case-insensitive CWT scope alias to its canonical name.
   * Returns `null` when the parsed scope table has no matching declaration.
   */
  canonicalScope(name: string): string | null {
    return this.scopes.get(name.toLowerCase()) ?? null;
  }

  /**
   * The scopes one `scope_groups` entry admits, matched case-insensitively, or
   * `null` when no group has that name. Members are as `scopes.cwt` spells
   * them, not canonicalized.
   */
  scopeGroup(name: string): readonly string[] | null {
    return this.scopeGroups.get(name.toLowerCase()) ?? null;
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
  }

  /** Returns a detached snapshot of the imports and aliases recorded for the current file. */
  endFile(): Usage {
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

  /** Compatibility adapter for existing emission call sites. */
  useValue(value: LoweredValue): { readonly type: string } {
    return { type: this.typeOf(value) };
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
        return `${expression}.path`;
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
    for (const name of other.usedEnums) {
      this.usedEnums.add(name);
      this.scopedEnums.add(name);
    }
    for (const name of other.usedRefs) {
      this.usedRefs.add(name);
      this.scopedRefs.add(name);
    }
    for (const name of other.usedValueSets) {
      this.usedValueSets.add(name);
      this.scopedValueSets.add(name);
    }
    for (const name of other.unknownScopes) {
      this.unknownScopes.add(name);
    }
    for (const name of other.unknownScopeGroups) {
      this.unknownScopeGroups.add(name);
    }
    for (const name of other.usedScopeGroups) {
      this.usedScopeGroups.add(name);
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

  /**
   * Lowers one rule type and records any enum, reference, value-set, or scope usage it introduces.
   * Returns `null` when the rule has no sensible scalar representation.
   */
  valueFor(type: RuleType, inLocalisationUnion = false): LoweredValue | null {
    const value = this.lowerValueFor(type, inLocalisationUnion);
    if (value !== null) {
      this.recordGeneratedValueNames(value);
    }
    return value;
  }

  private recordGeneratedValueNames(value: LoweredValue): void {
    for (const type of value.types) {
      switch (type.kind) {
        case "enum":
          this.usedEnums.add(type.name);
          this.scopedEnums.add(type.name);
          break;
        case "reference":
          this.usedRefs.add(type.name);
          this.scopedRefs.add(type.name);
          break;
        case "valueSet":
          this.usedValueSets.add(type.name);
          this.scopedValueSets.add(type.name);
          break;
      }
    }
  }

  private lowerValueFor(type: RuleType, inLocalisationUnion: boolean): LoweredValue | null {
    if (inLocalisationUnion) {
      const beside = this.valueBesideLocalisation(type);
      if (beside !== undefined) {
        return beside;
      }
    }
    switch (type.kind) {
      case "bool":
        return {
          types: [{ kind: "primitive", name: "boolean" }],
          conversion: "identity",
          literals: ["yes", "no"],
        };
      case "int":
      case "float":
        return { types: [{ kind: "primitive", name: "number" }], conversion: "identity" };
      case "valueField":
        // CWT's `value_field`/`int_value_field` admit a literal number, a
        // scripted variable, a `scope.variable` path, `value:<script_value>`,
        // or `trigger:<name>` — a strictly wider domain than `float`/`int`,
        // which is why the rules give it its own `RuleType` kind rather than
        // folding it into one of those. `ScriptValue` already includes
        // `number` as an arm, so every existing numeric call site keeps
        // typechecking unchanged; only the non-numeric forms are new.
        return {
          types: [{ kind: "sdk", name: "ScriptValue" }],
          conversion: "identity",
          scriptValue: true,
        };
      // Display text or a reference — one input for every position that stores
      // a key. A bare string is the English text and never a key: an existing
      // key has four spellings that mint a reference (`mod.localization()`, a
      // definition's `loc` member, `vanilla.localization()`,
      // `external.localization()`), so a fifth unchecked one would say nothing
      // the others do not. Inline text recorded by script defers its key until
      // the splice into a definition, an event, or a patch supplies an owner.
      case "localisation":
        return {
          types: [{ kind: "sdk", name: "LocalizationInput" }],
          conversion: "refId",
          objectKinds: ["localization-ref", "localized-text"],
          localizationInput: true,
        };
      case "scalar":
      case "filepath":
      case "icon":
      case "colour":
        return { types: [{ kind: "primitive", name: "string" }], conversion: "identity" };
      case "valueSet": {
        return {
          types: [{ kind: "valueSet", name: type.name }],
          conversion: "identity",
        };
      }
      // `scope[X]` and `scope_group[G]` both name a scope the author has to
      // reach by a path the game can follow — `this`, `from`, an event target
      // — which is exactly what a `ScopeValue` is. There is deliberately no
      // `| string` arm: a bare word here is a scope name the compiler cannot
      // check, and the SDK has typed spellings for every path it supports.
      case "scope": {
        const argument = type.name.toLowerCase();
        if (argument === "any" || argument === "all") {
          return {
            types: [{ kind: "scope", scopes: "any" }],
            conversion: "scopePath",
            objectKinds: ["scope-ref"],
          };
        }
        const canonical = this.canonicalScope(type.name);
        if (canonical === null) {
          this.unknownScopes.add(type.name);
          return { types: [{ kind: "primitive", name: "string" }], conversion: "identity" };
        }
        return {
          types: [{ kind: "scope", scopes: [canonical] }],
          conversion: "scopePath",
          objectKinds: ["scope-ref"],
        };
      }
      case "scopeGroup": {
        const members = this.rules.scopeGroups.get(type.name);
        if (members === undefined) {
          this.unknownScopeGroups.add(type.name);
          return { types: [{ kind: "primitive", name: "string" }], conversion: "identity" };
        }
        const canonical = members.map((member) => this.canonicalScope(member));
        if (canonical.includes(null)) {
          for (const [index, member] of members.entries()) {
            if (canonical[index] === null) {
              this.unknownScopes.add(member);
            }
          }
          this.unknownScopeGroups.add(type.name);
          return { types: [{ kind: "primitive", name: "string" }], conversion: "identity" };
        }
        this.usedScopeGroups.add(type.name);
        const scopes = [
          ...new Set(canonical.filter((scope): scope is string => scope !== null)),
        ].sort();
        return {
          types: [{ kind: "scope", scopes }],
          conversion: "scopePath",
          objectKinds: ["scope-ref"],
        };
      }
      case "literal":
        return {
          types: [{ kind: "literal", value: type.text }],
          conversion: "identity",
          literals: [type.text],
          ...(type.text === "yes" || type.text === "no" ? { booleanLiterals: [type.text] } : {}),
        };
      case "enum": {
        const members = this.rules.enums.get(type.name);
        if (members === undefined) {
          return { types: [{ kind: "primitive", name: "string" }], conversion: "identity" };
        }
        const reference = COMPLEX_ENUM_REFERENCE_OVERLAYS.get(type.name);
        return {
          types: [{ kind: "enum", name: type.name }],
          conversion: reference === undefined ? "identity" : "stringRefId",
          ...(reference === undefined
            ? {}
            : {
                refTypes: [reference.target],
                objectKinds: ["typed-ref" as const],
              }),
          // An enum CWT names but never populates emits as bare `string`, so
          // its set is open however the rules spell it.
          ...(members.length > 0 ? { literals: members } : {}),
        };
      }
      case "typeRef": {
        return {
          types: [{ kind: "reference", name: type.name, unchecked: true }],
          conversion: "refId",
          refTypes: [type.name],
          objectKinds: ["typed-ref"],
        };
      }
      default:
        return null;
    }
  }

  /**
   * Re-lowers one arm of a union that also names a localisation key, so no arm
   * is left spelled as a bare `string`.
   *
   * A bare string now means English display text, so a second string-backed
   * arm in the same position would be two things at once with nothing to tell
   * them apart. Each such arm gets a runtime-distinguishable spelling instead:
   * raw displayed text becomes {@link LiteralText}, and a `<type>` reference
   * drops the escape-hatch `| string` in favour of `external.reference()`,
   * which is the same `{ id }` shape every branded reference already is.
   *
   * An arm with no such spelling is refused rather than reinterpreted or
   * dropped — see `tests/localisation-unions.test.ts`, which walks every
   * localisation union in the rules so a future CWT change cannot introduce
   * one unnoticed.
   *
   * Returns `undefined` for an arm that needs no adjustment.
   */
  private valueBesideLocalisation(type: RuleType): LoweredValue | undefined {
    switch (type.kind) {
      case "scalar":
      case "filepath":
      case "icon":
      case "colour":
        return {
          types: [{ kind: "sdk", name: "LiteralText" }],
          // `refId` does not handle LiteralText: it falls through to
          // `TypedRef.id` and would produce `undefined`. Every field emitted
          // from this arm also carries `locKey: true`, so `contentScalar`
          // short-circuits to `localizationScalar` before reading `conversion`;
          // the resolved value is a plain string, which `refId` returns unchanged.
          conversion: "literalText",
          objectKinds: ["literal-text"],
        };
      case "typeRef": {
        return {
          types: [{ kind: "reference", name: type.name, unchecked: false }],
          conversion: "refId",
          refTypes: [type.name],
          objectKinds: ["typed-ref"],
        };
      }
      case "enum":
      case "valueSet":
        throw new Error(
          `A localisation position is overloaded with ${type.kind}[${type.name}], whose members ` +
            "are bare strings: a string there would be both display text and one of those " +
            "names, with nothing to tell them apart. Give the arm a runtime-distinguishable " +
            "spelling, or keep the field out of the localization input surface."
        );
      default:
        return undefined;
    }
  }

  /**
   * Lowers an overloaded rule into one signature while recording every arm's usage.
   * Returns `null` when any arm has no sensible scalar representation.
   */
  unionFor(types: readonly RuleType[]): LoweredValue | null {
    const localisation = types.some((type) => type.kind === "localisation");
    const values = types.map((type) => this.valueFor(type, localisation));
    if (!values.every((value): value is LoweredValue => value !== null)) {
      return null;
    }
    const conversions = new Set(values.map((value) => value.conversion));
    const refTypes = referenceTargetsOf(types);
    // One open arm opens the whole union, the same rule `refTypes` follows: a
    // scalar arm makes every value legal, so the closed arms prove nothing.
    const literals = values.every((value) => value.literals !== undefined)
      ? [...new Set(values.flatMap((value) => [...value.literals!]))]
      : undefined;
    const booleanLiterals = [...new Set(values.flatMap((value) => value.booleanLiterals ?? []))];
    const objectKinds = [...new Set(values.flatMap((value) => value.objectKinds ?? []))];
    const firstValue = values[0]!;
    const conversionsDiffer = conversions.size > 1;
    // Propagated only when every conversion agrees: a mixed union uses `refId`,
    // which cannot be wrapped by `scriptValueScalar`. The real rules do not
    // overload a value_field arm alongside a typeRef.
    const scriptValue =
      !conversionsDiffer && values.every((value) => value.scriptValue === true) ? true : undefined;
    const conversion: ScalarConversion = conversionsDiffer ? "refId" : firstValue.conversion;
    // The sentinels a mixed localisation position keeps: `default` selects the
    // game's own fail text, `random` its own name generator, and neither is a
    // key the mod could supply. They keep precedence over English shorthand,
    // so `{ english: "default" }` is how the word itself is displayed.
    const localizationLiterals = localisation
      ? [...new Set(types.flatMap((type) => (type.kind === "literal" ? [type.text] : [])))]
      : [];
    return {
      types: values.flatMap((value) => value.types),
      conversion,
      refTypes,
      literals,
      ...(localisation ? { localizationInput: true as const } : {}),
      ...(localizationLiterals.length === 0 ? {} : { localizationLiterals }),
      ...(booleanLiterals.length === 0 ? {} : { booleanLiterals }),
      ...(scriptValue === undefined ? {} : { scriptValue }),
      ...(objectKinds.length === 0 ? {} : { objectKinds }),
    };
  }
}

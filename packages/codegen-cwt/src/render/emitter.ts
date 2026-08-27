/**
 * Maps a rule type onto a TypeScript type and the expression that turns a
 * value of that type back into something the PDXScript AST accepts.
 */

import type { RuleType } from "../cwt/model.ts";
import { scopeIndex, type RuleSet } from "../cwt/rules.ts";
import { pascalCase } from "../naming.ts";
import { OverlayAudit } from "../overlay/audit.ts";
import { COMPLEX_ENUM_REFERENCE_OVERLAYS } from "../overlay/index.ts";
import { ImportRecorder, knownSymbol, type FileImports, type SymbolKind } from "./symbols.ts";

/**
 * A lowered TypeScript value shape and the metadata needed to serialize it.
 * Emitters use this contract to write both author-facing types and runtime conversion metadata.
 */
export interface TsValue {
  /** The TypeScript type text written into generated declarations. */
  readonly type: string;
  /** Converts an expression of {@link TsValue.type} into a PDXScript scalar expression. */
  readonly toScalar: (expression: string) => string;
  /**
   * Content registries referenced when every admitted form is a typed reference.
   * Mixed or open forms leave this undefined so runtime validation does not infer false ownership.
   */
  readonly refTypes?: readonly string[];
  /**
   * Every admitted scalar token when the CWT rule defines a closed set.
   * Tokens use game spelling, including `yes` and `no`; open forms leave this undefined.
   */
  readonly literals?: readonly string[];
  /**
   * Rule-declared boolean tokens, retained even when another arm makes the value domain open.
   * Effect recording uses them to distinguish booleans from arbitrary strings with the same text.
   */
  readonly booleanLiterals?: readonly ("yes" | "no")[];
  /**
   * Marks `value_field` and `int_value_field` values that need `scriptValueScalar` before AST
   * serialization. Their scalar conversion remains the identity so conversion metadata stays
   * accurate.
   */
  readonly scriptValue?: true;
  /**
   * Structured SDK value forms accepted by this scalar shape.
   * Runtime recording uses these tags to select an object arm without guessing from JavaScript type.
   */
  readonly objectKinds?: readonly ScalarObjectKind[];
  /** SDK symbols spelled by {@link TsValue.type} that the output file must import. */
  readonly typeSymbols?: readonly string[];
  /**
   * SDK symbol called by {@link TsValue.toScalar}, when one is required.
   * This import is used by `emit/script/triggers.ts`, which writes conversion expressions.
   */
  readonly scalarSymbol?: string;
}

/** A runtime-discriminated object form accepted by a scalar field. */
export type ScalarObjectKind = "scope-ref" | "typed-ref" | "localization-ref";

/** The symbols and generated aliases referenced while emitting one output file. */
export interface Usage {
  /** CWT enum aliases referenced by the file. */
  readonly enums: string[];
  /** CWT content-reference aliases referenced by the file. */
  readonly refs: string[];
  /** CWT value-set aliases referenced by the file. */
  readonly valueSets: string[];
  /** Every SDK symbol the file's emitters declared a use of, by module. */
  readonly imports: FileImports;
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
 * The content registries an overloaded value's ids may name.
 *
 * An all-reference overload keeps its target types. A complex-enum overlay can
 * also retain its target beside exact literals, which are a closed spelling
 * exception rather than an open alternative. Other non-reference arms make an
 * id-shaped value legal for reasons the registries cannot see, so the result is
 * `undefined`. Names stay as the rules spell them, subtype qualifier included
 * (`agreement_term.discrete`).
 *
 * Separate from {@link Emitter.unionFor} because a position can carry the
 * registries without spelling the branded type — a map key lowers to `string`
 * — and asking this question must not record a use of a name the generated
 * file never writes.
 */
export function referenceTargetsOf(types: readonly RuleType[]): readonly string[] | undefined {
  const targetOf = (type: RuleType): string | undefined => {
    if (type.kind === "typeRef") {
      return type.name;
    }
    if (type.kind === "enum") {
      const overlay = COMPLEX_ENUM_REFERENCE_OVERLAYS.get(type.name);
      return overlay?.target;
    }
    return undefined;
  };
  const referenced = types.flatMap((type) => {
    const target = targetOf(type);
    return target === undefined ? [] : [target];
  });
  if (referenced.length === types.length) {
    return [...new Set(referenced)];
  }
  const isLiteralComplexEnumUnion =
    referenced.length > 0 &&
    types.some((type) => type.kind === "enum" && COMPLEX_ENUM_REFERENCE_OVERLAYS.has(type.name)) &&
    types.every(
      (type) =>
        type.kind === "literal" ||
        (type.kind === "enum" && COMPLEX_ENUM_REFERENCE_OVERLAYS.has(type.name))
    );
  return isLiteralComplexEnumUnion ? [...new Set(referenced)] : undefined;
}

/**
 * Lowers CWT value types and records every generated symbol used by each output file.
 * Create one emitter per codegen run, and bracket each file with {@link Emitter.beginFile} and
 * {@link Emitter.endFile}.
 */
export class Emitter {
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

  /** Creates a run-scoped emitter over one parsed CWT rule set. */
  constructor(rules: RuleSet) {
    this.rules = rules;
    this.scopes = scopeIndex(rules);
  }

  /**
   * Resolves a case-insensitive CWT scope alias to its canonical name.
   * Returns `null` when the parsed scope table has no matching declaration.
   */
  canonicalScope(name: string): string | null {
    return this.scopes.get(name.toLowerCase()) ?? null;
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

  /** Records every symbol a lowered value's type spells, then returns the same value for emission. */
  useValue(value: TsValue): TsValue {
    for (const name of value.typeSymbols ?? []) {
      this.use(name);
    }
    return value;
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
  valueFor(type: RuleType): TsValue | null {
    switch (type.kind) {
      case "bool":
        return {
          type: "boolean",
          toScalar: (expression) => expression,
          literals: ["yes", "no"],
        };
      case "int":
      case "float":
        return { type: "number", toScalar: (expression) => expression };
      case "valueField":
        // CWT's `value_field`/`int_value_field` admit a literal number, a
        // scripted variable, a `scope.variable` path, `value:<script_value>`,
        // or `trigger:<name>` — a strictly wider domain than `float`/`int`,
        // which is why the rules give it its own `RuleType` kind rather than
        // folding it into one of those. `ScriptValue` already includes
        // `number` as an arm, so every existing numeric call site keeps
        // typechecking unchanged; only the non-numeric forms are new.
        return {
          type: "ScriptValue",
          toScalar: (expression) => expression,
          scriptValue: true,
          typeSymbols: ["ScriptValue"],
        };
      // A recorded script argument keeps the game's own reading of a bare
      // string here — it is a key, since recorded script carries no identity
      // to mint one from — and additionally accepts a reference to one. A
      // key-typed *content* member reads a bare string as display text
      // instead (SDK-303) and spells its own type, so it does not use this.
      case "localisation":
        return {
          type: "string | LocalizationRef",
          toScalar: (expression) => `refId(${expression})`,
          objectKinds: ["localization-ref"],
          typeSymbols: ["LocalizationRef"],
          scalarSymbol: "refId",
        };
      case "scalar":
      case "filepath":
      case "icon":
      case "colour":
        return { type: "string", toScalar: (expression) => expression };
      case "valueSet": {
        this.usedValueSets.add(type.name);
        this.scopedValueSets.add(type.name);
        return {
          type: this.valueSetTypeName(type.name),
          toScalar: (expression) => expression,
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
            type: "ScopeValue",
            toScalar: (expression) => `${expression}.path`,
            objectKinds: ["scope-ref"],
            typeSymbols: ["ScopeValue"],
          };
        }
        const canonical = this.canonicalScope(type.name);
        if (canonical === null) {
          this.unknownScopes.add(type.name);
          return { type: "string", toScalar: (expression) => expression };
        }
        return {
          type: scopeValueType([canonical]),
          toScalar: (expression) => `${expression}.path`,
          objectKinds: ["scope-ref"],
          typeSymbols: ["ScopeValue"],
        };
      }
      case "scopeGroup": {
        const members = this.rules.scopeGroups.get(type.name);
        if (members === undefined) {
          this.unknownScopeGroups.add(type.name);
          return { type: "string", toScalar: (expression) => expression };
        }
        const canonical = members.map((member) => this.canonicalScope(member));
        if (canonical.includes(null)) {
          for (const [index, member] of members.entries()) {
            if (canonical[index] === null) {
              this.unknownScopes.add(member);
            }
          }
          this.unknownScopeGroups.add(type.name);
          return { type: "string", toScalar: (expression) => expression };
        }
        this.usedScopeGroups.add(type.name);
        const scopes = [
          ...new Set(canonical.filter((scope): scope is string => scope !== null)),
        ].sort();
        return {
          type: scopeValueType(scopes),
          toScalar: (expression) => `${expression}.path`,
          objectKinds: ["scope-ref"],
          typeSymbols: ["ScopeValue"],
        };
      }
      case "literal":
        return {
          type: JSON.stringify(type.text),
          toScalar: (expression) => expression,
          literals: [type.text],
          ...(type.text === "yes" || type.text === "no" ? { booleanLiterals: [type.text] } : {}),
        };
      case "enum": {
        const members = this.rules.enums.get(type.name);
        if (members === undefined) {
          return { type: "string", toScalar: (expression) => expression };
        }
        this.usedEnums.add(type.name);
        this.scopedEnums.add(type.name);
        const reference = COMPLEX_ENUM_REFERENCE_OVERLAYS.get(type.name);
        return {
          type: this.enumTypeName(type.name),
          toScalar:
            reference === undefined
              ? (expression) => expression
              : (expression) => `String(refId(${expression}))`,
          ...(reference === undefined
            ? {}
            : {
                refTypes: [reference.target],
                objectKinds: ["typed-ref" as const],
                scalarSymbol: "refId",
              }),
          // An enum CWT names but never populates emits as bare `string`, so
          // its set is open however the rules spell it.
          ...(members.length > 0 ? { literals: members } : {}),
        };
      }
      case "typeRef": {
        this.usedRefs.add(type.name);
        this.scopedRefs.add(type.name);
        const name = this.refTypeName(type.name);
        return {
          type: `${name} | string`,
          toScalar: (expression) => `refId(${expression})`,
          refTypes: [type.name],
          objectKinds: ["typed-ref"],
          scalarSymbol: "refId",
        };
      }
      default:
        return null;
    }
  }

  /**
   * Lowers an overloaded rule into one signature while recording every arm's usage.
   * Returns `null` when any arm has no sensible scalar representation.
   */
  unionFor(types: readonly RuleType[]): TsValue | null {
    const values = types.map((type) => this.valueFor(type));
    if (!values.every((value): value is TsValue => value !== null)) {
      return null;
    }
    // Split compound members (`XRef | string`) so `string` dedupes across
    // arms instead of repeating in the joined union.
    const parts = mergeScopeArms([...new Set(values.flatMap((value) => value.type.split(" | ")))]);
    const conversionProbe = "x";
    const conversionExpressions = new Set(values.map((value) => value.toScalar(conversionProbe)));
    const refTypes = referenceTargetsOf(types);
    // One open arm opens the whole union, the same rule `refTypes` follows: a
    // scalar arm makes every value legal, so the closed arms prove nothing.
    const literals = values.every((value) => value.literals !== undefined)
      ? [...new Set(values.flatMap((value) => [...value.literals!]))]
      : undefined;
    const booleanLiterals = [...new Set(values.flatMap((value) => value.booleanLiterals ?? []))];
    const objectKinds = [...new Set(values.flatMap((value) => value.objectKinds ?? []))];
    // Every arm's type survives into `parts` — `mergeScopeArms` collapses scope
    // arms into another scope arm and the `Set` only drops exact duplicates — so
    // the union of the arms' symbols is exactly what the joined type spells.
    const typeSymbols = [...new Set(values.flatMap((value) => value.typeSymbols ?? []))];
    const firstValue = values[0]!;
    const conversionsDiffer = conversionExpressions.size > 1;
    // Propagated only when every conversion agrees: a mixed union uses `refId`,
    // which cannot be wrapped by `scriptValueScalar`. The real rules do not
    // overload a value_field arm alongside a typeRef.
    const scriptValue =
      !conversionsDiffer && values.every((value) => value.scriptValue === true) ? true : undefined;
    const scalarSymbol = conversionsDiffer ? "refId" : firstValue.scalarSymbol;
    return {
      type: parts.join(" | "),
      toScalar: conversionsDiffer ? (expression) => `refId(${expression})` : firstValue.toScalar,
      refTypes,
      literals,
      ...(booleanLiterals.length === 0 ? {} : { booleanLiterals }),
      ...(scriptValue === undefined ? {} : { scriptValue }),
      ...(objectKinds.length === 0 ? {} : { objectKinds }),
      ...(typeSymbols.length === 0 ? {} : { typeSymbols }),
      ...(scalarSymbol === undefined ? {} : { scalarSymbol }),
    };
  }
}

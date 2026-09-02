/** Semantic value facts retained between CWT interpretation and TypeScript emission. */

import type { RuleType } from "../cwt/model.ts";
import type { RuleSet } from "../cwt/rules.ts";
import { COMPLEX_ENUM_REFERENCE_OVERLAYS } from "../overlay/index.ts";
import type { ContentConversion } from "./content-shape.ts";
import { ScopeResolver } from "./scopes.ts";

/**
 * How an authored value becomes a PDXScript scalar.
 *
 * Runtime metadata groups every non-identity conversion under `"ref"`, but
 * lowering must retain the finer distinction. `refId(x)`, `x.path`, and
 * `x.text` record alike while accepting different values; choosing one arm's
 * expression for another would serialize `undefined`.
 */
export type ScalarConversion = "identity" | "refId" | "stringRefId" | "scopePath" | "literalText";

/**
 * Projects a semantic conversion onto the runtime content descriptor vocabulary.
 *
 * Every non-identity conversion records as `"ref"` because `refId` implements
 * all of them at runtime. The distinctions above matter only while emission
 * chooses which expression to write.
 */
export function contentConversionOf(
  conversion: ScalarConversion
): Extract<ContentConversion, "identity" | "ref"> {
  return conversion === "identity" ? "identity" : "ref";
}

/** A runtime-discriminated object form accepted by a scalar field. */
export type ScalarObjectKind =
  "scope-ref" | "typed-ref" | "localization-ref" | "localized-text" | "literal-text";

/** One render-free authoring type selected by semantic lowering. */
export type LoweredAuthoringType =
  | { readonly kind: "primitive"; readonly name: "boolean" | "number" | "string" }
  | { readonly kind: "sdk"; readonly name: string }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "scope"; readonly scopes: readonly string[] | "any" }
  | { readonly kind: "enum"; readonly name: string }
  | { readonly kind: "reference"; readonly name: string; readonly unchecked: boolean }
  | { readonly kind: "valueSet"; readonly name: string };

/** A lowered authoring value and the semantic facts needed to serialize it. */
export interface LoweredValue {
  /** Authoring type arms retained without TypeScript source text. */
  readonly types: readonly LoweredAuthoringType[];
  /** Runtime scalar conversion selected by lowering. */
  readonly conversion: ScalarConversion;
  /**
   * Referenced registries when every admitted form is a typed reference.
   * Mixed or open forms omit this so validation does not infer false ownership.
   */
  readonly refTypes?: readonly string[];
  /**
   * Every admitted scalar token when the rule defines a closed set.
   * Open forms omit this; tokens keep the game's spelling, including `yes` and `no`.
   */
  readonly literals?: readonly string[];
  /**
   * Rule-declared boolean tokens retained inside otherwise open unions.
   * Recording uses them to distinguish booleans from strings with the same text.
   */
  readonly booleanLiterals?: readonly ("yes" | "no")[];
  /** Whether `value_field` inputs require `scriptValueScalar` before serialization. */
  readonly scriptValue?: true;
  /**
   * Structured SDK value forms accepted by this scalar shape.
   * Runtime recording uses these tags instead of guessing from JavaScript types.
   */
  readonly objectKinds?: readonly ScalarObjectKind[];
  /**
   * Whether this value is a localization input.
   * Its field path is supplied later, when emission constructs the runtime call.
   */
  readonly localizationInput?: true;
  /** Engine sentinels admitted beside a localization input. */
  readonly localizationLiterals?: readonly string[];
}

/** Whether a scalar admits a localization reference. */
export function recordsLocalization(value: LoweredValue): boolean {
  return value.objectKinds?.includes("localization-ref") === true;
}

/**
 * Returns the content registries an overloaded value's ids may name.
 *
 * An all-reference overload keeps its target types. A complex-enum overlay can
 * also retain its target beside exact literals, which are a closed spelling
 * exception rather than an open alternative. Other non-reference arms make an
 * id-shaped value legal for reasons the registries cannot see, so the result is
 * `undefined`. Names keep the rules' spelling, including subtype qualifiers.
 *
 * This query remains separate from {@link ValueLowerer.unionFor}: a position
 * can carry registries without spelling a branded authoring type, such as a map
 * key projected to `string`, and querying ownership must not record a generated
 * name that no output file writes.
 */
export function referenceTargetsOf(types: readonly RuleType[]): readonly string[] | undefined {
  const targetOf = (type: RuleType): string | undefined => {
    if (type.kind === "typeRef") {
      return type.name;
    }
    return type.kind === "enum"
      ? COMPLEX_ENUM_REFERENCE_OVERLAYS.get(type.name)?.target
      : undefined;
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

/** A generated-name use observed while lowering one scalar value. */
export interface LoweredValueNameUse {
  /** The generated alias family containing the name. */
  readonly kind: "enum" | "reference" | "valueSet";
  /** The CWT name that emission projects into a TypeScript identifier. */
  readonly name: string;
}

/**
 * Interprets CWT scalar declarations as render-free authoring values.
 *
 * The instance owns all run-scoped interpretation evidence: canonical scopes,
 * unknown names, selected groups, and generated alias uses. Emission composes
 * this class and projects its results without owning these decisions.
 */
export class ValueLowerer {
  /** Parsed CWT rules available to semantic classifiers. */
  readonly rules: RuleSet;
  /** Scope names used by rules but absent from `scopes.cwt`. */
  readonly unknownScopes = new Set<string>();
  /** Missing or invalid scope groups encountered during lowering. */
  readonly unknownScopeGroups = new Set<string>();
  /** Enum aliases selected during this lowering run. */
  readonly usedEnums = new Set<string>();
  /** Content-reference aliases selected during this lowering run. */
  readonly usedRefs = new Set<string>();
  /** Value-set aliases selected during this lowering run. */
  readonly usedValueSets = new Set<string>();
  private readonly scopes: ScopeResolver;
  private readonly nameUses: LoweredValueNameUse[] = [];

  /** Creates a run-scoped scalar lowerer over one parsed rule set. */
  constructor(rules: RuleSet) {
    this.rules = rules;
    this.scopes = new ScopeResolver(rules);
  }

  /** Scope groups selected by semantic lowering. */
  get usedScopeGroups(): Set<string> {
    return this.scopes.usedScopeGroups;
  }

  /** Resolves a case-insensitive CWT scope alias to its canonical name. */
  canonicalScope(name: string): string | null {
    return this.scopes.canonicalScope(name);
  }

  /** Resolves a case-insensitive CWT scope-group name to its declared members. */
  scopeGroup(name: string): readonly string[] | null {
    return this.scopes.scopeGroup(name);
  }

  /** Returns a cursor that can later delimit generated-name uses. */
  nameUseCursor(): number {
    return this.nameUses.length;
  }

  /** Returns generated-name uses recorded at or after a prior cursor. */
  nameUsesSince(cursor: number): readonly LoweredValueNameUse[] {
    return this.nameUses.slice(cursor);
  }

  /** Merges another run's generated-name inventory into this run. */
  absorbUsage(other: ValueLowerer): void {
    for (const name of other.usedEnums) {
      this.usedEnums.add(name);
    }
    for (const name of other.usedRefs) {
      this.usedRefs.add(name);
    }
    for (const name of other.usedValueSets) {
      this.usedValueSets.add(name);
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

  /**
   * Lowers one rule type and records any generated aliases it selects.
   * Returns `null` when the rule has no scalar authoring representation.
   */
  valueFor(type: RuleType, inLocalisationUnion = false): LoweredValue | null {
    const value = this.lowerValue(type, inLocalisationUnion);
    if (value !== null) {
      this.recordNames(value);
    }
    return value;
  }

  private recordNames(value: LoweredValue): void {
    for (const type of value.types) {
      if (type.kind !== "enum" && type.kind !== "reference" && type.kind !== "valueSet") {
        continue;
      }
      const kind = type.kind;
      const names =
        kind === "enum"
          ? this.usedEnums
          : kind === "reference"
            ? this.usedRefs
            : this.usedValueSets;
      names.add(type.name);
      this.nameUses.push({ kind, name: type.name });
    }
  }

  private lowerValue(type: RuleType, inLocalisationUnion: boolean): LoweredValue | null {
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
        return {
          types: [{ kind: "sdk", name: "ScriptValue" }],
          conversion: "identity",
          scriptValue: true,
        };
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
      case "valueSet":
        return { types: [{ kind: "valueSet", name: type.name }], conversion: "identity" };
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
        const members = this.scopeGroup(type.name);
        if (members === null) {
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
        return {
          types: [
            {
              kind: "scope",
              scopes: [
                ...new Set(canonical.filter((scope): scope is string => scope !== null)),
              ].sort(),
            },
          ],
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
            : { refTypes: [reference.target], objectKinds: ["typed-ref" as const] }),
          ...(members.length > 0 ? { literals: members } : {}),
        };
      }
      case "typeRef":
        return {
          types: [{ kind: "reference", name: type.name, unchecked: true }],
          conversion: "refId",
          refTypes: [type.name],
          objectKinds: ["typed-ref"],
        };
      default:
        return null;
    }
  }

  /**
   * Re-lowers one arm of a union that also names a localization key, so no arm
   * remains a bare string.
   *
   * A bare string now means English display text, so another string-backed arm
   * would mean two things with no runtime discriminator. Raw displayed text
   * becomes `LiteralText`, while a content reference loses its unchecked string
   * escape hatch in favor of the same `{ id }` shape as a branded reference.
   *
   * Enum and value-set arms have no distinguishable runtime spelling. They fail
   * rather than being reinterpreted or dropped; `localisation-unions.test.ts`
   * walks the real rules so a new ambiguous arm cannot pass unnoticed.
   * Returns `undefined` when an arm needs no adjustment.
   */
  private valueBesideLocalisation(type: RuleType): LoweredValue | undefined {
    switch (type.kind) {
      case "scalar":
      case "filepath":
      case "icon":
      case "colour":
        return {
          types: [{ kind: "sdk", name: "LiteralText" }],
          conversion: "literalText",
          objectKinds: ["literal-text"],
        };
      case "typeRef":
        return {
          types: [{ kind: "reference", name: type.name, unchecked: false }],
          conversion: "refId",
          refTypes: [type.name],
          objectKinds: ["typed-ref"],
        };
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
   * Lowers an overloaded scalar rule into one semantic value.
   * Returns `null` when any arm lacks a scalar authoring representation.
   */
  unionFor(types: readonly RuleType[]): LoweredValue | null {
    const localisation = types.some((type) => type.kind === "localisation");
    const values = types.map((type) => this.valueFor(type, localisation));
    if (!values.every((value): value is LoweredValue => value !== null)) {
      return null;
    }

    const conversions = new Set(values.map((value) => value.conversion));
    const refTypes = referenceTargetsOf(types);
    // One open arm opens the entire union: a scalar arm makes every value legal,
    // so the literals retained by closed arms no longer prove a closed domain.
    const literals = values.every((value) => value.literals !== undefined)
      ? [...new Set(values.flatMap((value) => [...value.literals!]))]
      : undefined;
    const booleanLiterals = [...new Set(values.flatMap((value) => value.booleanLiterals ?? []))];
    const objectKinds = [...new Set(values.flatMap((value) => value.objectKinds ?? []))];
    const conversionsDiffer = conversions.size > 1;
    // Preserve the script-value marker only when all arms agree. A mixed
    // conversion uses refId and cannot also be wrapped by scriptValueScalar.
    const scriptValue =
      !conversionsDiffer && values.every((value) => value.scriptValue === true) ? true : undefined;
    const conversion: ScalarConversion = conversionsDiffer ? "refId" : values[0]!.conversion;
    // Mixed localization positions retain engine sentinels such as `default`
    // and `random`. They take precedence over English shorthand, so an author
    // uses `{ english: "default" }` to display the word itself.
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

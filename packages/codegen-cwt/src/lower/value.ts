/** Semantic value facts retained between CWT interpretation and TypeScript emission. */

import type { RuleType } from "../cwt/model.ts";
import { COMPLEX_ENUM_REFERENCE_OVERLAYS } from "../overlay/index.ts";
import type { ContentConversion } from "./content-shape.ts";

/** How an authored scalar becomes the value stored in the PDXScript AST. */
export type ScalarConversion = "identity" | "refId" | "stringRefId" | "scopePath" | "literalText";

/** Projects a semantic conversion onto the runtime content descriptor vocabulary. */
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

/** A lowered authoring value and its serialization facts. */
export interface LoweredValue {
  /** Authoring type arms retained without TypeScript source text. */
  readonly types: readonly LoweredAuthoringType[];
  /** Runtime scalar conversion selected by lowering. */
  readonly conversion: ScalarConversion;
  /** Referenced registries when every admitted form is a typed reference. */
  readonly refTypes?: readonly string[];
  /** Every admitted scalar token when the rules define a closed set. */
  readonly literals?: readonly string[];
  /** Rule-declared boolean tokens retained inside otherwise open unions. */
  readonly booleanLiterals?: readonly ("yes" | "no")[];
  /** Whether the runtime must apply `scriptValueScalar`. */
  readonly scriptValue?: true;
  /** Structured SDK value forms accepted by this scalar shape. */
  readonly objectKinds?: readonly ScalarObjectKind[];
  /** Whether this value is a localization input. */
  readonly localizationInput?: true;
  /** Engine sentinels admitted beside a localization input. */
  readonly localizationLiterals?: readonly string[];
}

/** Whether a scalar admits a localization reference. */
export function recordsLocalization(value: LoweredValue): boolean {
  return value.objectKinds?.includes("localization-ref") === true;
}

/** The content registries an overloaded value's ids may name. */
export function referenceTargetsOf(types: readonly RuleType[]): readonly string[] | undefined {
  const complexEnumTargets = new Map(
    [...COMPLEX_ENUM_REFERENCE_OVERLAYS].map(([name, overlay]) => [name, overlay.target])
  );
  const targetOf = (type: RuleType): string | undefined => {
    if (type.kind === "typeRef") {
      return type.name;
    }
    return type.kind === "enum" ? complexEnumTargets.get(type.name) : undefined;
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
    types.some((type) => type.kind === "enum" && complexEnumTargets.has(type.name)) &&
    types.every(
      (type) =>
        type.kind === "literal" || (type.kind === "enum" && complexEnumTargets.has(type.name))
    );
  return isLiteralComplexEnumUnion ? [...new Set(referenced)] : undefined;
}

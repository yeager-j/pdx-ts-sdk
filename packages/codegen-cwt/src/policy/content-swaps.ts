import type { ContentType, RuleSet } from "../cwt/rules.ts";
import type { ContentEmission } from "../emit/content/content-type.ts";
import { compareStrings, docComment } from "../naming.ts";

/** Swap bases that deliberately have no generated registry, with the reason for each exclusion. */
export const CONTENT_SWAP_EXCLUSIONS = new Map<string, string>([
  [
    "authority",
    "the CWT declaration swaps authority, but the SDK intentionally exposes no authority registry",
  ],
]);

/** An emitted registry and the CWT declaration from which its swap identities can be derived. */
export interface ContentSwapSource {
  /** The resolved SDK registry name. */
  readonly registry: string;
  /** The registry's parsed CWT type declaration. */
  readonly type: ContentType;
  /** The generated field evidence for the registry. */
  readonly emission: ContentEmission;
}

/** The authored path and collection shape that identify swappable nested definitions. */
export interface ContentSwapIdentity {
  /** The SDK registry that owns the nested definitions. */
  readonly registryType: string;
  /** The authored member path from the registry root to the nested definition. */
  readonly path: readonly string[];
  /** How definition identities are encoded at the final path segment. */
  readonly keying: "record-keys" | "array-names";
}

/**
 * Derives the complete swap-identity policy from CWT `base_type` declarations and emitted fields.
 * Every declaration must resolve to an emitted registry or a reviewed exclusion.
 */
export function deriveContentSwapIdentities(
  rules: RuleSet,
  contents: readonly ContentSwapSource[]
): readonly ContentSwapIdentity[] {
  const contentByTypeName = new Map(contents.map((content) => [content.type.name, content]));
  const identities: ContentSwapIdentity[] = [];
  const swapDeclarations = [...rules.contentTypes.values()].filter(
    (type): type is ContentType & { readonly baseType: string } => type.baseType != null
  );

  for (const declaration of swapDeclarations) {
    const baseName = declaration.baseType.split(".")[0]!;
    const baseContent = contentByTypeName.get(baseName);
    if (baseContent === undefined) {
      const reason = CONTENT_SWAP_EXCLUSIONS.get(baseName);
      if (reason === undefined) {
        throw new Error(
          `type[${declaration.name}] swaps base_type=${declaration.baseType}, but no emitted ` +
            "content registry owns that base and no exclusion explains it"
        );
      }
      continue;
    }
    const keyFilter = declaration.keyFilter;
    if (keyFilter === null || keyFilter.negated) {
      throw new Error(
        `type[${declaration.name}] swaps ${baseName} but declares no positive type_key_filter`
      );
    }
    const scriptPath = [
      ...(declaration.skipRootKeys ?? []).filter((key) => key !== "any"),
      keyFilter.key,
    ];
    const fieldPath = scriptPath.join(".");
    const identityField = [
      ...baseContent.emission.emittedFields,
      ...baseContent.emission.nestedEmittedFields,
    ].find(
      (field) =>
        field.field === fieldPath ||
        field.field === `${baseContent.type.name}.${fieldPath}` ||
        field.field === `${baseContent.registry}.${fieldPath}`
    );
    if (identityField === undefined) {
      throw new Error(
        `type[${declaration.name}] derives swap path ${baseName}.${fieldPath}, but that base ` +
          "registry emits no matching field"
      );
    }
    let keying: ContentSwapIdentity["keying"];
    if (identityField.shape === "repeatedStruct") {
      keying = "record-keys";
    } else if (identityField.shape === "struct" && identityField.repeated) {
      keying = "array-names";
    } else {
      throw new Error(
        `type[${declaration.name}] derives ${baseName}.${fieldPath}, whose emitted shape ` +
          `${identityField.shape} cannot carry swap identities`
      );
    }
    if (
      identityField.authoredPath === undefined ||
      identityField.authoredPath.length !== scriptPath.length
    ) {
      throw new Error(
        `type[${declaration.name}] derives ${baseName}.${fieldPath}, but emitted field evidence ` +
          "does not carry the complete authored member path"
      );
    }
    identities.push({
      registryType: baseContent.registry,
      path: identityField.authoredPath,
      keying,
    });
  }

  for (const [excluded] of CONTENT_SWAP_EXCLUSIONS) {
    if (!swapDeclarations.some((declaration) => declaration.baseType.split(".")[0] === excluded)) {
      throw new Error(`CONTENT_SWAP_EXCLUSIONS names ${excluded}, but no swap declaration uses it`);
    }
  }
  return identities.sort((left, right) => compareStrings(left.registryType, right.registryType));
}

/** Emits the generated swap-identity contract and its derived policy rows. */
export function emitContentSwapProtocol(rows: readonly ContentSwapIdentity[]): string {
  return (
    docComment([
      "A nested definition that may stand in for another definition of the same registry.",
      "Derived from CWT base_type, skip_root_key, and type_key_filter declarations.",
    ]) +
    "export interface SwapIdentity {\n" +
    "  readonly registryType: string;\n" +
    "  readonly path: readonly string[];\n" +
    '  readonly keying: "record-keys" | "array-names";\n' +
    "}\n\n" +
    "export const SWAP_IDENTITIES = [\n" +
    rows
      .map(
        (row) =>
          `  { registryType: ${JSON.stringify(row.registryType)}, path: ${JSON.stringify(row.path)}, keying: ${JSON.stringify(row.keying)} },\n`
      )
      .join("") +
    "] as const satisfies readonly SwapIdentity[];\n"
  );
}

import type { ContentType, RuleSet } from "./cwt/rules.ts";
import type { ContentEmission } from "./emit/content-type.ts";
import { docComment } from "./naming.ts";

export const CONTENT_SWAP_EXCLUSIONS = new Map<string, string>([
  [
    "authority",
    "the CWT declaration swaps authority, but the SDK intentionally exposes no authority registry",
  ],
]);

export interface ContentSwapSource {
  readonly registry: string;
  readonly type: ContentType;
  readonly emission: ContentEmission;
}

export interface ContentSwapIdentity {
  readonly registryType: string;
  readonly path: readonly string[];
  readonly keying: "record-keys" | "array-names";
}

export function deriveContentSwapIdentities(
  rules: RuleSet,
  contents: readonly ContentSwapSource[]
): readonly ContentSwapIdentity[] {
  const byReference = new Map(contents.map((content) => [content.type.name, content]));
  const rows: ContentSwapIdentity[] = [];
  const declarations = [...rules.contentTypes.values()].filter((type) => type.baseType != null);

  for (const declaration of declarations) {
    const baseName = declaration.baseType!.split(".")[0]!;
    const base = byReference.get(baseName);
    if (base === undefined) {
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
    const emitted = [...base.emission.emittedFields, ...base.emission.nestedEmittedFields].find(
      (field) =>
        field.field === fieldPath ||
        field.field === `${base.type.name}.${fieldPath}` ||
        field.field === `${base.registry}.${fieldPath}`
    );
    if (emitted === undefined) {
      throw new Error(
        `type[${declaration.name}] derives swap path ${baseName}.${fieldPath}, but that base ` +
          "registry emits no matching field"
      );
    }
    const keying =
      emitted.shape === "repeatedStruct"
        ? "record-keys"
        : emitted.shape === "struct" && emitted.repeated
          ? "array-names"
          : null;
    if (keying === null) {
      throw new Error(
        `type[${declaration.name}] derives ${baseName}.${fieldPath}, whose emitted shape ` +
          `${emitted.shape} cannot carry swap identities`
      );
    }
    if (emitted.authoredPath === undefined || emitted.authoredPath.length !== scriptPath.length) {
      throw new Error(
        `type[${declaration.name}] derives ${baseName}.${fieldPath}, but emitted field evidence ` +
          "does not carry the complete authored member path"
      );
    }
    rows.push({
      registryType: base.registry,
      path: emitted.authoredPath,
      keying,
    });
  }

  for (const [excluded] of CONTENT_SWAP_EXCLUSIONS) {
    if (!declarations.some((declaration) => declaration.baseType?.split(".")[0] === excluded)) {
      throw new Error(`CONTENT_SWAP_EXCLUSIONS names ${excluded}, but no swap declaration uses it`);
    }
  }
  return rows.sort((left, right) => left.registryType.localeCompare(right.registryType));
}

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

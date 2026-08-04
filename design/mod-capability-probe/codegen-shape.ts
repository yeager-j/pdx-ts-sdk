import { CONTENT_MANIFEST } from "../../packages/codegen-cwt/src/content-manifest.ts";
import { camelCase, pascalCase } from "../../packages/codegen-cwt/src/naming.ts";
import {
  CONTENT_CONTRIBUTION_SINKS,
  CONTENT_PATCH_REGISTRIES,
  HAND_WRITTEN_CONTENT_DEFINERS,
} from "../../packages/codegen-cwt/src/overlay.ts";

export interface CapabilityMethodRow {
  readonly registry: string;
  readonly method: string;
  readonly typeName: string;
  readonly handWritten: boolean;
  readonly patchMethod: string | undefined;
  readonly contributionMethod: string | undefined;
}

/**
 * The proposed emitter's Single Choice table.
 *
 * Registry identity comes from the manifest exactly once. Existing overlay
 * tables continue to decide grafts, patches, and contribution sinks; moving a
 * definer onto the mod capability introduces no registry-name conditional.
 */
export function capabilityMethodRows(): CapabilityMethodRow[] {
  return CONTENT_MANIFEST.map((entry) => {
    const registry = "as" in entry ? entry.as : entry.type;
    const typeName = pascalCase(registry);
    return {
      registry,
      method: camelCase(registry),
      typeName,
      handWritten: HAND_WRITTEN_CONTENT_DEFINERS.has(registry),
      patchMethod: CONTENT_PATCH_REGISTRIES.has(registry) ? `patch${typeName}` : undefined,
      contributionMethod: CONTENT_CONTRIBUTION_SINKS.get(registry)?.method,
    };
  });
}

/**
 * Representative declaration text for the mechanical arm. The shipping
 * emitter would splice its already-resolved `Def` type and scope parameter
 * where this probe prints `TypeDef`; those are existing decisions in
 * `contentDefiners`, not new capability branches.
 */
export function emitCapabilityMethodDeclarations(): string {
  return capabilityMethodRows()
    .map(
      ({ method, typeName }) =>
        `  ${method}<const Name extends string>(name: Name, ` +
        `def: Omit<${typeName}Def<MintId<P, I[${JSON.stringify(method)}], Name>>, "id">): ${typeName}Item;`
    )
    .join("\n");
}

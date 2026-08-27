import { walkItems, type PdxItem } from "@pdx-ts/pdxscript";

import { contentDescriptor } from "../content/descriptors.ts";
import type { LocalizationRoleUse } from "../content/localization-families.ts";
import { SWAP_IDENTITIES, type SwapIdentity } from "../content/swaps.ts";
import { CONTENT_REGISTRIES } from "../generated/content-registry.ts";
import type { ContentRefUse } from "../references.ts";
import type { ContentFile, DefinedGroup, EmittedFile } from "./model.ts";

type ReferenceValidationInput = {
  readonly prefix: string;
  readonly contentFiles: readonly ContentFile[];
  readonly componentTagIds: ReadonlySet<string>;
  readonly eventFiles: readonly EmittedFile[];
  readonly eventIds: ReadonlySet<string>;
  readonly definedGroups: readonly DefinedGroup[];
  readonly patched: readonly {
    readonly registry: string;
    readonly def: Readonly<Record<string, unknown>>;
  }[];
  readonly refUses: readonly ReferenceUse[];
  readonly roleUses: readonly LocalizationRoleUse[];
  readonly vanillaIdsOf: (registry: string) => ReadonlySet<string> | undefined;
};

const registriesByReferenceTarget = indexRegistriesByReferenceTarget();

function indexRegistriesByReferenceTarget(): ReadonlyMap<string, readonly string[]> {
  const registriesByTarget = new Map<string, string[]>();
  for (const descriptor of CONTENT_REGISTRIES) {
    const qualifier = descriptor.referenceName.indexOf(".");
    const targets =
      qualifier === -1
        ? [descriptor.referenceName]
        : [descriptor.referenceName, descriptor.referenceName.slice(0, qualifier)];
    for (const target of targets) {
      registriesByTarget.set(target, [...(registriesByTarget.get(target) ?? []), descriptor.type]);
    }
  }
  registriesByTarget.set("component_tag", ["component_tag"]);
  return registriesByTarget;
}

function readSwapPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

function swapIds(value: unknown, keying: SwapIdentity["keying"]): readonly string[] {
  if (keying === "record-keys") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value)
      : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  for (const item of value) {
    const name = (item as { readonly name?: unknown } | null)?.name;
    if (typeof name === "string") {
      ids.push(name);
    }
  }
  return ids;
}

/** Every `str` scalar anywhere in the tree, regions included, in source order. */
function scanStrings(nodes: readonly PdxItem[], strings: string[]): void {
  walkItems(
    nodes,
    undefined,
    (node) => {
      if (node.kind === "str") {
        strings.push(node.value);
      }
      return undefined;
    },
    { read: true }
  );
}

function assertOwnEventReferencesExist(
  prefix: string,
  contentFiles: readonly ContentFile[],
  eventFiles: readonly EmittedFile[],
  eventIds: ReadonlySet<string>
): void {
  const ownEventId = new RegExp(`^${prefix}(_[a-z0-9_]*)?\\.\\d+$`);
  const strings: string[] = [];
  for (const file of contentFiles) {
    scanStrings(file.entries, strings);
  }
  for (const file of eventFiles) {
    scanStrings(file.entries, strings);
  }

  for (const value of strings) {
    if (ownEventId.test(value) && !eventIds.has(value)) {
      throw new Error(
        `"${value}" looks like one of this mod's event ids, but no such event is among the ` +
          `features passed to buildMod — was the feature holding it included?`
      );
    }
  }
}

function indexDefinitionsByType(
  definedGroups: readonly DefinedGroup[]
): ReadonlyMap<string, readonly DefinedGroup["defined"][number][]> {
  const definitionsByType = new Map<string, DefinedGroup["defined"][number][]>();
  for (const group of definedGroups) {
    definitionsByType.set(group.type, [
      ...(definitionsByType.get(group.type) ?? []),
      ...group.defined,
    ]);
  }
  return definitionsByType;
}

function collectBuiltIds(
  definedGroups: readonly DefinedGroup[],
  patched: ReferenceValidationInput["patched"],
  componentTagIds: ReadonlySet<string>
): ReadonlyMap<string, ReadonlySet<string>> {
  const builtIds = new Map<string, Set<string>>();
  for (const group of definedGroups) {
    const ids = builtIds.get(group.type) ?? new Set<string>();
    for (const defined of group.defined) {
      ids.add(defined.id);
    }
    builtIds.set(group.type, ids);
  }

  const definitionsByType = indexDefinitionsByType(definedGroups);
  for (const { registryType, path, keying } of SWAP_IDENTITIES) {
    const authoredDefinitions: unknown[] = [
      ...(definitionsByType.get(registryType) ?? []).map((definition) => definition.def),
      ...patched.filter((patch) => patch.registry === registryType).map((patch) => patch.def),
    ];
    if (authoredDefinitions.length === 0) {
      continue;
    }

    const ids = builtIds.get(registryType) ?? new Set<string>();
    for (const definition of authoredDefinitions) {
      for (const id of swapIds(readSwapPath(definition, path), keying)) {
        ids.add(id);
      }
    }
    builtIds.set(registryType, ids);
  }
  builtIds.set("component_tag", new Set(componentTagIds));
  return builtIds;
}

function resolveTargetRegistries(target: string): readonly string[] | undefined {
  const exact = registriesByReferenceTarget.get(target);
  if (exact !== undefined) {
    return exact;
  }
  const qualifier = target.indexOf(".");
  return qualifier === -1 ? undefined : registriesByReferenceTarget.get(target.slice(0, qualifier));
}

function registriesFor(use: ContentRefUse): readonly string[] | undefined {
  if (use.targets.length === 0) {
    return undefined;
  }
  const resolvedTargets = use.targets.map(resolveTargetRegistries);
  if (resolvedTargets.some((registries) => registries === undefined)) {
    return undefined;
  }
  return resolvedTargets.flatMap((registries) => registries ?? []);
}

function isOwnedReference(id: string, prefix: string, minted: boolean): boolean {
  return minted ? `_${id}_`.includes(`_${prefix}_`) : id.startsWith(`${prefix}_`);
}

function assertContentReferenceExists(
  owner: string,
  use: ContentRefUse,
  prefix: string,
  builtIds: ReadonlyMap<string, ReadonlySet<string>>,
  vanillaIdsOf: ReferenceValidationInput["vanillaIdsOf"]
): void {
  const registries = registriesFor(use);
  if (registries === undefined || use.verifiedVanilla === true) {
    return;
  }

  const minted = registries.some((registry) => contentDescriptor(registry)?.mintHead !== undefined);
  // Exact vanilla identity takes precedence over ownership inferred from its spelling (ADR-0006).
  const isVanilla = registries.some((registry) => vanillaIdsOf(registry)?.has(use.id) === true);
  if (isVanilla || !isOwnedReference(use.id, prefix, minted)) {
    return;
  }
  if (registries.some((registry) => builtIds.get(registry)?.has(use.id))) {
    return;
  }

  const target = use.targets.join(" or ");
  const because = minted
    ? `the reference contains this mod's prefix "${prefix}" as a "_"-delimited name ` +
      `segment and matches no vanilla ${target}`
    : `the id carries this mod's prefix "${prefix}_"`;
  throw new Error(
    `${owner} references ${target} "${use.id}" in "${use.field}", but no such ${target} is ` +
      `among the features passed to buildMod — ${because}, so this build has to define it; ` +
      `was its feature passed to buildMod?`
  );
}

/** A recorded content reference and the definition or event that wrote it. */
export interface ReferenceUse {
  /** The definition or event whose serialized field contains the reference. */
  readonly owner: string;
  /** The referenced id, target registry names, and serialized field path. */
  readonly use: ContentRefUse;
}

/**
 * Rejects a localization role whose reference this build defines but supplies no text family for.
 *
 * The authoring type refuses the two owned shapes it can see, but a handle
 * reaches the field before its definition exists, a defined item widened to a
 * plain reference wears nothing to test, and a raw string wears less. All
 * three land here, where the same id census the reference check uses settles
 * ownership by identity rather than by shape.
 */
function assertLocalizationRolesComplete(
  roleUses: readonly LocalizationRoleUse[],
  builtIds: ReadonlyMap<string, ReadonlySet<string>>
): void {
  for (const use of roleUses) {
    if (use.bundled || builtIds.get(use.registry)?.has(use.id) !== true) {
      continue;
    }
    throw new Error(
      `${use.owner} names ${use.registry} "${use.id}" in "${use.field}", and this build defines ` +
        `that ${use.registry}. ${use.reader} builds a required text family from its id, and ` +
        `nothing ships that text, so the mod would show raw keys wherever the family is read — ` +
        `write the reference and its text together as ` +
        `{ resource: …, localization: … }.`
    );
  }
}

/**
 * Rejects event and content references that look owned by this mod but have no definition in the
 * compiled Feature set. Verified vanilla references and assumed third-party references pass through.
 */
export function validateReferences(args: ReferenceValidationInput): void {
  assertOwnEventReferencesExist(args.prefix, args.contentFiles, args.eventFiles, args.eventIds);
  const builtIds = collectBuiltIds(args.definedGroups, args.patched, args.componentTagIds);
  for (const { owner, use } of args.refUses) {
    assertContentReferenceExists(owner, use, args.prefix, builtIds, args.vanillaIdsOf);
  }
  assertLocalizationRolesComplete(args.roleUses, builtIds);
}

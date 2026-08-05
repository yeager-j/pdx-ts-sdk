import type { PdxItem } from "@pdx-ts/pdxscript";

import { CONTENT_REGISTRIES } from "../generated/content-registry.ts";
import type { ContentRefUse } from "../references.ts";
import type { ContentFile, DefinedGroup, EmittedFile } from "./model.ts";

export interface SwapIdentity {
  readonly registryType: string;
  readonly path: readonly string[];
  readonly keying: "record-keys" | "array-names";
}

export const SWAP_IDENTITIES: readonly SwapIdentity[] = [
  { registryType: "tradition", path: ["traditionSwap"], keying: "record-keys" },
  { registryType: "ascension_perk", path: ["traditionSwap"], keying: "record-keys" },
  { registryType: "civic_or_origin", path: ["swapType"], keying: "array-names" },
  { registryType: "technology", path: ["technologySwap"], keying: "array-names" },
  { registryType: "job", path: ["swappableData", "swapType"], keying: "array-names" },
];

const readSwapPath = (value: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (current, segment) =>
      current !== null && typeof current === "object"
        ? (current as Readonly<Record<string, unknown>>)[segment]
        : undefined,
    value
  );

const swapIds = (value: unknown, keying: SwapIdentity["keying"]): readonly string[] => {
  if (keying === "record-keys") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value)
      : [];
  }
  return Array.isArray(value)
    ? value.flatMap((item: unknown) =>
        typeof (item as { readonly name?: unknown } | null)?.name === "string"
          ? [(item as { readonly name: string }).name]
          : []
      )
    : [];
};

export interface ReferenceUse {
  readonly owner: string;
  readonly use: ContentRefUse;
}

export function validateReferences(args: {
  readonly prefix: string;
  readonly contentFiles: readonly ContentFile[];
  readonly eventFiles: readonly EmittedFile[];
  readonly eventIds: ReadonlySet<string>;
  readonly definedGroups: readonly DefinedGroup[];
  readonly refUses: readonly ReferenceUse[];
}): void {
  const ownEventId = new RegExp(`^${args.prefix}(_[a-z0-9_]*)?\\.\\d+$`);
  const scanned: string[] = [];
  const scan = (nodes: readonly PdxItem[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case "entry":
          if (node.value.kind === "str") {
            scanned.push(node.value.value);
          } else if (node.value.kind === "container") {
            scan(node.value.items);
          }
          break;
        case "str":
          scanned.push(node.value);
          break;
        case "container":
        case "param":
          scan(node.items);
          break;
        default:
          break;
      }
    }
  };
  for (const file of args.contentFiles) {
    scan(file.entries);
  }
  for (const file of args.eventFiles) {
    scan(file.entries);
  }
  for (const value of scanned) {
    if (ownEventId.test(value) && !args.eventIds.has(value)) {
      throw new Error(
        `"${value}" looks like one of this mod's event ids, but no such event is among the ` +
          `features passed to buildMod — was the feature holding it included?`
      );
    }
  }

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
  const resolveTargetRegistries = (target: string): readonly string[] | undefined => {
    const exact = registriesByTarget.get(target);
    if (exact !== undefined) {
      return exact;
    }
    const qualifier = target.indexOf(".");
    return qualifier === -1 ? undefined : registriesByTarget.get(target.slice(0, qualifier));
  };

  const builtIds = new Map<string, Set<string>>();
  for (const group of args.definedGroups) {
    const ids = builtIds.get(group.type) ?? new Set<string>();
    for (const defined of group.defined) {
      ids.add(defined.id);
    }
    builtIds.set(group.type, ids);
  }
  const definedByType = new Map<string, DefinedGroup["defined"][number][]>();
  for (const group of args.definedGroups) {
    definedByType.set(group.type, [...(definedByType.get(group.type) ?? []), ...group.defined]);
  }
  for (const { registryType, path, keying } of SWAP_IDENTITIES) {
    const defined = definedByType.get(registryType);
    if (defined === undefined) {
      continue;
    }
    const ids = builtIds.get(registryType) ?? new Set<string>();
    for (const definition of defined) {
      for (const id of swapIds(readSwapPath(definition.def, path), keying)) {
        ids.add(id);
      }
    }
    builtIds.set(registryType, ids);
  }

  for (const { owner, use } of args.refUses) {
    if (!use.id.startsWith(`${args.prefix}_`)) {
      continue;
    }
    const resolvedTargets = use.targets.map(resolveTargetRegistries);
    if (
      use.targets.length === 0 ||
      resolvedTargets.some((registries) => registries === undefined)
    ) {
      continue;
    }
    if (
      resolvedTargets.some((registries) =>
        registries!.some((registry) => builtIds.get(registry)?.has(use.id))
      )
    ) {
      continue;
    }
    const target = use.targets.join(" or ");
    throw new Error(
      `${owner} references ${target} "${use.id}" in "${use.field}", but no such ${target} is ` +
        `among the features passed to buildMod — the id carries this mod's prefix ` +
        `"${args.prefix}_", so this build has to define it; was its feature passed to buildMod?`
    );
  }
}

/**
 * The deterministic fold from capability-owned features to `PureMod`.
 *
 * The coordinator keeps the order visible while compiler leaves own config,
 * localization, reference validation, patch planning, and freezing.
 */

import { kv, type PdxEntry } from "@pdx-ts/pdxscript";

import {
  flattenItems,
  type ContentItem,
  type EventItemBase,
  type ModItemInput,
  type ModWarning,
  type OnActionBindingItem,
} from "../authoring/feature.ts";
import { ContentAuthoring } from "../content/authoring.ts";
import { OnActionAuthoring } from "../events/on-actions.ts";
import type { DefinedEvent } from "../events/types.ts";
import { CONTENT_REGISTRIES, type ContentTypeName } from "../generated/content-registry.ts";
import type { ScopeName } from "../generated/scopes.ts";
import {
  checkVanillaPackagePin,
  installedVanillaPackageVersion,
  vanillaIdsCheckWarning,
} from "../identifiers/package-pin.ts";
import { compareUtf8 } from "../ordering.ts";
import {
  resolveConfig,
  type BuildOptions,
  type ModConfig,
  type ResolvedModConfig,
} from "./config.ts";
import { freezeItems } from "./freeze.ts";
import { createLocalizationAccumulator } from "./localization.ts";
import type { ContentFile, DefinedGroup, EmittedFile, PureMod } from "./model.ts";
import { collectPatches, planPatches } from "./patches.ts";
import { validateReferences, type ReferenceUse } from "./references.ts";

export { type BuildOptions, type ModConfig } from "./config.ts";
export { type EmittedFile, type PureMod } from "./model.ts";

function emissionPath(prefix: string, outputDir: string, stem: string): string {
  return `${outputDir}/${prefix}_${stem}.txt`;
}

function eventNumber(event: EventItemBase, namespace: string): number {
  return Number(event.id.slice(namespace.length + 1));
}

export function buildMod(
  callerConfig: ModConfig | ResolvedModConfig,
  collections: readonly ModItemInput[],
  options: BuildOptions = {}
): PureMod {
  const config = resolveConfig(callerConfig);
  const flat = flattenItems(collections);
  const warnings: ModWarning[] = [];
  const localization = createLocalizationAccumulator(warnings);
  const refUses: ReferenceUse[] = [];

  const content = new ContentAuthoring(
    config.prefix,
    CONTENT_REGISTRIES,
    localization.register,
    (message) => warnings.push({ code: "missing-prefix", message }),
    (message) => warnings.push({ code: "unstable-desc-key", message }),
    (message) => warnings.push({ code: "loc-key-looks-like-text", message })
  );

  const vanillaKeysByDir = new Map<string, Set<string>>();
  for (const file of options.vanilla?.files ?? []) {
    const dir = file.path.slice(0, file.path.lastIndexOf("/"));
    const keys = vanillaKeysByDir.get(dir) ?? new Set<string>();
    for (const key of file.keys) {
      keys.add(key);
    }
    vanillaKeysByDir.set(dir, keys);
  }
  const descriptorByType = new Map(
    CONTENT_REGISTRIES.map((descriptor) => [descriptor.type as ContentTypeName, descriptor])
  );
  const ownIdsByDir = new Map<string, Map<string, ContentTypeName>>();
  const rawByType = new Map<ContentTypeName, Map<string, ContentItem[]>>();

  // Pass 1: collect and validate items without defining them. Definition is
  // delayed because it registers localization as a side effect.
  for (const { item, file } of flat) {
    if (item.itemKind !== "content") {
      continue;
    }
    const descriptor = descriptorByType.get(item.type);
    if (descriptor === undefined) {
      throw new Error(`Unknown generated content type "${item.type}"`);
    }
    const vanillaKeys = vanillaKeysByDir.get(descriptor.outputDir);
    if (vanillaKeys?.has(item.def.id)) {
      throw new Error(
        `${item.type} id "${item.def.id}" collides with a vanilla ${item.type} of the same id — ` +
          `defining it would silently override vanilla content; patch it instead`
      );
    }
    const ownIds = ownIdsByDir.get(descriptor.outputDir) ?? new Map<string, ContentTypeName>();
    const otherType = ownIds.get(item.def.id);
    if (otherType !== undefined && otherType !== item.type) {
      throw new Error(
        `${item.type} id "${item.def.id}" collides with a ${otherType} of the same id — both are ` +
          `emitted under "${descriptor.outputDir}", where the game merges every file it loads by ` +
          `id, so only one definition would survive and which one is undetermined; give one of them ` +
          `a different id`
      );
    }
    ownIds.set(item.def.id, item.type);
    ownIdsByDir.set(descriptor.outputDir, ownIds);
    const relPath = emissionPath(config.prefix, descriptor.outputDir, file ?? descriptor.fileStem);
    const byPath = rawByType.get(item.type) ?? new Map<string, ContentItem[]>();
    const group = byPath.get(relPath) ?? [];
    group.push(item);
    byPath.set(relPath, group);
    rawByType.set(item.type, byPath);
  }

  // Pass 2: define in registry, path, and id order so localization follows
  // the same canonical order as the content files.
  const definedGroups: DefinedGroup[] = [];
  for (const descriptor of CONTENT_REGISTRIES) {
    const type = descriptor.type as ContentTypeName;
    const byPath = rawByType.get(type);
    if (byPath === undefined) {
      continue;
    }
    for (const relPath of [...byPath.keys()].sort(compareUtf8)) {
      const items = [...byPath.get(relPath)!].sort((a, b) => compareUtf8(a.def.id, b.def.id));
      definedGroups.push({
        type,
        relPath,
        defined: items.map((item) => content.define(item.type, item.def)),
      });
    }
  }

  // Pass 3: lower after every definition has registered its localization.
  const filesByPath = new Map<
    string,
    { types: ContentTypeName[]; ids: string[]; entries: PdxEntry[] }
  >();
  const pathOrder: string[] = [];
  for (const group of definedGroups) {
    let file = filesByPath.get(group.relPath);
    if (file === undefined) {
      file = { types: [], ids: [], entries: [] };
      filesByPath.set(group.relPath, file);
      pathOrder.push(group.relPath);
    }
    file.types.push(group.type);
    for (const defined of group.defined) {
      file.ids.push(defined.id);
      file.entries.push(
        defined.toEntries((use) => {
          refUses.push({ owner: `${group.type} "${defined.id}"`, use });
        })
      );
    }
  }
  const contentFiles: ContentFile[] = pathOrder.map((relPath) => {
    const file = filesByPath.get(relPath)!;
    return { relPath, types: file.types, ids: file.ids, entries: file.entries };
  });

  const placedEvents = flat.filter(
    (placed): placed is { item: EventItemBase; file: string | undefined } =>
      placed.item.itemKind === "event"
  );
  const eventsByPath = new Map<string, { namespace: string; events: EventItemBase[] }>();
  for (const { item, file } of placedEvents) {
    const relPath = emissionPath(config.prefix, "events", file ?? "events");
    const group = eventsByPath.get(relPath);
    if (group === undefined) {
      eventsByPath.set(relPath, { namespace: item.namespace, events: [item] });
    } else if (group.namespace !== item.namespace) {
      throw new Error(
        `event file ${relPath} would mix namespaces "${group.namespace}" and ` +
          `"${item.namespace}" — one namespace per file; give each namespace its own file stem`
      );
    } else {
      group.events.push(item);
    }
  }
  const stemsByNamespace = new Map<string, Set<string>>();
  for (const { item, file } of placedEvents) {
    const stems = stemsByNamespace.get(item.namespace) ?? new Set<string>();
    stems.add(file ?? "events");
    stemsByNamespace.set(item.namespace, stems);
  }
  for (const [namespace, stems] of stemsByNamespace) {
    if (stems.size > 1) {
      const listed = [...stems].sort(compareUtf8).map((stem) => `"${stem}"`);
      throw new Error(
        `event namespace "${namespace}" is split across file stems ` +
          `${listed.slice(0, -1).join(", ")} and ${listed.at(-1)} — one file per namespace; ` +
          `give each namespace its own file stem`
      );
    }
  }
  const eventGroups = [...eventsByPath]
    .sort(([a], [b]) => compareUtf8(a, b))
    .map(([relPath, group]) => ({
      relPath,
      namespace: group.namespace,
      events: [...group.events].sort(
        (a, b) => eventNumber(a, group.namespace) - eventNumber(b, group.namespace)
      ),
    }));
  const orderedEvents = eventGroups.flatMap((group) => group.events);

  const eventIds = new Set<string>();
  const namespaces: string[] = [];
  for (const item of orderedEvents) {
    if (eventIds.has(item.id)) {
      throw new Error(`Duplicate event id "${item.id}"`);
    }
    eventIds.add(item.id);
    for (const use of item.refs) {
      refUses.push({ owner: `event "${item.id}"`, use });
    }
    localization.register(item.locEntries);
    warnings.push(...item.warnings);
    if (!namespaces.includes(item.namespace)) {
      namespaces.push(item.namespace);
    }
  }
  for (const namespace of namespaces) {
    if (namespace !== config.prefix && !namespace.startsWith(`${config.prefix}_`)) {
      warnings.push({
        code: "missing-prefix",
        message:
          `event namespace "${namespace}" should be the mod prefix "${config.prefix}" or start ` +
          `with "${config.prefix}_" so its event ids cannot collide with vanilla or other mods`,
      });
    }
  }
  const eventFiles: EmittedFile[] = eventGroups.map((group) => ({
    relPath: group.relPath,
    entries: [kv("namespace", group.namespace), ...group.events.map((event) => event.entry)],
  }));

  const includedEvents = new Set<EventItemBase>(placedEvents.map(({ item }) => item));
  const onActionAuthoring = new OnActionAuthoring((event) =>
    includedEvents.has(event as unknown as EventItemBase)
  );
  const bindings = flat.flatMap(({ item }) => (item.itemKind === "on-action" ? [item] : []));
  const bindingOrder = (item: OnActionBindingItem): string =>
    item.events.map((event) => event.id).join("\u0000");
  const orderedBindings = [...bindings].sort(
    (a, b) => compareUtf8(a.hook.name, b.hook.name) || compareUtf8(bindingOrder(a), bindingOrder(b))
  );
  for (const item of orderedBindings) {
    for (const event of item.events) {
      onActionAuthoring.register(
        item.hook,
        event as DefinedEvent<ScopeName, ScopeName | undefined>
      );
    }
  }
  const onActions = onActionAuthoring.entries();

  const contributedLimits: string[] = [];
  for (const { item } of flat) {
    if (item.itemKind !== "contribution") {
      continue;
    }
    for (const id of item.ids) {
      contributedLimits.push(id);
      refUses.push({
        owner: `the ${item.registry} contribution`,
        use: { targets: [item.refRegistry], id, field: `default.${item.registry}` },
      });
    }
  }
  const shipOfSizeLimits = new Set<string>(contributedLimits.sort(compareUtf8));

  const patches = collectPatches(flat, options, refUses);
  validateReferences({
    prefix: config.prefix,
    contentFiles,
    eventFiles,
    eventIds,
    definedGroups,
    refUses,
  });

  const orderedPatches = [...patches].sort((a, b) => compareUtf8(a.id, b.id));
  const patchPlan = planPatches(
    config,
    contentFiles.filter((file) => file.types.includes("technology")),
    orderedPatches
  );
  const vanillaOrigin = options.vanilla ?? orderedPatches[0]?.source.origin;
  const vanillaPaths =
    vanillaOrigin === undefined ? undefined : new Set(vanillaOrigin.files.map((file) => file.path));

  if (options.vanilla !== undefined) {
    checkVanillaPackagePin(
      installedVanillaPackageVersion(),
      options.vanilla.gameVersion,
      config.acceptGameVersion
    );
  }
  if (config.uncheckedVanillaIds !== true) {
    const idsWarning = vanillaIdsCheckWarning(
      installedVanillaPackageVersion(),
      options.vanilla?.gameVersion,
      config.acceptGameVersion
    );
    if (idsWarning !== undefined) {
      warnings.push({ code: "unchecked-vanilla-ids", message: idsWarning });
    }
  }

  for (const file of contentFiles) {
    freezeItems(file.entries);
  }
  for (const file of eventFiles) {
    freezeItems(file.entries);
  }
  freezeItems(onActions);

  return Object.freeze({
    config,
    warnings,
    contentFiles,
    eventFiles,
    events: orderedEvents,
    onActions,
    loc: localization.loc,
    shipOfSizeLimits,
    patchPlan,
    vanillaPaths,
  });
}

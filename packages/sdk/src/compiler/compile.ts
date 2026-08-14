/**
 * The deterministic fold from capability-owned features to `PureMod`.
 *
 * The coordinator keeps the order visible while compiler leaves own config,
 * localization, reference validation, patch planning, and freezing.
 */

import { kv, type PdxEntry } from "@pdx-ts/pdxscript";

import { flattenItems, type ModItemInput } from "../authoring/feature.ts";
import { LOCALIZATION_LANGUAGES } from "../authoring/localization.ts";
import { ContentAuthoring } from "../content/authoring.ts";
import type { ContentItem } from "../content/types.ts";
import type { ModWarning } from "../diagnostics.ts";
import { OnActionAuthoring, type OnActionHookItem } from "../events/on-actions.ts";
import type { DefinedEvent, EventItemBase } from "../events/types.ts";
import { CONTENT_REGISTRIES, type ContentTypeName } from "../generated/content-registry.ts";
import type { ScopeName } from "../generated/scopes.ts";
import {
  checkVanillaPackagePin,
  installedVanillaPackageVersion,
  vanillaIdsCheckWarning,
} from "../identifiers/package-pin.ts";
import { compareUtf8, normalizeLogicalPath, type LogicalPath } from "../ordering.ts";
import {
  resolveConfig,
  type BuildOptions,
  type ModConfig,
  type ResolvedModConfig,
} from "./config.ts";
import { freezeItems, immutableSet } from "./freeze.ts";
import { createLocalizationAccumulator } from "./localization.ts";
import type { ContentFile, DefinedGroup, EmittedFile, PureMod } from "./model.ts";
import { collectPatches, planPatches } from "./patches.ts";
import {
  DESCRIPTOR_PATH,
  MATERIALIZATION_MANIFEST_PATH,
  onActionsPath,
  shipOfSizeLimitsPath,
} from "./paths.ts";
import { validateReferences, type ReferenceUse } from "./references.ts";

export { type BuildOptions, type ModConfig } from "./config.ts";
export { type EmittedFile, type LocalizationFile, type PureMod } from "./model.ts";

function emissionPath(prefix: string, outputDir: string, stem: string): LogicalPath {
  return normalizeLogicalPath(`${outputDir}/${prefix}_${stem}.txt`);
}

function eventNumber(event: EventItemBase, namespace: string): number {
  return Number(event.id.slice(namespace.length + 1));
}

export function buildMod(
  callerConfig: ModConfig | ResolvedModConfig,
  features: readonly ModItemInput[],
  options: BuildOptions = {}
): PureMod {
  const config = resolveConfig(callerConfig);
  const flat = flattenItems(features);
  const warnings: ModWarning[] = [];
  const localization = createLocalizationAccumulator(warnings);
  const refUses: ReferenceUse[] = [];

  const content = new ContentAuthoring(
    config.prefix,
    CONTENT_REGISTRIES,
    () => {},
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
  const rawByType = new Map<
    ContentTypeName,
    Map<LogicalPath, { items: Array<{ item: ContentItem; stem: string | undefined }> }>
  >();

  // Pass 1: collect and validate items without defining them. Definition is
  // delayed because it registers localization as a side effect.
  for (const { item, stem } of flat) {
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
    const relPath = emissionPath(config.prefix, descriptor.outputDir, stem ?? descriptor.fileStem);
    const byPath =
      rawByType.get(item.type) ??
      new Map<LogicalPath, { items: Array<{ item: ContentItem; stem: string | undefined }> }>();
    const group = byPath.get(relPath) ?? { items: [] };
    group.items.push({ item, stem });
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
      const group = byPath.get(relPath)!;
      const items = [...group.items].sort((a, b) => compareUtf8(a.item.def.id, b.item.def.id));
      definedGroups.push({
        type,
        relPath,
        defined: items.map(({ item, stem }) =>
          content.define(item.type, item.def, (entries) =>
            localization.register({
              layer: "ordinary",
              language: "english",
              stem,
              entries,
            })
          )
        ),
      });
    }
  }

  // Pass 3: lower after every definition has registered its localization.
  const filesByPath = new Map<
    LogicalPath,
    { types: ContentTypeName[]; ids: string[]; entries: PdxEntry[] }
  >();
  const pathOrder: LogicalPath[] = [];
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
    (placed): placed is { item: EventItemBase; stem: string | undefined } =>
      placed.item.itemKind === "event"
  );
  const eventStem = new Map(placedEvents.map(({ item, stem }) => [item, stem] as const));
  const eventsByPath = new Map<LogicalPath, { namespace: string; events: EventItemBase[] }>();
  for (const { item, stem } of placedEvents) {
    const relPath = emissionPath(config.prefix, "events", stem ?? "events");
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
  for (const { item, stem } of placedEvents) {
    const stems = stemsByNamespace.get(item.namespace) ?? new Set<string>();
    stems.add(stem ?? "events");
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
  for (const group of eventGroups) {
    for (const item of group.events) {
      if (eventIds.has(item.id)) {
        throw new Error(`Duplicate event id "${item.id}"`);
      }
      eventIds.add(item.id);
      for (const use of item.refs) {
        refUses.push({ owner: `event "${item.id}"`, use });
      }
      localization.register({
        layer: "ordinary",
        language: "english",
        stem: eventStem.get(item),
        entries: item.locEntries,
      });
      warnings.push(...item.warnings);
      if (!namespaces.includes(item.namespace)) {
        namespaces.push(item.namespace);
      }
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
  const bindingOrder = (item: OnActionHookItem): string =>
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
  const shipOfSizeLimits = immutableSet(contributedLimits.sort(compareUtf8));

  const patchesByRegistry = collectPatches(flat, options, refUses);
  const patches = [...patchesByRegistry.values()].flat();
  // Registry then id: `patchesByRegistry` is keyed in the order the registries
  // first appeared among the items, which is authoring order, and localization
  // is registered in the order it is emitted (ADR-0005).
  const locOrderedPatches = [...patches].sort(
    (a, b) => compareUtf8(a.registry, b.registry) || compareUtf8(a.id, b.id)
  );
  const patchStem = new Map(
    flat.flatMap(({ item, stem }) =>
      item.itemKind === "patch" ? [[item.patched, stem] as const] : []
    )
  );
  for (const patched of locOrderedPatches) {
    warnings.push(...patched.warnings);
    localization.register({
      layer: "ordinary",
      language: "english",
      stem: patchStem.get(patched),
      entries: patched.loc,
    });
    localization.register({
      layer: "replace",
      language: "english",
      stem: patchStem.get(patched),
      entries: patched.replaceLoc,
    });
  }
  for (const { item, stem } of flat) {
    if (item.itemKind !== "localization") {
      continue;
    }
    for (const language of LOCALIZATION_LANGUAGES) {
      const text = item.translations[language];
      if (text !== undefined) {
        localization.register({
          layer: item.layer,
          language,
          stem,
          entries: [[item.key, text]],
        });
      }
    }
  }
  // Resolved before patch planning, not after, because localization paths are
  // the last ones this fold mints and the patch plan has to steer its computed
  // filename clear of every path the mod already occupies.
  const localizationFiles = localization.finish(config.prefix);

  validateReferences({
    prefix: config.prefix,
    contentFiles,
    eventFiles,
    eventIds,
    definedGroups,
    patched: patches,
    refUses,
  });

  // Every path the mod occupies apart from the patch plans themselves. A
  // computed patch filename that landed on one of these would emit two files
  // at one path, and `winningPath` can only steer around what it is shown.
  const occupiedPaths: LogicalPath[] = [
    DESCRIPTOR_PATH,
    MATERIALIZATION_MANIFEST_PATH,
    ...contentFiles.map((file) => file.relPath),
    ...eventFiles.map((file) => file.relPath),
    ...localizationFiles.map((file) => file.relPath),
  ];
  if (onActions.length > 0) {
    occupiedPaths.push(onActionsPath(config.prefix));
  }
  if (shipOfSizeLimits.size > 0) {
    occupiedPaths.push(shipOfSizeLimitsPath(config.prefix));
  }

  const patchPlans = Object.freeze(
    planPatches(config, contentFiles, patchesByRegistry, occupiedPaths).map((plan) =>
      Object.freeze({
        ...plan,
        assertions: Object.freeze(
          plan.assertions.map((assertion) =>
            Object.freeze({ ...assertion, beats: Object.freeze([...assertion.beats]) })
          )
        ),
      })
    )
  );
  for (const plan of patchPlans) {
    const assumed = plan.assertions.filter((assertion) => assertion.confidence === "assumed");
    if (assumed.length > 0) {
      warnings.push({
        code: "assumed-patch-rule",
        message:
          `Patch plan ${plan.relPath} relies on assumed override rules for ` +
          `${assumed.map((assertion) => `"${assertion.key}"`).join(", ")}; ` +
          "the emitted header records the unverified judgments.",
      });
    }
  }
  const vanillaOrigin = options.vanilla ?? patches[0]?.source.origin;
  const vanillaPaths =
    vanillaOrigin === undefined
      ? undefined
      : immutableSet(vanillaOrigin.files.map((file) => file.path));

  if (options.vanilla !== undefined) {
    checkVanillaPackagePin(
      installedVanillaPackageVersion(),
      options.vanilla.gameVersion,
      config.acceptGameVersion
    );
  }
  const idsWarning = vanillaIdsCheckWarning(
    installedVanillaPackageVersion(),
    options.vanilla?.gameVersion,
    config.acceptGameVersion
  );
  if (idsWarning !== undefined) {
    warnings.push({ code: "mismatched-vanilla-ids", message: idsWarning });
  }

  for (const file of contentFiles) {
    freezeItems(file.entries);
  }
  for (const file of eventFiles) {
    freezeItems(file.entries);
  }
  freezeItems(onActions);

  const frozenWarnings = Object.freeze(warnings.map((warning) => Object.freeze({ ...warning })));
  const frozenContentFiles = Object.freeze(
    contentFiles.map((file) =>
      Object.freeze({
        ...file,
        types: Object.freeze([...file.types]),
        ids: Object.freeze([...file.ids]),
      })
    )
  );
  const frozenEventFiles = Object.freeze(eventFiles.map((file) => Object.freeze({ ...file })));
  const frozenEvents = Object.freeze(
    orderedEvents.map((event) =>
      Object.freeze({
        ...event,
        refs: Object.freeze(
          event.refs.map((ref) =>
            Object.freeze({ ...ref, targets: Object.freeze([...ref.targets]) })
          )
        ),
        locEntries: Object.freeze(
          event.locEntries.map(([key, text]) => Object.freeze([key, text] as const))
        ),
        warnings: Object.freeze(event.warnings.map((warning) => Object.freeze({ ...warning }))),
      })
    )
  );

  return Object.freeze({
    config,
    warnings: frozenWarnings,
    contentFiles: frozenContentFiles,
    eventFiles: frozenEventFiles,
    events: frozenEvents,
    onActions,
    localizationFiles,
    shipOfSizeLimits,
    patchPlans,
    vanillaPaths,
  });
}

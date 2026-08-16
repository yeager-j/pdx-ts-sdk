/**
 * The deterministic fold from capability-owned features to `PureMod`.
 *
 * The coordinator keeps the order visible while compiler leaves own config,
 * localization, reference validation, patch planning, and freezing.
 */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type { AssetFileItem } from "../authoring/assets.ts";
import { flattenItems, type ModItemInput } from "../authoring/feature.ts";
import { LOCALIZATION_LANGUAGES } from "../authoring/localization.ts";
import { ContentAuthoring } from "../content/authoring.ts";
import { contentDescriptor } from "../content/descriptors.ts";
import { shapeMintOf } from "../content/mint-provenance.ts";
import type { ContentRegistryDescriptor } from "../content/schema.ts";
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
import { PACKAGED_ID_EVIDENCE } from "../identifiers/vanilla-gfx-ids.ts";
import {
  checkVanillaPathInventoryConsistency,
  packagedVanillaPaths,
} from "../identifiers/vanilla-paths.ts";
import { compareUtf8, normalizeLogicalPath, type LogicalPath } from "../ordering.ts";
import type { AssetPathUse } from "../references.ts";
import type { VanillaView } from "../stellaris/vanilla/view.ts";
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
  adjudicatePaths,
  DESCRIPTOR_PATH,
  MATERIALIZATION_MANIFEST_PATH,
  onActionsPath,
  shipOfSizeLimitsPath,
  type PathClaim,
} from "./paths.ts";
import { validateReferences, type ReferenceUse } from "./references.ts";

export { type BuildOptions, type ModConfig } from "./config.ts";
export { type EmittedFile, type LocalizationFile, type PureMod } from "./model.ts";

export function emissionPath(
  prefix: string,
  outputDir: string,
  stem: string,
  extension: string
): LogicalPath {
  return normalizeLogicalPath(`${outputDir}/${prefix}_${stem}${extension}`);
}

/**
 * Which root block, if any, one emitted content file sits inside.
 *
 * A file merges every registry that shares its path, and an envelope is a
 * property of the file rather than of a definition — so the registries sharing
 * one file have to agree on it. They disagree only when a manifest puts a
 * wrapped and an unwrapped registry in one directory, which no rule forbids and
 * no emitted file could express, so this refuses rather than picks.
 */
export function fileRootEnvelope(
  relPath: LogicalPath,
  types: readonly string[],
  envelopeOf: (type: string) => string | undefined
): string | undefined {
  const envelope = types.length === 0 ? undefined : envelopeOf(types[0]!);
  for (const type of types) {
    const other = envelopeOf(type);
    if (other !== envelope) {
      const describe = (value: string | undefined): string =>
        value === undefined ? "no root block" : `"${value}"`;
      throw new Error(
        `content file ${relPath} would merge "${types[0]!}", which sits inside ` +
          `${describe(envelope)}, with "${type}", which sits inside ${describe(other)} — one ` +
          "root block per file; give one of them a different file stem"
      );
    }
  }
  return envelope;
}

function eventNumber(event: EventItemBase, namespace: string): number {
  return Number(event.id.slice(namespace.length + 1));
}

/** Records which Feature placed something into a file. Unnamed features add none. */
function noteStem(
  stemsByPath: Map<LogicalPath, Set<string>>,
  relPath: LogicalPath,
  stem: string | undefined
): void {
  const stems = stemsByPath.get(relPath) ?? new Set<string>();
  if (stem !== undefined) {
    stems.add(stem);
  }
  stemsByPath.set(relPath, stems);
}

function stemsOf(
  stemsByPath: ReadonlyMap<LogicalPath, Set<string>>,
  relPath: LogicalPath
): readonly string[] {
  return [...(stemsByPath.get(relPath) ?? [])].sort(compareUtf8);
}

export function buildMod(
  callerConfig: ModConfig | ResolvedModConfig,
  features: readonly ModItemInput[],
  options: BuildOptions = {}
): PureMod {
  const config = resolveConfig(callerConfig);
  const flat = flattenItems(features);
  const assets = flat
    .filter(
      (placed): placed is { item: AssetFileItem; stem: string | undefined } =>
        placed.item.itemKind === "asset"
    )
    .sort((a, b) => compareUtf8(a.item.path, b.item.path));
  const warnings: ModWarning[] = [];
  const localization = createLocalizationAccumulator(warnings);
  const refUses: ReferenceUse[] = [];
  const pathUses: { owner: string; use: AssetPathUse }[] = [];

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
  const ownIdsByDir = new Map<string, Map<string, ContentTypeName>>();
  // Which Features placed items into each emitted file. A file merges several
  // Features' items whenever they share a stem or an output directory, so a
  // path claim reports a set of stems rather than one.
  const stemsByPath = new Map<LogicalPath, Set<string>>();
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
    const descriptor = contentDescriptor(item.type);
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
    // The same refusal on packaged rather than loaded evidence. A mint-shaped
    // registry has no id segment keeping its names clear of vanilla's, so the
    // collision is real and provable from the shipped id sets — and there is no
    // patch surface to redirect to, because a deliberate whole-object override
    // of a vanilla GFX definition is out of scope (SDK-125).
    if (PACKAGED_ID_EVIDENCE.get(item.type)?.().has(item.def.id) === true) {
      throw new Error(
        `${item.type} name "${item.def.id}" collides with a vanilla ${item.type} of the same ` +
          `name — defining it would silently override vanilla content, and overriding a vanilla ` +
          `${item.type} is out of scope; mint a different name`
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
    const relPath = emissionPath(
      config.prefix,
      descriptor.outputDir,
      stem ?? descriptor.fileStem,
      descriptor.fileExtension
    );
    const byPath =
      rawByType.get(item.type) ??
      new Map<LogicalPath, { items: Array<{ item: ContentItem; stem: string | undefined }> }>();
    const group = byPath.get(relPath) ?? { items: [] };
    group.items.push({ item, stem });
    byPath.set(relPath, group);
    rawByType.set(item.type, byPath);
    noteStem(stemsByPath, relPath, stem);
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
          content.define(
            item.type,
            item.def,
            (entries) =>
              localization.register({
                layer: "ordinary",
                language: "english",
                stem,
                entries,
              }),
            // The recorded mint, never the item's own `minted` property: a
            // build reached directly through `buildMod` gets the same
            // unforgeable answer `mod.feature` does.
            shapeMintOf(item)
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
        defined.toEntries(
          (use) => {
            refUses.push({ owner: `${group.type} "${defined.id}"`, use });
          },
          (use) => {
            pathUses.push({ owner: `${group.type} "${defined.id}"`, use });
          }
        )
      );
    }
  }

  // An Asset an emitted definition points at but no Feature places is the one
  // asset-path failure that is provable rather than merely unverified: the
  // Item exists, its path is written into the `.gfx`, and the file it names
  // will not be in the mod. Checked here, right where the uses were recorded,
  // because it needs nothing but this build's own placements.
  const placedAssets = new Set(assets.map(({ item }) => item));
  for (const { owner, use } of pathUses) {
    if (use.kind === "item" && !placedAssets.has(use.item)) {
      throw new Error(
        `${owner} references the Asset file "${use.path}" in "${use.field}", but no Feature ` +
          `passed to buildMod places it — the mod would ship a definition pointing at a file ` +
          `that is not in it; add the Asset to a feature, or write the path as a string if the ` +
          `file comes from somewhere else`
      );
    }
  }
  const contentFiles: ContentFile[] = pathOrder.map((relPath) => {
    const file = filesByPath.get(relPath)!;
    const envelope = fileRootEnvelope(
      relPath,
      file.types,
      (type) => contentDescriptor(type)?.rootEnvelope
    );
    return {
      relPath,
      types: file.types,
      ids: file.ids,
      entries: envelope === undefined ? file.entries : [block(envelope, file.entries)],
    };
  });

  const placedEvents = flat.filter(
    (placed): placed is { item: EventItemBase; stem: string | undefined } =>
      placed.item.itemKind === "event"
  );
  const eventStem = new Map(placedEvents.map(({ item, stem }) => [item, stem] as const));
  const eventsByPath = new Map<LogicalPath, { namespace: string; events: EventItemBase[] }>();
  for (const { item, stem } of placedEvents) {
    const relPath = emissionPath(config.prefix, "events", stem ?? "events", ".txt");
    noteStem(stemsByPath, relPath, stem);
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
  const onActionStems = new Set<string>();
  const bindings = flat.flatMap(({ item, stem }) => {
    if (item.itemKind !== "on-action") {
      return [];
    }
    if (stem !== undefined) {
      onActionStems.add(stem);
    }
    return [item];
  });
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
  const contributionStems = new Set<string>();
  for (const { item, stem } of flat) {
    if (item.itemKind !== "contribution") {
      continue;
    }
    if (stem !== undefined) {
      contributionStems.add(stem);
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
    vanillaIdsOf: (registry) => PACKAGED_ID_EVIDENCE.get(registry)?.(),
  });

  // One claim per emitted file, made by the merged file rather than by the
  // items in it: content from several registries sharing an output directory,
  // events from several Features, and localization keys registered under
  // several stems all deliberately land in one file, and claiming per item
  // would report those merges as duplicates.
  const claims: PathClaim[] = [
    {
      path: DESCRIPTOR_PATH,
      producer: { kind: "descriptor", stems: [], detail: "the mod descriptor" },
    },
  ];
  for (const { item, stem } of assets) {
    claims.push({
      path: item.path,
      producer: {
        kind: "asset",
        stems: stem === undefined ? [] : [stem],
        detail: `Asset file ${item.path}`,
      },
    });
  }
  for (const file of contentFiles) {
    claims.push({
      path: file.relPath,
      producer: {
        kind: "content",
        stems: stemsOf(stemsByPath, file.relPath),
        detail: `content ${file.ids.join(", ")}`,
      },
    });
  }
  for (const file of eventFiles) {
    claims.push({
      path: file.relPath,
      producer: {
        kind: "events",
        stems: stemsOf(stemsByPath, file.relPath),
        detail: `events in ${file.relPath}`,
      },
    });
  }
  const resolvedShipOfSizeLimitsPath =
    shipOfSizeLimits.size > 0 ? shipOfSizeLimitsPath(config.prefix) : undefined;
  if (resolvedShipOfSizeLimitsPath !== undefined) {
    claims.push({
      path: resolvedShipOfSizeLimitsPath,
      producer: {
        kind: "ship-of-size-limits",
        stems: [...contributionStems].sort(compareUtf8),
        detail: "the shared ship-of-size limits",
      },
    });
  }
  const resolvedOnActionsPath = onActions.length > 0 ? onActionsPath(config.prefix) : undefined;
  if (resolvedOnActionsPath !== undefined) {
    claims.push({
      path: resolvedOnActionsPath,
      producer: {
        kind: "on-actions",
        stems: [...onActionStems].sort(compareUtf8),
        detail: "the shared on-action hooks",
      },
    });
  }
  for (const file of localizationFiles) {
    claims.push({
      path: file.relPath,
      producer: {
        kind: "localization",
        stems: file.stems,
        detail: `${file.language} localization`,
      },
    });
  }

  // The patch plan mints its own filename and needs to steer clear of every
  // path already spoken for. `winningPath` can only avoid what it is shown, so
  // it sees the claims made so far rather than, as before, one registry's own
  // content files.
  const occupiedPaths = claims.map((claim) => claim.path);
  occupiedPaths.push(MATERIALIZATION_MANIFEST_PATH);

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
  for (const plan of patchPlans) {
    const registries = [...new Set(plan.assertions.map((assertion) => assertion.registry))].sort(
      compareUtf8
    );
    claims.push({
      path: plan.relPath,
      producer: {
        kind: "patch-plan",
        stems: [
          ...new Set(
            registries.flatMap((registry) =>
              (patchesByRegistry.get(registry) ?? []).flatMap((patched) => {
                const stem = patchStem.get(patched);
                return stem === undefined ? [] : [stem];
              })
            )
          ),
        ].sort(compareUtf8),
        detail: `the ${registries.join(", ")} patch plan`,
      },
    });
  }

  // The packaged vanilla path inventory is always present (ADR-0006): every
  // build checks its claims against it, whether or not the build loaded a
  // `VanillaView`. On top of that, every accepted origin adds its own
  // evidence — `options.vanilla` when supplied, and every patch's own view —
  // rather than only one of them: SDK-119's resolution states the rule
  // ("Assembly unions every matching inventory available"), and
  // `collectPatches` only enforces that every origin shares one
  // `manifestKey`, not that they are the same object. A hermetic
  // `options.vanilla` and a live-loaded patch origin can share a
  // `manifestKey` while carrying different `pathInventory`s, so picking just
  // one (`options.vanilla ?? patches[0]?.source.origin`) could silently drop
  // the other's live evidence. Deduped by reference first — several patches
  // usually share one origin object — so the (files, pathInventory) union is
  // built at most once per distinct view, not once per patch.
  const vanillaOrigins = new Set<VanillaView>();
  if (options.vanilla !== undefined) {
    vanillaOrigins.add(options.vanilla);
  }
  for (const patched of patches) {
    vanillaOrigins.add(patched.source.origin);
  }
  checkVanillaPathInventoryConsistency(installedVanillaPackageVersion());
  const vanillaPaths = immutableSet([
    ...packagedVanillaPaths(),
    ...[...vanillaOrigins].flatMap((origin) => origin.files.map((file) => file.path)),
    ...[...vanillaOrigins].flatMap((origin) => origin.pathInventory ?? []),
  ]);

  // Raw filepath strings, classified once the whole vanilla path union exists —
  // this is the first point in the fold where "does that file exist?" has all
  // its evidence. Never an error in any arm: a DLC path, another mod's path,
  // and a file the author ships outside the SDK are all legitimate here, and
  // none of them is knowable from inside this build.
  const placedAssetPaths = new Set<string>(assets.map(({ item }) => item.path));
  for (const { owner, use } of pathUses) {
    if (use.kind !== "string") {
      continue;
    }
    let normalized: string;
    try {
      normalized = normalizeLogicalPath(use.path);
    } catch {
      // An unnormalizable string cannot match anything either set holds, so it
      // is reported exactly like an unknown path, spelled as written.
      normalized = use.path;
    }
    if (placedAssetPaths.has(normalized) || vanillaPaths.has(normalized)) {
      continue;
    }
    warnings.push({
      code: "unverified-asset-path",
      message:
        `${owner} writes the path "${use.path}" in "${use.field}", and no Asset this build ` +
        `captures and no vanilla file has that path — check the spelling, or ignore this if the ` +
        `file comes from a DLC, another mod, or outside the SDK`,
      path: normalized,
      field: use.field,
      owner,
    });
  }

  // The last thing the fold decides. Everything above minted a path; this rules
  // on the whole set at once, so the `PureMod` below cannot exist unless every
  // output has exactly one owner.
  const paths = adjudicatePaths({ claims, vanillaPaths });

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
  const frozenAssets = Object.freeze([...assets.map(({ item }) => item)]);
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
    assets: frozenAssets,
    contentFiles: frozenContentFiles,
    eventFiles: frozenEventFiles,
    events: frozenEvents,
    onActions,
    localizationFiles,
    shipOfSizeLimits,
    onActionsPath: resolvedOnActionsPath,
    shipOfSizeLimitsPath: resolvedShipOfSizeLimitsPath,
    patchPlans,
    paths,
  });
}

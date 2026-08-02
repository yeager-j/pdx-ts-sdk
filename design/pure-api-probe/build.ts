/**
 * `buildMod`: the Mod builder's accumulators, written as the fold they
 * already were (SDK-22). Pure in the sense that matters: same config,
 * collections, and options produce the same value; all diagnostics are
 * throws or data on the returned value, never console output.
 *
 * Fold order: config → content → events → on-actions → contributions →
 * patches. Grouping is load-bearing twice over: localization insertion
 * order determines the emitted yml, and the patch plan reads the assembled
 * technology entries. It also keeps the `modifierDescKeys` WeakMap hazard
 * ordered — loc extraction (the write) always precedes lowering (the read,
 * in the emission grouping below).
 *
 * Emission paths are computed here, not in `render`: each collection's file
 * stem groups content into per-file entry lists, event files are one
 * namespace each by construction (co-declared at `createEvents`) with a
 * backstop check for same-stem merges, and the patch planner reserves and
 * enumerates every one of the mod's own technology files — the SDK-19
 * constraint that any splitting API must feed the path-order machinery,
 * not bypass it.
 */

import { kv, serialize, type PdxEntry, type PdxItem } from "@pdx-ts/pdxscript";

import { ContentAuthoring, type DefinedContent } from "../../src/content.ts";
import { StaleRuleTableError } from "../../src/errors.ts";
import type { DefinedEvent } from "../../src/events.ts";
import { CONTENT_REGISTRIES, type ContentTypeName } from "../../src/generated/content-registry.ts";
import type { ScopeName } from "../../src/generated/scopes.ts";
import type { ModConfig } from "../../src/mod.ts";
import { OnActionAuthoring } from "../../src/on-actions.ts";
import { normalizeLogicalPath } from "../../src/resolver/path-order.ts";
import { collectVarRefs, planPatchEmission, type PatchPlan } from "../../src/resolver/plan.ts";
import { SUPPORTED_STELLARIS_BUILD } from "../../src/resolver/rules.ts";
import type { PatchedTechnology } from "../../src/vanilla/patch.ts";
import { sha256Hex, type VanillaFile, type VanillaView } from "../../src/vanilla/surface.ts";
import { flattenItems, type EventItemBase, type ModItemInput, type ModWarning } from "./items.ts";

const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface BuildOptions {
  /**
   * The vanilla view the mod is built against. When present, a content id
   * colliding with a real vanilla id is a hard error (a define must not
   * silently override someone else's content), and every patch must come
   * from this exact view. Without it, only the prefix warning stands.
   */
  readonly vanilla?: VanillaView;
}

/** One emitted file: path plus the entries serialized into it, in order. */
export interface EmittedFile {
  readonly relPath: string;
  readonly entries: readonly PdxEntry[];
}

interface ContentFile extends EmittedFile {
  readonly type: ContentTypeName;
  readonly ids: readonly string[];
}

/** The assembled mod: a value, not a builder. `render(mod)` consumes it. */
export interface PureMod {
  readonly config: ModConfig;
  readonly warnings: readonly ModWarning[];
  /** Content emission, grouped by registry then collection file. */
  readonly contentFiles: readonly ContentFile[];
  /** Event emission: one file per stem, one namespace per file. */
  readonly eventFiles: readonly EmittedFile[];
  readonly events: readonly EventItemBase[];
  readonly onActions: OnActionAuthoring;
  readonly loc: ReadonlyMap<string, string>;
  readonly shipOfSizeLimits: ReadonlySet<string>;
  readonly patchPlan: PatchPlan | undefined;
  /** Normalized vanilla paths for render's collision check; set when patched. */
  readonly vanillaPaths: ReadonlySet<string> | undefined;
}

/** `<outputDir>/<prefix>_<stem>.txt`. Stems are validated flat snake_case,
 * so the emitted path is total and safe by construction. */
function emissionPath(prefix: string, outputDir: string, stem: string): string {
  return `${outputDir}/${prefix}_${stem}.txt`;
}

export function buildMod(
  config: ModConfig,
  collections: readonly ModItemInput[],
  options: BuildOptions = {}
): PureMod {
  if (!PREFIX_PATTERN.test(config.prefix)) {
    throw new Error(`Mod prefix "${config.prefix}" must be lowercase snake_case ([a-z][a-z0-9_]*)`);
  }
  const flat = flattenItems(collections);
  const warnings: ModWarning[] = [];
  const loc = new Map<string, string>();

  const registerLocEntries = (entries: readonly (readonly [string, string])[]): void => {
    const pending = new Set<string>();
    for (const [key] of entries) {
      if (loc.has(key) || pending.has(key)) {
        throw new Error(`Duplicate localization key "${key}"`);
      }
      pending.add(key);
    }
    for (const [key, source] of entries) {
      let text = source;
      if (text.includes('"')) {
        warnings.push({
          code: "loc-quote-replaced",
          message: `Localization "${key}": Paradox yml has no quote escaping; replacing " with '`,
        });
        text = text.replaceAll('"', "'");
      }
      loc.set(key, text);
    }
  };

  const content = new ContentAuthoring(
    config.prefix,
    CONTENT_REGISTRIES,
    registerLocEntries,
    (message) => warnings.push({ code: "missing-prefix", message })
  );

  // Vanilla ids by output directory: the collision guard's index. Only
  // directories the view actually parsed can guard — honest about coverage.
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

  // Content, in item order — the order the emitted files and loc yml keep.
  // Each definition records where its collection placed it.
  interface Placement {
    readonly type: ContentTypeName;
    readonly relPath: string;
    readonly defined: DefinedContent<string, { readonly id: string }>;
  }
  const placements: Placement[] = [];
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
    placements.push({
      type: item.type,
      relPath: emissionPath(config.prefix, descriptor.outputDir, file ?? descriptor.fileStem),
      defined: content.define(item.type, item.def),
    });
  }

  // Group placements into files: registry declaration order (matching the
  // class API for default stems), then collection files by first appearance.
  // Lowering happens here — after every define, so the modifierDescKeys
  // write has always preceded this read.
  const contentFiles: ContentFile[] = [];
  for (const descriptor of CONTENT_REGISTRIES) {
    const rows = placements.filter((placement) => placement.type === descriptor.type);
    const byPath = new Map<string, Placement[]>();
    for (const row of rows) {
      const group = byPath.get(row.relPath) ?? [];
      group.push(row);
      byPath.set(row.relPath, group);
    }
    for (const [relPath, group] of byPath) {
      contentFiles.push({
        relPath,
        type: descriptor.type as ContentTypeName,
        ids: group.map((row) => row.defined.id),
        entries: group.map((row) => row.defined.toEntries()),
      });
    }
  }

  // Events arrive as finished data (closures ran at the definition site,
  // where createEvents knew the namespace). The fold's jobs: the global
  // duplicate check across factories, the loc merge, per-namespace prefix
  // warnings, and file grouping with the one-namespace-per-file backstop.
  const placedEvents = flat.filter(
    (placed): placed is { item: EventItemBase; file: string | undefined } =>
      placed.item.itemKind === "event"
  );
  const eventIds = new Set<string>();
  const namespaces: string[] = [];
  for (const { item } of placedEvents) {
    if (eventIds.has(item.id)) {
      throw new Error(`Duplicate event id "${item.id}"`);
    }
    eventIds.add(item.id);
    registerLocEntries(item.locEntries);
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

  // One namespace per event file. createEvents makes this hold by
  // construction; the check catches same-stem merges of two factories.
  const eventsByPath = new Map<string, { namespace: string; events: EventItemBase[] }>();
  for (const { item, file } of placedEvents) {
    const relPath = emissionPath(config.prefix, "events", file ?? "events");
    const group = eventsByPath.get(relPath);
    if (group === undefined) {
      eventsByPath.set(relPath, { namespace: item.namespace, events: [item] });
    } else if (group.namespace !== item.namespace) {
      throw new Error(
        `event file ${relPath} would mix namespaces "${group.namespace}" and ` +
          `"${item.namespace}" — one namespace per file; give each createEvents its own file stem`
      );
    } else {
      group.events.push(item);
    }
  }
  const eventFiles: EmittedFile[] = [...eventsByPath].map(([relPath, group]) => ({
    relPath,
    entries: [kv("namespace", group.namespace), ...group.events.map((event) => event.entry)],
  }));

  // On-actions: ownership is membership in this build, by value identity.
  const includedEvents = new Set<EventItemBase>(placedEvents.map(({ item }) => item));
  const onActions = new OnActionAuthoring((event) =>
    includedEvents.has(event as unknown as EventItemBase)
  );
  for (const { item } of flat) {
    if (item.itemKind !== "on-action") {
      continue;
    }
    if (!includedEvents.has(item.event)) {
      throw new Error(
        `Event "${item.event.id}" is not among the collections passed to buildMod; ` +
          `on-action "${item.hook.name}" can only fire this mod's own events`
      );
    }
    onActions.register(item.hook, item.event as DefinedEvent<ScopeName, ScopeName | undefined>);
  }

  // Contributions: union into the shared sink; a limit listed twice emits once.
  const shipOfSizeLimits = new Set<string>();
  for (const { item } of flat) {
    if (item.itemKind !== "contribution") {
      continue;
    }
    for (const id of item.ids) {
      shipOfSizeLimits.add(id);
    }
  }

  // Patches: seen together, so the duplicate and one-view checks live here.
  const patches: PatchedTechnology[] = [];
  for (const { item } of flat) {
    if (item.itemKind !== "patch") {
      continue;
    }
    const patched = item.patched;
    if (patches.some((existing) => existing.id === patched.id)) {
      throw new Error(`Duplicate patch for technology "${patched.id}"`);
    }
    const expected = options.vanilla?.manifestKey ?? patches[0]?.source.origin.manifestKey;
    if (expected !== undefined && patched.source.origin.manifestKey !== expected) {
      throw new Error(
        `Patch for "${patched.id}" comes from a different vanilla load than ` +
          `${options.vanilla !== undefined ? "the view passed to buildMod" : "earlier patches"} ` +
          `(manifest ${patched.source.origin.manifestKey.slice(0, 12)} vs ${expected.slice(0, 12)}); ` +
          `patch one mod from one view`
      );
    }
    patches.push(patched);
  }

  // The dangling-reference guard: with plain string ids, firing an event
  // whose collection was never passed to buildMod would silently emit a
  // well-formed id with no definition behind it. Scan every emitted entry
  // tree for scalars shaped like one of this mod's own event ids and demand
  // a definition — the getter throw this replaces died with the stamp.
  const ownEventId = new RegExp(`^${config.prefix}[a-z0-9_]*\\.\\d+$`);
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
  for (const file of contentFiles) {
    scan(file.entries);
  }
  for (const file of eventFiles) {
    scan(file.entries);
  }
  for (const value of scanned) {
    if (ownEventId.test(value) && !eventIds.has(value)) {
      throw new Error(
        `"${value}" looks like one of this mod's event ids, but no such event is among the ` +
          `collections passed to buildMod — was its createEvents(...) collection included?`
      );
    }
  }

  const patchPlan = planPatches(
    config,
    contentFiles.filter((file) => file.type === "technology"),
    patches
  );
  const vanillaPaths =
    patches.length > 0
      ? new Set(patches[0]!.source.origin.files.map((file) => file.path))
      : undefined;

  return Object.freeze({
    config,
    warnings,
    contentFiles,
    eventFiles,
    events: placedEvents.map(({ item }) => item),
    onActions,
    loc,
    shipOfSizeLimits,
    patchPlan,
    vanillaPaths,
  });
}

/**
 * `Mod.patchPlan()` (src/mod.ts) over explicit inputs instead of `this` —
 * and over *every* one of the mod's own technology files, not one fixed
 * stem. With collections a registry can split, so each own file joins the
 * surviving-file enumeration (its name competes for path order) and the
 * reserved list (the patch file must not be named over it).
 */
function planPatches(
  config: ModConfig,
  techFiles: readonly ContentFile[],
  patches: readonly PatchedTechnology[]
): PatchPlan | undefined {
  if (patches.length === 0) {
    return undefined;
  }
  const { prefix } = config;
  const origin = patches[0]!.source.origin;
  if (
    origin.gameVersion !== undefined &&
    origin.gameVersion !== SUPPORTED_STELLARIS_BUILD &&
    config.acceptGameVersion !== origin.gameVersion
  ) {
    throw new StaleRuleTableError(
      `the install is Stellaris ${origin.gameVersion} but the rule table is verified against ` +
        `${SUPPORTED_STELLARIS_BUILD} — re-verify the oracle runs, or set ` +
        `acceptGameVersion: "${origin.gameVersion}" to proceed on the stale table`
    );
  }

  const enumeration: VanillaFile[] = [
    ...origin.files.filter((file) => file.path.startsWith("common/technology/")),
    ...techFiles.map((file) => ({
      path: normalizeLogicalPath(file.relPath),
      sha256: sha256Hex(serialize(file.entries)),
      keys: file.ids,
    })),
  ];

  return planPatchEmission({
    registry: "technologies",
    patches: patches.map((patched) => {
      const entry = patched.toEntries();
      const fileLocals = origin.localVariables(patched.source.sourceFile);
      const locals = new Map<string, number>();
      for (const name of collectVarRefs(entry)) {
        const value = fileLocals.get(name);
        if (value !== undefined) {
          locals.set(name, value);
        }
      }
      return {
        key: patched.id,
        sourceFile: patched.source.sourceFile,
        sourceSha256: patched.source.sourceSha256,
        entry,
        locals,
      };
    }),
    enumeration,
    reservedPaths: techFiles.map((file) => file.relPath),
    prefix,
  });
}

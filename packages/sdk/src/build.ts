/**
 * `buildMod`: the mod assembly, written as the fold it is (SDK-22). Pure in the sense that matters: same config,
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
 * Emission order is a function of the content alone (SDK-23), never of source
 * position or the order collections were passed: content sorts by registry
 * declaration order, then emitted file path bytes, then id bytes; event files
 * sort by path bytes with numeric ids inside a file; on-action hook blocks
 * sort by hook name; the contribution sink and the patch list sort by id.
 * Arrays *inside* a definition — prerequisites, options, weight modifiers —
 * are author data and are left exactly as written. This is why content is
 * defined in three passes below: `define` registers localization as a side
 * effect, so it cannot run before the canonical order is known, or the loc
 * yml would desynchronize from the txt files it describes.
 *
 * Emission paths are computed here, not in `render`: each collection's file
 * stem groups content into per-file entry lists, event files are checked to
 * hold exactly one namespace each (in both directions), and the patch planner reserves and
 * enumerates every one of the mod's own technology files — the SDK-19
 * constraint that any splitting API must feed the path-order machinery,
 * not bypass it.
 */

import { kv, serialize, type PdxEntry, type PdxItem } from "@pdx-ts/pdxscript";

import { ContentAuthoring, type ContentRefUse, type DefinedContent } from "./content.ts";
import { StaleRuleTableError } from "./errors.ts";
import type { DefinedEvent } from "./events.ts";
import { CONTENT_REGISTRIES, type ContentTypeName } from "./generated/content-registry.ts";
import type { ScopeName } from "./generated/scopes.ts";
import {
  flattenItems,
  type ContentItem,
  type EventItemBase,
  type ModItemInput,
  type ModWarning,
  type OnActionBindingItem,
} from "./items.ts";
import { OnActionAuthoring } from "./on-actions.ts";
import { compareUtf8, normalizeLogicalPath } from "./resolver/path-order.ts";
import { collectVarRefs, planPatchEmission, type PatchPlan } from "./resolver/plan.ts";
import { SUPPORTED_STELLARIS_BUILD } from "./resolver/rules.ts";
import { checkVanillaPackagePin, installedVanillaPackageVersion } from "./vanilla/package-pin.ts";
import type { PatchedTechnology } from "./vanilla/patch.ts";
import { sha256Hex, type VanillaFile, type VanillaView } from "./vanilla/surface.ts";

const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * A launcher `supported_version`: one to three dot-separated parts, each a
 * number or `*`, with an optional leading `v`. Both spellings of the `v` are
 * accepted because both load — `supportedVersionFor` picks which one the SDK
 * *writes*, and normalizing an author's own string into emitted bytes would be
 * a worse trade than tolerating theirs.
 */
const SUPPORTED_VERSION_PATTERN = /^v?(\d+|\*)(\.(\d+|\*)){0,2}$/;

/** The mod's identity and launcher metadata: `buildMod`'s first argument. */
export interface ModConfig<P extends string = string> {
  /** Display name shown in the launcher. */
  name: string;
  /** Namespace for everything the mod emits: file names and content ids. Lowercase snake_case. */
  prefix: P;
  version?: string;
  /** Game version pattern, e.g. "4.0.*". */
  supportedVersion: string;
  tags?: string[];
  /**
   * Acknowledges a game build the rule table is not verified against.
   * Patch emission refuses when the loaded install's version differs from
   * the table's pin; setting this to that exact version proceeds anyway —
   * an explicit, per-version acceptance, never a blanket one.
   */
  acceptGameVersion?: string;
}

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
  /**
   * Every registry that lowered a definition into this file, in registry
   * declaration order. Usually one entry — distinct registries only share a
   * `relPath` when they share an `outputDir` and file stem, which today is
   * true of exactly the three component-template registries (SDK-32),
   * mirroring the game's own `components.cwt` layout.
   */
  readonly types: readonly ContentTypeName[];
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
  /** The on-action hook blocks, already in emission order. */
  readonly onActions: readonly PdxEntry[];
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

/** The numeric half of `namespace.N`. Only ever called for events already
 * grouped under that namespace, so the slice is total. */
function eventNumber(event: EventItemBase, namespace: string): number {
  return Number(event.id.slice(namespace.length + 1));
}

export function buildMod(
  config: ModConfig,
  collections: readonly ModItemInput[],
  options: BuildOptions = {}
): PureMod {
  if (!PREFIX_PATTERN.test(config.prefix)) {
    throw new Error(`Mod prefix "${config.prefix}" must be lowercase snake_case ([a-z][a-z0-9_]*)`);
  }
  if (config.name.includes('"')) {
    // `descriptor.mod` writes `name="<name>"`, and PDXScript has no quote
    // escaping to rescue it — the launcher answers the malformed result by
    // refusing the mod without saying why. Localization already replaces quotes
    // rather than emitting them; a mod's own name is identity, so it is refused
    // instead of silently rewritten.
    throw new Error(
      `Mod name ${JSON.stringify(config.name)} cannot contain a double quote: it is written ` +
        `verbatim into descriptor.mod, which has no way to escape one.`
    );
  }
  if (!SUPPORTED_VERSION_PATTERN.test(config.supportedVersion)) {
    throw new Error(
      `supportedVersion "${config.supportedVersion}" is not a launcher version pattern ` +
        `(e.g. "v4.4.*", "v4.*", "v4.4.6"). It is written verbatim into descriptor.mod, and ` +
        `the launcher answers an unreadable one by silently refusing the mod.`
    );
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

  // Every own-prefixed content reference the build writes, with the thing that
  // wrote it. Filled while lowering (and by the patch and contribution folds),
  // resolved against the built ids once every collection has been seen.
  const refUses: { readonly owner: string; readonly use: ContentRefUse }[] = [];

  // Own ids by output directory (SDK-32): the same index shape as the
  // vanilla-collision guard below, for the same reason — the game loads
  // every file it finds in a directory and merges their keys into one
  // namespace, so `outputDir` is the scope a key must be unique in, not
  // `relPath`. That was always true, but unreachable, for two *own*
  // definitions before this build started merging same-relPath registries
  // (SDK-32 above): two different registries could not previously land two
  // definitions in the game's eyes one directory apart with different stems
  // and still collide, because nothing forced them into the same file to
  // notice. `component_template`'s three subtypes are exactly that case —
  // CWT itself models them as one `type[component_template]` — and a
  // same-outputDir, different-stem collision is exactly as broken in-game
  // (an undetermined last-loaded winner) as the same-file collision the
  // merge above now allows, so both are checked here rather than only the
  // same-file one. Per-registry duplicate ids are still `ContentAuthoring
  // .define`'s job in pass 2; this only catches two different registries
  // claiming the same id.
  const ownIdsByDir = new Map<string, Map<string, ContentTypeName>>();

  // Content pass 1: collect the raw items into registry → emitted file →
  // items, without defining any of them. Nothing here depends on the order
  // the items arrived in — the unknown-type, vanilla-collision, and own-id
  // checks are per item — which is the point: `define` registers
  // localization as a side effect, so it must not run until the canonical
  // order is known, or the loc yml would follow item order while the txt
  // files follow this one.
  const rawByType = new Map<ContentTypeName, Map<string, ContentItem[]>>();
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

  // Content pass 2: define in canonical order (SDK-23) — registry declaration
  // order, then emitted files by path bytes, then items by id bytes. Defining
  // here rather than above is what keeps the localization insertion order and
  // the emitted files one and the same order.
  interface DefinedGroup {
    readonly type: ContentTypeName;
    readonly relPath: string;
    readonly defined: readonly DefinedContent<string, { readonly id: string }>[];
  }
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

  // Content pass 3: lower, merging groups that land at the same relPath
  // (SDK-32). Separate from the defining loop, not merged into it, because
  // lowering reads the modifierDescKeys WeakMap that defining writes — every
  // define must precede every read, whatever the grouping.
  //
  // Distinct registries can resolve to the same emitted path (only the three
  // component-template registries do, since only they share an `outputDir` —
  // the game's own `components.cwt` groups them the same way), and `render`
  // keys its file map by relPath, so two registries landing on one path have
  // to merge into a single file here rather than let the second silently win
  // a `Map.set`. `definedGroups` is already walked in the required order —
  // `CONTENT_REGISTRIES` declaration order outer, path bytes middle, id bytes
  // inner — so appending each group's entries to its path's file in
  // encounter order keeps a merged file in "registry declaration order, then
  // id" with no extra sort, and keeps a non-colliding file identical to
  // before. That also preserves order-purity: which module or collection
  // authored a definition never decided this order, so it still doesn't.
  interface MergedFile {
    readonly types: ContentTypeName[];
    readonly ids: string[];
    readonly entries: PdxEntry[];
  }
  const filesByPath = new Map<string, MergedFile>();
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

  // Events arrive as finished data (closures ran at the definition site,
  // where the namespace handle knew the namespace). The fold's jobs: the
  // global duplicate check across handles, the loc merge, per-namespace prefix
  // warnings, and file grouping with the one-namespace-per-file backstop.
  const placedEvents = flat.filter(
    (placed): placed is { item: EventItemBase; file: string | undefined } =>
      placed.item.itemKind === "event"
  );

  // Grouping runs first now, so the duplicate check, the loc merge and the
  // prefix warnings can all run in the canonical order below. One namespace
  // per event file, checked here because a collection can be handed events
  // from two namespaces and two collections can share one file stem.
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
  // The other half of the bijection (SDK-23 decision 1): the grouping above
  // forbids two namespaces in one file, this forbids one namespace across two
  // files. A split namespace splits its numeric id space across independent
  // define-site duplicate checks, and makes which file an event lands in a
  // fact about layout rather than about the event's identity.
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

  // Files by path bytes; events inside a file by their *numeric* id, which is
  // well defined because a file carries exactly one namespace (the backstop
  // above). Sorting the full ids as text would file `ns.10` before `ns.2`.
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
    // An event's closures ran at its definition site and reported what they
    // wrote there; the references arrive as finished data like everything
    // else on the item, and face the same guard as a declarative field.
    for (const use of item.refs) {
      refUses.push({ owner: `event "${item.id}"`, use });
    }
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

  const eventFiles: EmittedFile[] = eventGroups.map((group) => ({
    relPath: group.relPath,
    entries: [kv("namespace", group.namespace), ...group.events.map((event) => event.entry)],
  }));

  // On-actions: ownership is membership in this build, by value identity.
  const includedEvents = new Set<EventItemBase>(placedEvents.map(({ item }) => item));
  const onActionAuthoring = new OnActionAuthoring((event) =>
    includedEvents.has(event as unknown as EventItemBase)
  );
  // The array inside one `on()` call is author data. Which `on()` call comes
  // first is not: two collections — or two discovered modules — can each bind
  // the same hook, and collection order must never reach the output (SDK-23).
  // So the calls are ordered by hook name, then by their event-id sequence,
  // and only then registered straight down each array.
  const bindings = flat.flatMap(({ item }) => (item.itemKind === "on-action" ? [item] : []));
  const bindingOrder = (item: OnActionBindingItem): string =>
    item.events.map((event) => event.id).join("\u0000");
  const orderedBindings = [...bindings].sort(
    (a, b) => compareUtf8(a.hook.name, b.hook.name) || compareUtf8(bindingOrder(a), bindingOrder(b))
  );
  for (const item of orderedBindings) {
    for (const event of item.events) {
      if (!includedEvents.has(event)) {
        throw new Error(
          `Event "${event.id}" is not among the collections passed to buildMod; ` +
            `on-action "${item.hook.name}" can only fire this mod's own events`
        );
      }
      onActionAuthoring.register(
        item.hook,
        event as DefinedEvent<ScopeName, ScopeName | undefined>
      );
    }
  }
  // The accumulator stays inside the fold; the mod carries only its finished
  // entries. Handing out the live instance would let a caller register after
  // `buildMod` returned and change what `render` emits — a builder backdoor
  // around the collection fold and its ordering rules.
  const onActions = onActionAuthoring.entries();

  // Contributions: union into the shared sink; a limit listed twice emits
  // once. The sink is a Set, which `render` iterates in insertion order, so
  // the ids go in sorted — the emitted list is the content, not the order the
  // contributions happened to arrive in.
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
    for (const use of patched.refs) {
      refUses.push({ owner: `the patch of ${patched.id}`, use });
    }
  }

  // The dangling-reference guard: with plain string ids, firing an event
  // whose collection was never passed to buildMod would silently emit a
  // well-formed id with no definition behind it. Scan every emitted entry
  // tree for scalars shaped like one of this mod's own event ids and demand
  // a definition — the getter throw this replaces died with the stamp.
  // The prefix is delimited, matching the namespaces the warning above accepts
  // (`prefix` or `prefix_*`) rather than every namespace that merely starts
  // with those characters: for prefix `foo`, a third-party `foobar.1` is
  // somebody else's event, and firing it must not demand a definition here.
  const ownEventId = new RegExp(`^${config.prefix}(_[a-z0-9_]*)?\\.\\d+$`);
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
          `collections passed to buildMod — was the collection holding it included?`
      );
    }
  }

  // The content half of the same guard. Where events are found by scanning
  // emitted scalars for an id shape, content references are recorded as they
  // are lowered, from field metadata that still says which registries the id
  // may name. That is the difference between "an own-prefixed string" — flags,
  // localization keys, saved event targets are all that — and a reference: only
  // a field the rules say holds `<technology>` demands a built technology.
  // Keyed by the CWT reference a field can name, which is what its `refTypes`
  // says — not by the registry name, which no field ever names and which meant
  // that for a registry the manifest split out of a shared CWT type, no field
  // matched at all and every reference to one went unchecked.
  //
  // One target can answer to several registries. A qualified reference names
  // exactly one (`<component_template.utility_component_template>`), while the
  // bare type names every registry split out of it: a field holding
  // `<component_template>` takes a utility, weapon, or strike-craft template,
  // so an id is accounted for if any of the three defined it.
  //
  // Only the registry → target direction was covered here (SDK-37): a registry
  // whose own `referenceName` is qualified also registers its bare prefix, so
  // a bare-target field resolves. The reverse never held — a registry whose
  // `referenceName` is itself bare (`civic_or_origin`, `component_set`, never
  // split by the manifest) registers only that bare key, while its own fields
  // can still target a *subtype* of it (`civic_or_origin.civic`,
  // `component_set.required_component`) when the vendored rules declare one.
  // `resolveTargetRegistries` below tries the exact target first and only
  // then falls back to the bare prefix, so both directions resolve through
  // the same map without registering every subtype combination up front.
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
  /**
   * Resolves a `refTypes` target to the registries that can satisfy it: the
   * exact target if a registry registered it, else — for a qualified target
   * like `"civic_or_origin.civic"` — the bare registry it qualifies, if that
   * registry exists and was never itself split into subtypes. A registry
   * this bare fallback resolves does not distinguish which subtype an id
   * belongs to (the guard only proves the id exists, not that it exists as
   * the *right* subtype) — see SDK-41 for the subtype split that would close
   * that gap; unresolvable here for either form is still "nothing here could
   * have defined it".
   */
  const resolveTargetRegistries = (target: string): readonly string[] | undefined => {
    const exact = registriesByTarget.get(target);
    if (exact !== undefined) {
      return exact;
    }
    const qualifier = target.indexOf(".");
    return qualifier === -1 ? undefined : registriesByTarget.get(target.slice(0, qualifier));
  };
  const builtIds = new Map<string, Set<string>>();
  for (const group of definedGroups) {
    const ids = builtIds.get(group.type) ?? new Set<string>();
    for (const defined of group.defined) {
      ids.add(defined.id);
    }
    builtIds.set(group.type, ids);
  }
  // Nested "swap" definitions that double as their owning registry's own
  // reference target (SDK-38, widened for the P1 in SDK-37's review): the
  // vendored rules declare a `base_type` relationship for exactly five
  // registries the SDK exposes, mechanically enumerated by
  // `grep -rn "base_type" vendor/cwtools-stellaris-config/config/` against
  // the pin this codegen ran against (`251fe1189b4e`) — every hit, so a
  // sixth showing up in a future vendor bump is a diff on this list, not a
  // silent gap:
  //   - common/traditions.cwt:17                type[swapped_tradition]      base_type = tradition
  //   - common/ascension_perks.cwt:16            type[swapped_ascension_perk] base_type = ascension_perk
  //   - common/technologies_consolidated.cwt:58  type[swapped_technology]    base_type = technology
  //   - common/pop_jobs.cwt:33                   type[swapped_job]           base_type = job
  //   - common/governments.cwt:97                type[swapped_civic]         base_type = civic_or_origin.civic
  //   - common/governments.cwt:20                type[swapped_authority]     base_type = authority
  //     (excluded: `authority` has no `defineAuthority` — CONTENT_MANIFEST
  //     never registers it as an SDK registry, so there is no `builtIds` set
  //     for its swap ids to join)
  // Every one of the five folds into *its own* registry's built-id set —
  // `base_type` never names a different registry than the one declaring the
  // swap field — so this cannot loosen the guard for an unrelated registry.
  //
  // `civic_or_origin.swap_type`, `technology.technology_swap`, and
  // `job.swap_type` are CWT "shape 3": an anonymous repeated block
  // (`name_field = "name"`) rather than `tradition.tradition_swap`'s
  // record-keyed "shape 2". `ContentAuthoring`'s `nestedIds` bookkeeping
  // (`content.ts`'s `collectRepeatedStructs`) only tracks the record-keyed
  // shape, so all five are read directly off each definition's own resolved
  // `def` here instead — one mechanism for both shapes, rather than pairing
  // this table with a second, codegen-side one that would need to stay in
  // sync with it by hand. Teaching `collectRepeatedStructs` (or the
  // generated field metadata) to recognize the shape-3 case is real codegen
  // surgery — a new `ContentField` concept, `base_type`/`type_key_filter`
  // cross-referencing to attribute a `type[swapped_x]` back to its owning
  // field, and regenerating four files — with no behavioral upside over
  // reading `def` directly, since the guard only needs the id strings.
  interface SwapIdentity {
    /** Registry the swap field lives on, and also the fold target — every
     * `base_type` above names its own declaring registry. */
    readonly registryType: string;
    /**
     * The resolved `def`'s member path to the swap field (camelCase),
     * walked from the definition root. Usually one segment; `job`'s swap
     * field sits inside the `swappable_data` wrapper CWT declares alongside
     * it (`swappableData.swapType`), so this is a path rather than a single
     * member.
     */
    readonly path: readonly string[];
    /** Reads swap ids off the value at `path`. */
    readonly extract: (value: unknown) => readonly string[];
  }
  const readPath = (value: unknown, path: readonly string[]): unknown =>
    path.reduce<unknown>(
      (current, segment) =>
        current !== null && typeof current === "object"
          ? (current as Readonly<Record<string, unknown>>)[segment]
          : undefined,
      value
    );
  const recordKeys = (value: unknown): readonly string[] =>
    value !== null && typeof value === "object" ? Object.keys(value) : [];
  const arrayNames = (value: unknown): readonly string[] =>
    Array.isArray(value)
      ? value.flatMap((item: unknown) =>
          typeof (item as { readonly name?: unknown } | null)?.name === "string"
            ? [(item as { readonly name: string }).name]
            : []
        )
      : [];
  const SWAP_IDENTITIES: readonly SwapIdentity[] = [
    { registryType: "tradition", path: ["traditionSwap"], extract: recordKeys },
    { registryType: "ascension_perk", path: ["traditionSwap"], extract: recordKeys },
    { registryType: "civic_or_origin", path: ["swapType"], extract: arrayNames },
    { registryType: "technology", path: ["technologySwap"], extract: arrayNames },
    { registryType: "job", path: ["swappableData", "swapType"], extract: arrayNames },
  ];
  const definedByType = new Map<string, DefinedGroup["defined"][number][]>();
  for (const group of definedGroups) {
    definedByType.set(group.type, [...(definedByType.get(group.type) ?? []), ...group.defined]);
  }
  for (const { registryType, path, extract } of SWAP_IDENTITIES) {
    const defined = definedByType.get(registryType);
    if (defined === undefined) {
      continue;
    }
    const ids = builtIds.get(registryType) ?? new Set<string>();
    for (const definition of defined) {
      for (const id of extract(readPath(definition.def, path))) {
        ids.add(id);
      }
    }
    builtIds.set(registryType, ids);
  }
  for (const { owner, use } of refUses) {
    // Vanilla and third-party ids are somebody else's to define, exactly as
    // the prefix policy and the event scan have it.
    if (!use.id.startsWith(`${config.prefix}_`)) {
      continue;
    }
    // A target this SDK cannot author (`<technology_tier>`) or a field that
    // also admits non-references excuses the id: nothing here could have
    // defined it, so its absence is not evidence of a mistake.
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
        `among the collections passed to buildMod — the id carries this mod's prefix ` +
        `"${config.prefix}_", so this build has to define it; was its collection passed to buildMod?`
    );
  }

  // Patch emission is content too: the plan enumerates and serializes the
  // patched entries, so they go in by id rather than by arrival.
  const orderedPatches = [...patches].sort((a, b) => compareUtf8(a.id, b.id));
  const patchPlan = planPatches(
    config,
    contentFiles.filter((file) => file.types.includes("technology")),
    orderedPatches
  );
  const vanillaPaths =
    orderedPatches.length > 0
      ? new Set(orderedPatches[0]!.source.origin.files.map((file) => file.path))
      : undefined;

  // Identifier-package version pin (SDK-12), checked after the rule-table
  // staleness gate above: rule-table staleness outranks identifier-package
  // staleness because patch emission — what that gate guards — is the more
  // dangerous operation. This gate is broader (it fires whenever a vanilla
  // view is supplied at all, not only when patches exist, because vanilla
  // identifiers can be authored anywhere a reference is written) but must
  // never change which error a stale-rule-table build sees, so it runs
  // strictly after `planPatches` has had its chance to throw.
  if (options.vanilla !== undefined) {
    checkVanillaPackagePin(
      installedVanillaPackageVersion(),
      options.vanilla.gameVersion,
      config.acceptGameVersion
    );
  }

  return Object.freeze({
    config,
    warnings,
    contentFiles,
    eventFiles,
    events: orderedEvents,
    onActions,
    loc,
    shipOfSizeLimits,
    patchPlan,
    vanillaPaths,
  });
}

/**
 * The patch plan over explicit inputs, and over *every* one of the mod's own
 * technology files rather than one fixed stem. With collections a registry can split, so each own file joins the
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

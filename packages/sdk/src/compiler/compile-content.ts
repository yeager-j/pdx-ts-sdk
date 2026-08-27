import { block, type PdxEntry } from "@pdx-ts/pdxscript";

import { ContentAuthoring } from "../content/authoring.ts";
import { contentDescriptor } from "../content/descriptors.ts";
import { shapeMintOf } from "../content/mint-provenance.ts";
import type { ContentItem } from "../content/types.ts";
import { CONTENT_REGISTRIES, type ContentTypeName } from "../generated/content-registry.ts";
import { PACKAGED_ID_EVIDENCE } from "../identifiers/vanilla-gfx-ids.ts";
import { compareUtf8, normalizeLogicalPath, type LogicalPath } from "../ordering.ts";
import { noteStem, type BuildSession } from "./compile-session.ts";
import { registerLocalization } from "./localization.ts";
import type { ContentFile, DefinedGroup } from "./model.ts";

/** Content definitions and files produced by the three content passes. */
export interface CompiledContent {
  readonly contentFiles: readonly ContentFile[];
  readonly definedGroups: readonly DefinedGroup[];
}

type RawContentGroups = Map<
  ContentTypeName,
  Map<LogicalPath, { items: Array<{ item: ContentItem; stem: string | undefined }> }>
>;

/** Returns the canonical emitted path for one content or event file. */
export function emissionPath(
  prefix: string,
  outputDir: string,
  stem: string,
  extension: string
): LogicalPath {
  return normalizeLogicalPath(`${outputDir}/${prefix}_${stem}${extension}`);
}

/**
 * Resolves the optional root block for registries that share one emitted file.
 *
 * A file has one envelope, so every registry merged into it must agree.
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

/** Collects, defines, and lowers content while preserving canonical definition order. */
export function compileContent(session: BuildSession): CompiledContent {
  const content = new ContentAuthoring(
    session.config.prefix,
    CONTENT_REGISTRIES,
    () => {},
    (message) => session.warnings.push({ code: "missing-prefix", message }),
    (message) => session.warnings.push({ code: "unstable-desc-key", message }),
    (message) => session.warnings.push({ code: "loc-key-looks-like-text", message })
  );
  const rawGroups = collectContentGroups(session);
  const definedGroups = defineContentGroups(session, content, rawGroups);
  const contentFiles = lowerContentGroups(session, definedGroups);
  assertPlacedAssetReferences(session);

  return { contentFiles, definedGroups };
}

function collectContentGroups(session: BuildSession): RawContentGroups {
  const vanillaKeysByDir = collectVanillaKeysByDirectory(session);
  const ownIdsByDir = new Map<string, Map<string, ContentTypeName>>();
  const rawByType: RawContentGroups = new Map();

  for (const { item, stem } of session.flat) {
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
    assertNoPackagedVanillaCollision(item);
    registerOwnId(ownIdsByDir, descriptor.outputDir, item);

    const relPath = emissionPath(
      session.config.prefix,
      descriptor.outputDir,
      stem ?? descriptor.fileStem,
      descriptor.fileExtension
    );
    const byPath = rawByType.get(item.type) ?? new Map();
    const group = byPath.get(relPath) ?? { items: [] };
    group.items.push({ item, stem });
    byPath.set(relPath, group);
    rawByType.set(item.type, byPath);
    noteStem(session, relPath, stem);
  }
  return rawByType;
}

function collectVanillaKeysByDirectory(session: BuildSession): Map<string, Set<string>> {
  const vanillaKeysByDir = new Map<string, Set<string>>();
  for (const file of session.options.vanilla?.files ?? []) {
    const dir = file.path.slice(0, file.path.lastIndexOf("/"));
    const keys = vanillaKeysByDir.get(dir) ?? new Set<string>();
    for (const key of file.keys) {
      keys.add(key);
    }
    vanillaKeysByDir.set(dir, keys);
  }
  return vanillaKeysByDir;
}

function assertNoPackagedVanillaCollision(item: ContentItem): void {
  if (PACKAGED_ID_EVIDENCE.get(item.type)?.().has(item.def.id) !== true) {
    return;
  }
  throw new Error(
    `${item.type} name "${item.def.id}" collides with a vanilla ${item.type} of the same ` +
      `name — defining it would silently override vanilla content, and overriding a vanilla ` +
      `${item.type} is out of scope; mint a different name`
  );
}

function registerOwnId(
  ownIdsByDir: Map<string, Map<string, ContentTypeName>>,
  outputDir: string,
  item: ContentItem
): void {
  const ownIds = ownIdsByDir.get(outputDir) ?? new Map<string, ContentTypeName>();
  const otherType = ownIds.get(item.def.id);
  if (otherType !== undefined && otherType !== item.type) {
    throw new Error(
      `${item.type} id "${item.def.id}" collides with a ${otherType} of the same id — both are ` +
        `emitted under "${outputDir}", where the game merges every file it loads by id, so only ` +
        `one definition would survive and which one is undetermined; give one of them a different id`
    );
  }
  ownIds.set(item.def.id, item.type);
  ownIdsByDir.set(outputDir, ownIds);
}

function defineContentGroups(
  session: BuildSession,
  content: ContentAuthoring,
  rawByType: ReadonlyMap<
    ContentTypeName,
    ReadonlyMap<LogicalPath, { items: Array<{ item: ContentItem; stem: string | undefined }> }>
  >
): DefinedGroup[] {
  const definedGroups: DefinedGroup[] = [];
  for (const descriptor of CONTENT_REGISTRIES) {
    const type = descriptor.type as ContentTypeName;
    const byPath = rawByType.get(type);
    if (byPath === undefined) {
      continue;
    }
    for (const relPath of [...byPath.keys()].sort(compareUtf8)) {
      const items = [...byPath.get(relPath)!.items].sort((a, b) =>
        compareUtf8(a.item.def.id, b.item.def.id)
      );
      definedGroups.push({
        type,
        relPath,
        defined: items.map(({ item, stem }) =>
          content.define(
            item.type,
            item.def,
            (entries) =>
              registerLocalization(session.localization, { layer: "ordinary", stem }, entries),
            shapeMintOf(item)
          )
        ),
      });
    }
  }
  return definedGroups;
}

function lowerContentGroups(
  session: BuildSession,
  definedGroups: readonly DefinedGroup[]
): ContentFile[] {
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
          (use) => session.refUses.push({ owner: `${group.type} "${defined.id}"`, use }),
          (use) => session.pathUses.push({ owner: `${group.type} "${defined.id}"`, use })
        )
      );
    }
  }

  return pathOrder.map((relPath) => {
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
}

function assertPlacedAssetReferences(session: BuildSession): void {
  const placedAssets = new Set(session.assets.map(({ item }) => item));
  for (const { owner, use } of session.pathUses) {
    if (use.kind === "item" && !placedAssets.has(use.item)) {
      throw new Error(
        `${owner} references the Asset file "${use.path}" in "${use.field}", but no Feature ` +
          `passed to buildMod places it — the mod would ship a definition pointing at a file ` +
          `that is not in it; add the Asset to a feature, or write the path as a string if the ` +
          `file comes from somewhere else`
      );
    }
  }
}

/**
 * The parse cache: content-addressed, so invalidation is free. The key is a
 * hash of the file manifest (every path and its content hash), which means a
 * hit can skip parsing but can never serve stale content — any changed byte
 * changes the key. Hashing itself always runs; it is also the version-drift
 * input.
 *
 * The cache is an optimization, never a dependency: an unwritable directory
 * proceeds uncached, silently. At technology-only scope the saving is
 * milliseconds; the layer exists so `load()` keeps its shape when the full
 * `common/` tree lands, where "install layer too slow to run every build" is
 * the handoff's named escape hatch.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { sha256Hex, type ParsedSource } from "./view.ts";

/** Bump when the cached shape changes; old entries just miss. */
const CACHE_FORMAT_VERSION = 1;
const KEEP_NEWEST = 2;

interface CacheFile {
  readonly formatVersion: number;
  readonly sources: readonly ParsedSource[];
}

export function cacheKey(manifest: readonly { path: string; sha256: string }[]): string {
  const lines = manifest
    .map((file) => `${file.path}\t${file.sha256}`)
    .sort()
    .join("\n");
  return sha256Hex(`v${CACHE_FORMAT_VERSION}\n${lines}`);
}

function entryPath(dir: string, key: string): string {
  return join(dir, `vanilla-${key}.json`);
}

function isParsedSource(value: unknown): value is ParsedSource {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const source = value as {
    readonly path?: unknown;
    readonly sha256?: unknown;
    readonly items?: unknown;
  };
  return (
    typeof source.path === "string" &&
    typeof source.sha256 === "string" &&
    Array.isArray(source.items)
  );
}

/**
 * Recovers a cache entry from its parsed JSON, or `undefined` when the value is
 * not an entry this build can use.
 *
 * The entry is a file on disk, so its shape is evidence rather than a
 * compile-time fact: an older format version, a half-written file, or an
 * unrelated file under the same name all arrive here as valid JSON. Each is a
 * miss, and a miss regenerates — so this returns `undefined` instead of
 * throwing.
 *
 * Every source is checked down to the members `VanillaView` reads. The `items`
 * inside a source are not walked: the parser owns that shape, and the view
 * already refuses a document it cannot read.
 */
function decodeCacheFile(value: unknown): CacheFile | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const { formatVersion, sources } = value as {
    readonly formatVersion?: unknown;
    readonly sources?: unknown;
  };
  if (formatVersion !== CACHE_FORMAT_VERSION || !Array.isArray(sources)) {
    return undefined;
  }
  if (!sources.every(isParsedSource)) {
    return undefined;
  }
  return { formatVersion: CACHE_FORMAT_VERSION, sources };
}

export function readCache(dir: string, key: string): readonly ParsedSource[] | undefined {
  let raw: string;
  try {
    raw = readFileSync(entryPath(dir, key), "utf8");
  } catch {
    return undefined;
  }
  try {
    return decodeCacheFile(JSON.parse(raw))?.sources;
  } catch {
    // A torn or corrupt entry is a miss, not a failure.
    return undefined;
  }
}

export function writeCache(dir: string, key: string, sources: readonly ParsedSource[]): void {
  const payload: CacheFile = { formatVersion: CACHE_FORMAT_VERSION, sources };
  try {
    mkdirSync(dir, { recursive: true });
    const target = entryPath(dir, key);
    const temp = `${target}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(payload), "utf8");
    renameSync(temp, target);
    prune(dir, key);
  } catch {
    // The cache is an optimization, not a dependency, and a cache failure is
    // neither a thrown error nor `mod.warnings` data — it is a silent miss.
    // `load()` returns the same view it would have returned uncached.
  }
}

function prune(dir: string, keepKey: string): void {
  const entries = readdirSync(dir)
    .filter((name) => name.startsWith("vanilla-") && name.endsWith(".json"))
    .filter((name) => name !== `vanilla-${keepKey}.json`)
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of entries.slice(KEEP_NEWEST - 1)) {
    rmSync(join(dir, entry.name), { force: true });
  }
}

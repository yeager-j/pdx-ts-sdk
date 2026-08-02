/**
 * The parse cache: content-addressed, so invalidation is free. The key is a
 * hash of the file manifest (every path and its content hash), which means a
 * hit can skip parsing but can never serve stale content — any changed byte
 * changes the key. Hashing itself always runs; it is also the version-drift
 * input.
 *
 * The cache is an optimization, never a dependency: an unwritable directory
 * warns once and proceeds uncached. At technology-only scope the saving is
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

import { sha256Hex, type ParsedSource } from "../vanilla/surface.ts";

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

export function readCache(dir: string, key: string): readonly ParsedSource[] | undefined {
  let raw: string;
  try {
    raw = readFileSync(entryPath(dir, key), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.formatVersion !== CACHE_FORMAT_VERSION) {
      return undefined;
    }
    return parsed.sources;
  } catch {
    // A torn or corrupt entry is a miss, not a failure.
    return undefined;
  }
}

let warnedUnwritable = false;

export function writeCache(dir: string, key: string, sources: readonly ParsedSource[]): void {
  const payload: CacheFile = { formatVersion: CACHE_FORMAT_VERSION, sources };
  try {
    mkdirSync(dir, { recursive: true });
    const target = entryPath(dir, key);
    const temp = `${target}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(payload), "utf8");
    renameSync(temp, target);
    prune(dir, key);
  } catch (error) {
    if (!warnedUnwritable) {
      warnedUnwritable = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`pdx-ts: parse cache disabled (${message}); every build will re-parse`);
    }
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

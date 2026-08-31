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
 *
 * Content-addressing is why a hit cannot serve stale content, and it was once
 * taken to mean more than it does. The key covers the bytes on disk and
 * therefore names the entry's *file*; it says nothing about what is inside
 * that file. Reading one used to be a cast to `CacheFile` on the strength of
 * one integer, so an entry reading `{"formatVersion":1,"sources":[]}` under
 * the right name produced an empty vanilla view in silence, and a malformed
 * entry failed later somewhere with no apparent connection to the cache.
 * Reading an entry is therefore a parse against the manifest the key was
 * computed over, and every disagreement is a miss (SDK-339).
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
import {
  isBareToken,
  isMathSource,
  isNumeral,
  isOperator,
  isParamName,
  isQuotableContent,
  isVarName,
  isWritableText,
  regionTextProblem,
  type PdxItem,
  type PdxValue,
} from "@pdx-ts/pdxscript";

import { sha256Hex, type ParsedSource } from "./parse.ts";

/**
 * Bump when the cached *meaning* changes under an unchanged shape.
 *
 * Shape drift no longer needs this: {@link isItem} names every node kind and
 * every field the AST has, so a tree the current parser would not produce
 * fails to parse back and misses. What the constant still covers is a change
 * that keeps the shape and changes what it denotes — a different number
 * lexeme normalization, say — which no structural check can see.
 */
const CACHE_FORMAT_VERSION = 1;
const KEEP_NEWEST = 2;

/** One file's identity in the manifest the cache key was computed over. */
interface ManifestFile {
  readonly path: string;
  readonly sha256: string;
}

/** What one entry holds. Written from this type; read back through {@link parseCacheFile}. */
interface CacheFile {
  readonly formatVersion: number;
  readonly sources: readonly ParsedSource[];
}

export function cacheKey(manifest: readonly ManifestFile[]): string {
  const lines = manifest
    .map((file) => `${file.path}\t${file.sha256}`)
    .sort()
    .join("\n");
  return sha256Hex(`v${CACHE_FORMAT_VERSION}\n${lines}`);
}

function entryPath(dir: string, key: string): string {
  return join(dir, `vanilla-${key}.json`);
}

/**
 * The cached parse of one manifest, or `undefined` when it must be parsed
 * again.
 *
 * A hit is an entry that holds this exact load: every source at the same
 * index, under the same path, with the same content hash, and items forming a
 * tree the parser could have produced. The identity returned comes from
 * `manifest` rather than from the file, so a hit can only describe the load
 * that asked for it.
 *
 * Everything else — an absent, unreadable, torn, stale or mismatched entry —
 * is `undefined`, meaning parse it again. Nothing is repaired and nothing is
 * raised: the cache is an optimization, and a miss returns the same view an
 * uncached load would.
 *
 * @param dir - Directory holding the cache entries.
 * @param key - The entry's content-addressed name, from {@link cacheKey}.
 * @param manifest - The file manifest `key` was computed over.
 */
export function readCache(
  dir: string,
  key: string,
  manifest: readonly ManifestFile[]
): readonly ParsedSource[] | undefined {
  let raw: string;
  try {
    raw = readFileSync(entryPath(dir, key), "utf8");
  } catch {
    return undefined;
  }
  try {
    return parseCacheFile(JSON.parse(raw), manifest);
  } catch {
    // A torn or corrupt entry is a miss, not a failure.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a cache entry back into parser state, or `undefined` for any mismatch. */
function parseCacheFile(
  value: unknown,
  manifest: readonly ManifestFile[]
): readonly ParsedSource[] | undefined {
  if (!isRecord(value) || value["formatVersion"] !== CACHE_FORMAT_VERSION) {
    return undefined;
  }
  const sources = value["sources"];
  if (!Array.isArray(sources) || sources.length !== manifest.length) {
    return undefined;
  }

  const parsed: ParsedSource[] = [];
  for (const [index, source] of sources.entries()) {
    const expected = manifest[index]!;
    if (
      !isRecord(source) ||
      source["path"] !== expected.path ||
      source["sha256"] !== expected.sha256 ||
      !isItemList(source["items"])
    ) {
      return undefined;
    }
    parsed.push({ path: expected.path, sha256: expected.sha256, items: source["items"] });
  }
  return parsed;
}

function isItemList(value: unknown): value is readonly PdxItem[] {
  return Array.isArray(value) && value.every(isItem);
}

/** A field that is a string, tested against the spelling rule its kind has. */
function isText(value: unknown, representable: (text: string) => boolean): boolean {
  return typeof value === "string" && representable(value);
}

/**
 * Whether a revived JSON value is a node the parser could have produced.
 *
 * JSON has no types of its own, so this is where the AST's are re-established
 * — and the type of a field is not the whole of what the AST states. Every
 * constructor in `@pdx-ts/pdxscript` rejects what the parser could not have
 * produced, so that a hand-built tree is in the same language as a parsed
 * one, and a tree revived out of JSON is a hand-built tree. Checking only
 * that a `num` carries a string would admit `{"kind":"num","lexeme":"garbage"}`,
 * which no parse yields and which fails much later in whichever reader first
 * asks that node for a number.
 *
 * So each field is held to the same predicate its constructor uses. The one
 * loosened is `quoted` on a `str`, which is a rendering hint rather than part
 * of the value: it selects which spelling rule the content must satisfy.
 */
function isItem(value: unknown): value is PdxItem {
  if (!isRecord(value)) {
    return false;
  }
  switch (value["kind"]) {
    case "str":
      return (
        typeof value["quoted"] === "boolean" &&
        isText(value["value"], value["quoted"] ? isQuotableContent : isWritableText)
      );
    case "num":
      return isText(value["lexeme"], isNumeral);
    case "bool":
      return typeof value["value"] === "boolean";
    case "var":
      return isText(value["name"], isVarName);
    case "math":
      return isText(value["source"], isMathSource);
    case "container":
      return isContainer(value);
    case "entry":
      return (
        isText(value["key"], (key) => isBareToken(key) || isQuotableContent(key)) &&
        isText(value["op"], isOperator) &&
        isValue(value["value"]) &&
        (value["line"] === undefined || typeof value["line"] === "number")
      );
    case "param":
      return (
        isText(value["name"], isParamName) &&
        typeof value["negated"] === "boolean" &&
        isItemList(value["items"])
      );
    case "param-text":
      return (
        typeof value["name"] === "string" &&
        typeof value["negated"] === "boolean" &&
        typeof value["text"] === "string" &&
        regionTextProblem(value["name"], value["negated"], value["text"]) === null
      );
    default:
      return false;
  }
}

function isContainer(value: Record<string, unknown>): boolean {
  return (
    (value["header"] === undefined || isText(value["header"], isBareToken)) &&
    isItemList(value["items"])
  );
}

/** An entry's right-hand side: narrower than an item, as the AST states. */
function isValue(value: unknown): value is PdxValue {
  return isItem(value) && value.kind !== "entry" && !value.kind.startsWith("param");
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

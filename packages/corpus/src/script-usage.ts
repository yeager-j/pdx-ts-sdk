/**
 * How often vanilla writes each script key: the `used` weight of the coverage
 * report's script surfaces.
 *
 * The count is flat. Every key of every entry under `common/` and `events/`
 * is counted once per occurrence, whatever block it sits in, and a key is
 * reduced to the names the rules declare: a dotted path is split into its
 * segments, each segment is lowercased, a trailing `?` is dropped, and a
 * `prefix:name` segment counts as its prefix with the colon kept. So
 * `owner.capital_scope?` credits `owner` and `capital_scope`, and
 * `parameter:x` credits `parameter:`, the declared prefix of the
 * `pop_faction_parameter` link. The colon keeps a prefixed form apart from a
 * bare key of the same text: `modifier:x` and the `modifier = { ... }` field
 * are different names. Values are never counted, so the `value:` and
 * `trigger:` link forms weigh zero. A key the rules declare on two surfaces
 * (a trigger and an effect of the same name) credits both.
 *
 * The committed fixture keeps only the keys in the declared script vocabulary
 * ({@link scriptVocabulary}), as counts of key text. It carries no values, no
 * script bodies, and no localized text: the same licensing boundary as the
 * registry fixtures.
 *
 * Pure half: {@link countScriptKeys} and {@link scriptVocabulary}. Impure
 * half: {@link readScriptUsage}, which walks an install.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { relativeRegistryPath, walkRegistryFiles } from "@pdx-ts/codegen-cwt/corpus/registry-files";
import { parse, PdxSyntaxError, type PdxItem } from "@pdx-ts/pdxscript";
import { compareUtf8 } from "@pdx-ts/sdk/internals";

/** Key occurrences keyed by the declared name each key text reduces to. */
export type ScriptKeyCounts = ReadonlyMap<string, number>;

/**
 * The declared names one key text credits, in order: lowercased, split on
 * `.`, a trailing `?` dropped, a `prefix:name` segment reduced to `prefix:`
 * (the colon kept). Empty segments are dropped.
 */
export function scriptKeySegments(key: string): string[] {
  return key
    .toLowerCase()
    .split(".")
    .map((segment) => {
      const unmarked = segment.replace(/\?$/, "");
      const colon = unmarked.indexOf(":");
      return colon < 0 ? unmarked : unmarked.slice(0, colon + 1);
    })
    .filter((segment) => segment.length > 0);
}

/**
 * Adds every key under `items` to `counts`, one per occurrence.
 *
 * Descends into entry values, bare containers, and `param` blocks.
 * `param-text` regions are text the engine splices before parsing, so their
 * keys are not counted.
 */
export function countScriptKeys(items: readonly PdxItem[], counts: Map<string, number>): void {
  for (const item of items) {
    switch (item.kind) {
      case "entry":
        for (const segment of scriptKeySegments(item.key)) {
          counts.set(segment, (counts.get(segment) ?? 0) + 1);
        }
        if (item.value.kind === "container") {
          countScriptKeys(item.value.items, counts);
        }
        break;
      case "container":
      case "param":
        countScriptKeys(item.items, counts);
        break;
      default:
        break;
    }
  }
}

/** The declared script names whose usage the fixture records. */
export interface ScriptVocabularyInput {
  /** Trigger rule keys. */
  readonly triggers: Iterable<string>;
  /** Effect rule keys. */
  readonly effects: Iterable<string>;
  /** Scope and value links with their optional prefix, as declared (`value:`). */
  readonly links: Iterable<{ readonly name: string; readonly prefix: string | null }>;
  /** Modifier names. */
  readonly modifiers: Iterable<string>;
  /** Event and option field keys, bare. */
  readonly eventFields: Iterable<string>;
}

/** The lowercased union of every declared script name, and a hash of the sorted list. */
export interface ScriptVocabulary {
  /** Every declared name, lowercased; a link's prefix keeps its colon. */
  readonly keys: ReadonlySet<string>;
  /** sha256 over the sorted keys joined by `\n`. */
  readonly fingerprint: string;
}

/**
 * Builds the vocabulary the usage fixture is filtered to. A link with a
 * prefix contributes both its name and the prefix as declared, colon
 * included, which is the name {@link scriptKeySegments} credits.
 */
export function scriptVocabulary(input: ScriptVocabularyInput): ScriptVocabulary {
  const names = [
    ...input.triggers,
    ...input.effects,
    ...[...input.links].flatMap((link) =>
      link.prefix === null ? [link.name] : [link.name, link.prefix]
    ),
    ...input.modifiers,
    ...input.eventFields,
  ];
  const keys = new Set(names.map((name) => name.toLowerCase()));
  const sorted = [...keys].sort(compareUtf8);
  return { keys, fingerprint: sha256(sorted.join("\n")) };
}

/** Key counts per install root, with the evidence of which files produced them. */
export interface ScriptUsage {
  /** The install directories walked, as given. */
  readonly roots: readonly string[];
  /** Counts per root, keyed by root. Every root is present, even when empty. */
  readonly counts: ReadonlyMap<string, ScriptKeyCounts>;
  /** Number of `.txt` files found under every root. */
  readonly files: number;
  /** Root-relative `/`-separated paths of files the parser rejected, sorted. */
  readonly failedFiles: readonly string[];
  /** sha256 over the sorted `path:sha256(bytes)` lines of every file, parsed or not. */
  readonly fingerprint: string;
}

/**
 * Parses every `.txt` file under each root of `installPath`, recursively,
 * and counts their keys with {@link countScriptKeys}.
 *
 * A file that fails to parse (`PdxSyntaxError`) is recorded in `failedFiles`
 * and still fingerprinted, so a prose file in `common/` cannot hide a content
 * change. Any other error propagates.
 */
export function readScriptUsage(installPath: string, roots: readonly string[]): ScriptUsage {
  const counts = new Map<string, ScriptKeyCounts>();
  const failedFiles: string[] = [];
  const fingerprintLines: string[] = [];
  let files = 0;
  for (const root of roots) {
    const directory = path.join(installPath, root);
    const rootCounts = new Map<string, number>();
    for (const file of walkRegistryFiles(directory, ".txt", true)) {
      files += 1;
      const relative = `${root}/${relativeRegistryPath(directory, file)}`;
      const bytes = readFileSync(file);
      fingerprintLines.push(`${relative}:${createHash("sha256").update(bytes).digest("hex")}`);
      let items: readonly PdxItem[];
      try {
        items = parse(bytes.toString("utf8")).items;
      } catch (error) {
        if (error instanceof PdxSyntaxError) {
          failedFiles.push(relative);
          continue;
        }
        throw error;
      }
      countScriptKeys(items, rootCounts);
    }
    counts.set(root, rootCounts);
  }
  return {
    roots,
    counts,
    files,
    failedFiles: failedFiles.sort(compareUtf8),
    fingerprint: sha256(fingerprintLines.sort(compareUtf8).join("\n")),
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

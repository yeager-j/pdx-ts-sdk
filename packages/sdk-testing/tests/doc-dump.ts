/**
 * Reads a Paradox documentation dump from the CWT config fork for the whitelist audit gate.
 *
 * This lives under `tests/` rather than `src/` on purpose: the published
 * package must never reach for a file outside itself, and the checked-out dump is
 * a repository input, not a runtime one. The whitelist carries only the pins —
 * a name and a hash — and this is what turns them back into evidence.
 *
 * The parsers are `@pdx-ts/codegen-cwt`'s, not new ones: the generator already
 * owns how these dumps are read, and an audit that read them its own way would
 * be pinning a paragraph nothing else in the repository agrees exists.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseScopeLinks, type ScopeLink } from "@pdx-ts/codegen-cwt/logs/scopes";
import { parseTriggerDocs, type DocEntry } from "@pdx-ts/codegen-cwt/logs/trigger-docs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT_DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs");

/** Which of the three CWT logs a whitelist category is audited against. */
export type DumpName = "triggers" | "effects" | "scopes";

export interface DocBlock {
  /** The canonicalized paragraph, as hashed — printed on a mismatch so the diff is readable. */
  readonly text: string;
  readonly sha: string;
  /** Whether the paragraph carries Paradox's own deprecation marker. */
  readonly deprecated: boolean;
}

export interface CwtDocDump {
  /** The selected version directory under `script-docs/`, e.g. `v4.4.1`. */
  readonly version: string;
  readonly blocks: Readonly<Record<DumpName, ReadonlyMap<string, DocBlock>>>;
}

/**
 * Line endings and trailing spaces are not evidence: normalizing them keeps a
 * source update that only rewrites whitespace from reporting every pin as broken,
 * which would train a maintainer to re-pin without reading. Blank lines
 * *inside* a usage example are kept — `kill_leader`'s example has one.
 */
function canonical(parts: readonly string[]): string {
  return parts
    .map((part) => part.replaceAll("\r", ""))
    .filter((part) => part.trim() !== "")
    .join("\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

function blockOf(text: string): DocBlock {
  return {
    text,
    sha: createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16),
    deprecated: /deprecat/i.test(text),
  };
}

function entryBlock(entry: DocEntry): DocBlock {
  return blockOf(
    canonical([
      entry.name,
      entry.summary,
      entry.usage,
      `Supported Scopes: ${entry.scopes.join(" ")}`,
    ])
  );
}

function linkBlock(link: ScopeLink): DocBlock {
  return blockOf(
    canonical([
      link.name,
      link.summary,
      `Supported Scopes: ${link.inputScopes.join(" ")}`,
      `Output Scope: ${link.outputScope}`,
    ])
  );
}

function index<T>(source: Iterable<readonly [string, T]>, toBlock: (value: T) => DocBlock) {
  return new Map([...source].map(([name, value]) => [name, toBlock(value)]));
}

/** Reads the named documentation dump and indexes its audited paragraphs. */
export function readCwtDocDump(version: string): CwtDocDump {
  const dir = path.join(SCRIPT_DOCS, version);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(
      `CWT documentation dump ${version} does not exist under ${SCRIPT_DOCS}. ` +
        "Run git submodule update --init."
    );
  }
  const read = (name: string): string => fs.readFileSync(path.join(dir, name), "utf8");
  const docs = parseTriggerDocs(read("triggers.log"), read("effects.log"));
  return {
    version,
    blocks: {
      triggers: index(docs.triggers, entryBlock),
      effects: index(docs.effects, entryBlock),
      scopes: index(
        parseScopeLinks(read("scopes.log")).links.map((link) => [link.name, link] as const),
        linkBlock
      ),
    },
  };
}

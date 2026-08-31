import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { eventKinds, type EventKindSpec } from "@pdx-ts/codegen-cwt/lower/event-kinds";
import { parse, type PdxValue } from "@pdx-ts/pdxscript";

import { compareIdentifiers } from "./emit.ts";

export interface VanillaEventDefinition extends EventKindSpec {
  readonly id: string;
  readonly namespace: string;
  readonly localId: string;
  readonly source: string;
}

/** One event source file resolved from the CWT event type declaration. */
export interface VanillaEventSource {
  readonly path: string;
  /** Path relative to the configured event directory. */
  readonly source: string;
}

export interface VanillaEventsRead {
  readonly definitions: readonly VanillaEventDefinition[];
  /** The exact files read, for checks that must measure the same event corpus. */
  readonly sourceFiles: readonly VanillaEventSource[];
  /** Directory under the install root that supplied the definitions. */
  readonly path: string;
  readonly extension: string;
  readonly files: number;
  readonly diagnostics: number;
  readonly missing: boolean;
}

function walk(dir: string, extension: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort(compareIdentifiers);
  } catch {
    return [];
  }

  return names.flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full, extension)
      : name.endsWith(extension)
        ? [full]
        : [];
  });
}

function scalar(value: PdxValue): string | null {
  if (value.kind === "str") {
    return value.value;
  }
  if (value.kind === "num") {
    return value.lexeme;
  }
  return null;
}

function splitEventId(id: string, source: string): { namespace: string; localId: string } {
  const first = id.indexOf(".");
  if (first <= 0 || first !== id.lastIndexOf(".") || first === id.length - 1) {
    throw new Error(`${source}: event id ${JSON.stringify(id)} must be namespace.local-id`);
  }
  const namespace = id.slice(0, first);
  if (!/^[a-z][a-z0-9_-]*$/.test(namespace)) {
    throw new Error(`${source}: event namespace ${JSON.stringify(namespace)} is not portable`);
  }
  return { namespace, localId: id.slice(first + 1) };
}

export function readVanillaEvents(
  installRoot: string,
  configRoot: string,
  eventKindFacts?: readonly EventKindSpec[]
): VanillaEventsRead {
  const rules = loadRules(configRoot);
  const type = rules.contentTypes.get("event");
  if (type?.path === null || type?.path === undefined || !type.path.startsWith("game/")) {
    throw new Error(`type[event] has unusable path ${type?.path ?? "undefined"}`);
  }

  const dir = path.join(installRoot, type.path.slice("game/".length));
  const extension = type.pathExtension ?? ".txt";
  const sourceFiles = walk(dir, extension).map((file) => ({
    path: file,
    source: path.relative(dir, file).split(path.sep).join("/"),
  }));
  const kinds = new Map((eventKindFacts ?? eventKinds(rules)).map((kind) => [kind.key, kind]));
  const definitions = new Map<string, VanillaEventDefinition>();
  let diagnostics = 0;

  for (const file of sourceFiles) {
    const parsed = parse(readFileSync(file.path, "utf8"), file.source);
    diagnostics += parsed.diagnostics.length;

    for (const item of parsed.items) {
      if (item.kind !== "entry") {
        continue;
      }
      const kind = kinds.get(item.key);
      if (kind === undefined) {
        continue;
      }
      if (item.value.kind !== "container") {
        throw new Error(`${file.source}: ${item.key} must be a block`);
      }
      const idEntry = item.value.items.find(
        (candidate) => candidate.kind === "entry" && candidate.key === "id"
      );
      const id = idEntry?.kind === "entry" ? scalar(idEntry.value) : null;
      if (id === null) {
        throw new Error(`${file.source}: ${item.key} has no scalar id`);
      }
      const existing = definitions.get(id);
      if (existing !== undefined) {
        throw new Error(
          `${file.source}: duplicate event id ${JSON.stringify(id)}; first defined in ${existing.source}`
        );
      }
      definitions.set(id, {
        ...kind,
        ...splitEventId(id, file.source),
        id,
        source: file.source,
      });
    }
  }

  return {
    definitions: [...definitions.values()].sort(
      (left, right) =>
        compareIdentifiers(left.namespace, right.namespace) ||
        compareIdentifiers(left.localId, right.localId)
    ),
    sourceFiles,
    path: type.path.slice("game/".length),
    extension,
    files: sourceFiles.length,
    diagnostics,
    missing: sourceFiles.length === 0,
  };
}

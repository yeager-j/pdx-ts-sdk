import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eventKinds, type EventKindSpec } from "@pdx-ts/codegen-cwt/event-kinds";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { parse, type PdxValue } from "@pdx-ts/pdxscript";

import { compareIdentifiers } from "./emit.ts";

export interface VanillaEventDefinition extends EventKindSpec {
  readonly id: string;
  readonly namespace: string;
  readonly localId: string;
  readonly source: string;
}

export interface VanillaEventsRead {
  readonly definitions: readonly VanillaEventDefinition[];
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
  const files = walk(dir, extension);
  const kinds = new Map((eventKindFacts ?? eventKinds(rules)).map((kind) => [kind.key, kind]));
  const definitions = new Map<string, VanillaEventDefinition>();
  let diagnostics = 0;

  for (const file of files) {
    const source = path.relative(dir, file).split(path.sep).join("/");
    const parsed = parse(readFileSync(file, "utf8"), source);
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
        throw new Error(`${source}: ${item.key} must be a block`);
      }
      const idEntry = item.value.items.find(
        (candidate) => candidate.kind === "entry" && candidate.key === "id"
      );
      const id = idEntry?.kind === "entry" ? scalar(idEntry.value) : null;
      if (id === null) {
        throw new Error(`${source}: ${item.key} has no scalar id`);
      }
      const existing = definitions.get(id);
      if (existing !== undefined) {
        throw new Error(
          `${source}: duplicate event id ${JSON.stringify(id)}; first defined in ${existing.source}`
        );
      }
      definitions.set(id, { ...kind, ...splitEventId(id, source), id, source });
    }
  }

  return {
    definitions: [...definitions.values()].sort(
      (left, right) =>
        compareIdentifiers(left.namespace, right.namespace) ||
        compareIdentifiers(left.localId, right.localId)
    ),
    path: type.path.slice("game/".length),
    extension,
    files: files.length,
    diagnostics,
    missing: files.length === 0,
  };
}

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ComplexEnum } from "@pdx-ts/codegen-cwt/cwt/rules";
import { parse, type PdxItem } from "@pdx-ts/pdxscript";

import { compareIdentifiers } from "./emit.ts";

type ContainerEntry = Extract<PdxItem, { kind: "entry" }> & {
  readonly value: Extract<Extract<PdxItem, { kind: "entry" }>["value"], { kind: "container" }>;
};

export interface ComplexEnumMembers {
  readonly name: string;
  readonly members: readonly string[];
  readonly files: number;
  readonly diagnostics: number;
  readonly missing: boolean;
}

function walk(dir: string, extension: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory()
      ? walk(file, extension)
      : name.endsWith(extension)
        ? [file]
        : [];
  });
}

function entriesAt(items: readonly PdxItem[], pathToItems: readonly string[]): readonly PdxItem[] {
  let current = items;
  for (const key of pathToItems) {
    const entry = current.find(
      (item): item is ContainerEntry =>
        item.kind === "entry" && item.key === key && item.value.kind === "container"
    );
    if (entry === undefined || entry.value.kind !== "container") {
      return [];
    }
    current = entry.value.items;
  }
  return current;
}

function collect(items: readonly PdxItem[], spec: ComplexEnum, add: (name: string) => void): void {
  const roots = spec.startFromRoot
    ? [items]
    : items
        .filter(
          (item): item is ContainerEntry => item.kind === "entry" && item.value.kind === "container"
        )
        .map((item) => item.value.items);
  for (const root of roots) {
    const selected = entriesAt(root, spec.selector.path);
    if (spec.selector.kind === "key") {
      for (const item of selected) {
        if (item.kind === "entry") {
          add(item.key);
        }
      }
      continue;
    }
    for (const item of selected) {
      if (item.kind === "entry" && item.key === spec.selector.key && item.value.kind === "str") {
        add(item.value.value);
      }
      if (item.kind === "entry" && item.key === spec.selector.key && item.value.kind === "num") {
        add(item.value.lexeme);
      }
    }
  }
}

export function readComplexEnumMembers(root: string, spec: ComplexEnum): ComplexEnumMembers {
  const dir = path.join(root, spec.path.replace(/^game\//, ""));
  const files = walk(dir, spec.extension);
  const members = new Set<string>();
  let diagnostics = 0;
  for (const file of files) {
    const parsed = parse(readFileSync(file, "utf8"), path.basename(file));
    diagnostics += parsed.diagnostics.length;
    collect(parsed.items, spec, (member) => members.add(member));
  }
  return {
    name: spec.name,
    members: [...members].sort(compareIdentifiers),
    files: files.length,
    diagnostics,
    missing: files.length === 0,
  };
}

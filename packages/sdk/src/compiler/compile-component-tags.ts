/** Lowers capability-owned component tags through their bare-scalar file channel. */

import { scalar, type PdxItem } from "@pdx-ts/pdxscript";

import type { ComponentTagItem } from "../authoring/component-tags.ts";
import { compareUtf8, type LogicalPath } from "../ordering.ts";
import { emissionPath } from "./compile-content.ts";
import { noteStem, type BuildSession } from "./compile-session.ts";
import type { ComponentTagFile } from "./model.ts";

interface TagGroup {
  readonly items: Array<{ readonly item: ComponentTagItem; readonly stem: string | undefined }>;
}

/** Collects component tags into deterministic, feature-scoped bare-scalar files. */
export function compileComponentTags(session: BuildSession): readonly ComponentTagFile[] {
  const ids = new Set<string>();
  const groups = new Map<LogicalPath, TagGroup>();

  for (const { item, stem } of session.items.componentTag) {
    if (ids.has(item.id)) {
      throw new Error(`Component tag "${item.id}" is declared more than once`);
    }
    ids.add(item.id);
    const relPath = emissionPath(
      session.config.prefix,
      "common/component_tags",
      stem ?? "component_tags",
      ".txt"
    );
    const group = groups.get(relPath) ?? { items: [] };
    group.items.push({ item, stem });
    groups.set(relPath, group);
    noteStem(session, relPath, stem);
  }

  return [...groups]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([relPath, group]) => {
      const items = [...group.items].sort((left, right) =>
        compareUtf8(left.item.id, right.item.id)
      );
      const entries: PdxItem[] = items.map(({ item }) => scalar(item.id));
      return { relPath, ids: items.map(({ item }) => item.id), entries };
    });
}

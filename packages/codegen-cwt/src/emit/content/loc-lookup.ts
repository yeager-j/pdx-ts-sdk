/**
 * Emits `content-loc.ts`: the registry-name to `loc`-surface lookup a
 * `ContentItem` reads.
 *
 * One member spelled once on the item resolves to each registry's own slot
 * references, which is what keeps the whole surface off `ContentItem`'s type
 * parameters — a lookup, rather than a third parameter every capability
 * method, handle, and item union would have to carry.
 */

import { docComment, kebabCase } from "../../naming.ts";
import { importList } from "../../render/symbols.ts";
import { member as renderMember } from "../../render/writer.ts";
import type { ContentEmission } from "./content-type.ts";

/** One registry's contribution to the lookup: its name, and the type its items carry. */
export interface LocLookupContent {
  readonly registry: string;
  readonly emission: ContentEmission;
}

const EMPTY_SURFACE = "NoLocalizationRefs";

/** Renders the generated `loc` lookup module for all manifest registries. */
export function contentLocLookup(contents: readonly LocLookupContent[]): string {
  const imports =
    importList("../authoring/localization.ts", [EMPTY_SURFACE]) +
    importList("./content-registry.ts", ["ContentTypeName"]) +
    contents
      .flatMap(({ registry, emission }) =>
        emission.locTypeName === null
          ? []
          : [importList(`./${kebabCase(registry)}.ts`, [emission.locTypeName])]
      )
      .join("");
  const members = contents
    .map(({ registry, emission }) =>
      renderMember({
        name: registry,
        type: emission.locTypeName ?? EMPTY_SURFACE,
        readonly: true,
        optional: false,
        docs: [
          emission.locTypeName === null
            ? `A \`${registry}\` declares no localisation slots, so it mints no keys.`
            : `The localization keys one \`${registry}\` mints, as references.`,
        ],
      })
    )
    .join("");
  return (
    imports +
    "\n" +
    docComment([
      "The `loc` surface each content registry's items carry.",
      "A registry that declares no localisation slots maps to the shared empty",
      "surface, so naming a slot it never mints is a compile error.",
    ]) +
    `export interface ContentLocByType {\n${members}}\n\n` +
    docComment(["One registry's minted localization keys, as references."]) +
    "export type ContentLoc<K extends ContentTypeName> = ContentLocByType[K];\n"
  );
}

/**
 * Emits `content-registry.ts`: the `CONTENT_REGISTRIES` descriptor table the
 * SDK runtime reads, one row per manifest registry.
 */

import path from "node:path";

import type { ContentType } from "../../cwt/rules.ts";
import { contentFileLayout } from "../../lower/content-layout.ts";
import { docComment, kebabCase } from "../../naming.ts";
import { EXACT_NAME_MINTS, FILE_STEM_OVERLAYS, MINT_SHAPE_OVERLAYS } from "../../overlay/index.ts";
import type { CONTENT_MANIFEST } from "../../policy/manifest.ts";
import type { ContentEmission } from "./content-type.ts";

/**
 * Renders the generated content-registry descriptor module for all manifest registries.
 * File layout, mint policy, and field-table bindings stay derived from the same content rows.
 */
export function contentRegistry(
  contents: readonly {
    manifest: (typeof CONTENT_MANIFEST)[number];
    registry: string;
    referenceName: string;
    keyword: string | undefined;
    type: ContentType;
    emission: ContentEmission;
  }[]
): string {
  const imports = contents
    .map((content) => {
      const file = `./${kebabCase(content.registry)}.ts`;
      const values = [content.emission.fieldsConstant, content.emission.localisationConstant];
      return `import { ${values.join(", ")} } from ${JSON.stringify(file)};\n`;
    })
    .join("");
  const descriptors = contents
    .map((content) => {
      const sourcePath = content.type.path;
      if (sourcePath === null || !sourcePath.startsWith("game/")) {
        throw new Error(`type[${content.registry}] has unusable path ${sourcePath}`);
      }
      const outputDir = sourcePath.slice("game/".length);
      // The directory's own last component, unless SDK-121 fixed a canonical
      // stem for this registry — see `FILE_STEM_OVERLAYS`.
      const fileStem = FILE_STEM_OVERLAYS.get(content.registry) ?? path.posix.basename(outputDir);
      const layout = contentFileLayout(content.registry, content.type);
      const mintHead = MINT_SHAPE_OVERLAYS.get(content.registry)?.head;
      return (
        "  {\n" +
        `    type: ${JSON.stringify(content.registry)},\n` +
        `    referenceName: ${JSON.stringify(content.referenceName)},\n` +
        `    outputDir: ${JSON.stringify(outputDir)},\n` +
        `    fileStem: ${JSON.stringify(fileStem)},\n` +
        `    fileExtension: ${JSON.stringify(layout.fileExtension)},\n` +
        (mintHead === undefined ? "" : `    mintHead: ${JSON.stringify(mintHead)},\n`) +
        (EXACT_NAME_MINTS.has(content.registry) ? "    exactNames: true,\n" : "") +
        (layout.rootEnvelope === undefined
          ? ""
          : `    rootEnvelope: ${JSON.stringify(layout.rootEnvelope)},\n`) +
        `    fields: ${content.emission.fieldsConstant},\n` +
        `    localisation: ${content.emission.localisationConstant},\n` +
        (content.keyword === undefined
          ? ""
          : `    keyedBy: { keyword: ${JSON.stringify(content.keyword)}, ` +
            `nameField: ${JSON.stringify(content.type.nameField)} },\n`) +
        "  },\n"
      );
    })
    .join("");
  return (
    'import type { ContentRegistryDescriptor } from "../content/schema.ts";\n' +
    imports +
    "\n" +
    docComment([
      "Every content registry the SDK exposes: its name, the CWT reference its",
      "definitions satisfy, the game folder it writes to, and its field and",
      "localization tables.",
    ]) +
    "export const CONTENT_REGISTRIES = [\n" +
    descriptors +
    "] as const satisfies readonly ContentRegistryDescriptor[];\n\n" +
    docComment(["The name of one content registry the SDK exposes."]) +
    'export type ContentTypeName = (typeof CONTENT_REGISTRIES)[number]["type"];\n\n' +
    docComment([
      "The CWT reference a registry's definitions satisfy, as a type.",
      "",
      "The same thing `referenceName` carries as data, and the brand a",
      "`ContentItem` for that registry wears — which is what makes a defined",
      "component template reach a field holding `<component_template>`.",
    ]) +
    "export type ContentReferenceName<K extends ContentTypeName> = Extract<\n" +
    "  (typeof CONTENT_REGISTRIES)[number],\n" +
    "  { type: K }\n" +
    '>["referenceName"];\n'
  );
}

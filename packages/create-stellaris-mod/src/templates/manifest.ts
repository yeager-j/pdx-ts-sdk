/**
 * `stellaris-mod.json` and the JSON schema beside it.
 *
 * The manifest is the project's single author-owned source of truth for mod
 * identity, launcher metadata, and source layout: `src/mod.ts` is wiring from
 * it to `createMod` rather than a second place to state the same facts. The
 * sole key under `mod` is the mod prefix, which is what makes
 * `keyof typeof manifest.mod` recover it exactly rather than widening to
 * `string`.
 *
 * The schema is emitted into the project and referenced relatively, so an
 * author gets completion and in-editor errors without the project acquiring a
 * dependency, a network fetch, or a URL that has to keep resolving forever.
 * `src/manifest.ts` enforces the same rules at runtime; `manifest.test.ts` runs
 * one corpus through both.
 *
 * The two grammars come from `src/manifest.ts` as `RegExp.source` rather than
 * being written out a third time. JSON Schema's `pattern` is an ECMA-262
 * regular expression, so the adapter's own regex *is* the schema's — a
 * restatement here would be one more thing that can silently disagree.
 */

import { PREFIX_PATTERN, PROJECT_MOD_FIELDS, projectModFieldSchema } from "../manifest.ts";
import type { Resolved } from "../options.ts";
import { PROJECT_LAYOUT_FIELDS, projectLayoutFieldSchema } from "../project-layout.ts";

export const MANIFEST_FILE = "stellaris-mod.json";
export const MANIFEST_SCHEMA_FILE = "stellaris-mod.schema.json";

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function manifestJson(resolved: Resolved): string {
  return json({
    $schema: `./${MANIFEST_SCHEMA_FILE}`,
    mod: {
      [resolved.prefix]: {
        name: resolved.name,
        version: "0.1.0",
        supportedVersion: resolved.supportedVersion,
        tags: resolved.tags,
      },
    },
    contentDirectory: "src/content",
    assetsDirectory: "assets",
  });
}

export function manifestSchema(): string {
  return json({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Stellaris mod project manifest",
    description:
      "Mod identity, launcher metadata, generated Feature source, and the mirrored Asset tree. " +
      "src/mod.ts wires this to createMod.",
    type: "object",
    required: [
      "mod",
      ...Object.entries(PROJECT_LAYOUT_FIELDS)
        .filter(([, field]) => field.required)
        .map(([name]) => name),
    ],
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      mod: {
        description:
          "Exactly one entry. Its key is the mod prefix, so `keyof typeof manifest.mod` " +
          "recovers the prefix exactly; its value is the mod configuration other than the prefix.",
        type: "object",
        minProperties: 1,
        maxProperties: 1,
        propertyNames: { pattern: PREFIX_PATTERN.source },
        additionalProperties: { $ref: "#/$defs/modConfig" },
      },
      ...Object.fromEntries(
        Object.entries(PROJECT_LAYOUT_FIELDS).map(([name, field]) => [
          name,
          projectLayoutFieldSchema(field),
        ])
      ),
    },
    $defs: {
      modConfig: {
        type: "object",
        required: Object.entries(PROJECT_MOD_FIELDS)
          .filter(([, field]) => field.required)
          .map(([name]) => name),
        additionalProperties: false,
        properties: Object.fromEntries(
          Object.entries(PROJECT_MOD_FIELDS).map(([name, field]) => [
            name,
            projectModFieldSchema(field),
          ])
        ),
      },
    },
  });
}

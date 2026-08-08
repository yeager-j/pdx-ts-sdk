/**
 * `stellaris-mod.json` and the JSON schema beside it.
 *
 * The manifest is the project's single author-owned source of truth for mod
 * identity and launcher metadata: `src/mod.ts` is wiring from it to `createMod`
 * rather than a second place to state the same facts. The sole key under `mod`
 * is the mod prefix, which is what makes `keyof typeof manifest.mod` recover it
 * exactly rather than widening to `string`.
 *
 * The schema is emitted into the project and referenced relatively, so an
 * author gets completion and in-editor errors without the project acquiring a
 * dependency, a network fetch, or a URL that has to keep resolving forever.
 * `src/manifest.ts` enforces the same rules at runtime; `manifest.test.ts` runs
 * one corpus through both.
 */

import type { Resolved } from "../options.ts";

export const MANIFEST_FILE = "stellaris-mod.json";
export const MANIFEST_SCHEMA_FILE = "stellaris-mod.schema.json";

/** The SDK's rule, restated here because the schema is data, not code. */
const PREFIX_PATTERN = "^[a-z][a-z0-9_]*$";

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
  });
}

export function manifestSchema(): string {
  return json({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Stellaris mod project manifest",
    description:
      "Mod identity, launcher metadata, and where generated feature source goes. " +
      "src/mod.ts wires this to createMod.",
    type: "object",
    required: ["mod", "contentDirectory"],
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
        propertyNames: { pattern: PREFIX_PATTERN },
        additionalProperties: { $ref: "#/$defs/modConfig" },
      },
      contentDirectory: {
        description: "Project-relative directory generated feature source is written into.",
        type: "string",
        minLength: 1,
      },
    },
    $defs: {
      modConfig: {
        type: "object",
        required: ["name", "supportedVersion"],
        additionalProperties: false,
        properties: {
          name: { description: "Display name shown in the launcher.", type: "string" },
          version: { type: "string" },
          supportedVersion: {
            description: 'Game version pattern, e.g. "v4.4.*".',
            type: "string",
          },
          tags: { description: "Launcher tags.", type: "array", items: { type: "string" } },
          acceptGameVersion: {
            description: "Acknowledges a game build the SDK's rule table is not verified against.",
            type: "string",
          },
          uncheckedVanillaIds: {
            description: "Acknowledges authoring without compile-time vanilla id checking.",
            type: "boolean",
          },
        },
      },
    },
  });
}

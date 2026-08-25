/**
 * The generated public content barrel, rendered from the real rules.
 *
 * The barrel is the SDK's public content surface, so each table that decides
 * a name is public gets an assertion here, and the two ways
 * `PUBLIC_NESTED_TYPES` can rot get one each.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { emitAliasCategories } from "@pdx-ts/codegen-cwt/emit/content/alias-categories";
import { emitContentType } from "@pdx-ts/codegen-cwt/emit/content/content-type";
import { contentDefiners } from "@pdx-ts/codegen-cwt/emit/content/definers";
import {
  contentPublicBarrel,
  type PublicBarrelModule,
} from "@pdx-ts/codegen-cwt/emit/content/public-barrel";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import {
  referenceNameOf,
  typesReferencedBySubtype,
} from "@pdx-ts/codegen-cwt/lower/content-reference";
import { kebabCase, pascalCase } from "@pdx-ts/codegen-cwt/naming";
import {
  CONTENT_PATCH_REGISTRIES,
  CONTENT_SCOPE_PARAMETERS,
  REPEATED_STRUCT_DEFINITIONS,
  SPRITE_SHAPE_MINTS,
} from "@pdx-ts/codegen-cwt/overlay";
import {
  CONTENT_MANIFEST,
  registryNameOf,
  type ContentManifestEntry,
} from "@pdx-ts/codegen-cwt/policy/manifest";
import { PUBLIC_NESTED_TYPES } from "@pdx-ts/codegen-cwt/policy/public-surface";
import { Emitter } from "@pdx-ts/codegen-cwt/render/emitter";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));
const emitter = new Emitter(rules);
const subtypeReferencedTypes = typesReferencedBySubtype(rules);

const contents = CONTENT_MANIFEST.map((manifestEntry) => {
  const entry: ContentManifestEntry = manifestEntry;
  const type = rules.contentTypes.get(entry.type);
  const body = rules.bodies.get(entry.type);
  if (type === undefined || body === undefined) {
    throw new Error(`Missing fixture rules for ${entry.type}`);
  }
  emitter.beginFile();
  const emission = emitContentType(emitter, type, body, registryNameOf(entry), entry.as);
  emitter.endFile();
  return {
    manifest: manifestEntry,
    registry: registryNameOf(entry),
    referenceName: referenceNameOf(type, entry.as, subtypeReferencedTypes),
    emission,
  };
});
const { aliasCategories } = emitAliasCategories(
  emitter,
  rules,
  contents.flatMap((content) => content.emission.inlineSplices)
);
const definers = contentDefiners(contents);

const modules: PublicBarrelModule[] = [
  ...contents.map((content) => ({
    file: `${kebabCase(content.registry)}.ts`,
    code: content.emission.code,
    publicTypes: content.emission.publicTypes,
  })),
  ...[...aliasCategories].map(([category, emission]) => ({
    file: `${category.replaceAll("_", "-")}.ts`,
    code: emission.code,
    publicTypes: [],
  })),
  {
    file: "content-capability.ts",
    code: definers.capabilityCode,
    publicTypes: definers.capabilityPublicTypes,
  },
];
const barrel = contentPublicBarrel(modules);

/** The names the rendered barrel re-exports, keyed by the module they come from. */
function exportsByModule(rendered: string): Map<string, readonly string[]> {
  const statements = rendered.matchAll(/export type \{([^}]*)\} from "\.\/([\w-]+\.ts)";/g);
  return new Map(
    [...statements].map((statement) => [
      statement[2]!,
      statement[1]!.split(",").map((name) => name.trim()),
    ])
  );
}

const published = exportsByModule(barrel);

/** The published names of one registry's module, or none when it publishes nothing. */
function publishedFor(registry: string): readonly string[] {
  return published.get(`${kebabCase(registry)}.ts`) ?? [];
}

describe("the generated public content barrel", () => {
  it("documents every authored field in the player-crisis registries", () => {
    const registries = new Set([
      "ascension_perk_category",
      "resource",
      "crisis_path",
      "crisis_level",
      "crisis_objective",
      "menace_perk",
    ]);
    const undocumented = contents
      .filter((content) => registries.has(content.registry))
      .flatMap((content) =>
        Object.entries(content.emission.docTables[0]?.members ?? {}).flatMap(([member, row]) =>
          row.docs.length === 0 ? [`${content.registry}.${member}`] : []
        )
      );

    expect(undocumented).toEqual([]);
  });

  it("documents the vanilla-view workflow for ascension perk category patches", () => {
    expect(definers.capabilityCode).toContain("@example");
    expect(definers.capabilityCode).toContain("const vanilla = stellaris.load();");
    expect(definers.capabilityCode).toContain("mod.compile([feature], { vanilla });");
  });

  it("publishes every manifest registry's authoring types", () => {
    const missing = CONTENT_MANIFEST.flatMap((entry) => {
      const registry = registryNameOf(entry);
      const name = pascalCase(registry);
      return [`${name}Def`, `${name}Fields`, `Defined${name}`].filter(
        (type) => !publishedFor(registry).includes(type)
      );
    });

    expect(missing).toEqual([]);
  });

  it("publishes every patchable registry's whole patch vocabulary", () => {
    const missing = [...CONTENT_PATCH_REGISTRIES.keys()].flatMap((registry) => {
      const name = pascalCase(registry);
      return [`${name}Patch`, `Patched${name}`, `${name}PatchItem`].filter(
        (type) => !publishedFor(registry).includes(type)
      );
    });

    expect(missing).toEqual([]);
  });

  it("publishes every repeated-struct interface an author fills", () => {
    const missing = [...REPEATED_STRUCT_DEFINITIONS].flatMap(([path, config]) => {
      const registry = path.slice(0, path.indexOf("."));
      const type = `${config.typeName}Fields`;
      return publishedFor(registry).includes(type) ? [] : [`${registry}: ${type}`];
    });

    expect(missing).toEqual([]);
  });

  it("publishes the scope unions a scope-parameterised registry declares", () => {
    const missing = [...CONTENT_SCOPE_PARAMETERS].flatMap(([registry, row]) => {
      const declared = [
        `${pascalCase(registry)}Scope`,
        ...(row.declaredFrom === undefined
          ? []
          : [`${pascalCase(registry)}${pascalCase(row.declaredFrom.member)}`]),
      ];
      return declared.filter((type) => !publishedFor(registry).includes(type));
    });

    expect(missing).toEqual([]);
  });

  it("publishes the minted-name alias of every shape mint", () => {
    const capability = published.get("content-capability.ts") ?? [];
    const missing = SPRITE_SHAPE_MINTS.map((shape) => `${pascalCase(shape.method)}Name`).filter(
      (type) => !capability.includes(type)
    );

    expect(missing).toEqual([]);
  });

  it("keeps the runtime field tables and internal helpers unpublished", () => {
    expect(barrel).not.toContain("TECHNOLOGY_FIELDS");
    expect(barrel).not.toContain("TECHNOLOGY_LOCALISATION");
    // The interface `SpecialProjectFields` resolves to under a selector.
    expect(barrel).not.toContain("SpecialProjectFieldsBase");
    // A nested struct no author names: `prereqfor_desc` is authored inline.
    expect(barrel).not.toContain("TechnologyPrereqforDesc");
  });

  it("renders the same text for the same emissions, whatever order they arrive in", () => {
    expect(contentPublicBarrel(modules)).toBe(barrel);
    expect(contentPublicBarrel([...modules].reverse())).toBe(barrel);
  });

  it("fails when a curated type is no longer exported by its module", () => {
    const [first] = PUBLIC_NESTED_TYPES;
    const stubs = PUBLIC_NESTED_TYPES.map((row) => ({
      file: row.module,
      code: row.names.map((name) => `export interface ${name} {}\n`).join(""),
      publicTypes: [],
    }));

    expect(() =>
      contentPublicBarrel(
        stubs.map((stub) => (stub.file === first!.module ? { ...stub, code: "" } : stub))
      )
    ).toThrow(
      `The public barrel would export ${[...first!.names].sort().join(", ")} from ` +
        `"./${first!.module}", which declares no such export`
    );
    expect(() => contentPublicBarrel(stubs)).not.toThrow();
  });

  it("fails when a curated row names a module codegen does not emit", () => {
    expect(() => contentPublicBarrel([])).toThrow(
      `PUBLIC_NESTED_TYPES names module "${PUBLIC_NESTED_TYPES[0]!.module}", which codegen does ` +
        "not emit"
    );
  });
});

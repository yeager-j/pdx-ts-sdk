/**
 * The vanilla identifier generator, measured against a fixture install.
 *
 * Hermetic and always-run: the install-gated gate (regenerating against the
 * real 4.4.6 install and comparing to committed output) can only run next to a
 * copy of the game, so everything that can be proved without one is proved
 * here — the readers' three id layouts, parameter optionality, the trie's
 * shape, and determinism.
 *
 * The fixture lowers the trie threshold rather than shipping 2,000 fake
 * sprites: the threshold is an option precisely so the *logic* can be
 * exercised at ten ids instead of ten thousand.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditedSpellings } from "@pdx-ts/codegen-cwt/corpus/casing";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { VANILLA_REF_EXTRAS } from "@pdx-ts/codegen-cwt/policy/manifest";
import { describe, expect, it } from "vitest";

import { buildVanillaFacts } from "../src/build-facts.ts";
import { registryFile, TABLE_NAMES } from "../src/emit.ts";
import { formatEmitted } from "../src/format.ts";
import { generateVanillaPackage } from "../src/generate.ts";
import { VANILLA_MANIFEST, type VanillaIdRow } from "../src/manifest.ts";
import { readVanillaEvents } from "../src/read-events.ts";
import { readRegistryIds } from "../src/read-ids.ts";
import { readScriptedDefinitions } from "../src/read-scripted.ts";
import { bucketPath, fileBucketKey } from "../src/trie.ts";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const OPTIONS = {
  installRoot: path.join(ROOT, "fixtures/fake-install"),
  gameVersion: "4.4.6",
  configRoot: path.join(ROOT, "vendor/cwtools-stellaris-config/config"),
  docsRoot: path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1"),
  trieThreshold: 5,
};

const generated = generateVanillaPackage(OPTIONS);
const files = await formatEmitted(generated.files, path.join(ROOT, "packages/stellaris-ids/src"));

function file(name: string): string {
  const text = files.get(name);
  if (text === undefined) {
    throw new Error(`no emitted file ${name}; emitted ${[...files.keys()].join(", ")}`);
  }
  return text;
}

function registryReport(name: string) {
  const found = generated.report.registries.find((one) => one.registry === name);
  if (found === undefined) {
    throw new Error(`no report row for ${name}`);
  }
  return found;
}

describe("emitted file set", () => {
  it("emits one file per registry, plus the barrel and the tables", () => {
    expect(files.has("index.ts")).toBe(true);
    expect(files.has("tables.ts")).toBe(true);
    for (const row of generated.report.registries) {
      expect(files.has(registryFile(row.registry)), row.registry).toBe(true);
    }
    expect(files.has("scripted-triggers.ts")).toBe(true);
    expect(files.has("scripted-effects.ts")).toBe(true);
    expect(files.has("events/index.ts")).toBe(true);
  });

  it("emits the path inventory beside the barrel without re-exporting it", () => {
    // `./paths` is its own subpath so that importing the package's root never
    // loads tens of thousands of strings a caller did not ask for.
    expect(files.has("paths.ts")).toBe(true);
    expect(file("index.ts")).not.toContain("./paths.ts");
  });

  it("names every emitted registry in the tables", () => {
    const tables = file("tables.ts");
    for (const row of generated.report.registries) {
      const member = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(row.registry)
        ? row.registry
        : JSON.stringify(row.registry);
      expect(tables).toContain(`readonly ${member}:`);
    }
    expect(tables).toContain(
      "export interface VanillaScriptedTriggers extends VanillaScriptedTriggerParams {}"
    );
    expect(tables).toContain(
      "export interface VanillaScriptedEffects extends VanillaScriptedEffectParams {}"
    );
    expect(tables).toContain("readonly event: VanillaEventTrie;");
    expect(tables).toContain("readonly ship_class: VanillaShipClassMember;");
  });

  it("exports every table the SDK imports, so an empty one is not a missing one", () => {
    // `@pdx-ts/sdk` imports all five by name (ADR-0006). A table emitted only
    // when it has members would make an install that defines none of something
    // a compile error in the SDK rather than an empty set here.
    const tables = file("tables.ts");
    for (const name of TABLE_NAMES) {
      expect(tables, name).toContain(`export interface ${name}`);
    }
  });

  it("re-exports every public type from the barrel with no runtime exports", () => {
    const barrel = file("index.ts");
    const tablesExport = /export type \{([^}]*)\} from "\.\/tables\.ts";/.exec(barrel);
    expect(tablesExport, "the barrel re-exports the tables").not.toBeNull();
    for (const name of TABLE_NAMES) {
      expect(tablesExport![1], name).toContain(name);
    }
    expect(barrel).toContain(
      'export type { VanillaSpriteTypeTrie } from "./registries/sprite-type/index.ts";'
    );
    expect(barrel).toContain('export type { VanillaEventTrie } from "./events/index.ts";');
    expect(barrel).not.toMatch(/export (const|function|class|default)\b/);
  });

  it("carries the game version in every header", () => {
    for (const [name, text] of files) {
      expect(
        text.startsWith("// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6."),
        name
      ).toBe(true);
    }
  });
});

describe("event reader and trie", () => {
  it("groups definitions by the namespace in their full id and preserves exact event kinds", () => {
    expect(generated.report.events).toMatchObject({
      definitions: 4,
      scoped: 3,
      scopeless: 1,
      namespaces: 4,
      files: 2,
      diagnostics: 0,
      missing: false,
    });
    expect(generated.report.events.byKind).toEqual(
      new Map([
        ["country_event", 1],
        ["event", 1],
        ["observer_event", 1],
        ["ship_event", 1],
      ])
    );
    expect(files.has("events/declared_namespace_is_not_identity.ts")).toBe(false);
    expect(file("events/fake.ts")).toContain(
      'readonly $1: EventRef<"country", {}, "country"> & { readonly id: "fake.1" };'
    );
    expect(file("events/observer.ts")).toContain(
      'readonly notice: EventRef<"country", {}, "observer"> & { readonly id: "observer.notice" };'
    );
    expect(file("events/generic.ts")).toContain(
      'readonly start: EventScopelessRef & { readonly id: "generic.start" };'
    );
    expect(file("events/orphan.ts")).toContain(
      'readonly $2: EventRef<"ship", {}, "ship"> & { readonly id: "orphan.2" };'
    );
  });

  it("fails loudly on malformed and duplicate event ids", () => {
    const configRoot = OPTIONS.configRoot;
    const missingRoot = mkdtempSync(path.join(tmpdir(), "pdx-events-missing-"));
    const malformedRoot = mkdtempSync(path.join(tmpdir(), "pdx-events-malformed-"));
    const duplicateRoot = mkdtempSync(path.join(tmpdir(), "pdx-events-duplicate-"));
    try {
      mkdirSync(path.join(missingRoot, "events"));
      writeFileSync(path.join(missingRoot, "events/events.txt"), "country_event = { }\n");
      expect(() => readVanillaEvents(missingRoot, configRoot)).toThrow(
        "country_event has no scalar id"
      );

      mkdirSync(path.join(malformedRoot, "events"));
      writeFileSync(
        path.join(malformedRoot, "events/events.txt"),
        "country_event = { id = missing_namespace }\n"
      );
      expect(() => readVanillaEvents(malformedRoot, configRoot)).toThrow(
        'event id "missing_namespace" must be namespace.local-id'
      );

      mkdirSync(path.join(duplicateRoot, "events"));
      writeFileSync(
        path.join(duplicateRoot, "events/events.txt"),
        "country_event = { id = duplicate.1 }\nship_event = { id = duplicate.1 }\n"
      );
      expect(() => readVanillaEvents(duplicateRoot, configRoot)).toThrow(
        'duplicate event id "duplicate.1"'
      );
    } finally {
      rmSync(missingRoot, { recursive: true, force: true });
      rmSync(malformedRoot, { recursive: true, force: true });
      rmSync(duplicateRoot, { recursive: true, force: true });
    }
  });
});

describe("registry readers", () => {
  it("derives ref-only registry membership from the CWT generator's manifest", () => {
    const extras = new Set<string>(VANILLA_REF_EXTRAS.map((one) => one.type));
    expect(
      VANILLA_MANIFEST.filter(
        (row): row is VanillaIdRow => row.kind === "ids" && extras.has(row.type)
      ).map((row) => row.type)
    ).toEqual(VANILLA_REF_EXTRAS.map((one) => one.type));
  });

  it("reads id-keyed registries from the top-level keys", () => {
    expect(file("registries/technology.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      /** Identifiers defined in Stellaris 4.4.6 for the \`technology\` registry. */
      export type VanillaTechnologyId = "tech_fake_farming" | "tech_gene_tailoring";
      "
    `);
  });

  it("projects shared civic and origin ids from installed discriminator fields", () => {
    expect(file("registries/civic-or-origin.ts")).toContain('"civic_named_origin"');
    expect(file("registries/civic-or-origin.ts")).toContain('"origin_named_default_civic"');
    expect(file("registries/civic-or-origin-civic.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      /** Identifiers defined in Stellaris 4.4.6 for the \`civic_or_origin.civic\` registry. */
      export type VanillaCivicOrOriginCivicId =
        \"origin_named_default_civic\" | \"origin_named_explicit_civic\";
      "
    `);
    expect(file("registries/civic-or-origin-origin.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      /** Identifiers defined in Stellaris 4.4.6 for the \`civic_or_origin.origin\` registry. */
      export type VanillaCivicOrOriginOriginId = \"civic_named_origin\";
      "
    `);
  });

  it("does not descend a path_strict registry's subdirectories", () => {
    // `common/technology/category` holds `technology_category` definitions, a
    // different CWT type; the fixture puts `biology` there. Reading it as a
    // technology is exactly the silent over-approximation `path_strict = yes`
    // exists to prevent, and `stellaris.load()` skips the same two subdirs.
    expect(registryReport("technology").ids).toBe(2);
    expect(file("registries/technology.ts")).not.toContain("biology");
  });

  it("reads name_field registries from the keyword's body field", () => {
    expect(registryReport("ambient_object").ids).toBe(2);
    expect(file("registries/ambient-object.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      /** Identifiers defined in Stellaris 4.4.6 for the \`ambient_object\` registry. */
      export type VanillaAmbientObjectId = "fake_ambient_beacon" | "fake_ambient_relay";
      "
    `);
  });

  it("walks nested directories and honours the declared extension", () => {
    // Three `.asset` files, two of them directories down; `category` is a
    // different CWT type and contributes nothing.
    expect(registryReport("sound").files).toBe(3);
    expect(file("registries/sound.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      /** Identifiers defined in Stellaris 4.4.6 for the \`sound\` registry. */
      export type VanillaSoundId =
        | "fake.dotted.alert"
        | "fake_alert_one"
        | "fake_alert_three"
        | "fake_alert_two"
        | "fake_deep_hum"
        | "fake_deep_pulse";
      "
    `);
    expect(file("registries/sound-effect.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      /** Identifiers defined in Stellaris 4.4.6 for the \`sound_effect\` registry. */
      export type VanillaSoundEffectId =
        | "fake.dotted.effect"
        | "fake_effect_alpha"
        | "fake_effect_beta"
        | "fake_effect_deep_one"
        | "fake_effect_deep_two"
        | "fake_effect_gamma";
      "
    `);
  });

  it("descends a filterless skip_root_key registry by the presence of the name field", () => {
    // `type[sprite]` declares no `## type_key_filter`, because its eight
    // subtypes each carry their own. Two of the ten fixture sprites are written
    // under one of those other keywords (`frameAnimatedSpriteType`,
    // `PieChartType`); matching on any single keyword would have dropped them,
    // and vanilla's real set would fall from 9,198 to 8,617.
    expect(registryReport("spriteType").ids).toBe(10);
    expect(file("registries/sprite-type.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      /** Identifiers defined in Stellaris 4.4.6 for the \`spriteType\` registry. */
      export type VanillaSpriteTypeId =
        | "GFX_icon_alert"
        | "GFX_icon_warning"
        | "GFX_odd.name"
        | "GFX_planet_barren"
        | "GFX_planet_ocean"
        | "GFX_planet_toxic"
        | "GFX_ship"
        | "GFX_ship_combat"
        | "GFX_ship_combat_1"
        | "GFX_ship_combat_2";
      "
    `);
  });

  it("descends a filtered skip_root_key registry by the keyword the rules declare", () => {
    // The other disposition, and the one `type[sprite]` cannot have. Both
    // `type[model_mesh]` and `type[particle]` declare a type-level
    // `## type_key_filter`, which states the single key all of their
    // definitions carry — so a sibling under a different key inside the same
    // `objectTypes` envelope is somebody else's. Vanilla's own
    // `gfx/models/ui/_arrows.gfx` is exactly this: twelve `arrowType` blocks
    // that name-field presence alone handed out as mesh ids.
    expect(registryReport("pdxmesh").ids).toBe(2);
    expect(file("registries/pdxmesh.ts")).toContain(
      'export type VanillaPdxmeshId = "fake_shuttle_mesh" | "fake_station_mesh";'
    );
    expect(file("registries/pdxmesh.ts")).not.toContain("fake_move_arrow");

    expect(registryReport("pdxparticle").ids).toBe(2);
    expect(file("registries/pdxparticle.ts")).not.toContain("fake_not_a_particle");
  });

  it("matches a definition keyword by its audited spellings, never by lowercasing", () => {
    // The recognition hook, stated where it is read. Blanket-lowercasing would
    // absorb a key that differs from the filter only by case, which is the one
    // thing `casing.ts` exists to make somebody look at. Vanilla writes
    // `pdxmesh` and `pdxparticle` one way each, so those are exact today.
    expect(auditedSpellings("pdxmesh", "pdxmesh")).toEqual(["pdxmesh"]);
    expect(auditedSpellings("pdxparticle", "pdxparticle")).toEqual(["pdxparticle"]);
    // A registry whose table does carry a variant offers both, in canonical
    // order — the shape the reader would use if a filtered registry grew one.
    expect(auditedSpellings("spriteType", "spriteType")).toEqual(["spriteType", "SpriteType"]);
    // A key nobody audited is its own only spelling.
    expect(auditedSpellings("pdxmesh", "arrowType")).toEqual(["arrowType"]);
  });

  it("accepts name fields regardless of their source-key casing", () => {
    const ids = readRegistryIds(OPTIONS.installRoot, {
      registry: "special_project",
      referenceName: "special_project",
      path: "common/special_projects",
      extension: ".txt",
      keyword: "special_project",
      nameField: "key",
      skipRootKey: null,
      keyFilter: null,
      excludedKey: null,
      pathStrict: false,
      bucket: "stripped-file",
      oversized: false,
      subtypeProjections: [],
    });
    expect(ids.ids).toEqual(["fake_uppercase_project"]);
  });

  it("reports a registry the install does not have rather than failing", () => {
    // The fixture install has no `common/traditions` at all — the miniature
    // install carries only the directories some test needs.
    const missing = registryReport("tradition");
    expect(missing).toMatchObject({ ids: 0, files: 0, missing: true });
    expect(file("registries/tradition.ts")).toContain("= never;");
  });
});

describe("complex enum readers", () => {
  it("extracts install-defined members from each CWT selector shape", () => {
    expect(file("enums/ship-class.ts")).toContain('= "fake_ship_class";');
    expect(file("enums/section-slot.ts")).toContain('= "fake_section_slot";');
    expect(file("enums/component-tag.ts")).toContain('= "fake_component_tag";');
    expect(file("enums/component-slot.ts")).toContain('"fake_component_slot"');
    expect(file("enums/component-slot.ts")).toContain('"fake_component_slot_two"');
    expect(file("enums/situation-approach.ts")).toContain('"fake_approach"');
    expect(file("enums/situation-approach.ts")).toContain('"fake_approach_two"');
    expect(file("enums/situation-stage.ts")).toContain('= "fake_stage";');
  });

  it("discovers complex enums outside the writable content manifest", () => {
    const rules = loadRules(OPTIONS.configRoot);
    expect(rules.complexEnums.has("policy_option")).toBe(true);
    expect(rules.complexEnums.has("district_set")).toBe(true);
  });

  it("reports every complex enum input and its read outcome", () => {
    expect(generated.report.complexEnums).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "component_slot", files: 1, members: 2, missing: false }),
        expect.objectContaining({ name: "component_tag", files: 1, members: 1, missing: false }),
        expect.objectContaining({ name: "policy_option", files: 0, members: 0, missing: true }),
      ])
    );
  });
});

describe("scripted parameters", () => {
  it("makes defaulted and conditional parameters optional and the rest required", () => {
    expect(file("scripted-triggers.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      export interface VanillaScriptedTriggerParams {
        readonly fake_conditional: {
          readonly FLAG?: string | number;
          readonly NAME?: string | number;
        };
        readonly fake_defaulted: {
          readonly YEARS?: string | number;
        };
        readonly fake_dual_scope: {};
        readonly fake_no_params: {};
        readonly fake_required: {
          readonly TECH: string | number;
        };
        readonly fake_unknown_key: {};
      }
      "
    `);
  });

  it("keeps a defaulted parameter optional", () => {
    expect(file("scripted-triggers.ts")).toContain("readonly YEARS?: string | number;");
  });

  it("reads effects the same way", () => {
    expect(file("scripted-effects.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      export interface VanillaScriptedEffectParams {
        readonly fake_effect_params: {
          readonly AMOUNT: string | number;
          readonly REASON?: string | number;
        };
        readonly fake_effect_simple: {};
      }
      "
    `);
  });

  it("counts definitions and parameterized definitions", () => {
    expect(generated.report.scripted).toMatchObject([
      { registry: "scripted_trigger", definitions: 6, parameterized: 3, files: 1 },
      { registry: "scripted_effect", definitions: 2, parameterized: 1, files: 1 },
    ]);
  });
});

describe("scripted definition identity", () => {
  it("carries the selected definition's provenance", () => {
    const read = readScriptedDefinitions(
      OPTIONS.installRoot,
      "scripted_trigger",
      "common/scripted_triggers"
    );
    expect(read.definitions.find((one) => one.name === "fake_no_params")).toMatchObject({
      source: "00_fake_triggers.txt",
      ordinal: 0,
    });
  });

  it("fails on a duplicate instead of combining one body's params with another", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pdx-scripted-duplicate-"));
    const dir = path.join(root, "common/scripted_triggers");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "00_first.txt"), "same = { has_technology = $TECH$ }\n");
      writeFileSync(path.join(dir, "01_second.txt"), "same = { is_country_type = default }\n");

      expect(() =>
        readScriptedDefinitions(root, "scripted_trigger", "common/scripted_triggers")
      ).toThrow(
        'scripted_trigger: ambiguous duplicate definition "same" in 00_first.txt#0 and 01_second.txt#0'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("versioned build facts", () => {
  it("records compatible evidence versions and stable hashes", () => {
    const facts = buildVanillaFacts(OPTIONS);
    expect(facts.formatVersion).toBe(1);
    expect(facts.gameVersion).toBe("4.4.6");
    expect(facts.evidence.docs.version).toBe("4.4.1");
    expect(facts.evidence.cwt.version).toMatch(/^[0-9a-f]{40}$/);
    expect(facts.evidence.install.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(facts.evidence.cwt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(facts.evidence.docs.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(buildVanillaFacts(OPTIONS).evidence).toEqual(facts.evidence);
  });

  it("rejects a game and docs snapshot from different compatibility versions", () => {
    expect(() => buildVanillaFacts({ ...OPTIONS, gameVersion: "4.5.0" })).toThrow(
      "Stellaris 4.5.0 is incompatible with script docs 4.4.1"
    );
  });

  it("changes the install identity when an ID registry input changes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pdx-build-facts-"));
    const technologies = path.join(root, "common/technology");
    const source = path.join(technologies, "technologies.txt");
    try {
      mkdirSync(technologies, { recursive: true });
      writeFileSync(source, "tech_first = {}\n");
      const first = buildVanillaFacts({ ...OPTIONS, installRoot: root });

      writeFileSync(source, "tech_second = {}\n");
      const second = buildVanillaFacts({ ...OPTIONS, installRoot: root });

      const technologyIds = (facts: typeof first) =>
        facts.registries.find(({ spec }) => spec.registry === "technology")?.read.ids;
      expect(technologyIds(first)).toEqual(["tech_first"]);
      expect(technologyIds(second)).toEqual(["tech_second"]);
      expect(first.evidence.install.sha256).not.toBe(second.evidence.install.sha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("inferred scopes", () => {
  const triggers = generated.report.scripted.find((one) => one.registry === "scripted_trigger")!;

  it("binds each definition at the scope its body supports", () => {
    // `fake_no_params` is one country-scoped key, so it narrows. The two
    // widening cases below do not, and every binding is emitted either way.
    expect(file("triggers.ts")).toContain(
      'export const fakeNoParams = /*#__PURE__*/ scriptedTrigger("fake_no_params", "country");'
    );
    expect(file("triggers.ts")).toContain(
      'export const fakeUnknownKey = /*#__PURE__*/ scriptedTrigger("fake_unknown_key", "any");'
    );
    expect(file("triggers.ts")).toContain(
      'export const fakeDualScope = /*#__PURE__*/ scriptedTrigger("fake_dual_scope", "any");'
    );
  });

  it("names the key that cost a narrowing, not just the count", () => {
    // A coverage share on its own says something moved without saying what.
    // After a game patch this is the line that turns "the numbers dropped" into
    // a keyword to go look at.
    expect(triggers.unknownKeys).toEqual([["some_key_no_rule_declares", 1]]);
  });

  it("names the definitions whose intersection emptied", () => {
    // ∅ falls back to unconstrained, which is right and also indistinguishable
    // in the output from "the rules said nothing" — so it is reported by name.
    expect(triggers.emptied).toEqual(["fake_dual_scope"]);
  });
});

describe("bucket paths", () => {
  it("takes the whole directory path plus the stem for a directory layout", () => {
    // Real 4.4.6 layout: `sound/toxoids/ships/tox_ships_moves.asset`.
    expect(bucketPath("toxoids/ships/tox_ships_moves.asset", "directory", "sound")).toEqual([
      "toxoids",
      "ships",
      "tox_ships_moves",
    ]);
    expect(bucketPath("soundeffects.asset", "directory", "sound")).toEqual(["soundeffects"]);
  });

  it("takes the stem verbatim for a file layout, stripping nothing", () => {
    // `interface/interface.gfx` is a real file, and the token rule would
    // strip it to nothing and lose the bucket. `interface/` carries no
    // load-order numbers either, so there is nothing to strip.
    expect(bucketPath("eventpictures.gfx", "file", "interface")).toEqual(["eventpictures"]);
    expect(bucketPath("interface.gfx", "file", "interface")).toEqual(["interface"]);
    expect(bucketPath("common/buttons.gfx", "file", "interface")).toEqual(["buttons"]);
  });

  it("puts a stripped-file stem that strips to nothing at the root", () => {
    expect(bucketPath("00_static_modifiers.txt", "stripped-file", "static_modifiers")).toEqual([]);
    expect(
      bucketPath("09_static_modifiers_deficit.txt", "stripped-file", "static_modifiers")
    ).toEqual(["deficit"]);
  });
});

describe("file bucket keys", () => {
  it("strips the load-order number and the registry's own token", () => {
    // Every name below is a real 4.4.6 filename under
    // `common/static_modifiers/`.
    expect(fileBucketKey("09_static_modifiers_deficit", "static_modifiers")).toBe("deficit");
    expect(fileBucketKey("14_static_modifiers_clone_army_origin", "static_modifiers")).toBe(
      "clone_army_origin"
    );
  });

  it("merges files that differ only in load order", () => {
    expect(fileBucketKey("16_static_modifiers_paragon", "static_modifiers")).toBe(
      fileBucketKey("19_static_modifiers_paragon", "static_modifiers")
    );
  });

  it("gives a token-only stem no bucket at all", () => {
    expect(fileBucketKey("00_static_modifiers", "static_modifiers")).toBe("");
  });

  it("keeps the whole stripped stem when the token is absent", () => {
    expect(fileBucketKey("000_readme", "static_modifiers")).toBe("readme");
  });
});

describe("trie", () => {
  it("buckets a registry by its vanilla source files, ids at the root when a file names no subject", () => {
    // The fixture's `common/static_modifiers/` mirrors vanilla's own layout:
    // `00_static_modifiers.txt` and `01_static_modifiers.txt` strip to nothing
    // and put their ids at the root; `09_static_modifiers_deficit.txt` names a
    // bucket; `16_` and `19_static_modifiers_paragon.txt` name the *same*
    // bucket and merge, because load order is not a category; `000_readme.txt`
    // defines nothing and so contributes no bucket despite not carrying the
    // registry token at all.
    expect(registryReport("static_modifier").trie).toMatchObject({
      buckets: 5,
      rootLeaves: 3,
      flatOnly: 0,
    });
    expect(file("registries/static-modifier/index.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      import type { StaticModifierRef } from "@pdx-ts/sdk/stellaris";

      import type { VanillaStaticModifierTrieDeficit } from "./deficit.ts";
      import type { VanillaStaticModifierTrieParagon } from "./paragon.ts";

      export interface VanillaStaticModifierTrie {
        readonly deficit: VanillaStaticModifierTrieDeficit;
        readonly fake_empire_base: StaticModifierRef & {
          readonly id: "fake_empire_base";
        };
        readonly fake_orbital_base: StaticModifierRef & {
          readonly id: "fake_orbital_base";
        };
        readonly fake_planet_base: StaticModifierRef & {
          readonly id: "fake_planet_base";
        };
        readonly paragon: VanillaStaticModifierTrieParagon;
      }
      "
    `);
  });

  it("spells every leaf with the whole id, never a path join", () => {
    // The load-bearing property of the whole trie: `paragon` is a filename and
    // no part of any id, so `.id` is the leaf key alone.
    expect(file("registries/static-modifier/paragon.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      import type { StaticModifierRef } from "@pdx-ts/sdk/stellaris";

      export type VanillaStaticModifierTrieParagon = {
        readonly fake_crisis_studied: StaticModifierRef & {
          readonly id: "fake_crisis_studied";
        };
        readonly fake_legend_inspired: StaticModifierRef & {
          readonly id: "fake_legend_inspired";
        };
      };
      "
    `);
  });

  it("buckets sprites by their .gfx file and never splits an id inside one", () => {
    // `GFX_ship` and `GFX_ship_combat_1` are neighbours in one bucket, not a
    // node and its descendant: a `.gfx` file is the category, and the shared
    // `GFX_ship` prefix is not.
    expect(registryReport("spriteType").trie).toMatchObject({
      buckets: 2,
      rootLeaves: 0,
      flatOnly: 0,
    });
    expect(file("registries/sprite-type/fake-sprites.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      import type { SpriteRef } from "@pdx-ts/sdk/stellaris";

      export type VanillaSpriteTypeTrieFakeSprites = {
        readonly GFX_planet_barren: SpriteRef & {
          readonly id: "GFX_planet_barren";
        };
        readonly GFX_planet_ocean: SpriteRef & {
          readonly id: "GFX_planet_ocean";
        };
        readonly GFX_ship: SpriteRef & {
          readonly id: "GFX_ship";
        };
        readonly GFX_ship_combat: SpriteRef & {
          readonly id: "GFX_ship_combat";
        };
        readonly GFX_ship_combat_1: SpriteRef & {
          readonly id: "GFX_ship_combat_1";
        };
        readonly GFX_ship_combat_2: SpriteRef & {
          readonly id: "GFX_ship_combat_2";
        };
      };
      "
    `);
  });

  it("keeps an id a property path could not spell, as a quoted verbatim key", () => {
    // `GFX_odd.name` used to be routed to the flat union only, because a dot
    // cannot be a segment of a joined path. A verbatim leaf key has no such
    // limit, so nothing is flat-only any more.
    expect(file("registries/sprite-type.ts")).toContain('"GFX_odd.name"');
    expect(file("registries/sprite-type/fake-more.ts")).toContain(
      'readonly "GFX_odd.name": SpriteRef & {'
    );
  });

  it("nests a directory-layout registry one segment per directory level", () => {
    // `sound/nested/deeper/fake_deep.asset` is two directories and a stem, and
    // all three are navigation.
    expect(registryReport("sound").trie).toMatchObject({
      buckets: 2,
      rootLeaves: 0,
      flatOnly: 0,
    });
    expect(file("registries/sound/nested.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      import type { SoundRef } from "@pdx-ts/sdk/stellaris";

      export type VanillaSoundTrieNested = {
        readonly deeper: {
          readonly fake_deep: {
            readonly fake_deep_hum: SoundRef & {
              readonly id: "fake_deep_hum";
            };
            readonly fake_deep_pulse: SoundRef & {
              readonly id: "fake_deep_pulse";
            };
          };
        };
        readonly fake_more: {
          readonly "fake.dotted.alert": SoundRef & {
            readonly id: "fake.dotted.alert";
          };
          readonly fake_alert_two: SoundRef & {
            readonly id: "fake_alert_two";
          };
        };
      };
      "
    `);
    expect(file("registries/sound/index.ts")).toMatchInlineSnapshot(`
      "// Generated by @pdx-ts/codegen-vanilla from Stellaris 4.4.6. Do not edit.

      import type { VanillaSoundTrieFakeSounds } from "./fake-sounds.ts";
      import type { VanillaSoundTrieNested } from "./nested.ts";

      export interface VanillaSoundTrie {
        readonly fake_sounds: VanillaSoundTrieFakeSounds;
        readonly nested: VanillaSoundTrieNested;
      }
      "
    `);
  });

  it("emits one file per top-level bucket and nothing else", () => {
    // The whole trie directory, so a change of file scheme — the first-character
    // partition this replaced, or a deeper split — has to be stated here. The
    // shell removes every emitted-set orphan, so this is also what keeps stale
    // files from surviving a regeneration.
    expect([...files.keys()].filter((name) => name.includes("/sprite-type/")).sort()).toEqual([
      "registries/sprite-type/fake-more.ts",
      "registries/sprite-type/fake-sprites.ts",
      "registries/sprite-type/index.ts",
    ]);
    expect([...files.keys()].filter((name) => name.includes("/sound-effect/")).sort()).toEqual([
      "registries/sound-effect/fake-sounds.ts",
      "registries/sound-effect/index.ts",
      "registries/sound-effect/nested.ts",
    ]);
  });

  it("leaves registries under the threshold flat", () => {
    expect(registryReport("technology").trie).toBeNull();
    expect(files.has("registries/technology/index.ts")).toBe(false);
  });

  it("honours a manifest's explicit oversized declaration below the threshold", () => {
    expect(registryReport("deposit").trie).not.toBeNull();
    expect(files.has("registries/deposit/index.ts")).toBe(true);
  });
});

describe("determinism", () => {
  it("emits byte-identical output on a second run", () => {
    const again = generateVanillaPackage(OPTIONS);
    expect([...again.files.keys()]).toEqual([...generated.files.keys()]);
    for (const [name, text] of again.files) {
      expect(text, name).toBe(generated.files.get(name));
    }
    expect(again.report).toEqual(generated.report);
  });
});

describe("report", () => {
  it("counts the path inventory and both sources it came from", () => {
    // The fixture's one DLC archive carries five entries: a directory, three
    // pieces of operating-system metadata, and one real path. Only the last
    // reaches the inventory, and the archive file itself is a walked path too.
    expect(generated.report.paths).toEqual({
      total: 35,
      installFiles: 34,
      archives: 1,
      archiveEntries: 4,
      junkExcluded: 3,
    });
  });

  it("counts the localization keys and the files they were read from", () => {
    // The fixture's one english file spends seven lines on a header, a
    // comment, and five keys.
    expect(generated.report.localization).toEqual({
      keys: 5,
      files: 1,
      unparsedLines: 0,
      missing: false,
    });
  });

  it("counts what it read and what the licensing gate saw", () => {
    expect(generated.report.rejections).toBe(0);
    expect(generated.report.identifiersChecked).toBeGreaterThan(50);
    expect(generated.report.diagnostics).toBe(0);
    expect(generated.report.emittedFiles).toBe(generated.files.size);
  });
});

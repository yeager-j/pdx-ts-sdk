import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuleField } from "@pdx-ts/codegen-cwt/cwt/model";
import { parseCwt, type CwtNode } from "@pdx-ts/codegen-cwt/cwt/parser";
import { readAliases, scopeIndex } from "@pdx-ts/codegen-cwt/cwt/rules";
import { emitEffects } from "@pdx-ts/codegen-cwt/emit/script/effects";
import { emitEvents } from "@pdx-ts/codegen-cwt/emit/script/events";
import { emitScopeLinks } from "@pdx-ts/codegen-cwt/emit/script/links";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import { lowerRule, lowerRuleTable } from "@pdx-ts/codegen-cwt/lower/lowered-rule";
import {
  mapType,
  mergeBlock,
  repeatedMemberType,
  type ArgField,
  type ArgValue,
  type MapValue,
  type SkipReason,
} from "@pdx-ts/codegen-cwt/lower/script-shape";
import {
  deriveContentSwapIdentities,
  type ContentSwapSource,
} from "@pdx-ts/codegen-cwt/policy/content-swaps";
import { createEffectPolicy } from "@pdx-ts/codegen-cwt/policy/effects";
import { createEventFieldPolicy } from "@pdx-ts/codegen-cwt/policy/event-fields";
import { createModifierOperationPolicy } from "@pdx-ts/codegen-cwt/policy/modifiers";
import { RESERVED_TRIGGER_EXPORT_NAMES } from "@pdx-ts/codegen-cwt/policy/triggers";
import { Emitter } from "@pdx-ts/codegen-cwt/render/emitter";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1");
const rules = loadRules(CONFIG);
const docs = parseTriggerDocs(
  readFileSync(`${DOCS}/triggers.log`, "utf8"),
  readFileSync(`${DOCS}/effects.log`, "utf8")
);
const emitter = new Emitter(rules);
const scopes = scopeIndex(rules);

/**
 * The named members one block of declarations lowers to. A block that lowers
 * to an open map instead is a fault in the case under test, not a result
 * these assertions can read.
 */
function mergedFields(
  blockEmitter: Emitter,
  fields: readonly RuleField[]
): ArgField[] | SkipReason {
  const block = mergeBlock(blockEmitter, fields, null, new Set<string>());
  if ("detail" in block) {
    return block;
  }
  if (block.kind === "map") {
    throw new Error("the declarations lowered to an open map, not named fields");
  }
  return [...block.fields];
}

function cwtFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cwtFilesUnder(full);
    return entry.isFile() && entry.name.endsWith(".cwt") ? [full] : [];
  });
}

function filesMentioningBaseType(): string[] {
  return cwtFilesUnder(CONFIG).filter((file) => {
    const uncommented = readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.split("#", 1)[0]!)
      .join("\n");
    return /(?<![A-Za-z0-9_])base_type\s*=/.test(uncommented);
  });
}

function baseTypeDeclarations(file: string): readonly {
  name: string;
  baseType: string;
}[] {
  const declarations: { name: string; baseType: string }[] = [];
  const readTypes = (nodes: readonly CwtNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "assignment" || node.value.kind !== "block") continue;
      const name = /^type\[(.+)\]$/.exec(node.key.text)?.[1];
      if (name === undefined) continue;
      const baseType = node.value.nodes.find(
        (field) => field.kind === "assignment" && field.key.text === "base_type"
      );
      if (baseType?.kind === "assignment" && baseType.value.kind === "scalar") {
        declarations.push({ name, baseType: baseType.value.text });
      }
    }
  };
  const parsed = parseCwt(readFileSync(file, "utf8"), file);
  for (const node of parsed.nodes) {
    if (node.kind === "assignment" && node.key.text === "types" && node.value.kind === "block") {
      readTypes(node.value.nodes);
    }
  }
  return declarations;
}

function syntheticEffectInput(source: string, emitter: Emitter) {
  const aliases = readAliases(
    parseCwt(source, "synthetic-effects.cwt").nodes,
    "synthetic-effects.cwt",
    "effect",
    new Map()
  ).aliases;
  const effects = new Map([...rules.effects, ...aliases]);
  return {
    policy: createEffectPolicy({ ...rules, effects }),
    rules: lowerRuleTable(effects, docs.effects, emitter, scopes),
  };
}

describe("LoweredRule", () => {
  const triggers = lowerRuleTable(rules.triggers, docs.triggers, emitter, scopes);
  const effects = lowerRuleTable(rules.effects, docs.effects, emitter, scopes);

  it("carries legal scopes and nested-clause facts through one model", () => {
    const rule = triggers.get("count_owned_planet")!;
    expect(rule.scopes).toEqual(["country", "sector"]);
    expect(rule.scopeType).toBe('"country" | "sector"');
    expect(rule.blocks).toHaveLength(1);
    expect(rule.body.splice).toBeNull();
    expect([...rule.body.clauses]).toEqual([["limit", "planet"]]);
    expect([...rule.body.args]).toEqual(["count"]);
  });

  it("marks a rule removed only when every declaration says so", () => {
    expect(triggers.get("has_pop_flag")!.removed).toBe(true);
    expect(effects.get("pop_event")!.removed).toBe(true);
    expect(effects.get("run_in_ai_mode")!.removed).toBe(false);
    expect(triggers.get("count_owned_planet")!.removed).toBe(false);
  });

  it("rejects a rule whose declarations disagree about api_status", () => {
    const source = [
      "## api_status = removed",
      "alias[trigger:mixed_status] = $any",
      "## scopes = { country }",
      "alias[trigger:mixed_status] = bool",
    ].join("\n");
    const declarations = readAliases(
      parseCwt(source, "mixed.cwt").nodes,
      "mixed.cwt",
      "trigger",
      new Map()
    ).aliases.get("mixed_status")!;

    expect(declarations).toHaveLength(2);
    expect(() => lowerRule("mixed_status", declarations, undefined, emitter, scopes)).toThrow(
      'mixed_status: some declarations are marked "## api_status = removed" and some are not'
    );
  });

  it("retains mixed named arguments and effect splices", () => {
    const rule = effects.get("while")!;
    expect(rule.scopes).toBe("universal");
    expect(rule.body.splice).toEqual({ scope: null });
    expect([...rule.body.clauses]).toEqual([["limit", null]]);
    expect([...rule.body.args]).toEqual(["count"]);
  });

  it("retains create_ambient_object's scalar/block overloads for codegen", () => {
    const rule = effects.get("create_ambient_object")!;
    const fields = rule.blocks[0]!.named.filter((field) => field.key.kind === "name");
    expect(
      fields.map((field) => (field.key.kind === "name" ? field.key.name : "<non-name>"))
    ).toEqual([
      "type",
      "location",
      "scale",
      "use_3d_location",
      "entity_offset",
      "entity_offset",
      "entity_offset_angle",
      "entity_offset_angle",
      "entity_offset_height",
      "entity_offset_height",
      "base_angle_towards",
      "base_angle_towards",
      "entity_face_object",
      "entity_scale_to_size",
      "scripted_scale",
      "play_animation_once",
      "duration",
      "is_wreck",
      "effect",
    ]);
    for (const name of ["entity_offset", "entity_offset_angle", "entity_offset_height"]) {
      expect(
        fields.filter((field) => field.key.kind === "name" && field.key.name === name)
      ).toHaveLength(2);
    }

    const policy = createEffectPolicy(rules);
    const emitted = emitEffects(new Emitter(rules), docs.effects, scopes, effects, policy, []);
    expect(emitted.interfaces).toContain("createAmbientObject(args:");
    const ambientSignature = emitted.interfaces.slice(
      emitted.interfaces.indexOf("createAmbientObject(args:"),
      emitted.interfaces.indexOf("createAmbientObject(args:") + 1_500
    );
    expect(ambientSignature).toContain("target?: ScopeValue");
    expect(emitted.interfaces).toContain("entityOffset?: number | { min: number; max: number }");
    expect(emitted.meta).toContain('kind: "scalar-or-block"');
    expect(emitted.interfaces).toContain("effect?: (scope: AmbientObjectScope) => void");
    expect(emitted.fieldAdditions).toEqual([
      expect.stringContaining("create_ambient_object.target"),
      expect.stringContaining("create_ship.create_colony"),
    ]);
    // `create_colony` bounds its ethics at three, `start_colony` at ten —
    // past the width a union of lengths still reads as a bound.
    expect(emitted.interfaces).toContain(
      'ethos?: "random" | "owner" | { ethic: readonly [EthicRef | string] | ' +
        "readonly [EthicRef | string, EthicRef | string] | " +
        "readonly [EthicRef | string, EthicRef | string, EthicRef | string] }"
    );
    expect(emitted.interfaces).toContain(
      'ethos?: "owner" | "random" | ' +
        "{ ethic: readonly [EthicRef | string, ...(EthicRef | string)[]] }"
    );
    expect(emitted.skipped).not.toContainEqual(expect.objectContaining({ name: "create_colony" }));
    expect(emitted.skipped).not.toContainEqual(expect.objectContaining({ name: "start_colony" }));
    expect(emitted.scalarOnly).toEqual([]);
  });

  it("emits create_pop_group from its mixed ethos rule and keeps it out of the skip report", () => {
    const policy = createEffectPolicy(rules);
    const emitted = emitEffects(new Emitter(rules), docs.effects, scopes, effects, policy, []);

    expect(emitted.interfaces).toContain("createPopGroup(args:");
    expect(emitted.interfaces).toContain('ethos?: "random" | ScopeValue<');
    expect(emitted.interfaces).toContain("| { ethic: EthicRef | string };");
    expect(emitted.interfaces).toContain("size?: ScriptValue;");
    expect(emitted.interfaces).toContain("effect?: (scope: PopGroupScope) => void");
    expect(emitted.meta).toContain('createPopGroup: { key: "create_pop_group"');
    expect(emitted.meta).toContain('scalar: { objectKinds: ["scope-ref"] }');
    expect(emitted.references.find((row) => row.key === "create_pop_group")?.availability).toEqual({
      kind: "scopes",
      scopes: ["carrier", "colony", "planet", "ship"],
    });
    expect(emitted.skipped).not.toContainEqual(
      expect.objectContaining({ name: "create_pop_group" })
    );
  });

  it("emits scalar/block overloads and merges equivalent block declaration leaves", () => {
    const effectEmitter = new Emitter(rules);
    const input = syntheticEffectInput(
      [
        "## scopes = { planet }",
        "alias[effect:synthetic_terraform] = <planet_class>",
        "alias[effect:synthetic_terraform] = { class = <planet_class> inherit_entity = bool }",
        "alias[effect:synthetic_terraform] = { class = <planet_class_random_list> inherit_entity = bool }",
      ].join("\n"),
      effectEmitter
    );
    const emitted = emitEffects(effectEmitter, docs.effects, scopes, input.rules, input.policy, []);

    expect(emitted.interfaces).toContain(
      "syntheticTerraform(value: PlanetClassRef | string): void;\n" +
        "  syntheticTerraform(args: { class: PlanetClassRef | string | PlanetClassRandomListRef; inheritEntity: boolean }): void;"
    );
    expect(emitted.meta).toContain('kind: "scalar-or-block"');
    expect(emitted.scalarOnly).toEqual([]);
  });

  it("refuses multiple block declarations whose layouts differ", () => {
    const effectEmitter = new Emitter(rules);
    const input = syntheticEffectInput(
      [
        "## scopes = { planet }",
        "alias[effect:synthetic_multiple_blocks] = { class = <planet_class> }",
        "alias[effect:synthetic_multiple_blocks] = { inherit_entity = bool }",
      ].join("\n"),
      effectEmitter
    );
    const emitted = emitEffects(effectEmitter, docs.effects, scopes, input.rules, input.policy, []);

    expect(emitted.skipped).toContainEqual({
      name: "synthetic_multiple_blocks",
      category: "multiple-block-forms",
      detail: "multiple block declarations",
    });
  });

  it("expands the name alias category into effect argument fields", () => {
    const effectEmitter = new Emitter(rules);
    effectEmitter.beginFile();
    const emitted = emitEffects(
      effectEmitter,
      docs.effects,
      scopes,
      effects,
      createEffectPolicy(rules),
      []
    );
    const nameEffects = [
      "clone_leader",
      "create_army",
      "create_balanced_fleet",
      "create_country",
      "create_fleet",
      "create_leader",
      "create_random_fleet",
      "create_rebels",
      "create_saved_leader",
      "create_ship",
      "create_species",
      "declare_war",
      "join_alliance",
      "modify_army",
      "spawn_megastructure",
    ];

    for (const name of nameEffects) {
      expect(emitted.skipped).not.toContainEqual(
        expect.objectContaining({
          name,
          category: "unsupported-alias-splice",
          detail: expect.stringContaining("(name)"),
        })
      );
    }
    for (const name of [
      "create_army",
      "create_ship",
      "declare_war",
      "join_alliance",
      "modify_army",
      "spawn_megastructure",
    ]) {
      expect(emitted.skipped).not.toContainEqual(expect.objectContaining({ name }));
    }
    expect(
      emitted.skipped
        .filter((skip) => nameEffects.includes(skip.name))
        .map(({ name, category }) => [name, category])
    ).toEqual([]);
    expect(emitted.interfaces).toContain('civics?: ScopeValue<"agreement"');
    expect(emitted.interfaces).toContain(
      '| { civic?: readonly (CivicOrOriginCivicRef | string | "random")[] }'
    );
    expect(emitted.interfaces).toContain("variableString?: readonly string[]");
    expect(emitted.interfaces).toContain("spawnMegastructure(args:");
    expect(emitted.interfaces).toContain("type: MegastructureRef | string");
    expect(emitted.interfaces).toContain("initEffect?: (scope: MegastructureScope) => void");
    expect(emitted.interfaces).toContain("createColony?: boolean");
    const declareWarSignature = emitted.interfaces.slice(
      emitted.interfaces.indexOf("declareWar(args:"),
      emitted.interfaces.indexOf("declareWar(args:") + 1_500
    );
    expect(declareWarSignature).toContain(
      "name?: string | { key: string; variableString?: readonly string[] }"
    );
    expect(emitted.fieldCardinalityOverrides).toEqual([
      expect.stringContaining("declare_war.name → optional"),
      expect.stringContaining("copy_ascension_perks_from.exceptions → value-list 0..inf"),
      expect.stringContaining("copy_traditions_from.exceptions → value-list 0..inf"),
      expect.stringContaining("create_balanced_fleet.ship_designs → optional"),
      expect.stringContaining("storm_apply_aftermath_modifier.severity → repeated"),
      expect.stringContaining("create_country.remove_invalid_civics → optional"),
    ]);
    // The one field of `create_country` CWT leaves unannotated, which the game
    // documents as defaulting to `no`.
    expect(emitted.interfaces).toContain("removeInvalidCivics?: boolean");
    expect(emitted.meta).toContain(
      '{ prop: "variableString", key: "variable_string", kind: "value", repeated: true }'
    );
    const usage = effectEmitter.endFile();
    expect(usage.refs).toContain("name_list");
    // Only an emitted rule contributes imports, and every name-aliasing rule
    // now emits: `create_country` brings the enum behind its `contact_rule`
    // field, `create_species` the class behind its `class` field.
    expect(usage.enums).toContain("contact_rule");
    expect(usage.refs).toContain("species_class");
  });

  it("authors a repeated effect field as an array and marks it repeated in the meta", () => {
    const emitted = emitEffects(
      new Emitter(rules),
      docs.effects,
      scopes,
      effects,
      createEffectPolicy(rules),
      []
    );

    expect(emitted.interfaces).toContain(
      "setFleetFormation(args: { position?: readonly { x: number; y: number }[] }): void;"
    );
    expect(emitted.interfaces).toContain(
      "variable?: readonly { varname?: ScriptValue; type?: MessageVariableType; key?: string; " +
        "value?: string; localization?: string; scope?: ScopeValue; trigger?: Trigger<S> }[]"
    );
    expect(emitted.meta).toContain(
      '{ prop: "position", key: "position", kind: "fields", fields: ' +
        '[{ prop: "x", key: "x", kind: "value" }, { prop: "y", key: "y", kind: "value" }], ' +
        "repeated: true }"
    );
    expect(emitted.meta).toContain(
      '{ prop: "ethic", key: "ethic", kind: "value", refTypes: ["ethic"], repeated: true }'
    );
  });

  it("makes a cluster generic over its receiving scope when a clause runs there", () => {
    const emitted = emitEffects(
      new Emitter(rules),
      docs.effects,
      scopes,
      effects,
      createEffectPolicy(rules),
      []
    );

    expect(emitted.interfaces).toContain(
      "export interface UniversalEffects<S extends ScopeName> extends " +
        "EnableSpecialProjectEffectsExtension {"
    );
    expect(emitted.universalParameters).toBe("<S extends ScopeName>");
    expect(emitted.interfaces).toContain("trigger?: Trigger<S> }[] }): void;");
    expect(emitted.interfaces).toContain(
      'export interface CountryScope extends StructuralEffects<"country">,'
    );
    expect(emitted.interfaces).toContain('EffectsIn8Scopes39a9<"country">,');
    // A cluster valid in one scope names that scope directly: there is no
    // second caller for its clause types to disagree with.
    expect(emitted.interfaces).toContain("export interface EffectsInFleet {");
  });

  it("rejects a stale effect-field cardinality override", () => {
    const declareWar = effects.get("declare_war")!;
    const block = declareWar.blocks[0]!;
    const changed = new Map(effects);
    changed.set("declare_war", {
      ...declareWar,
      blocks: [
        {
          ...block,
          type: {
            ...block.type,
            fields: block.type.fields.map((field) =>
              field.key.kind === "aliasName" && field.key.category === "name"
                ? { ...field, cardinality: { min: 0, max: 1 } }
                : field
            ),
          },
        },
      ],
    });

    expect(() =>
      emitEffects(new Emitter(rules), docs.effects, scopes, changed, createEffectPolicy(rules), [])
    ).toThrow(/CWT already makes it optional/);
  });

  it("rejects an effect-field overlay after CWT starts declaring that field", () => {
    const ambient = effects.get("create_ambient_object")!;
    const block = ambient.blocks[0]!;
    const location = block.named.find(
      (field) => field.key.kind === "name" && field.key.name === "location"
    )!;
    const changed = new Map(effects);
    changed.set("create_ambient_object", {
      ...ambient,
      blocks: [
        {
          ...block,
          type: {
            ...block.type,
            fields: [
              ...block.type.fields,
              {
                ...location,
                key: { kind: "name", name: "target" },
                type: { kind: "scope", name: "any" },
              },
            ],
          },
          named: [
            ...block.named,
            {
              ...location,
              key: { kind: "name", name: "target" },
              type: { kind: "scope", name: "any" },
            },
          ],
        },
      ],
    });

    expect(() =>
      emitEffects(new Emitter(rules), docs.effects, scopes, changed, createEffectPolicy(rules), [])
    ).toThrow(
      'EFFECT_FIELD_ADDITIONS names "create_ambient_object.target", which CWT now declares'
    );
  });

  it("carries an object-backed scalar discriminator through a scalar/block overload", () => {
    const ambient = effects.get("create_ambient_object")!;
    const block = ambient.blocks[0]!;
    const scalarOffset = block.named.find(
      (field) =>
        field.key.kind === "name" &&
        field.key.name === "entity_offset" &&
        field.type.kind !== "block"
    )!;
    const fields = block.named.filter(
      (field) => field.key.kind === "name" && field.key.name === "entity_offset"
    );
    const merged = mergedFields(new Emitter(rules), [
      ...fields,
      {
        ...scalarOffset,
        type: { kind: "typeRef", name: "ambient_object" },
      },
    ]);
    expect(Array.isArray(merged)).toBe(true);
    if (!Array.isArray(merged)) {
      throw new Error(merged.detail);
    }
    expect(merged).toHaveLength(1);
    expect(merged[0]?.value).toMatchObject({
      kind: "scalarOrBlock",
      scalar: { objectKinds: ["typed-ref"] },
    });
  });

  it("lowers a scope-typed field to its scope value and literal arms", () => {
    const parent = effects
      .get("create_fleet")!
      .blocks[0]!.named.filter((field) => field.key.kind === "name" && field.key.name === "parent");
    const merged = mergedFields(new Emitter(rules), parent);
    expect(Array.isArray(merged)).toBe(true);
    if (!Array.isArray(merged)) {
      throw new Error(merged.detail);
    }
    expect(merged[0]?.value).toMatchObject({
      kind: "scalar",
      value: { type: 'ScopeValue<"fleet"> | "none"' },
    });
  });

  /**
   * A misspelled bracketed keyword must stay a visible skip. Treating it as a
   * literal would type the field as the string `sceop2[fleet]`.
   */
  it("skips a field whose bracketed CWT keyword the classifier does not know", () => {
    const parent = effects
      .get("create_fleet")!
      .blocks[0]!.named.filter((field) => field.key.kind === "name" && field.key.name === "parent");
    const merged = mergedFields(
      new Emitter(rules),
      parent.map((field) => ({
        ...field,
        type: { kind: "unknownKeyword", text: "sceop2[fleet]" } as const,
      }))
    );
    expect(merged).toEqual({
      category: "unsupported-field-value",
      detail: 'field "parent" has a type the emitter cannot express',
    });
  });

  it("keys an int-filtered map on number and a reference-filtered one on string", () => {
    const map = (overrides: Partial<MapValue>): MapValue => ({
      keyName: "int",
      indexType: "number",
      value: { type: "TraitRef | string", toScalar: (expression) => expression },
      cardinality: { min: 0, max: null },
      splice: false,
      ...overrides,
    });

    expect(mapType(new Emitter(rules), map({}))).toBe(
      "{ readonly [int: number]: TraitRef | string }"
    );
    expect(mapType(new Emitter(rules), map({ keyName: "resource", indexType: "string" }))).toBe(
      "{ readonly [resource: string]: TraitRef | string }"
    );
  });

  it("lowers the int key filter of leader traits to a number-keyed member", () => {
    const traitsDeclarations = effects
      .get("create_leader")!
      .blocks[0]!.named.filter((field) => field.key.kind === "name" && field.key.name === "traits");
    const merged = mergedFields(new Emitter(rules), traitsDeclarations);

    expect(Array.isArray(merged)).toBe(true);
    if (!Array.isArray(merged)) {
      throw new Error(merged.detail);
    }
    const traits = merged.find((field) => field.name === "traits");
    if (traits?.value.kind !== "fields") {
      throw new Error("create_leader.traits no longer lowers to a block of named members");
    }
    expect(traits.value.fields.find((field) => field.name === "entries")?.value).toMatchObject({
      kind: "map",
      map: { keyName: "int", indexType: "number", splice: true },
    });
  });

  it("declines a mixed block whose open keys come from two key filters", () => {
    const debris = effects.get("add_resource_from_debris")!.blocks[0]!.named;
    const patron = effects.get("add_attunement")!.blocks[0]!.named[0]!;
    const block = mergeBlock(new Emitter(rules), [...debris, patron], null, new Set<string>());

    expect(block).toEqual({
      category: "computed-field-key",
      detail: "mixed block with more than one computed key family",
    });
  });

  it("keeps expanding an enum-typed key filter into named members", () => {
    const merged = mergedFields(new Emitter(rules), effects.get("add_modifier")!.blocks[0]!.named);

    expect(Array.isArray(merged)).toBe(true);
    if (!Array.isArray(merged)) {
      throw new Error(merged.detail);
    }
    expect(merged.map((field) => field.name)).toContain("days");
    expect(merged.map((field) => field.name)).toContain("years");
    expect(merged.every((field) => field.value.kind !== "map")).toBe(true);
  });

  it("preserves a structured-only field without inventing a scalar arm", () => {
    const settings = effects.get("set_diplomacy_action_setting")!;
    const merged = mergedFields(new Emitter(rules), settings.blocks[0]!.named);
    expect(Array.isArray(merged)).toBe(true);
    if (!Array.isArray(merged)) {
      throw new Error(merged.detail);
    }
    expect(merged.find((field) => field.name === "settings")?.value).toMatchObject({
      kind: "fields",
      fields: [
        expect.objectContaining({ name: "vote_type" }),
        expect.objectContaining({ name: "acceptance_type" }),
      ],
    });
  });
});

describe("a spliced alias category with a script authoring surface", () => {
  const effects = lowerRuleTable(rules.effects, docs.effects, emitter, scopes);
  const emitted = emitEffects(
    new Emitter(rules),
    docs.effects,
    scopes,
    effects,
    createEffectPolicy(rules),
    []
  );

  it("emits the category as one union of single-member objects", () => {
    // `queue_actions = { alias_name[fleet_action] }` is an ordered queue in
    // which a member may repeat, so its members cannot be one struct of
    // optional keys: `wait` twice has to stay two items.
    expect(emitted.interfaces).toContain("export type FleetAction<S extends ScopeName> =");
    expect(emitted.interfaces).toContain(
      "| { wait: number | { duration: number; random?: number } }"
    );
    expect(emitted.interfaces).toContain("| { moveTo: ScopeValue<");
    expect(emitted.interfaces).toContain('| { orbitPlanet: ScopeValue<"planet"> | "random" }');
  });

  it("recurses through the category name rather than expanding it", () => {
    expect(emitted.interfaces).toContain("actions: readonly FleetAction<S>[] }");
    expect(emitted.interfaces).toContain('foundSystem: readonly FleetAction<"system">[];');
    expect(emitted.interfaces).toContain("failed?: readonly FleetAction<S>[] }");
  });

  it("types a member's own splices as the clause each one holds", () => {
    // `trigger = { id = scalar alias_name[trigger] }` pushes system scope, so
    // its conditions are typed there; `effect = { id = scalar
    // alias_name[effect] }` pushes none and runs in the list's own scope.
    expect(emitted.interfaces).toContain(
      "id: string; \n/** The nested conditions, written bare inside the block beside its " +
        'named keys. */\nconditions: Trigger<"system"> };'
    );
    expect(emitted.interfaces).toContain(
      "id: string; \n/** The nested effects, written bare inside the block beside its " +
        "named keys. */\neffects: (scope: ScopeObjOf<S>) => void }"
    );
  });

  it("keeps each member's own CWT documentation on the member", () => {
    expect(emitted.interfaces).toContain(
      "| { \n/** This requires the fleet to be a planet destroyer */\ndestroyPlanet: {"
    );
    expect(emitted.interfaces).toContain(
      "stance: FleetStance; \n/** days to wait */\ndays?: number }"
    );
  });

  it("takes the list as the method's one argument, in the fleet cluster's own scope", () => {
    expect(emitted.interfaces).toContain(
      'queueActions(actions: readonly FleetAction<"fleet">[]): void;'
    );
  });

  it("gives the recorder one member table per listed category", () => {
    expect(emitted.meta).toContain(
      'queueActions: { key: "queue_actions", shape: { kind: "alias-list", category: "fleet_action" } }'
    );
    expect(emitted.meta).toContain("export const ALIAS_LIST_META");
    expect(emitted.meta).toContain(
      '"fleet_action": [{ prop: "repeat", key: "repeat", kind: "fields"'
    );
    expect(emitted.meta).toContain(
      '{ prop: "actions", key: "actions", kind: "alias-list", category: "fleet_action", splice: true }'
    );
    expect(emitted.meta).toContain(
      '{ prop: "conditions", key: "conditions", kind: "trigger", splice: true }'
    );
    expect(emitted.meta).toContain(
      '{ prop: "foundSystem", key: "found_system", kind: "alias-list", category: "fleet_action" }'
    );
  });

  it("reuses the content-side block for a category that already has one", () => {
    // `create_country.government_restrictions` splices the same grammar the
    // civic and origin registries author, so it takes that emitted interface
    // rather than a second type saying the same thing.
    expect(emitted.interfaces).toContain("governmentRestrictions?: GovernmentTriggerBlock;");
    expect(emitted.interfaces).not.toContain("export type GovernmentTrigger<");
    expect(emitted.meta).toContain(
      '{ prop: "governmentRestrictions", key: "government_restrictions", kind: "alias-struct", ' +
        'category: "government_trigger" }'
    );
    // The recorder loads the meta module, so the meta module is what pulls in
    // the field table that block is written through.
    expect(emitted.meta).toContain('import "./government-trigger.ts";');
  });

  it("skips a nested splice of a category with no script authoring surface", () => {
    const createCountry = effects.get("create_country")!;
    const block = createCountry.blocks[0]!;
    const restrictions = block.named.find(
      (field) => field.key.kind === "name" && field.key.name === "government_restrictions"
    )!;
    const merged = mergeBlock(
      new Emitter(rules),
      [
        {
          ...restrictions,
          type: {
            kind: "block",
            bare: [],
            fields: [
              { ...restrictions, key: { kind: "aliasName", category: "pop_pre_trigger" } as const },
            ],
          },
        },
      ],
      null,
      new Set(["trigger", "effect", "fleet_action", "government_trigger"])
    );

    expect(merged).toEqual({
      category: "unsupported-alias-splice",
      detail:
        'field "government_restrictions" structured arm splices a category the field model ' +
        "cannot type (pop_pre_trigger)",
    });
  });
});

describe("a repeated argument's declared bound", () => {
  const item: ArgValue = {
    kind: "scalar",
    value: { type: "EthicRef", toScalar: (expression) => expression },
  };

  it("spells a bounded repetition as the lengths it admits", () => {
    expect(repeatedMemberType(new Emitter(rules), item, "EthicRef", { min: 1, max: 3 })).toBe(
      "readonly [EthicRef] | readonly [EthicRef, EthicRef] | " +
        "readonly [EthicRef, EthicRef, EthicRef]"
    );
  });

  it("spells an unbounded repetition as an array, keeping any minimum", () => {
    expect(repeatedMemberType(new Emitter(rules), item, "EthicRef", { min: 0, max: null })).toBe(
      "readonly EthicRef[]"
    );
    expect(repeatedMemberType(new Emitter(rules), item, "EthicRef", { min: 1, max: null })).toBe(
      "readonly [EthicRef, ...EthicRef[]]"
    );
  });

  it("carries the bound into the emitted argument, widest form across the declarations", () => {
    // `ethic = <ethic>` and `ethic = random` are both 1..3: one key of three
    // occurrences, each taking either form, not six occurrences.
    const emitted = emitEffects(
      new Emitter(rules),
      docs.effects,
      scopes,
      lowerRuleTable(rules.effects, docs.effects, emitter, scopes),
      createEffectPolicy(rules),
      []
    );

    expect(emitted.interfaces).toContain(
      'ethic: readonly [EthicRef | string | "random"] | ' +
        'readonly [EthicRef | string | "random", EthicRef | string | "random"] | ' +
        'readonly [EthicRef | string | "random", EthicRef | string | "random", ' +
        'EthicRef | string | "random"]'
    );
    // 1..10 is past the width a union of lengths still reads as a bound, so it
    // keeps the minimum and stays an array.
    expect(emitted.interfaces).toContain(
      "ethic: readonly [EthicRef | string, ...(EthicRef | string)[]]"
    );
    // The recorder needs the fact, not the bound.
    expect(emitted.meta).toContain(
      '{ prop: "ethic", key: "ethic", kind: "value", refTypes: ["ethic"], repeated: true }'
    );
  });
});

describe("the effect ownership policy", () => {
  const policy = createEffectPolicy(rules);

  it("derives fire ownership from event kinds joined to effect rules", () => {
    expect(policy.fireKeys.size).toBe(20);
    expect(policy.fireKeys.has("country_event")).toBe(true);
    expect(policy.fireKeys.has("pop_event")).toBe(false);
    expect(policy.byKey.get("pop_event")).toMatchObject({ owner: "generated" });
  });

  it("reports a scoped event kind whose fire-effect rule disappears", () => {
    const effects = new Map(rules.effects);
    effects.delete("country_event");
    const changedRules = { ...rules, effects };
    const changedPolicy = createEffectPolicy(changedRules);
    const events = emitEvents(new Emitter(changedRules), changedPolicy, "<S extends ScopeName>");

    expect(events.skipped).toContainEqual({
      name: "country_event",
      category: "missing-fire-rule-scope",
      detail: "no fire-effect rule with `## scopes`",
    });
    expect(events.fireMethods).toBe(22);
  });

  it("does not grant fire ownership without declared receiving scopes", () => {
    const effects = new Map(rules.effects);
    effects.set(
      "country_event",
      rules.effects
        .get("country_event")!
        .map((declaration) => ({ ...declaration, supportedScopes: null }))
    );
    const changedRules = { ...rules, effects };
    const changedPolicy = createEffectPolicy(changedRules);
    const events = emitEvents(new Emitter(changedRules), changedPolicy, "<S extends ScopeName>");

    expect(changedPolicy.fireKeys.has("country_event")).toBe(false);
    expect(changedPolicy.byKey.get("country_event")).toMatchObject({ owner: "generated" });
    expect(events.skipped).toContainEqual({
      name: "country_event",
      category: "missing-fire-rule-scope",
      detail: "no fire-effect rule with `## scopes`",
    });
  });

  it("accounts explicitly for CWT-owned and SDK-synthetic methods", () => {
    expect(policy.structuralMethods).toEqual(
      new Set([
        "if",
        "whileLoop",
        "random",
        "randomList",
        "lockedRandomList",
        "saveEventTargetAs",
        "saveGlobalEventTargetAs",
        "addResource",
        "hiddenEffect",
        "addEventChainCounter",
        "resetEventChainCounter",
        "previewModifier",
        "target",
        "run",
      ])
    );
  });

  it("reserves the effect-path terminal against generated scope links", () => {
    const lowered = lowerRuleTable(rules.effects, docs.effects, emitter, scopes);
    expect(() =>
      emitEffects(emitter, docs.effects, scopes, lowered, policy, [
        {
          key: "effects",
          method: "effects",
          inputScopes: ["country"],
          outputScope: "country",
          docs: [],
        },
      ])
    ).toThrow(/scope link "effects" would emit property "effects"/);
  });
});

describe("generator-owned SDK protocols", () => {
  it("owns every complex modifier operation with a disposition and rationale", () => {
    const policy = createModifierOperationPolicy(rules);
    expect(policy.find((entry) => entry.scriptKey === "multiply")).toMatchObject({
      member: "multiplier",
      disposition: "supported",
    });
    expect(policy.find((entry) => entry.scriptKey === "pow")).toMatchObject({
      member: null,
      disposition: "unsupported",
    });
    expect(policy.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it("rejects an unowned modifier enum member", () => {
    const enums = new Map(rules.enums);
    enums.set("complex_maths_enum", [...enums.get("complex_maths_enum")!, "future_op"]);
    expect(() => createModifierOperationPolicy({ ...rules, enums })).toThrow(/future_op/);
  });

  it("derives an exhaustive event and option support ledger", () => {
    const policy = createEventFieldPolicy(rules);
    expect(policy.event.length).toBeGreaterThan(40);
    expect(policy.option.length).toBeGreaterThan(10);
    expect(policy.event.find((entry) => entry.scriptKey === "base")).toMatchObject({
      disposition: "unsupported",
    });
    expect(policy.event.find((entry) => entry.scriptKey === "picture")).toMatchObject({
      disposition: "partial",
      unsupportedForms: ["repeated scalar picture values", "triggered picture blocks"],
    });
    expect(policy.event.find((entry) => entry.scriptKey === "show_sound")).toMatchObject({
      disposition: "partial",
    });
    expect(policy.option.find((entry) => entry.scriptKey === "name")).toMatchObject({
      disposition: "partial",
      unsupportedForms: ["repeated scalar names", "triggered name blocks"],
    });
  });

  it("rejects event fields whose CWT shape changes", () => {
    const body = rules.bodies.get("event")!;
    const reshape = (fields: typeof body.fields): typeof body.fields =>
      fields.map((field) => {
        if (field.key.kind === "name" && field.key.name === "title") {
          return { ...field, cardinality: { min: 0, max: 2 } };
        }
        return field.type.kind === "block"
          ? { ...field, type: { ...field.type, fields: reshape(field.type.fields) } }
          : field;
      });
    const fields = reshape(body.fields);
    const bodies = new Map(rules.bodies).set("event", { ...body, fields });
    expect(() => createEventFieldPolicy({ ...rules, bodies })).toThrow(/title/);
  });

  it("rejects event fields whose CWT scalar type changes", () => {
    const body = rules.bodies.get("event")!;
    const reshape = (fields: typeof body.fields): typeof body.fields =>
      fields.map((field) => {
        if (field.key.kind === "name" && field.key.name === "event_window_type") {
          return { ...field, type: { kind: "scalar" as const } };
        }
        return field.type.kind === "block"
          ? { ...field, type: { ...field.type, fields: reshape(field.type.fields) } }
          : field;
      });
    const bodies = new Map(rules.bodies).set("event", { ...body, fields: reshape(body.fields) });

    expect(() => createEventFieldPolicy({ ...rules, bodies })).toThrow(/event_window_type/);
  });

  it("rejects changes to recursively nested event member types", () => {
    const body = rules.bodies.get("event")!;
    const reshape = (fields: typeof body.fields): typeof body.fields =>
      fields.map((field) => {
        if (field.key.kind === "name" && field.key.name === "icon_background") {
          return { ...field, type: { kind: "scalar" as const } };
        }
        return field.type.kind === "block"
          ? { ...field, type: { ...field.type, fields: reshape(field.type.fields) } }
          : field;
      });
    const bodies = new Map(rules.bodies).set("event", { ...body, fields: reshape(body.fields) });

    expect(() => createEventFieldPolicy({ ...rules, bodies })).toThrow(/option|icon/);
  });

  it("reserves every hand-written trigger export from scope-link generation", () => {
    expect(() =>
      emitScopeLinks(
        {
          links: [
            {
              key: "current_stage",
              method: "currentStage",
              inputScopes: ["country"],
              outputScope: "country",
              docs: [],
            },
          ],
        },
        scopes,
        RESERVED_TRIGGER_EXPORT_NAMES
      )
    ).toThrow(/currentStage/);
  });

  it("derives swap member paths from emitted field evidence", () => {
    const swappedJob = rules.contentTypes.get("swapped_job")!;
    const authoritySwap = [...rules.contentTypes.values()].find(
      (type) => type.baseType === "authority"
    )!;
    const contentTypes = new Map([
      [swappedJob.name, swappedJob],
      [authoritySwap.name, authoritySwap],
    ]);
    const job = {
      registry: "job",
      type: rules.contentTypes.get("job")!,
      emission: {
        emittedFields: [],
        nestedEmittedFields: [
          {
            field: "job.swappable_data.swap_type",
            authoredPath: ["renamedContainer", "renamedSwap"],
            shape: "struct",
            repeated: true,
          },
        ],
      },
    } as unknown as ContentSwapSource;

    expect(deriveContentSwapIdentities({ ...rules, contentTypes }, [job])).toEqual([
      {
        registryType: "job",
        path: ["renamedContainer", "renamedSwap"],
        keying: "array-names",
      },
    ]);

    const singularJob = {
      ...job,
      emission: {
        ...job.emission,
        nestedEmittedFields: job.emission.nestedEmittedFields.map((field) => ({
          ...field,
          repeated: false,
        })),
      },
    } as ContentSwapSource;
    expect(() => deriveContentSwapIdentities({ ...rules, contentTypes }, [singularJob])).toThrow(
      /cannot carry swap identities/
    );
  });

  it("loads every base_type declaration found anywhere in the vendored CWT tree", () => {
    const candidateFiles = filesMentioningBaseType();
    const declarations = candidateFiles.map((file) => ({
      file,
      declarations: baseTypeDeclarations(file),
    }));
    expect(candidateFiles.length).toBeGreaterThan(0);
    expect(
      declarations
        .filter((candidate) => candidate.declarations.length === 0)
        .map(({ file }) => file),
      "a raw base_type hit was not found structurally under types/type[...]"
    ).toEqual([]);

    const omitted = declarations.flatMap(({ file, declarations: found }) =>
      found.flatMap((declaration) =>
        rules.contentTypes.get(declaration.name)?.baseType === declaration.baseType
          ? []
          : [`${path.relative(CONFIG, file)}: type[${declaration.name}] = ${declaration.baseType}`]
      )
    );
    expect(
      omitted,
      "loadRules' fixed input list omitted or misread a vendored base_type declaration"
    ).toEqual([]);
  });
});

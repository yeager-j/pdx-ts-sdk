import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveContentSwapIdentities,
  type ContentSwapSource,
} from "@pdx-ts/codegen-cwt/content-swap-policy";
import { parseCwt, type CwtNode } from "@pdx-ts/codegen-cwt/cwt/parser";
import { loadRules, scopeIndex } from "@pdx-ts/codegen-cwt/cwt/rules";
import { createEffectPolicy } from "@pdx-ts/codegen-cwt/effect-policy";
import { emitEffects } from "@pdx-ts/codegen-cwt/emit/effects";
import { emitEvents } from "@pdx-ts/codegen-cwt/emit/events";
import { emitScopeLinks } from "@pdx-ts/codegen-cwt/emit/links";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";
import { createEventFieldPolicy } from "@pdx-ts/codegen-cwt/event-field-policy";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import { lowerRuleTable } from "@pdx-ts/codegen-cwt/lowered-rule";
import { createModifierOperationPolicy } from "@pdx-ts/codegen-cwt/modifier-policy";
import { RESERVED_TRIGGER_EXPORT_NAMES } from "@pdx-ts/codegen-cwt/trigger-policy";
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
    expect(emitted.interfaces).toContain("entityOffset?: number | { min: number; max: number }");
    expect(emitted.meta).toContain('kind: "scalar-or-fields"');
    expect(emitted.interfaces).toContain("effect?: (scope: AmbientObjectScope) => void");
    expect(emitted.interfaces).not.toContain("createColony(args:");
    expect(emitted.interfaces).not.toContain("startColony(args:");
    expect(emitted.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "create_colony",
          reason: expect.stringContaining("repeated nested fields"),
        }),
        expect.objectContaining({
          name: "start_colony",
          reason: expect.stringContaining("repeated nested fields"),
        }),
      ])
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
    const events = emitEvents(new Emitter(changedRules), changedPolicy);

    expect(events.skipped).toContainEqual({
      name: "country_event",
      reason: "no fire-effect rule with `## scopes`",
    });
    expect(events.fireMethods).toBe(22);
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

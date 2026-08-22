/**
 * Mutation-style proof that every silent overlay-table lookup SDK-255 gates
 * can actually fire, plus a real-pipeline smoke test that today's tables
 * clear every gate.
 *
 * Style follows tests/rule-protocol.test.ts: the vendored rules are loaded
 * once at module scope, and each `it` either feeds a validator a synthetic
 * stale row or reruns the relevant pipeline pieces in-process.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_MANIFEST,
  registryNameOf,
  type ContentManifestEntry,
} from "@pdx-ts/codegen-cwt/content-manifest";
import { loadRules } from "@pdx-ts/codegen-cwt/cwt/rules";
import { emitAliasSplice } from "@pdx-ts/codegen-cwt/emit/alias-splice";
import { emitAliasStruct } from "@pdx-ts/codegen-cwt/emit/alias-struct";
import { emitContentType } from "@pdx-ts/codegen-cwt/emit/content-type";
import { structuralSpliceOf } from "@pdx-ts/codegen-cwt/emit/fields";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";
import { camelCase } from "@pdx-ts/codegen-cwt/naming";
import {
  ASSET_PATH_FIELDS,
  CONTENT_CONTRIBUTION_SINKS,
  CONTENT_DECLINED_FIELDS,
  CONTENT_FIELD_OVERRIDES,
  CONTENT_PATCH_REGISTRIES,
  CONTENT_SCOPE_PARAMETERS,
  CONTENT_SUBTYPE_REFERENCE_REFINEMENTS,
  CONTENT_WITNESSES,
  EXACT_NAME_MINTS,
  FIELD_WIDENINGS,
  FILE_STEM_OVERLAYS,
  HAND_WRITTEN_CONTENT_DEFINERS,
  MINT_SHAPE_OVERLAYS,
  PATCH_WIDENINGS,
  REPEATED_STRUCT_DEFINITIONS,
  REPEATED_STRUCT_FIELD_OVERRIDES,
  REQUIRED_LOCALISATION,
  SCRIPTED_MODIFIER_CATEGORY_MAP,
  SYNTHETIC_LOCALISATION,
} from "@pdx-ts/codegen-cwt/overlay";
import {
  assertContentWitnessMembersKnown,
  assertHandWrittenTriggerExportsMatchRules,
  assertOverlayRegistriesKnown,
  assertPatchWideningsTargetPatchableRegistries,
  assertScriptedModifierCategoryMapValid,
  OverlayAudit,
} from "@pdx-ts/codegen-cwt/overlay-audit";
import {
  HAND_WRITTEN_TRIGGER_EXPORTS,
  handWrittenTriggerRulesByKey,
  type HandWrittenTriggerExport,
} from "@pdx-ts/codegen-cwt/trigger-policy";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const rules = loadRules(CONFIG);

/** The registry names the real manifest resolves to, without running codegen. */
const realRegistryNames = new Set(CONTENT_MANIFEST.map((entry) => registryNameOf(entry)));

describe("assertOverlayRegistriesKnown", () => {
  it("passes every real registry-keyed overlay table", () => {
    expect(() =>
      assertOverlayRegistriesKnown(
        [
          { tableId: "MINT_SHAPE_OVERLAYS", keys: MINT_SHAPE_OVERLAYS.keys() },
          { tableId: "EXACT_NAME_MINTS", keys: EXACT_NAME_MINTS.keys() },
          { tableId: "FILE_STEM_OVERLAYS", keys: FILE_STEM_OVERLAYS.keys() },
          { tableId: "HAND_WRITTEN_CONTENT_DEFINERS", keys: HAND_WRITTEN_CONTENT_DEFINERS.keys() },
          { tableId: "CONTENT_CONTRIBUTION_SINKS", keys: CONTENT_CONTRIBUTION_SINKS.keys() },
          {
            tableId: "CONTENT_SUBTYPE_REFERENCE_REFINEMENTS",
            keys: CONTENT_SUBTYPE_REFERENCE_REFINEMENTS.keys(),
          },
          { tableId: "CONTENT_PATCH_REGISTRIES", keys: CONTENT_PATCH_REGISTRIES.keys() },
          { tableId: "CONTENT_SCOPE_PARAMETERS", keys: CONTENT_SCOPE_PARAMETERS.keys() },
          { tableId: "CONTENT_WITNESSES", keys: CONTENT_WITNESSES.keys() },
        ],
        realRegistryNames
      )
    ).not.toThrow();
  });

  it("rejects a row naming a registry nothing resolves to", () => {
    expect(() =>
      assertOverlayRegistriesKnown(
        [{ tableId: "FAKE_TABLE", keys: ["not_a_real_registry"] }],
        realRegistryNames
      )
    ).toThrow('FAKE_TABLE names "not_a_real_registry", which is not a known registry');
  });

  it("rejects a CONTENT_SCOPE_PARAMETERS row keyed to a renamed or mistyped registry", () => {
    // Review fault 4: CONTENT_SCOPE_PARAMETERS is consumed only via
    // `CONTENT_SCOPE_PARAMETERS.get(registry)` (emit/content-type.ts's
    // `scopeParameterOf`) — a row FOUND there is checked further (scope
    // names, declaredFrom), but a row keyed to a registry nothing resolves
    // to is never looked up at all, so it rotted silently until this table
    // joined the Group A registry-keyed check in index.ts.
    expect(() =>
      assertOverlayRegistriesKnown(
        [{ tableId: "CONTENT_SCOPE_PARAMETERS", keys: ["decisionn"] }],
        realRegistryNames
      )
    ).toThrow('CONTENT_SCOPE_PARAMETERS names "decisionn", which is not a known registry');
  });

  it("rejects a CONTENT_WITNESSES row keyed to a renamed or mistyped registry (SDK-260)", () => {
    // CONTENT_WITNESSES is consumed only via `CONTENT_WITNESSES.get(registry)`
    // inside contentDefiners' per-content loop (index.ts) and emit/modifiers.ts's
    // fixed "economic_category" lookup — a row keyed to a registry nothing
    // resolves to (a rename or typo) is never looked up by either site, so it
    // would rot silently without joining the Group A registry-keyed check.
    expect(() =>
      assertOverlayRegistriesKnown(
        [{ tableId: "CONTENT_WITNESSES", keys: ["scripted_modifierr"] }],
        realRegistryNames
      )
    ).toThrow('CONTENT_WITNESSES names "scripted_modifierr", which is not a known registry');
  });
});

describe("assertContentWitnessMembersKnown", () => {
  /** The real top-level Def member names one registry's own emission produces. */
  function emittedMemberNamesFor(registryName: string): Set<string> {
    const type = rules.contentTypes.get(registryName)!;
    const body = rules.bodies.get(registryName)!;
    const emitter = new Emitter(rules);
    emitter.beginFile();
    const emission = emitContentType(emitter, type, body, registryName);
    emitter.endFile();
    return new Set(
      emission.emittedFields.map((field) => field.authoredPath?.[0] ?? camelCase(field.field))
    );
  }

  it("passes every real CONTENT_WITNESSES row against its own registry's emitted members", () => {
    for (const [registry, contentWitness] of CONTENT_WITNESSES) {
      expect(() =>
        assertContentWitnessMembersKnown(registry, contentWitness, emittedMemberNamesFor(registry))
      ).not.toThrow();
    }
  });

  it("rejects a wraps row naming a member the registry's emission does not produce (SDK-260)", () => {
    expect(() =>
      assertContentWitnessMembersKnown(
        "scripted_modifier",
        {
          mode: "wraps",
          type: "ScriptedModifierCategory",
          module: "./enums.ts",
          member: "not_a_real_member",
          reason: "test",
        },
        emittedMemberNamesFor("scripted_modifier")
      )
    ).toThrow(
      'CONTENT_WITNESSES\'s "scripted_modifier" row names member "not_a_real_member", which ' +
        "scripted_modifier's emission does not produce"
    );
  });

  it("rejects an intersects row with a misspelled omit member (SDK-260)", () => {
    expect(() =>
      assertContentWitnessMembersKnown(
        "economic_category",
        {
          mode: "intersects",
          type: "EconomicCategoryWitness",
          exactType: "ExactEconomicCategoryWitness",
          omit: [{ member: "modifierCategoryTypo", inferAs: "M" }],
          reason: "test",
        },
        emittedMemberNamesFor("economic_category")
      )
    ).toThrow(
      'CONTENT_WITNESSES\'s "economic_category" row names member "modifierCategoryTypo", which ' +
        "economic_category's emission does not produce"
    );
  });

  it("rejects a member repeated within one omit list", () => {
    expect(() =>
      assertContentWitnessMembersKnown(
        "economic_category",
        {
          mode: "intersects",
          type: "EconomicCategoryWitness",
          exactType: "ExactEconomicCategoryWitness",
          omit: [
            { member: "modifierCategory", inferAs: "M" },
            { member: "modifierCategory", inferAs: "N" },
          ],
          reason: "test",
        },
        emittedMemberNamesFor("economic_category")
      )
    ).toThrow(
      'CONTENT_WITNESSES\'s "economic_category" row names member "modifierCategory" twice in one ' +
        "omit list"
    );
  });

  it("rejects an omit entry with an empty inferAs", () => {
    expect(() =>
      assertContentWitnessMembersKnown(
        "economic_category",
        {
          mode: "intersects",
          type: "EconomicCategoryWitness",
          exactType: "ExactEconomicCategoryWitness",
          omit: [{ member: "modifierCategory", inferAs: "" }],
          reason: "test",
        },
        emittedMemberNamesFor("economic_category")
      )
    ).toThrow(
      'CONTENT_WITNESSES\'s "economic_category" row\'s "modifierCategory" omit entry has an empty ' +
        "inferAs"
    );
  });

  it("does not reject inferAs letters reused across different members", () => {
    // Two real omit entries (generateMultModifiers, triggeredUpkeepModifier)
    // legitimately share "U" — each member's own `D extends {...} ? infer X :
    // undefined` conditional scopes its `infer` to itself, so reuse across
    // members is not a collision this validator should reject.
    expect(() =>
      assertContentWitnessMembersKnown(
        "economic_category",
        {
          mode: "intersects",
          type: "EconomicCategoryWitness",
          exactType: "ExactEconomicCategoryWitness",
          omit: [
            { member: "generateMultModifiers", inferAs: "U" },
            { member: "triggeredUpkeepModifier", inferAs: "U" },
          ],
          reason: "test",
        },
        emittedMemberNamesFor("economic_category")
      )
    ).not.toThrow();
  });
});

describe("assertPatchWideningsTargetPatchableRegistries", () => {
  const patchableRegistries = new Set(CONTENT_PATCH_REGISTRIES.keys());

  it("passes the real PATCH_WIDENINGS table", () => {
    expect(() =>
      assertPatchWideningsTargetPatchableRegistries(
        "PATCH_WIDENINGS",
        PATCH_WIDENINGS.keys(),
        patchableRegistries
      )
    ).not.toThrow();
  });

  it("rejects a widening whose registry is not patchable", () => {
    expect(() =>
      assertPatchWideningsTargetPatchableRegistries(
        "PATCH_WIDENINGS",
        ["decision.custom_tooltip"],
        patchableRegistries
      )
    ).toThrow('PATCH_WIDENINGS widens "decision.custom_tooltip", whose registry "decision"');
  });

  it("rejects a three-segment key even when its first segment is patchable", () => {
    // The real consumption site (emit/content-type.ts's `patchTypes`) reads
    // this table with an exact `${type.name}.${entry.member}` lookup, so
    // "technology.prerequisites.extra" would resolve a patchable registry
    // here while never matching that lookup at all — a row that looks live
    // but is silently dead. Review fault 1.
    expect(() =>
      assertPatchWideningsTargetPatchableRegistries(
        "PATCH_WIDENINGS",
        ["technology.prerequisites.extra"],
        patchableRegistries
      )
    ).toThrow(
      'PATCH_WIDENINGS names "technology.prerequisites.extra", which is not a ' +
        '"<registry>.<member>" path'
    );
  });
});

describe("assertScriptedModifierCategoryMapValid", () => {
  const enumMembers = new Set(rules.enums.get("scripted_modifier_category") ?? []);
  const categoryLabels = new Set(rules.modifierCategories.keys());

  it("passes the real SCRIPTED_MODIFIER_CATEGORY_MAP against the loaded rules", () => {
    expect(() =>
      assertScriptedModifierCategoryMapValid(
        SCRIPTED_MODIFIER_CATEGORY_MAP,
        enumMembers,
        categoryLabels
      )
    ).not.toThrow();
  });

  it("rejects a key that is not a scripted_modifier_category enum member", () => {
    expect(() =>
      assertScriptedModifierCategoryMapValid(
        { not_a_real_category: ["All"] },
        enumMembers,
        categoryLabels
      )
    ).toThrow(
      'SCRIPTED_MODIFIER_CATEGORY_MAP names "not_a_real_category", which is not a member of ' +
        "enum[scripted_modifier_category]"
    );
  });

  it("rejects a label modifier_categories.cwt does not declare", () => {
    expect(() =>
      assertScriptedModifierCategoryMapValid(
        { all: ["Not A Real Label"] },
        enumMembers,
        categoryLabels
      )
    ).toThrow(
      'SCRIPTED_MODIFIER_CATEGORY_MAP maps "all" to "Not A Real Label", which modifier_categories.cwt ' +
        "does not declare"
    );
  });
});

describe("assertHandWrittenTriggerExportsMatchRules", () => {
  const loadedTriggerRuleKeys = new Set([...rules.triggers.keys()].map((key) => key.toLowerCase()));

  it("passes the real HAND_WRITTEN_TRIGGER_EXPORTS table against the loaded rules", () => {
    expect(() =>
      assertHandWrittenTriggerExportsMatchRules(HAND_WRITTEN_TRIGGER_EXPORTS, loadedTriggerRuleKeys)
    ).not.toThrow();
  });

  it("rejects an expectedInRules row whose ruleKey no loaded rule matches", () => {
    expect(() =>
      assertHandWrittenTriggerExportsMatchRules(
        [
          {
            exportName: "fakeExport",
            ruleKey: "not_a_real_trigger_key",
            kind: "typed-leaf-trigger",
            expectedInRules: true,
            reason: "test",
          },
        ],
        loadedTriggerRuleKeys
      )
    ).toThrow(
      'HAND_WRITTEN_TRIGGER_EXPORTS names ruleKey "not_a_real_trigger_key" for export "fakeExport"'
    );
  });

  it("does not check a row whose expectedInRules is false, however stale its ruleKey", () => {
    expect(() =>
      assertHandWrittenTriggerExportsMatchRules(
        [
          {
            exportName: "hiddenTrigger",
            ruleKey: "not_loaded_because_scope_links_is_skipped",
            kind: "structural-trigger",
            expectedInRules: false,
            reason: "test",
          },
        ],
        loadedTriggerRuleKeys
      )
    ).not.toThrow();
  });
});

describe("HandWrittenTriggerExport's discriminated shape", () => {
  it("cannot represent expectedInRules: true with no ruleKey (compile-time only)", () => {
    // Review fault 2: this combination used to type-check and pass the
    // runtime validator by being skipped unchecked (`ruleKey === undefined`
    // short-circuited it) — it would reserve `exportName` while never
    // entering `HAND_WRITTEN_TRIGGER_RULES_BY_KEY`, so `emit/triggers.ts`
    // would still generate the rules-declared trigger of the same key and
    // the hand-written export would silently shadow it. The union in
    // trigger-policy.ts now makes the combination unrepresentable, so the
    // proof lives at compile time: without the `@ts-expect-error` below,
    // `npm run typecheck` (which covers this test file) fails.
    // @ts-expect-error — expectedInRules: true requires ruleKey: string.
    const impossible: HandWrittenTriggerExport = {
      exportName: "impossible",
      kind: "typed-leaf-trigger",
      expectedInRules: true,
      reason: "test",
    };
    expect(impossible.exportName).toBe("impossible");
  });
});

describe("handWrittenTriggerRulesByKey", () => {
  it("resolves a ruleKey however it is cased, matching emit/triggers.ts's own .toLowerCase() lookup", () => {
    // Review fault 3: emit/triggers.ts looks up `key.toLowerCase()` where
    // `key` is a loaded trigger rule's own spelling (e.g. "current_stage").
    // Before this fix the by-key map stored `ruleKey` verbatim, so a row
    // spelled "Current_Stage" would validate fine (the validator lowercases
    // *its* candidate) but never be found at the real consumption site,
    // leaving both the generated and hand-written triggers live at once.
    const mixedCaseRow: HandWrittenTriggerExport = {
      exportName: "mixedCaseExport",
      ruleKey: "Current_Stage",
      kind: "typed-leaf-trigger",
      expectedInRules: true,
      reason: "test",
    };
    const byKey = handWrittenTriggerRulesByKey([mixedCaseRow]);
    expect(byKey.get("current_stage")).toBe(mixedCaseRow);
    expect(byKey.get("Current_Stage")).toBeUndefined();
  });
});

describe("OverlayAudit", () => {
  it("passes when every declared key was applied", () => {
    const audit = new OverlayAudit();
    audit.applied("SOME_TABLE", "registry.field");
    expect(() => audit.assertAllApplied("SOME_TABLE", ["registry.field"])).not.toThrow();
  });

  it("throws naming the table and the unapplied key", () => {
    const audit = new OverlayAudit();
    audit.applied("SOME_TABLE", "registry.field");
    expect(() =>
      audit.assertAllApplied("SOME_TABLE", ["registry.field", "registry.stale"])
    ).toThrow('SOME_TABLE names "registry.stale", which no consumption site applied');
  });

  it("treats every table independently", () => {
    const audit = new OverlayAudit();
    audit.applied("TABLE_A", "key");
    expect(() => audit.assertAllApplied("TABLE_B", ["key"])).toThrow(
      'TABLE_B names "key", which no consumption site applied'
    );
  });
});

describe("the real pipeline's overlay tables", () => {
  /**
   * Reruns exactly the content-type and alias-category emission
   * `index.ts`'s `main()` performs before its own staleness assertions —
   * everything needed to drive every `OverlayAudit.applied()` call site, none
   * of the file-writing. One shared `Emitter` so every consumption site
   * across every registry writes into the same audit instance, the same way
   * `main()`'s single `emitter` does.
   */
  function runContentAndAliasPipeline(): {
    readonly emitter: Emitter;
    readonly registryNames: Set<string>;
  } {
    const emitter = new Emitter(rules);
    const contents: { registry: string; emission: { inlineSplices: readonly string[] } }[] = [];
    for (const manifest of CONTENT_MANIFEST) {
      const entry: ContentManifestEntry = manifest;
      const type = rules.contentTypes.get(entry.type);
      const body = rules.bodies.get(entry.type);
      if (type === undefined || body === undefined) {
        continue;
      }
      const registry = registryNameOf(entry);
      emitter.beginFile();
      const emission = emitContentType(emitter, type, body, registry, entry.as);
      emitter.endFile();
      contents.push({ registry, emission });
    }

    const seenCategories = new Set<string>();
    const emitCategory = (category: string, kind: "struct" | "splice"): void => {
      if (seenCategories.has(category)) {
        return;
      }
      seenCategories.add(category);
      if (kind === "struct") {
        const members = rules.aliasCategories.get(category);
        if (members === undefined || members.size === 0) {
          return;
        }
        emitter.beginFile();
        emitAliasStruct(emitter, category, members);
        emitter.endFile();
        return;
      }
      if (structuralSpliceOf(emitter, category) === null) {
        return;
      }
      emitter.beginFile();
      const emission = emitAliasSplice(emitter, category)!;
      emitter.endFile();
      for (const nested of emission.spliceCategories) {
        emitCategory(nested, "splice");
      }
    };
    for (const override of [
      ...CONTENT_FIELD_OVERRIDES.values(),
      ...REPEATED_STRUCT_FIELD_OVERRIDES.values(),
    ]) {
      if (override.shape === "aliasStruct") {
        emitCategory(override.category!, "struct");
      }
    }
    for (const content of contents) {
      for (const category of content.emission.inlineSplices) {
        emitCategory(category, "splice");
      }
    }

    return { emitter, registryNames: new Set(contents.map((content) => content.registry)) };
  }

  it("clears every registry-keyed and path-keyed gate against today's tables", () => {
    const { emitter, registryNames } = runContentAndAliasPipeline();

    expect(() =>
      assertOverlayRegistriesKnown(
        [
          { tableId: "MINT_SHAPE_OVERLAYS", keys: MINT_SHAPE_OVERLAYS.keys() },
          { tableId: "EXACT_NAME_MINTS", keys: EXACT_NAME_MINTS.keys() },
          { tableId: "FILE_STEM_OVERLAYS", keys: FILE_STEM_OVERLAYS.keys() },
          { tableId: "HAND_WRITTEN_CONTENT_DEFINERS", keys: HAND_WRITTEN_CONTENT_DEFINERS.keys() },
          { tableId: "CONTENT_CONTRIBUTION_SINKS", keys: CONTENT_CONTRIBUTION_SINKS.keys() },
          {
            tableId: "CONTENT_SUBTYPE_REFERENCE_REFINEMENTS",
            keys: CONTENT_SUBTYPE_REFERENCE_REFINEMENTS.keys(),
          },
          { tableId: "CONTENT_PATCH_REGISTRIES", keys: CONTENT_PATCH_REGISTRIES.keys() },
          { tableId: "CONTENT_SCOPE_PARAMETERS", keys: CONTENT_SCOPE_PARAMETERS.keys() },
          { tableId: "CONTENT_WITNESSES", keys: CONTENT_WITNESSES.keys() },
        ],
        registryNames
      )
    ).not.toThrow();

    expect(() =>
      assertPatchWideningsTargetPatchableRegistries(
        "PATCH_WIDENINGS",
        PATCH_WIDENINGS.keys(),
        new Set(CONTENT_PATCH_REGISTRIES.keys())
      )
    ).not.toThrow();

    expect(() =>
      assertScriptedModifierCategoryMapValid(
        SCRIPTED_MODIFIER_CATEGORY_MAP,
        new Set(rules.enums.get("scripted_modifier_category") ?? []),
        new Set(rules.modifierCategories.keys())
      )
    ).not.toThrow();

    expect(() =>
      assertHandWrittenTriggerExportsMatchRules(
        HAND_WRITTEN_TRIGGER_EXPORTS,
        new Set([...rules.triggers.keys()].map((key) => key.toLowerCase()))
      )
    ).not.toThrow();

    expect(() =>
      emitter.overlayAudit.assertAllApplied(
        "CONTENT_FIELD_OVERRIDES",
        CONTENT_FIELD_OVERRIDES.keys()
      )
    ).not.toThrow();
    expect(() =>
      emitter.overlayAudit.assertAllApplied(
        "REPEATED_STRUCT_FIELD_OVERRIDES",
        REPEATED_STRUCT_FIELD_OVERRIDES.keys()
      )
    ).not.toThrow();
    expect(() =>
      emitter.overlayAudit.assertAllApplied("FIELD_WIDENINGS", FIELD_WIDENINGS.keys())
    ).not.toThrow();
    expect(() =>
      emitter.overlayAudit.assertAllApplied(
        "CONTENT_DECLINED_FIELDS",
        CONTENT_DECLINED_FIELDS.keys()
      )
    ).not.toThrow();
    expect(() =>
      emitter.overlayAudit.assertAllApplied("REQUIRED_LOCALISATION", REQUIRED_LOCALISATION.keys())
    ).not.toThrow();
    expect(() =>
      emitter.overlayAudit.assertAllApplied("SYNTHETIC_LOCALISATION", SYNTHETIC_LOCALISATION.keys())
    ).not.toThrow();
    expect(() =>
      emitter.overlayAudit.assertAllApplied(
        "REPEATED_STRUCT_DEFINITIONS",
        REPEATED_STRUCT_DEFINITIONS.keys()
      )
    ).not.toThrow();
  });

  it("would catch a genuinely orphaned CONTENT_FIELD_OVERRIDES row", () => {
    const { emitter } = runContentAndAliasPipeline();
    const staleTable = new Map(CONTENT_FIELD_OVERRIDES);
    staleTable.set("technology.not_a_real_field", staleTable.get("technology.prerequisites")!);

    expect(() =>
      emitter.overlayAudit.assertAllApplied("CONTENT_FIELD_OVERRIDES", staleTable.keys())
    ).toThrow(
      'CONTENT_FIELD_OVERRIDES names "technology.not_a_real_field", which no consumption site applied'
    );
  });

  it("clears the ASSET_PATH_FIELDS gate against today's table (SDK-256)", () => {
    const { emitter } = runContentAndAliasPipeline();
    expect(() =>
      emitter.overlayAudit.assertAllApplied("ASSET_PATH_FIELDS", ASSET_PATH_FIELDS.keys())
    ).not.toThrow();
  });

  it("does not leak ASSET_PATH_FIELDS state between separate pipeline runs (SDK-256)", () => {
    // The bug this guards: emit/fields.ts used to track which ASSET_PATH_FIELDS
    // rows had been applied in a module-level Set with no reset. A *second*
    // in-process pipeline run — this test file's own pattern, and something
    // several other suites do too — would find the first run's entries still
    // present and pass the presence check vacuously, even though the second
    // run's own emitter never touched those fields. Folding the tracking into
    // `OverlayAudit`, one instance per `Emitter`, is what makes a fresh
    // emitter fail honestly instead.
    runContentAndAliasPipeline();
    const freshEmitter = new Emitter(rules);
    expect(() =>
      freshEmitter.overlayAudit.assertAllApplied("ASSET_PATH_FIELDS", ASSET_PATH_FIELDS.keys())
    ).toThrow(
      'ASSET_PATH_FIELDS names "spriteType.textureFile", which no consumption site applied'
    );
  });
});

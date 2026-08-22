/**
 * Regenerates `packages/sdk/src/generated/` from the vendored cwtools config.
 *
 * Run with `npm run codegen`. The output is committed, so a rules bump shows up
 * as a reviewable diff on the SDK's public API.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { contentFileLayout } from "./content-layout.ts";
import {
  CONTENT_MANIFEST,
  registryNameOf,
  VANILLA_REF_EXTRAS,
  type ContentManifestEntry,
} from "./content-manifest.ts";
import { referenceNameOf, typesReferencedBySubtype } from "./content-reference.ts";
import { emitContentShapeProtocol } from "./content-shape.ts";
import { deriveContentSwapIdentities, emitContentSwapProtocol } from "./content-swap-policy.ts";
import { loadRules, scopeIndex, type ContentType } from "./cwt/rules.ts";
import { createEffectPolicy, emitEffectPolicyProtocol } from "./effect-policy.ts";
import { emitAliasSplice, type AliasSpliceEmission } from "./emit/alias-splice.ts";
import { emitAliasStruct } from "./emit/alias-struct.ts";
import { emitContentFieldDocs, type FieldDocsModule } from "./emit/content-field-docs.ts";
import { emitContentType, type ContentEmission } from "./emit/content-type.ts";
import { contentDefiners } from "./emit/definers.ts";
import { emitEffects } from "./emit/effects.ts";
import { emitEvents } from "./emit/events.ts";
import type { DocTable, FieldOmissionRow } from "./emit/field-rows.ts";
import { classifyLinks, emitScopeLinkNavigation, emitScopeLinks } from "./emit/links.ts";
import { emitModifiers, joinModifierScopes } from "./emit/modifiers.ts";
import { emitOnActions } from "./emit/on-actions.ts";
import { structuralSpliceOf } from "./emit/rule-shapes.ts";
import { emitScriptReferences } from "./emit/script-reference.ts";
import {
  canonicalScopes,
  emitEnums,
  emitRefs,
  emitScopes,
  emitValueSets,
  valuelessEnums,
} from "./emit/support.ts";
import { importList } from "./emit/symbols.ts";
import { emitTriggers } from "./emit/triggers.ts";
import { Emitter, type Usage } from "./emit/types.ts";
import { emitVanillaRefs } from "./emit/vanilla-refs.ts";
import { createEventFieldPolicy, emitEventFieldProtocol } from "./event-field-policy.ts";
import { header, write, writeModule } from "./generated-file.ts";
import { parseModifierDocs } from "./logs/modifier-docs.ts";
import { parseScopeLinks } from "./logs/scopes.ts";
import { parseTriggerDocs } from "./logs/trigger-docs.ts";
import { lowerRuleTable } from "./lowered-rule.ts";
import { createModifierOperationPolicy, emitModifierOperationProtocol } from "./modifier-policy.ts";
import { docComment, kebabCase } from "./naming.ts";
import {
  assertHandWrittenTriggerExportsMatchRules,
  assertOverlayRegistriesKnown,
  assertPatchWideningsTargetPatchableRegistries,
  assertScriptedModifierCategoryMapValid,
} from "./overlay-audit.ts";
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
} from "./overlay.ts";
import {
  compareToBaseline,
  reconcile,
  updatedBaseline,
  type DriftBaseline,
  type DriftReport,
} from "./reconcile.ts";
import { formatScriptGapReport, reconcileScriptGaps } from "./script-gaps.ts";
import { HAND_WRITTEN_TRIGGER_EXPORTS, RESERVED_TRIGGER_EXPORT_NAMES } from "./trigger-policy.ts";

/**
 * Every path this script touches is anchored to the module, not the process:
 * the inputs live in the repo, not in whatever directory `npm run codegen` was
 * invoked from, and a generator that silently reads a different rule set when
 * run from a subdirectory would be a nasty way to learn that.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const VENDOR = path.join(ROOT, "vendor/cwtools-stellaris-config");
const CONFIG = path.join(VENDOR, "config");
/** The dump directory matching the game version these rules target. */
const DOCS = path.join(VENDOR, "script-docs/v4.4.1");
const BASELINE = fileURLToPath(new URL("./drift-baseline.json", import.meta.url));

function upstreamCommit(): string {
  const version = readFileSync(`${VENDOR}/VERSION.md`, "utf8");
  return /`([0-9a-f]{40})`/.exec(version)?.[1] ?? "unknown";
}

/**
 * A registry's field count: its own keys, plus the fields lowered inside their
 * blocks where it has any. The two are counted apart because they are reached
 * differently — a nested field is authorable only through the member that owns
 * it, and only a `corpusDescents` walk measures it.
 */
function fieldCount(emission: ContentEmission): string {
  const nested = emission.nestedEmittedFields.length;
  return (
    `${emission.emittedFields.length} fields emitted` + (nested === 0 ? "" : ` (+${nested} nested)`)
  );
}

function reportSection(report: string[], title: string, lines: readonly string[]): void {
  if (lines.length === 0) {
    return;
  }
  report.push(`\n${title} (${lines.length}):`);
  for (const line of lines) {
    report.push(`  ${line}`);
  }
}

/**
 * Prints the codegen report, in the order its lines were collected.
 *
 * The one place `main()`'s report reaches `console.log`: every per-registry
 * and per-category line above is data by the time it gets here, pushed onto
 * {@link report} as `main()` computed it rather than printed where it was
 * computed — so what the report says and how it reaches stdout are two
 * separate concerns instead of one interleaved with the pipeline itself.
 */
function printReport(report: readonly string[]): void {
  for (const line of report) {
    console.log(line);
  }
}

function checkDrift(report: DriftReport, rebaseline: boolean): void {
  // A baseline written before a join existed reads as that join being empty,
  // so adding a join reports its entire current state as drift to review
  // instead of crashing on the missing field.
  const baseline = {
    links: { rulesOnly: [], docsOnly: [] },
    malformedDocBlocks: [],
    malformedModifierBlocks: [],
    ...(JSON.parse(readFileSync(BASELINE, "utf8")) as Partial<DriftBaseline>),
  } as DriftBaseline;
  if (rebaseline) {
    writeFileSync(
      BASELINE,
      `${JSON.stringify(updatedBaseline(report, baseline), null, 2)}\n`,
      "utf8"
    );
    console.log(`Rebaselined drift: ${BASELINE}`);
    return;
  }
  const differences = compareToBaseline(report, baseline);
  if (differences.length === 0) {
    return;
  }
  console.error("\nThe two rule sources drifted since the recorded baseline:\n");
  console.error(differences.join("\n"));
  console.error(
    "\nEach line is a trigger, effect, or annotation that exists in one source and not\n" +
      "the other, which means codegen would emit a wrong signature or silently skip it.\n" +
      "Review the change, then re-run with --rebaseline to accept it."
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const rebaseline = process.argv.includes("--rebaseline");
  const commit = upstreamCommit();

  const rules = loadRules(CONFIG);
  const docs = parseTriggerDocs(
    readFileSync(`${DOCS}/triggers.log`, "utf8"),
    readFileSync(`${DOCS}/effects.log`, "utf8")
  );
  const links = parseScopeLinks(readFileSync(`${DOCS}/scopes.log`, "utf8"));
  const modifierDocs = parseModifierDocs(readFileSync(`${DOCS}/modifiers.log`, "utf8"));

  checkDrift(reconcile(rules, docs, modifierDocs, links), rebaseline);

  const emitter = new Emitter(rules);
  const index = scopeIndex(rules);
  const effectPolicy = createEffectPolicy(rules);
  const modifierOperationPolicy = createModifierOperationPolicy(rules);
  const eventFieldPolicy = createEventFieldPolicy(rules);
  emitter.beginFile();
  const loweredTriggers = lowerRuleTable(rules.triggers, docs.triggers, emitter, index);
  const triggers = emitTriggers(emitter, docs.triggers, loweredTriggers);
  const triggerUsage = emitter.endFile();

  const dumpLinks = new Map(links.map((link) => [link.name, link]));
  const classifiedLinks = classifyLinks(emitter, dumpLinks, index);
  // The hand exports of src/script/triggers.ts share the links file's export
  // namespace through its `export *`, so they count as taken names too.
  const scopeLinks = emitScopeLinks(
    classifiedLinks,
    index,
    new Set([...triggers.names, ...RESERVED_TRIGGER_EXPORT_NAMES])
  );

  emitter.beginFile();
  const loweredEffects = lowerRuleTable(rules.effects, docs.effects, emitter, index);
  const effects = emitEffects(
    emitter,
    docs.effects,
    index,
    loweredEffects,
    effectPolicy,
    classifiedLinks.links
  );
  const effectUsage = emitter.endFile();
  const scriptGapReport = reconcileScriptGaps({
    triggers: triggers.skipped,
    effects: effects.skipped,
  });
  const scriptGapLines = formatScriptGapReport(scriptGapReport);

  await write(
    "content-shape.ts",
    header(commit, ["codegen-cwt ContentShape protocol"]) + emitContentShapeProtocol()
  );

  const contents: Array<{
    manifest: (typeof CONTENT_MANIFEST)[number];
    /** Registry name: the CWT type unless the manifest renames it via `as`. */
    registry: string;
    /** The CWT reference this registry's definitions satisfy. */
    referenceName: string;
    /** Top-level keyword, for registries CWT marks with `name_field`. */
    keyword: string | undefined;
    type: ContentType;
    emission: ContentEmission;
    usage: ReturnType<Emitter["endFile"]>;
  }> = [];
  const registryNames = new Set<string>();
  const subtypeReferencedTypes = typesReferencedBySubtype(rules);
  for (const manifest of CONTENT_MANIFEST) {
    const type = rules.contentTypes.get(manifest.type);
    const body = rules.bodies.get(manifest.type);
    if (type === undefined || body === undefined) {
      throw new Error(`${manifest.source} no longer declares type[${manifest.type}] and its body`);
    }
    const entry: ContentManifestEntry = manifest;
    const registry = registryNameOf(entry);
    assertRegistryName(entry, registry, registryNames);
    const keyword = entry.keyword;
    // A keyword the rules do declare must match what the manifest claims;
    // silence here would emit a top-level key the game quietly ignores.
    if (keyword !== undefined && type.nameField === null) {
      throw new Error(`type[${manifest.type}] declares no name_field, so it has no keyword`);
    }
    if (keyword === undefined && type.nameField !== null) {
      throw new Error(
        `type[${manifest.type}] declares name_field=${type.nameField}, so the manifest ` +
          "entry needs the keyword its entries are written under"
      );
    }
    const filter = effectiveKeyFilter(type, entry.as);
    if (filter !== null && keyword !== undefined && keyword !== filter.key) {
      throw new Error(
        `${filter.source} declares ## type_key_filter = ${filter.key} but the ` +
          `manifest claims keyword ${keyword}`
      );
    }
    emitter.beginFile();
    const emission = emitContentType(emitter, type, body, registry, entry.as);
    const usage = emitter.endFile();
    contents.push({
      manifest,
      registry,
      referenceName: referenceNameOf(type, entry.as, subtypeReferencedTypes),
      keyword,
      type,
      emission,
      usage,
    });
  }

  // An alias category emitted as its own shared module, from either of the two
  // reasons a category needs one: an overlay row lowering a *keyed* field onto
  // it (`civic_or_origin.potential` -> `government_trigger`), or a body
  // splicing it unkeyed (`solar_system_initializer` -> `planet_initializer`).
  // Both produce a named interface plus a `registerAliasStructFields` call, so
  // they share a write loop and a report line.
  //
  // A worklist rather than a flat list, because a spliced category can splice
  // further categories: `planet_initializer` reaches `moon_initializer`, which
  // reaches itself. Runs after the content loop so the splice seeds exist.
  const aliasCategories = new Map<
    string,
    {
      readonly code: string;
      readonly typeName: string;
      readonly usage: Usage;
      readonly emittedMembers: readonly string[];
      readonly declinedMembers: readonly string[];
      readonly omissions: readonly FieldOmissionRow[];
      readonly docTables: readonly DocTable[];
    }
  >();
  const aliasSplices = new Map<string, AliasSpliceEmission>();
  const emitCategory = (category: string, kind: "struct" | "splice"): void => {
    if (aliasCategories.has(category)) {
      return;
    }
    if (kind === "struct") {
      // An overlay row naming a category the rules do not declare is a
      // mistake in the row, so this throws rather than emitting nothing.
      const members = rules.aliasCategories.get(category);
      if (members === undefined || members.size === 0) {
        throw new Error(
          `overlay requests aliasStruct category "${category}" but the rules declare no ` +
            `alias[${category}:...] members — add it to EXTRA_ALIAS_CATEGORIES`
        );
      }
      emitter.beginFile(category);
      const emission = emitAliasStruct(emitter, category, members);
      aliasCategories.set(category, { ...emission, usage: emitter.endFile() });
      return;
    }
    // A splice seed is different: not every spliced category is structural, and
    // a non-structural one is not an error. `static_modifier` splices
    // `modifier`, whose authoring member is the `ModifierClosure` the runtime
    // already knows and whose members the rules keep outside `aliasCategories`
    // entirely — so there is no interface and no field table to emit.
    if (structuralSpliceOf(emitter, category) === null) {
      return;
    }
    emitter.beginFile(category);
    const emission = emitAliasSplice(emitter, category)!;
    const usage = emitter.endFile();
    aliasSplices.set(category, emission);
    aliasCategories.set(category, {
      code: emission.code,
      typeName: emission.typeName,
      usage,
      emittedMembers: emission.emittedFields.map((field) => field.field),
      declinedMembers: [...emission.declinedFields, ...emission.unsupported],
      omissions: emission.omissions,
      docTables: emission.docTables,
    });
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

  // Overlay-table staleness. Every table below is consulted through a plain
  // `.get()`/`.has()` lookup, so a row nothing matches would otherwise fail
  // silently: the lookup just returns `undefined` and the emitter falls back
  // to its mechanical reading. `EFFECT_FIELD_TYPE_OVERRIDES` and its siblings
  // already get this treatment inside `emit/effects.ts`; this closes the same
  // gap for every other overlay table (SDK-255).
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
  );
  assertPatchWideningsTargetPatchableRegistries(
    "PATCH_WIDENINGS",
    PATCH_WIDENINGS.keys(),
    new Set(CONTENT_PATCH_REGISTRIES.keys())
  );
  assertScriptedModifierCategoryMapValid(
    SCRIPTED_MODIFIER_CATEGORY_MAP,
    new Set(rules.enums.get("scripted_modifier_category") ?? []),
    new Set(rules.modifierCategories.keys())
  );
  assertHandWrittenTriggerExportsMatchRules(
    HAND_WRITTEN_TRIGGER_EXPORTS,
    new Set([...rules.triggers.keys()].map((key) => key.toLowerCase()))
  );
  emitter.overlayAudit.assertAllApplied("CONTENT_FIELD_OVERRIDES", CONTENT_FIELD_OVERRIDES.keys());
  emitter.overlayAudit.assertAllApplied(
    "REPEATED_STRUCT_FIELD_OVERRIDES",
    REPEATED_STRUCT_FIELD_OVERRIDES.keys()
  );
  emitter.overlayAudit.assertAllApplied("FIELD_WIDENINGS", FIELD_WIDENINGS.keys());
  emitter.overlayAudit.assertAllApplied("CONTENT_DECLINED_FIELDS", CONTENT_DECLINED_FIELDS.keys());
  emitter.overlayAudit.assertAllApplied("REQUIRED_LOCALISATION", REQUIRED_LOCALISATION.keys());
  emitter.overlayAudit.assertAllApplied("SYNTHETIC_LOCALISATION", SYNTHETIC_LOCALISATION.keys());
  emitter.overlayAudit.assertAllApplied(
    "REPEATED_STRUCT_DEFINITIONS",
    REPEATED_STRUCT_DEFINITIONS.keys()
  );
  emitter.overlayAudit.assertAllApplied("ASSET_PATH_FIELDS", ASSET_PATH_FIELDS.keys());

  // Registers every ref this namespace names (including the ref-only extras —
  // sound, sound_effect, resource) with `emitter.usedRefs` before
  // `refs.ts` is written below, so their `XRef` aliases survive even if
  // nothing else in the rules happens to reference them.
  const vanillaRefs = emitVanillaRefs(
    emitter,
    CONTENT_MANIFEST,
    VANILLA_REF_EXTRAS,
    new Map(contents.map((content) => [content.registry, content.referenceName]))
  );

  await write(
    "scopes.ts",
    header(commit, ["scopes.cwt"]) + emitScopes(canonicalScopes(rules.scopes))
  );
  await write(
    "refs.ts",
    header(commit, ["type references across the rule files"]) + emitRefs(emitter)
  );
  await write(
    "enums.ts",
    header(commit, ["enums.cwt"]) +
      'import type { VanillaEnumMember } from "../identifiers/contracts.ts";\n\n' +
      emitEnums(emitter)
  );
  await write(
    "value-sets.ts",
    header(commit, ["value sets referenced across the rule files"]) + emitValueSets(emitter)
  );
  const modifiers = emitModifiers(
    joinModifierScopes(rules, modifierDocs, (token) => emitter.canonicalScope(token))
  );
  await write(
    "modifiers.ts",
    header(commit, [
      "script-docs/v4.4.1/modifiers.log",
      "modifier_categories.cwt",
      "modifiers.cwt",
    ]) +
      'import type { CustomModifiers } from "../content/types.ts";\n' +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      modifiers.code
  );
  await write(
    "modifier-policy.ts",
    header(commit, ["modifier_rule.cwt"]) + emitModifierOperationProtocol(modifierOperationPolicy)
  );
  for (const [category, emission] of aliasCategories) {
    await writeModule(
      `${category.replaceAll("_", "-")}.ts`,
      commit,
      [`alias[${category}:...] across the rule files`],
      emitter,
      emission.usage,
      emission.code
    );
  }
  for (const content of contents) {
    await writeModule(
      `${kebabCase(content.registry)}.ts`,
      commit,
      [content.manifest.source],
      emitter,
      content.usage,
      content.emission.code
    );
  }
  const contentSources = CONTENT_MANIFEST.map((entry) => entry.source).filter(
    (source, index, sources) => sources.indexOf(source) === index
  );
  await write("content-registry.ts", header(commit, contentSources) + contentRegistry(contents));
  // The field-docs ledger: every table's doc rows plus the omission rows the
  // report prints, one generated module the docs build can import. Emitted
  // from the same emissions as the tables themselves, so the two cannot drift.
  const fieldDocsModules: FieldDocsModule[] = [
    ...contents.map((content) => ({
      module: `./${kebabCase(content.registry)}.ts`,
      docTables: content.emission.docTables,
    })),
    ...[...aliasCategories].map(([category, emission]) => ({
      module: `./${category.replaceAll("_", "-")}.ts`,
      docTables: emission.docTables,
    })),
  ];
  await write(
    "content-field-docs.ts",
    header(commit, [...contentSources, "codegen-cwt field-docs ledger"]) +
      emitContentFieldDocs(
        fieldDocsModules,
        new Map(contents.map((content) => [content.registry, content.emission.omissions])),
        new Map([...aliasCategories].map(([category, emission]) => [category, emission.omissions]))
      )
  );
  const contentSwaps = deriveContentSwapIdentities(rules, contents);
  await write(
    "content-swaps.ts",
    header(commit, [...contentSources, "CWT base_type declarations"]) +
      emitContentSwapProtocol(contentSwaps)
  );
  const definers = contentDefiners(contents);
  await write("content-definers.ts", header(commit, contentSources) + definers.code);
  await write(
    "content-capability.ts",
    header(commit, [...contentSources, "content-manifest.ts"]) + definers.capabilityCode
  );
  await write(
    "vanilla-refs.ts",
    header(commit, [...contentSources, "content-manifest.ts (VANILLA_REF_EXTRAS)"]) +
      'import type { CheckedVanillaId, VanillaId, VanillaTrie } from "../identifiers/contracts.ts";\n' +
      'import { makeEventTrie, makeIdTrie, makeVanillaRef } from "../identifiers/trie.ts";\n' +
      importList(
        "./refs.ts",
        vanillaRefs.refs.map((name) => emitter.refTypeName(name))
      ) +
      "\n" +
      vanillaRefs.code
  );
  await writeModule(
    "triggers.ts",
    commit,
    ["triggers.cwt", "aliases.cwt", "script-docs/v4.4.1/triggers.log"],
    emitter,
    triggerUsage,
    triggers.code
  );
  await write(
    "links.ts",
    header(commit, ["links.cwt", "script-docs/v4.4.1/scopes.log"]) +
      'import { block } from "@pdx-ts/pdxscript";\n' +
      'import { navigateScope } from "../script/effects/recorder.ts";\n' +
      'import type { ScopeRef, ScopeValue } from "../script/effects/types.ts";\n' +
      'import { trigger, type Trigger } from "../script/trigger-core.ts";\n' +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      scopeLinks.code
  );
  await write(
    "link-meta.ts",
    header(commit, ["links.cwt"]) +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      emitScopeLinkNavigation(classifiedLinks.navigation)
  );
  await writeModule(
    "effects.ts",
    commit,
    [
      "effects.cwt",
      "aliases.cwt",
      "links.cwt",
      "script-docs/v4.4.1/effects.log",
      "script-docs/v4.4.1/scopes.log",
    ],
    emitter,
    effectUsage,
    effects.interfaces
  );
  await write(
    "effect-meta.ts",
    header(commit, ["effects.cwt", "aliases.cwt", "links.cwt"]) + effects.meta
  );
  await write(
    "effect-policy.ts",
    header(commit, ["effects.cwt", "events/events.cwt"]) + emitEffectPolicyProtocol(effectPolicy)
  );
  const events = emitEvents(emitter, effectPolicy);
  await write(
    "events.ts",
    header(commit, ["events/events.cwt"]) +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      events.code
  );
  await write(
    "event-definers.ts",
    header(commit, ["events/events.cwt"]) +
      'import { assertEventNumber, buildEvent } from "../events/lower.ts";\n' +
      'import type { EventDef, EventItem, EventRef } from "../events/types.ts";\n' +
      'import { assertNamespace } from "../authoring/feature.ts";\n' +
      'import { EVENT_KINDS, type EventKindKey } from "./events.ts";\n' +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      events.definerCode
  );
  await write(
    "event-fires.ts",
    header(commit, ["events/events.cwt", "effects.cwt"]) +
      'import type { FireEventArgs, WitnessedFireEventArgs } from "../events/types.ts";\n' +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      events.firesCode
  );
  const scriptReferences = emitScriptReferences(
    canonicalScopes(rules.scopes),
    [...effects.references, ...events.fireReferences],
    effects.scopeLinkReferences
  );
  await write(
    "script-reference.ts",
    header(commit, [
      "scopes.cwt",
      "effects.cwt",
      "aliases.cwt",
      "links.cwt",
      "events/events.cwt",
      "script-docs/v4.4.1/effects.log",
      "script-docs/v4.4.1/scopes.log",
    ]) + scriptReferences.code
  );
  await write(
    "event-fields.ts",
    header(commit, ["events/events.cwt", "codegen-cwt event field support policy"]) +
      emitEventFieldProtocol(eventFieldPolicy)
  );
  const onActions = emitOnActions(rules);
  await write("on-actions.ts", header(commit, ["on_actions.cwt"]) + onActions.code);

  // Every line below is collected here as it becomes available, rather than
  // printed at the point it is computed — `printReport` is the one place this
  // function actually reaches `console.log`.
  const report: string[] = [];
  report.push(`cwtools-stellaris-config @ ${commit.slice(0, 12)}`);
  report.push(
    `\nscopes: ${canonicalScopes(rules.scopes).length}` +
      ` | scope groups: ${emitter.usedScopeGroups.size} lowered of ${rules.scopeGroups.size} parsed` +
      ` | enums emitted: ${emitter.usedEnums.size}` +
      ` | refs emitted: ${emitter.usedRefs.size}` +
      ` | value sets emitted: ${emitter.usedValueSets.size}`
  );
  report.push(
    `scope links: ${scopeLinks.emitted} trigger/value fns, ${effects.linkEmitted} effect paths` +
      ` emitted of ${rules.links.size} declared`
  );
  report.push(
    `modifiers: ${modifiers.names} names emitted` +
      ` (${modifiers.universal} universal, ${modifiers.groups} scope-set groups,` +
      ` ${modifiers.scopes} scopes, ${modifiers.trieTypes} path types;` +
      ` ${rules.modifierTemplates.length} cwt template rows)`
  );
  report.push(
    `triggers: ${triggers.emitted} emitted of ${rules.triggers.size} declared` +
      ` (${[...triggers.byShape].map(([kind, n]) => `${kind} ${n}`).join(", ")})`
  );
  report.push(
    `effects: ${effects.emitted} emitted of ${rules.effects.size} declared` +
      ` (${[...effects.byShape].map(([kind, n]) => `${kind} ${n}`).join(", ")}` +
      `; clusters ${effects.clusterCount})`
  );
  for (const content of contents) {
    report.push(`${content.registry}: ${fieldCount(content.emission)}`);
  }
  report.push(
    `content definers: ${definers.definers} emitted` +
      ` (${CONTENT_PATCH_REGISTRIES.size} free patchX,` +
      ` ${CONTENT_CONTRIBUTION_SINKS.size} free contribution adder,` +
      ` ${definers.grafted.length} re-exported from a hand-written graft)`
  );
  report.push(
    `vanilla refs: ${vanillaRefs.checked} checked constructors,` +
      ` ${vanillaRefs.tries} tries emitted (${vanillaRefs.refs.length} ref types registered)`
  );
  report.push(
    `event kinds: ${events.kinds} (${events.definers} definers, ` +
      `${events.fireMethods} typed fire methods)`
  );
  report.push(
    `script reference metadata: ${effects.references.length} ordinary effects, ` +
      `${events.fireReferences.length} event fires, ` +
      `${effectPolicy.structuralMethods.size} structural methods, ` +
      `${scriptReferences.scopeLinks} scope links`
  );
  report.push(
    `on-actions: ${onActions.emitted} emitted (${onActions.noScope} scopeless and currently rejected)`
  );
  for (const [category, emission] of aliasCategories) {
    // The two kinds count different things, so they say different things. A
    // struct category lowers the category's own members, and the interesting
    // number is how many of them survived. A splice category has exactly one
    // member by construction; what it lowers is the fields *inside* that
    // member's block, so "of 1 declared" would be true and useless.
    const splice = aliasSplices.get(category);
    report.push(
      splice === undefined
        ? `${category}: ${emission.emittedMembers.length} alias-struct members emitted` +
            ` of ${rules.aliasCategories.get(category)?.size ?? 0} declared`
        : `${category}: ${emission.emittedMembers.length} fields emitted into ` +
            `${splice.typeName}, spliced as \`${splice.memberKey}\``
    );
    reportSection(report, `${category} members declined`, emission.declinedMembers);
  }

  reportSection(report, "Policy-owned script rules", scriptGapLines.policyOwned);
  reportSection(report, "Abstract script placeholders", scriptGapLines.abstractPlaceholders);
  reportSection(report, "Tracked script-generation gaps", scriptGapLines.trackedGaps);
  reportSection(report, "Trigger summaries replaced by the overlay", triggers.docOverrides);
  reportSection(
    report,
    "Scope links not emitted",
    classifiedLinks.skipped.map((entry) => `${entry.name} — ${entry.detail}`)
  );
  reportSection(report, "Effects emitted scalar-only (block overload dropped)", effects.scalarOnly);
  reportSection(report, "Effect field types replaced by the overlay", effects.fieldTypeOverrides);
  reportSection(
    report,
    "Effect field cardinality replaced by the overlay",
    effects.fieldCardinalityOverrides
  );
  reportSection(report, "Effect fields added by the overlay", effects.fieldAdditions);
  reportSection(report, "On-actions not emitted", onActions.skipped);
  reportSection(
    report,
    "Event kinds without full typing",
    events.skipped.map((entry) => `${entry.name} — ${entry.detail}`)
  );
  reportSection(
    report,
    "Enums widened to string (rules declare no values)",
    valuelessEnums(emitter)
  );
  reportSection(
    report,
    "Scope parameters widened to string (scopes.cwt declares no such scope)",
    [...emitter.unknownScopes].sort()
  );
  reportSection(
    report,
    "Scope parameters widened to string (scopes.cwt declares no such scope_group)",
    [...emitter.unknownScopeGroups].sort()
  );
  reportSection(report, "Content definers taken from the hand-written grafts", definers.grafted);
  reportSection(
    report,
    "Body fields renamed off a colliding localization slot",
    contents.flatMap((content) => content.emission.localisationRenames)
  );
  for (const content of contents) {
    const type = content.registry;
    report.push(`\n${type}: ${fieldCount(content.emission)}`);
    reportSection(report, `${type} fields declined`, content.emission.declinedFields);
    reportSection(
      report,
      `${type} alias categories spliced unkeyed at the top level`,
      content.emission.inlineSplices
    );
    reportSection(
      report,
      `${content.registry} fields the emitter could not lower`,
      content.emission.unsupported
    );
    reportSection(
      report,
      `${content.registry} localization aliases collapsed`,
      content.emission.localisationAliases
    );
    reportSection(
      report,
      `${content.registry} fields a patch cannot carry`,
      content.emission.patchExclusions
    );
    reportSection(
      report,
      `${content.registry} patch members widened`,
      content.emission.patchWidenings
    );
    reportSection(
      report,
      `${content.registry} patch loc members`,
      content.emission.patchLocMembers
    );
  }
  printReport(report);
}

const REGISTRY_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Checks one row's resolved registry name before anything derives from it.
 *
 * The name reaches an exported symbol, a capability method, a generated file
 * stem and a fixture stem, so a name that is not an identifier stem fails the
 * build somewhere far from the row that caused it. A `name` that merely
 * restates what `as ?? type` already yields is dead weight that would drift,
 * and two rows resolving to one name would silently overwrite each other's
 * generated file.
 */
function assertRegistryName(
  entry: ContentManifestEntry,
  registry: string,
  seen: Set<string>
): void {
  if (!REGISTRY_NAME.test(registry)) {
    throw new Error(
      `The manifest resolves type[${entry.type}] to registry name "${registry}", which is not ` +
        "a legal identifier stem"
    );
  }
  if (entry.name !== undefined && entry.name === (entry.as ?? entry.type)) {
    throw new Error(
      `The manifest's name "${entry.name}" for type[${entry.type}] is what the row already ` +
        "resolves to, so the rename says nothing — drop it"
    );
  }
  if (seen.has(registry)) {
    throw new Error(
      `Two manifest rows resolve to the registry name "${registry}", so they would generate ` +
        "over each other"
    );
  }
  seen.add(registry);
}

/**
 * The `## type_key_filter` that constrains one manifest row's keyword.
 *
 * A type-level filter constrains every row reading that type. Where the type
 * declares none, an `as` row is one subtype of it, and it is that subtype's own
 * filter that says which key its definitions are written under — which is what
 * lets the three `component_template` keywords and `sprite`'s `spriteType` be
 * checked rather than trusted.
 *
 * A negated filter (`<> random_list`) names a key the entries are *not*
 * written under, so it constrains nothing about the keyword and is dropped
 * here rather than compared against.
 */
function effectiveKeyFilter(
  type: ContentType,
  as: string | undefined
): { readonly key: string; readonly source: string } | null {
  if (type.keyFilter !== null) {
    return type.keyFilter.negated
      ? null
      : { key: type.keyFilter.key, source: `type[${type.name}]` };
  }
  if (as === undefined) {
    return null;
  }
  const subtype = type.subtypes.find((candidate) => candidate.name === as);
  if (subtype?.keyFilter == null || subtype.keyFilter.negated) {
    return null;
  }
  return { key: subtype.keyFilter.key, source: `type[${type.name}] subtype[${as}]` };
}

function contentRegistry(
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
    "export const CONTENT_REGISTRIES = [\n" +
    descriptors +
    "] as const satisfies readonly ContentRegistryDescriptor[];\n\n" +
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

await main();

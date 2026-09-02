/**
 * Regenerates `packages/sdk/src/generated/` from the cwtools config fork.
 *
 * Run with `npm run codegen`. The output is committed, so a rules bump shows up
 * as a reviewable diff on the SDK's public API.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scopeIndex, type ContentType, type RuleSet } from "./cwt/rules.ts";
import {
  emitAliasCategories,
  type AliasCategoryEmission,
} from "./emit/content/alias-categories.ts";
import type { AliasSpliceEmission } from "./emit/content/alias-splice.ts";
import { emitContentType, type ContentEmission } from "./emit/content/content-type.ts";
import { contentDefiners } from "./emit/content/definers.ts";
import { emitContentFieldDocs, type FieldDocsModule } from "./emit/content/field-docs.ts";
import { contentLocLookup } from "./emit/content/loc-lookup.ts";
import { contentPublicBarrel } from "./emit/content/public-barrel.ts";
import { contentRegistry } from "./emit/content/registry.ts";
import { emitVanillaRefs } from "./emit/content/vanilla-refs.ts";
import { emitEffects } from "./emit/script/effects.ts";
import { emitEvents } from "./emit/script/events.ts";
import { emitScopeLinkNavigation, emitScopeLinks } from "./emit/script/links.ts";
import { emitModifiers, joinModifierScopes } from "./emit/script/modifiers.ts";
import { emitOnActions } from "./emit/script/on-actions.ts";
import { emitScriptReferences } from "./emit/script/script-reference.ts";
import { emitTriggers } from "./emit/script/triggers.ts";
import {
  canonicalScopes,
  emitEnums,
  emitRefs,
  emitScopes,
  emitValueSets,
  valuelessEnums,
} from "./emit/support.ts";
import { Emitter, type Usage } from "./emit/typescript.ts";
import { loadRules } from "./load-rules.ts";
import { parseModifierDocs } from "./logs/modifier-docs.ts";
import { parseScopeLinks } from "./logs/scopes.ts";
import { parseTriggerDocs } from "./logs/trigger-docs.ts";
import {
  referenceNameOf,
  subtypeReferenceRefinements,
  typesReferencedBySubtype,
  type SubtypeReferenceRefinement,
} from "./lower/content-reference.ts";
import { emitContentShapeProtocol } from "./lower/content-shape.ts";
import { classifyLinks } from "./lower/links.ts";
import { lowerRuleTable } from "./lower/lowered-rule.ts";
import { kebabCase } from "./naming.ts";
import {
  assertComplexEnumReferenceOverlaysValid,
  assertHandWrittenTriggerExportsMatchRules,
  assertOverlayRegistriesKnown,
  assertPatchWideningsTargetPatchableRegistries,
  assertScriptedModifierCategoryMapValid,
} from "./overlay/audit.ts";
import {
  ASSET_PATH_FIELDS,
  COMPLEX_ENUM_REFERENCE_OVERLAYS,
  CONTENT_CONTRIBUTION_SINKS,
  CONTENT_DECLINED_FIELDS,
  CONTENT_FIELD_DOCS,
  CONTENT_FIELD_OVERRIDES,
  CONTENT_PATCH_REGISTRIES,
  CONTENT_SCOPE_PARAMETERS,
  CONTENT_WITNESSES,
  EXACT_NAME_MINTS,
  FIELD_WIDENINGS,
  FILE_STEM_OVERLAYS,
  HAND_WRITTEN_CONTENT_DEFINERS,
  MINT_SHAPE_OVERLAYS,
  PATCH_WIDENINGS,
  REPEATED_STRUCT_DEFINITIONS,
  REQUIRED_LOCALISATION,
  SCRIPTED_MODIFIER_CATEGORY_MAP,
  SYNTHETIC_LOCALISATION,
} from "./overlay/index.ts";
import { deriveContentSwapIdentities, emitContentSwapProtocol } from "./policy/content-swaps.ts";
import { createEffectPolicy, emitEffectPolicyProtocol } from "./policy/effects.ts";
import { createEventFieldPolicy, emitEventFieldProtocol } from "./policy/event-fields.ts";
import {
  assertAndRecordRegistryName,
  CONTENT_MANIFEST,
  effectiveKeyFilter,
  registryNameOf,
  VANILLA_REF_EXTRAS,
  type ContentManifestEntry,
} from "./policy/manifest.ts";
import {
  createModifierOperationPolicy,
  emitModifierOperationProtocol,
} from "./policy/modifiers.ts";
import { formatScriptGapReport, reconcileScriptGaps } from "./policy/script-gaps.ts";
import { HAND_WRITTEN_TRIGGER_EXPORTS, RESERVED_TRIGGER_EXPORT_NAMES } from "./policy/triggers.ts";
import { CWT_SCRIPT_DOCS_VERSION, readCwtCommit } from "./provenance.ts";
import { checkDrift, loadBaseline } from "./reconcile/baseline.ts";
import { reconcile } from "./reconcile/reconcile.ts";
import { scopeAuthorityOf, type ScopeAuthority } from "./reconcile/scope-authority.ts";
import { GeneratedOutput, header } from "./render/generated-file.ts";
import { importList } from "./render/symbols.ts";
import { eventFieldSupportLossLines, printReport, reportSection } from "./report.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CWT_REPOSITORY_DIRECTORY = path.join(REPOSITORY_ROOT, "vendor/cwtools-stellaris-config");
const CWT_CONFIG_DIRECTORY = path.join(CWT_REPOSITORY_DIRECTORY, "config");
const SCRIPT_DOCS_DIRECTORY = path.join(
  CWT_REPOSITORY_DIRECTORY,
  "script-docs",
  CWT_SCRIPT_DOCS_VERSION
);

interface EmittedManifestContent {
  readonly manifest: (typeof CONTENT_MANIFEST)[number];
  readonly registry: string;
  readonly referenceName: string;
  readonly referenceRefinement: SubtypeReferenceRefinement | null;
  readonly keyword: string | undefined;
  readonly type: ContentType;
  readonly emission: ContentEmission;
  readonly usage: Usage;
}

interface ManifestContentEmission {
  readonly contents: EmittedManifestContent[];
  readonly registryNames: ReadonlySet<string>;
}

interface GeneratorSources {
  readonly rules: RuleSet;
  readonly docs: ReturnType<typeof parseTriggerDocs>;
  readonly links: ReturnType<typeof parseScopeLinks>;
  readonly modifierDocs: ReturnType<typeof parseModifierDocs>;
}

interface ScriptRuleEmission {
  readonly triggers: ReturnType<typeof emitTriggers>;
  readonly triggerUsage: Usage;
  readonly classifiedLinks: ReturnType<typeof classifyLinks>;
  readonly scopeLinks: ReturnType<typeof emitScopeLinks>;
  readonly effects: ReturnType<typeof emitEffects>;
  readonly effectUsage: Usage;
  readonly scriptGapLines: ReturnType<typeof formatScriptGapReport>;
}

interface EventModuleEmission {
  readonly events: ReturnType<typeof emitEvents>;
  readonly scriptReferences: ReturnType<typeof emitScriptReferences>;
  readonly onActions: ReturnType<typeof emitOnActions>;
}

interface SharedRuleModuleInput {
  /** The open session these modules are staged into. */
  readonly output: GeneratedOutput;
  readonly commit: string;
  readonly rules: RuleSet;
  readonly emitter: Emitter;
  readonly modifierDocs: ReturnType<typeof parseModifierDocs>;
  readonly modifierOperationPolicy: ReturnType<typeof createModifierOperationPolicy>;
}

interface ContentModuleInput {
  /** The open session these modules are staged into. */
  readonly output: GeneratedOutput;
  readonly commit: string;
  readonly rules: RuleSet;
  readonly emitter: Emitter;
  readonly contents: readonly EmittedManifestContent[];
  readonly aliasCategories: ReadonlyMap<string, AliasCategoryEmission>;
  readonly vanillaRefs: ReturnType<typeof emitVanillaRefs>;
}

interface ScriptModuleInput {
  /** The open session these modules are staged into. */
  readonly output: GeneratedOutput;
  readonly commit: string;
  readonly emitter: Emitter;
  readonly triggers: ReturnType<typeof emitTriggers>;
  readonly triggerUsage: Usage;
  readonly classifiedLinks: ReturnType<typeof classifyLinks>;
  readonly scopeLinks: ReturnType<typeof emitScopeLinks>;
  readonly effects: ReturnType<typeof emitEffects>;
  readonly effectUsage: Usage;
  readonly effectPolicy: ReturnType<typeof createEffectPolicy>;
}

interface EventModuleInput {
  /** The open session these modules are staged into. */
  readonly output: GeneratedOutput;
  readonly commit: string;
  readonly rules: RuleSet;
  readonly emitter: Emitter;
  readonly effects: ReturnType<typeof emitEffects>;
  readonly triggers: ReturnType<typeof emitTriggers>;
  readonly effectPolicy: ReturnType<typeof createEffectPolicy>;
  readonly eventFieldPolicy: ReturnType<typeof createEventFieldPolicy>;
}

interface CodegenReportInput {
  readonly commit: string;
  readonly rules: RuleSet;
  readonly emitter: Emitter;
  readonly scopeLinks: ReturnType<typeof emitScopeLinks>;
  readonly effects: ReturnType<typeof emitEffects>;
  readonly modifiers: ReturnType<typeof emitModifiers>;
  readonly triggers: ReturnType<typeof emitTriggers>;
  readonly contents: readonly EmittedManifestContent[];
  readonly definers: ReturnType<typeof contentDefiners>;
  readonly vanillaRefs: ReturnType<typeof emitVanillaRefs>;
  readonly events: ReturnType<typeof emitEvents>;
  readonly scriptReferences: ReturnType<typeof emitScriptReferences>;
  readonly effectPolicy: ReturnType<typeof createEffectPolicy>;
  readonly onActions: ReturnType<typeof emitOnActions>;
  readonly aliasCategories: ReadonlyMap<string, AliasCategoryEmission>;
  readonly aliasSplices: ReadonlyMap<string, AliasSpliceEmission>;
  readonly scriptGapLines: ReturnType<typeof formatScriptGapReport>;
  readonly classifiedLinks: ReturnType<typeof classifyLinks>;
  readonly eventFieldPolicy: ReturnType<typeof createEventFieldPolicy>;
}

function readGeneratorSources(
  configDirectory: string,
  scriptDocsDirectory: string
): GeneratorSources {
  const rules = loadRules(configDirectory);
  const docs = parseTriggerDocs(
    readFileSync(path.join(scriptDocsDirectory, "triggers.log"), "utf8"),
    readFileSync(path.join(scriptDocsDirectory, "effects.log"), "utf8")
  );
  const links = parseScopeLinks(readFileSync(path.join(scriptDocsDirectory, "scopes.log"), "utf8"));
  const modifierDocs = parseModifierDocs(
    readFileSync(path.join(scriptDocsDirectory, "modifiers.log"), "utf8")
  );
  return { rules, docs, links, modifierDocs };
}

function describeEmittedFields(emission: ContentEmission): string {
  const nestedFieldCount = emission.nestedEmittedFields.length;
  return (
    `${emission.emittedFields.length} fields emitted` +
    (nestedFieldCount === 0 ? "" : ` (+${nestedFieldCount} nested)`)
  );
}

function assertManifestKeywordMatchesType(entry: ContentManifestEntry, type: ContentType): void {
  const keyword = entry.keyword;
  if (keyword !== undefined && type.nameField === null) {
    throw new Error(`type[${entry.type}] declares no name_field, so it has no keyword`);
  }
  if (keyword === undefined && type.nameField !== null) {
    throw new Error(
      `type[${entry.type}] declares name_field=${type.nameField}, so the manifest ` +
        "entry needs the keyword its entries are written under"
    );
  }
  const keyFilter = effectiveKeyFilter(type, entry.as);
  if (keyFilter !== null && keyword !== undefined && keyword !== keyFilter.key) {
    throw new Error(
      `${keyFilter.source} declares ## type_key_filter = ${keyFilter.key} but the ` +
        `manifest claims keyword ${keyword}`
    );
  }
}

function emitManifestContents(rules: RuleSet, emitter: Emitter): ManifestContentEmission {
  const contents: EmittedManifestContent[] = [];
  const registryNames = new Set<string>();
  const subtypeReferencedTypes = typesReferencedBySubtype(rules);
  const refinements = subtypeReferenceRefinements(rules);

  for (const manifestEntry of CONTENT_MANIFEST) {
    const entry: ContentManifestEntry = manifestEntry;
    const type = rules.contentTypes.get(entry.type);
    const body = rules.bodies.get(entry.type);
    if (type === undefined || body === undefined) {
      throw new Error(`${entry.source} no longer declares type[${entry.type}] and its body`);
    }

    const registry = registryNameOf(entry);
    assertAndRecordRegistryName(entry, registry, registryNames);
    assertManifestKeywordMatchesType(entry, type);

    emitter.beginFile();
    const emission = emitContentType(emitter, type, body, registry, entry.as);
    const usage = emitter.endFile();
    // A registry that is one subtype of its type has nothing to refine: its
    // brand is already the qualified one wherever the rules reference it.
    const referenceRefinement =
      entry.as === undefined ? (refinements.get(entry.type) ?? null) : null;
    if (referenceRefinement !== null) {
      // The capability module imports the qualified reference, so the record
      // that carries the refinement is what puts it in `refs.ts`.
      emitter.usedRefs.add(referenceRefinement.reference);
    }
    contents.push({
      manifest: manifestEntry,
      registry,
      referenceName: referenceNameOf(type, entry.as, subtypeReferencedTypes),
      referenceRefinement,
      keyword: entry.keyword,
      type,
      emission,
      usage,
    });
  }

  return { contents, registryNames };
}

function emitScriptRules(
  rules: RuleSet,
  docs: ReturnType<typeof parseTriggerDocs>,
  links: ReturnType<typeof parseScopeLinks>,
  emitter: Emitter,
  effectPolicy: ReturnType<typeof createEffectPolicy>,
  authority: ScopeAuthority
): ScriptRuleEmission {
  const index = scopeIndex(rules);

  emitter.beginFile();
  const loweredTriggers = lowerRuleTable(
    rules.triggers,
    docs.triggers,
    emitter.lowerer,
    index,
    authority.triggers
  );
  const triggers = emitTriggers(emitter, docs.triggers, loweredTriggers);
  const triggerUsage = emitter.endFile();

  const documentedLinks = new Map(links.links.map((link) => [link.name, link]));
  const classifiedLinks = classifyLinks(rules, documentedLinks, index);
  const reservedScopeLinkNames = new Set([...triggers.names, ...RESERVED_TRIGGER_EXPORT_NAMES]);
  const scopeLinks = emitScopeLinks(classifiedLinks, index, reservedScopeLinkNames);

  emitter.beginFile();
  const loweredEffects = lowerRuleTable(
    rules.effects,
    docs.effects,
    emitter.lowerer,
    index,
    authority.effects
  );
  const effects = emitEffects(
    emitter,
    docs.effects,
    index,
    loweredEffects,
    effectPolicy,
    classifiedLinks.links
  );
  const effectUsage = emitter.endFile();
  const scriptGaps = reconcileScriptGaps({
    triggers: triggers.skipped,
    effects: effects.skipped,
  });

  return {
    triggers,
    triggerUsage,
    classifiedLinks,
    scopeLinks,
    effects,
    effectUsage,
    scriptGapLines: formatScriptGapReport(scriptGaps),
  };
}

function assertGenerationPolicies(
  rules: RuleSet,
  emitter: Emitter,
  registryNames: ReadonlySet<string>
): void {
  assertOverlayRegistriesKnown(
    [
      { tableId: "MINT_SHAPE_OVERLAYS", keys: MINT_SHAPE_OVERLAYS.keys() },
      { tableId: "EXACT_NAME_MINTS", keys: EXACT_NAME_MINTS.keys() },
      { tableId: "FILE_STEM_OVERLAYS", keys: FILE_STEM_OVERLAYS.keys() },
      { tableId: "HAND_WRITTEN_CONTENT_DEFINERS", keys: HAND_WRITTEN_CONTENT_DEFINERS.keys() },
      { tableId: "CONTENT_CONTRIBUTION_SINKS", keys: CONTENT_CONTRIBUTION_SINKS.keys() },
      { tableId: "CONTENT_PATCH_REGISTRIES", keys: CONTENT_PATCH_REGISTRIES.keys() },
      { tableId: "CONTENT_SCOPE_PARAMETERS", keys: CONTENT_SCOPE_PARAMETERS.keys() },
      { tableId: "CONTENT_WITNESSES", keys: CONTENT_WITNESSES.keys() },
    ],
    registryNames
  );
  assertComplexEnumReferenceOverlaysValid(
    "COMPLEX_ENUM_REFERENCE_OVERLAYS",
    COMPLEX_ENUM_REFERENCE_OVERLAYS.keys(),
    rules.complexEnums,
    rules.enums
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
  emitter.overlayAudit.assertAllApplied("FIELD_WIDENINGS", FIELD_WIDENINGS.keys());
  emitter.overlayAudit.assertAllApplied("CONTENT_FIELD_DOCS", CONTENT_FIELD_DOCS.keys());
  emitter.overlayAudit.assertAllApplied("CONTENT_DECLINED_FIELDS", CONTENT_DECLINED_FIELDS.keys());
  emitter.overlayAudit.assertAllApplied("REQUIRED_LOCALISATION", REQUIRED_LOCALISATION.keys());
  emitter.overlayAudit.assertAllApplied("SYNTHETIC_LOCALISATION", SYNTHETIC_LOCALISATION.keys());
  emitter.overlayAudit.assertAllApplied(
    "REPEATED_STRUCT_DEFINITIONS",
    REPEATED_STRUCT_DEFINITIONS.keys()
  );
  emitter.overlayAudit.assertAllApplied("ASSET_PATH_FIELDS", ASSET_PATH_FIELDS.keys());
}

function describeAliasCategory(
  category: string,
  emission: AliasCategoryEmission,
  splice: AliasSpliceEmission | undefined,
  rules: RuleSet
): string {
  if (splice === undefined) {
    return (
      `${category}: ${emission.emittedMembers.length} alias-struct members emitted` +
      ` of ${rules.aliasCategories.get(category)?.size ?? 0} declared`
    );
  }
  return (
    `${category}: ${emission.emittedMembers.length} fields emitted into ` +
    `${splice.typeName}, spliced as \`${splice.memberKey}\``
  );
}

function buildCodegenReport(input: CodegenReportInput): string[] {
  const {
    aliasCategories,
    aliasSplices,
    classifiedLinks,
    commit,
    contents,
    definers,
    effectPolicy,
    eventFieldPolicy,
    effects,
    emitter,
    events,
    modifiers,
    onActions,
    rules,
    scopeLinks,
    scriptGapLines,
    scriptReferences,
    triggers,
    vanillaRefs,
  } = input;
  const report: string[] = [];

  report.push(`cwtools-stellaris-config @ ${commit.slice(0, 12)}`);
  report.push(
    `\nscopes: ${canonicalScopes(rules.scopes).length}` +
      ` | scope groups: ${emitter.lowerer.usedScopeGroups.size} lowered of ${rules.scopeGroups.size} parsed` +
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
      ` (${[...triggers.byShape].map(([kind, count]) => `${kind} ${count}`).join(", ")})`
  );
  report.push(
    `effects: ${effects.emitted} emitted of ${rules.effects.size} declared` +
      ` (${[...effects.byShape].map(([kind, count]) => `${kind} ${count}`).join(", ")}` +
      `; clusters ${effects.clusterCount})`
  );
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
      `${scriptReferences.triggers} generated triggers, ` +
      `${events.fireReferences.length} event fires, ` +
      `${effectPolicy.structuralMethods.size} structural methods, ` +
      `${scriptReferences.scopeLinks} scope links`
  );
  report.push(
    `on-actions: ${onActions.emitted} emitted (${onActions.noScope} scopeless with weighted-reference support)`
  );
  for (const [category, emission] of aliasCategories) {
    report.push(describeAliasCategory(category, emission, aliasSplices.get(category), rules));
    reportSection(report, `${category} members declined`, emission.declinedMembers);
    reportSection(
      report,
      `${category} subtype requiredness collapsed`,
      aliasSplices.get(category)?.subtypeCollapses ?? []
    );
  }

  reportSection(report, "Policy-owned script rules", scriptGapLines.policyOwned);
  reportSection(report, "Abstract script placeholders", scriptGapLines.abstractPlaceholders);
  reportSection(report, "Tracked script-generation gaps", scriptGapLines.trackedGaps);
  reportSection(report, "Trigger summaries replaced by the overlay", triggers.docOverrides);
  reportSection(
    report,
    "Trigger wrappers held in the enclosing scope by the overlay",
    triggers.enclosingScopeWrappers
  );
  reportSection(
    report,
    "Scope links not emitted",
    classifiedLinks.skipped.map((entry) => `${entry.name} — ${entry.detail}`)
  );
  reportSection(report, "Effect value types replaced by the overlay", effects.valueTypeOverrides);
  reportSection(
    report,
    "Effect arguments whose generated fallback refuses a carried witness (derived from the seams)",
    effects.witnessExclusions
  );
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
    "Event fields not fully supported",
    eventFieldSupportLossLines(eventFieldPolicy.event)
  );
  reportSection(
    report,
    "Event option fields not fully supported",
    eventFieldSupportLossLines(eventFieldPolicy.option)
  );
  reportSection(
    report,
    "Enums widened to string (rules declare no values)",
    valuelessEnums(emitter)
  );
  reportSection(
    report,
    "Scope parameters widened to string (scopes.cwt declares no such scope)",
    [...emitter.lowerer.unknownScopes].sort()
  );
  reportSection(
    report,
    "Scope parameters widened to string (scopes.cwt declares no such scope_group)",
    [...emitter.lowerer.unknownScopeGroups].sort()
  );
  reportSection(report, "Content definers taken from the hand-written grafts", definers.grafted);
  reportSection(
    report,
    "Subtype references refined from the rules (capability returns the qualified reference)",
    contents.flatMap((content) =>
      content.referenceRefinement === null
        ? []
        : [
            `${content.registry}: <${content.referenceRefinement.reference}> when ` +
              `${content.referenceRefinement.member} is true`,
          ]
    )
  );
  reportSection(
    report,
    "Body fields renamed off a colliding localization slot",
    contents.flatMap((content) => content.emission.localisationRenames)
  );
  for (const content of contents) {
    report.push(`\n${content.registry}: ${describeEmittedFields(content.emission)}`);
    reportSection(report, `${content.registry} fields declined`, content.emission.declinedFields);
    reportSection(
      report,
      `${content.registry} alias categories spliced unkeyed at the top level`,
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
      `${content.registry} subtype arms emitted as unions`,
      content.emission.subtypeUnions
    );
    reportSection(
      report,
      `${content.registry} subtype requiredness collapsed`,
      content.emission.subtypeCollapses
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

  return report;
}

async function writeSharedRuleModules(
  input: SharedRuleModuleInput
): Promise<ReturnType<typeof emitModifiers>> {
  const { commit, emitter, modifierDocs, modifierOperationPolicy, output, rules } = input;

  await output.write(
    "scopes.ts",
    header(commit, ["scopes.cwt"]) + emitScopes(canonicalScopes(rules.scopes))
  );
  await output.write(
    "refs.ts",
    header(commit, ["type references across the rule files"]) + emitRefs(emitter)
  );
  await output.write(
    "enums.ts",
    header(commit, ["enums.cwt"]) +
      'import type { VanillaEnumMember } from "../identifiers/contracts.ts";\n\n' +
      emitEnums(emitter)
  );
  await output.write(
    "value-sets.ts",
    header(commit, ["value sets referenced across the rule files"]) + emitValueSets(emitter)
  );

  const modifiers = emitModifiers(
    joinModifierScopes(rules, modifierDocs, (token) => emitter.lowerer.canonicalScope(token))
  );
  await output.write(
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
  await output.write(
    "modifier-policy.ts",
    header(commit, ["modifier_rule.cwt"]) + emitModifierOperationProtocol(modifierOperationPolicy)
  );

  return modifiers;
}

async function writeContentModules(
  input: ContentModuleInput
): Promise<ReturnType<typeof contentDefiners>> {
  const { aliasCategories, commit, contents, emitter, output, rules, vanillaRefs } = input;

  for (const [category, emission] of aliasCategories) {
    await output.writeModule(
      `${category.replaceAll("_", "-")}.ts`,
      commit,
      [`alias[${category}:...] across the rule files`],
      emitter,
      emission.usage,
      emission.code
    );
  }
  for (const content of contents) {
    await output.writeModule(
      `${kebabCase(content.registry)}.ts`,
      commit,
      [content.manifest.source],
      emitter,
      content.usage,
      content.emission.code
    );
  }

  const contentSources = [...new Set(CONTENT_MANIFEST.map((entry) => entry.source))];
  await output.write(
    "content-registry.ts",
    header(commit, contentSources) + contentRegistry(contents)
  );
  await output.write("content-loc.ts", header(commit, contentSources) + contentLocLookup(contents));

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
  await output.write(
    "content-field-docs.ts",
    header(commit, [...contentSources, "codegen-cwt field-docs ledger"]) +
      emitContentFieldDocs(
        fieldDocsModules,
        new Map(contents.map((content) => [content.registry, content.emission.omissions])),
        new Map([...aliasCategories].map(([category, emission]) => [category, emission.omissions]))
      )
  );

  const contentSwaps = deriveContentSwapIdentities(rules, contents);
  await output.write(
    "content-swaps.ts",
    header(commit, [...contentSources, "CWT base_type declarations"]) +
      emitContentSwapProtocol(contentSwaps)
  );

  const definers = contentDefiners(contents);
  await output.write("content-definers.ts", header(commit, contentSources) + definers.code);
  await output.write(
    "content-capability.ts",
    header(commit, [...contentSources, "content-manifest.ts"]) + definers.capabilityCode
  );
  // An alias category publishes nothing of its own: the types an author names
  // inside one are curated by `PUBLIC_NESTED_TYPES`.
  const publicModules = [
    ...contents.map((content) => ({
      file: `${kebabCase(content.registry)}.ts`,
      exportedNames: content.emission.exportedNames,
      publicTypes: content.emission.publicTypes,
    })),
    ...[...aliasCategories].map(([category, emission]) => ({
      file: `${category.replaceAll("_", "-")}.ts`,
      exportedNames: emission.exportedNames,
      publicTypes: [],
    })),
    {
      file: "content-capability.ts",
      exportedNames: definers.capabilityExportedNames,
      publicTypes: definers.capabilityPublicTypes,
    },
  ];
  await output.write(
    "content-public.ts",
    header(commit, [...contentSources, "codegen-cwt public-surface policy"]) +
      contentPublicBarrel(publicModules)
  );
  await output.write(
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

  return definers;
}

async function writeScriptModules(input: ScriptModuleInput): Promise<void> {
  const {
    classifiedLinks,
    commit,
    effectPolicy,
    effectUsage,
    effects,
    emitter,
    output,
    scopeLinks,
    triggers,
    triggerUsage,
  } = input;

  await output.writeModule(
    "triggers.ts",
    commit,
    ["triggers.cwt", "aliases.cwt", "script-docs/v4.4.1/triggers.log"],
    emitter,
    triggerUsage,
    triggers.code
  );
  await output.write(
    "links.ts",
    header(commit, ["links.cwt", "script-docs/v4.4.1/scopes.log"]) +
      'import { block } from "@pdx-ts/pdxscript";\n' +
      'import { navigateScope } from "../script/effects/recorder.ts";\n' +
      'import type { ScopeRef, ScopeValue } from "../script/effects/types.ts";\n' +
      'import { trigger, type Trigger } from "../script/trigger-core.ts";\n' +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      scopeLinks.code
  );
  await output.write(
    "link-meta.ts",
    header(commit, ["links.cwt"]) +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      emitScopeLinkNavigation(classifiedLinks.navigation)
  );
  await output.writeModule(
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
  await output.write(
    "effect-meta.ts",
    header(commit, ["effects.cwt", "aliases.cwt", "links.cwt"]) + effects.meta
  );
  await output.write(
    "effect-policy.ts",
    header(commit, ["effects.cwt", "events/events.cwt"]) + emitEffectPolicyProtocol(effectPolicy)
  );
}

async function writeEventModules(input: EventModuleInput): Promise<EventModuleEmission> {
  const { commit, effectPolicy, effects, emitter, eventFieldPolicy, output, rules, triggers } =
    input;

  const events = emitEvents(emitter, effectPolicy, effects.universalParameters);
  await output.write(
    "events.ts",
    header(commit, ["events/events.cwt"]) +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      events.code
  );
  await output.write(
    "event-definers.ts",
    header(commit, ["events/events.cwt"]) +
      'import { assertEventNumber, buildEvent } from "../events/lower.ts";\n' +
      'import type { EventDef, EventItem, EventRef } from "../events/types.ts";\n' +
      'import type { AmbientScopeContext } from "../script/effects/types.ts";\n' +
      'import type { KeyedLocalization } from "../authoring/localization.ts";\n' +
      'import { assertNamespace } from "../authoring/feature.ts";\n' +
      'import { EVENT_KINDS, type EventKindKey } from "./events.ts";\n' +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      events.definerCode
  );
  await output.write(
    "event-fires.ts",
    header(commit, ["events/events.cwt", "effects.cwt"]) +
      'import type { FireEventArgs, WitnessedFireEventArgs } from "../events/types.ts";\n' +
      'import type { AmbientScopeContext } from "../script/effects/types.ts";\n' +
      'import type { ScopeName } from "./scopes.ts";\n\n' +
      events.firesCode
  );

  const scriptReferences = emitScriptReferences(
    canonicalScopes(rules.scopes),
    { methods: effectPolicy.structuralIdentity, keys: [...effectPolicy.structuralKeys] },
    [...effects.references, ...events.fireReferences],
    triggers.references,
    effects.scopeLinkReferences
  );
  await output.write(
    "script-reference.ts",
    header(commit, [
      "scopes.cwt",
      "effects.cwt",
      "triggers.cwt",
      "aliases.cwt",
      "links.cwt",
      "events/events.cwt",
      "script-docs/v4.4.1/effects.log",
      "script-docs/v4.4.1/triggers.log",
      "script-docs/v4.4.1/scopes.log",
    ]) + scriptReferences.code
  );
  await output.write(
    "event-fields.ts",
    header(commit, ["events/events.cwt", "codegen-cwt event field support policy"]) +
      emitEventFieldProtocol(eventFieldPolicy)
  );

  const onActions = emitOnActions(rules);
  await output.write("on-actions.ts", header(commit, ["on_actions.cwt"]) + onActions.code);

  return { events, scriptReferences, onActions };
}

async function main(): Promise<void> {
  const rebaseline = process.argv.includes("--rebaseline");
  const commit = readCwtCommit(CWT_REPOSITORY_DIRECTORY);
  const { docs, links, modifierDocs, rules } = readGeneratorSources(
    CWT_CONFIG_DIRECTORY,
    SCRIPT_DOCS_DIRECTORY
  );

  const baseline = loadBaseline();
  await checkDrift(reconcile(rules, docs, modifierDocs, links), baseline, rebaseline);
  const authority = scopeAuthorityOf(baseline, scopeIndex(rules));

  const emitter = new Emitter(rules);
  const effectPolicy = createEffectPolicy(rules);
  const modifierOperationPolicy = createModifierOperationPolicy(rules);
  const eventFieldPolicy = createEventFieldPolicy(rules);
  const scriptRules = emitScriptRules(rules, docs, links, emitter, effectPolicy, authority);

  const output = GeneratedOutput.open();
  let report: string[];
  try {
    await output.write(
      "content-shape.ts",
      header(commit, ["codegen-cwt ContentShape protocol"]) + emitContentShapeProtocol()
    );

    const { contents, registryNames } = emitManifestContents(rules, emitter);

    const { aliasCategories, aliasSplices } = emitAliasCategories(
      emitter,
      rules,
      contents.flatMap((content) => content.emission.inlineSplices)
    );
    assertGenerationPolicies(rules, emitter, registryNames);

    const vanillaRefs = emitVanillaRefs(
      emitter,
      CONTENT_MANIFEST,
      VANILLA_REF_EXTRAS,
      new Map(contents.map((content) => [content.registry, content.referenceName]))
    );

    const modifiers = await writeSharedRuleModules({
      output,
      commit,
      rules,
      emitter,
      modifierDocs,
      modifierOperationPolicy,
    });
    const definers = await writeContentModules({
      output,
      commit,
      rules,
      emitter,
      contents,
      aliasCategories,
      vanillaRefs,
    });
    await writeScriptModules({
      output,
      commit,
      emitter,
      ...scriptRules,
      effectPolicy,
    });
    const { events, scriptReferences, onActions } = await writeEventModules({
      output,
      commit,
      rules,
      emitter,
      effects: scriptRules.effects,
      triggers: scriptRules.triggers,
      effectPolicy,
      eventFieldPolicy,
    });

    report = buildCodegenReport({
      commit,
      rules,
      emitter,
      scopeLinks: scriptRules.scopeLinks,
      effects: scriptRules.effects,
      modifiers,
      triggers: scriptRules.triggers,
      contents,
      definers,
      vanillaRefs,
      events,
      scriptReferences,
      effectPolicy,
      onActions,
      aliasCategories,
      aliasSplices,
      scriptGapLines: scriptRules.scriptGapLines,
      classifiedLinks: scriptRules.classifiedLinks,
      eventFieldPolicy,
    });
  } catch (error) {
    output.discard();
    throw error;
  }

  // The report describes output that landed, so it prints only after the swap.
  output.commit();
  printReport(report);
}

await main();

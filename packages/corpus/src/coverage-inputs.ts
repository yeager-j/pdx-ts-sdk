/**
 * Gathers the syntax coverage report's inputs from the repository: the
 * vendored rules, a fresh run of the script emitters, and the committed
 * fixtures. The calculation itself is {@link coverageOf}.
 *
 * Reads the repository only. Never an install: the vanilla evidence is the
 * committed corpus and script usage fixtures, so the report runs wherever the
 * tests do. The one process effect is `git rev-parse` in the submodule, for
 * the header line.
 */

import { emitEvents } from "@pdx-ts/codegen-cwt/emit/script/events";
import { emitScriptRules } from "@pdx-ts/codegen-cwt/emit/script/script-rules";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/typescript";
import { createEffectPolicy } from "@pdx-ts/codegen-cwt/policy/effects";
import { VANILLA_REF_EXTRAS } from "@pdx-ts/codegen-cwt/policy/manifest";
import type { ScriptGapReport } from "@pdx-ts/codegen-cwt/policy/script-gaps";
import { readCwtCommit } from "@pdx-ts/codegen-cwt/provenance";
import { loadBaseline } from "@pdx-ts/codegen-cwt/reconcile/baseline";
import { scopeAuthorityOf } from "@pdx-ts/codegen-cwt/reconcile/scope-authority";
import { CWT_REPOSITORY_DIRECTORY } from "@pdx-ts/codegen-cwt/sources";

import {
  coverageOf,
  handWrittenOwnership,
  type Coverage,
  type RegistryCoverageInput,
  type UnexposedTypeInput,
  type UsageOf,
} from "./coverage/index.ts";
import {
  committedRegistryReports,
  FIXTURE_DIR,
  FIXTURE_PATH,
  loadMeta,
  loadRegistryFixture,
  loadScriptUsage,
  loadUnexposedTypes,
  MEASUREMENTS,
  META_FILE,
  SCRIPT_USAGE_FILE,
  SCRIPT_USAGE_ROOTS,
  UNEXPOSED_TYPES_FILE,
  type CorpusMeta,
  type RegistryReport,
  type ScriptUsageFixture,
  type UnexposedTypesFixture,
} from "./fixture.ts";
import { ACKNOWLEDGED_GAPS } from "./gaps.ts";
import {
  EVENT_FIELD_POLICY,
  MODIFIER_JOIN,
  RULES,
  SCOPE_INDEX,
  SCRIPT_VOCABULARY,
  SOURCES,
  UNEXPOSED_TYPES,
  type DeclaredType,
} from "./generator-sources.ts";
import { ACKNOWLEDGED_MISMATCHES } from "./observations.ts";

/** The usage root whose counts weigh event fields: `common/` writes `id` and `name` everywhere. */
const EVENT_FILES_ROOT = "events";

/** Types `vanilla.*` can reference without a registry to author them. */
const REFERENCEABLE_TYPES: ReadonlySet<string> = new Set(
  VANILLA_REF_EXTRAS.map((entry) => entry.type)
);

/** A committed fixture is missing or stale. The remedy is always `npm run corpus:extract`. */
export class CoverageInputError extends Error {}

/** The report over the real repository, with the join evidence tests read. */
export interface CoverageBuild extends Coverage {
  /** The script gap ledger reconciled with the emitters' skips, for tests that check the join. */
  readonly scriptGaps: ScriptGapReport;
}

function usageFromRoots(usage: ScriptUsageFixture, roots: readonly string[]): UsageOf {
  const tables = roots.map((root) => usage.counts[root] ?? {});
  return (key) => tables.reduce((total, table) => total + (table[key] ?? 0), 0);
}

function registryCoverageInput(report: RegistryReport): RegistryCoverageInput {
  return {
    registry: report.registry,
    emitted: report.measurement.emitted.map((field) => field.field),
    omissions: report.measurement.omissions,
    splices: report.measurement.splices,
    corpus: new Map(
      [...report.corpus.occurrences].map(([path, observation]) => [path, observation.definitions])
    ),
    acknowledged: ACKNOWLEDGED_GAPS.filter((row) => row.registry === report.registry),
    formMismatches: ACKNOWLEDGED_MISMATCHES.filter(
      (row) => row.registry === report.registry && row.kind === "form"
    ),
  };
}

function unexposedTypeInput(
  declared: DeclaredType,
  fixture: UnexposedTypesFixture
): UnexposedTypeInput {
  const recorded = fixture.types[declared.type.name]!;
  return {
    type: declared.type.name,
    path: declared.path,
    fields: declared.fields,
    referenceable: REFERENCEABLE_TYPES.has(declared.type.name),
    definitions: recorded.definitions,
    usage: new Map(Object.entries(recorded.fields)),
  };
}

function loadCorpusMeta(dir: string): CorpusMeta {
  const meta = loadMeta(dir);
  if (meta === null) {
    throw new CoverageInputError(
      `no committed ${FIXTURE_PATH}/${META_FILE} — run npm run corpus:extract first`
    );
  }
  return meta;
}

/** Every manifested registry with a committed fixture, or the missing ones by name. */
function assertRegistryFixtures(dir: string): void {
  const missing = MEASUREMENTS.filter(
    (measurement) => loadRegistryFixture(measurement.registry, dir) === null
  ).map((measurement) => measurement.registry);
  if (missing.length > 0) {
    throw new CoverageInputError(
      `no committed fixture for ${missing.join(", ")} under ${FIXTURE_PATH} — ` +
        "run npm run corpus:extract first"
    );
  }
}

/**
 * The committed unexposed-type fixture, checked against the declared types.
 *
 * @throws {Error} When the fixture records a manifested type: the two are
 *   contradictory, and neither the fixture nor the manifest can be right.
 */
function loadUnexposed(dir: string): UnexposedTypesFixture {
  const fixture = loadUnexposedTypes(dir);
  if (fixture === null) {
    throw new CoverageInputError(
      `no committed ${FIXTURE_PATH}/${UNEXPOSED_TYPES_FILE} — run npm run corpus:extract first`
    );
  }
  const recorded = new Set(Object.keys(fixture.types));
  const manifested = MEASUREMENTS.map((measurement) => measurement.registry).filter((registry) =>
    recorded.has(registry)
  );
  if (manifested.length > 0) {
    throw new Error(
      `${UNEXPOSED_TYPES_FILE} records ${manifested.join(", ")}, which the manifest exposes`
    );
  }
  const declared = new Set(UNEXPOSED_TYPES.map((one) => one.type.name));
  const stale = [
    ...[...declared].filter((name) => !recorded.has(name)).map((name) => `+${name}`),
    ...[...recorded].filter((name) => !declared.has(name)).map((name) => `-${name}`),
  ];
  if (stale.length > 0) {
    throw new CoverageInputError(
      `${FIXTURE_PATH}/${UNEXPOSED_TYPES_FILE} does not record the declared types ` +
        `(${stale.slice(0, 8).join(" ")}${stale.length > 8 ? ` +${stale.length - 8}` : ""}) — ` +
        "run npm run corpus:extract"
    );
  }
  return fixture;
}

function loadUsage(dir: string): ScriptUsageFixture {
  const usage = loadScriptUsage(dir);
  if (usage === null) {
    throw new CoverageInputError(
      `no committed ${FIXTURE_PATH}/${SCRIPT_USAGE_FILE} — run npm run corpus:extract first`
    );
  }
  if (usage.vocabulary.fingerprint !== SCRIPT_VOCABULARY.fingerprint) {
    throw new CoverageInputError(
      `${FIXTURE_PATH}/${SCRIPT_USAGE_FILE} was filtered to a vocabulary of ` +
        `${usage.vocabulary.size} keys that no longer matches the rules' ` +
        `${SCRIPT_VOCABULARY.keys.size} — run npm run corpus:extract`
    );
  }
  if (JSON.stringify(usage.roots) !== JSON.stringify(SCRIPT_USAGE_ROOTS)) {
    throw new CoverageInputError(
      `${FIXTURE_PATH}/${SCRIPT_USAGE_FILE} counts roots ${usage.roots.join(", ")}, not ` +
        `${SCRIPT_USAGE_ROOTS.join(", ")} — run npm run corpus:extract`
    );
  }
  return usage;
}

/**
 * Builds the report over the fixtures in `dir`.
 *
 * @throws {CoverageInputError} When a fixture is missing, was extracted
 *   against a different script vocabulary or set of declared types, or
 *   counts different roots.
 * @throws {Error} When the cwtools config submodule is not checked out: the
 *   header line reads its commit with `git rev-parse`. Run
 *   `git submodule update --init`.
 * @throws {Error} When an emitter's accounting contradicts the rules or a
 *   ledger row matches nothing; see {@link coverageOf}.
 */
export function buildCoverage(dir: string = FIXTURE_DIR): CoverageBuild {
  const meta = loadCorpusMeta(dir);
  assertRegistryFixtures(dir);
  const usage = loadUsage(dir);
  const unexposed = loadUnexposed(dir);
  const scriptUsage = usageFromRoots(usage, SCRIPT_USAGE_ROOTS);

  const emitter = new Emitter(RULES);
  const effectPolicy = createEffectPolicy(RULES);
  const scriptRules = emitScriptRules(
    RULES,
    SOURCES.docs,
    SOURCES.links,
    emitter,
    effectPolicy,
    scopeAuthorityOf(loadBaseline(), SCOPE_INDEX)
  );
  emitter.beginFile();
  const events = emitEvents(emitter, effectPolicy, scriptRules.effects.universalParameters);
  emitter.endFile();

  const coverage = coverageOf({
    triggers: {
      declared: RULES.triggers.keys(),
      emitted: scriptRules.triggers.references.map((row) => row.key),
      skipped: scriptRules.triggers.skipped,
    },
    effects: {
      declared: RULES.effects.keys(),
      // Every ordinary effect row records one fixed key; a row without one
      // would fail the accounting check by name.
      emitted: scriptRules.effects.references.flatMap((row) =>
        row.key === undefined ? [] : [row.key]
      ),
      skipped: scriptRules.effects.skipped,
    },
    fireSkips: events.skipped,
    scriptGaps: scriptRules.scriptGaps,
    modifiers: MODIFIER_JOIN,
    declaredLinks: RULES.links.keys(),
    links: scriptRules.classifiedLinks,
    eventFields: EVENT_FIELD_POLICY,
    ownership: handWrittenOwnership(effectPolicy),
    registries: committedRegistryReports(dir).map(registryCoverageInput),
    unexposedTypes: UNEXPOSED_TYPES.map((declared) => unexposedTypeInput(declared, unexposed)),
    scriptUsage,
    eventUsage: usageFromRoots(usage, [EVENT_FILES_ROOT]),
    // A link with a declared prefix (a value link, a data-driven link) is only
    // ever written in that form, and the counter credits the prefix.
    linkUsage: (key) => scriptUsage(RULES.links.get(key)?.prefix ?? key),
    provenance: {
      rulesCommit: readCwtCommit(CWT_REPOSITORY_DIRECTORY),
      gameVersion: meta.gameVersion,
      foldersWithoutType: Object.entries(unexposed.folders).map(([folder, counts]) => ({
        path: folder,
        definitions: counts.definitions,
      })),
    },
  });
  return { ...coverage, scriptGaps: scriptRules.scriptGaps };
}

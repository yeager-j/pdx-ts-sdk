/**
 * Assembles the syntax coverage report from the repository: the vendored
 * rules, a fresh run of the script emitters, and the committed fixtures.
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
import type { ScriptGapReport } from "@pdx-ts/codegen-cwt/policy/script-gaps";
import { readCwtCommit } from "@pdx-ts/codegen-cwt/provenance";
import { loadBaseline } from "@pdx-ts/codegen-cwt/reconcile/baseline";
import { scopeAuthorityOf } from "@pdx-ts/codegen-cwt/reconcile/scope-authority";
import { CWT_REPOSITORY_DIRECTORY } from "@pdx-ts/codegen-cwt/sources";

import {
  formatCoverageReport,
  sitesOfEffects,
  sitesOfEventFields,
  sitesOfModifiers,
  sitesOfRegistry,
  sitesOfScopeLinks,
  sitesOfTriggers,
  summarizeCoverage,
  type CoverageReport,
  type CoverageSurface,
  type RegistryCoverageInput,
  type UsageOf,
} from "./coverage/index.ts";
import {
  committedRegistryReports,
  FIXTURE_DIR,
  FIXTURE_PATH,
  loadMeta,
  loadScriptUsage,
  META_FILE,
  SCRIPT_USAGE_FILE,
  type RegistryReport,
  type ScriptUsageFixture,
} from "./fixture.ts";
import { ACKNOWLEDGED_GAPS } from "./gaps.ts";
import {
  EVENT_FIELD_POLICY,
  MODIFIER_JOIN,
  RULES,
  SCOPE_INDEX,
  SCRIPT_VOCABULARY,
  SOURCES,
} from "./generator-sources.ts";
import { ACKNOWLEDGED_MISMATCHES } from "./observations.ts";

/** The usage root whose counts weigh event fields: `common/` writes `id` and `name` everywhere. */
const EVENT_FILES_ROOT = "events";

/** A committed fixture is missing or stale. The remedy is always `npm run corpus:extract`. */
export class CoverageInputError extends Error {}

/** The report as data and as the lines `npm run coverage` prints. */
export interface CoverageBuild {
  readonly report: CoverageReport;
  readonly lines: readonly string[];
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
  if (!usage.roots.includes(EVENT_FILES_ROOT)) {
    throw new CoverageInputError(
      `${FIXTURE_PATH}/${SCRIPT_USAGE_FILE} has no ${EVENT_FILES_ROOT} root — run npm run corpus:extract`
    );
  }
  return usage;
}

/**
 * Builds the report over the fixtures in `dir`.
 *
 * @throws {CoverageInputError} When a fixture is missing or was extracted
 *   against a different script vocabulary.
 * @throws {Error} When an emitter's accounting contradicts the rules or a
 *   ledger row matches nothing; see the `sitesOf*` builders.
 */
export function buildCoverage(dir: string = FIXTURE_DIR): CoverageBuild {
  const meta = loadMeta(dir);
  if (meta === null) {
    throw new CoverageInputError(
      `no committed ${FIXTURE_PATH}/${META_FILE} — run npm run corpus:extract first`
    );
  }
  const usage = loadUsage(dir);
  const scriptUsage = usageFromRoots(usage, usage.roots);
  const eventUsage = usageFromRoots(usage, [EVENT_FILES_ROOT]);
  // A link with a declared prefix (a value link, a data-driven link) is only
  // ever written in that form, and the counter credits the prefix.
  const linkUsage: UsageOf = (key) => scriptUsage(RULES.links.get(key)?.prefix ?? key);

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

  const surfaces: CoverageSurface[] = [
    {
      id: "triggers",
      label: "triggers",
      sites: sitesOfTriggers(
        {
          declared: RULES.triggers.keys(),
          emitted: scriptRules.triggers.references.map((row) => row.key),
          skipped: scriptRules.triggers.skipped,
        },
        scriptRules.scriptGaps,
        scriptUsage
      ),
    },
    {
      id: "effects",
      label: "effects",
      sites: sitesOfEffects(
        {
          declared: RULES.effects.keys(),
          // Every ordinary effect row records one fixed key; a row without
          // one would fail the accounting check by name.
          emitted: scriptRules.effects.references.flatMap((row) =>
            row.key === undefined ? [] : [row.key]
          ),
          skipped: scriptRules.effects.skipped,
        },
        events.skipped,
        scriptRules.scriptGaps,
        scriptUsage
      ),
    },
    { id: "modifiers", label: "modifiers", sites: sitesOfModifiers(MODIFIER_JOIN, scriptUsage) },
    {
      id: "scope-links",
      label: "scope links",
      sites: sitesOfScopeLinks(RULES.links.keys(), scriptRules.classifiedLinks, linkUsage),
    },
    {
      id: "event-fields",
      label: "event fields",
      sites: sitesOfEventFields(EVENT_FIELD_POLICY, eventUsage),
    },
    ...committedRegistryReports(dir).map((report): CoverageSurface => ({
      id: `registry:${report.registry}`,
      label: report.registry,
      sites: sitesOfRegistry(registryCoverageInput(report)),
    })),
  ];
  const report = summarizeCoverage(surfaces);
  return {
    report,
    lines: formatCoverageReport(report, {
      rulesCommit: readCwtCommit(CWT_REPOSITORY_DIRECTORY),
      gameVersion: meta.gameVersion,
    }),
    scriptGaps: scriptRules.scriptGaps,
  };
}

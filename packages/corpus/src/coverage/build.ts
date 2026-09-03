/**
 * The coverage calculation: every surface's sites, the summary, and the
 * printed lines, from inputs that are all parameters.
 *
 * Nothing here reads a fixture, runs an emitter, or asks Git. The shell in
 * `coverage-inputs.ts` gathers those and calls {@link coverageOf}; a test
 * calls it with synthetic inputs.
 */

import type { ModifierJoin } from "@pdx-ts/codegen-cwt/emit/script/modifiers";
import type { LinkClassification } from "@pdx-ts/codegen-cwt/lower/links";
import type { SkippedRule } from "@pdx-ts/codegen-cwt/lower/script-shape";
import type { ScriptGapReport } from "@pdx-ts/codegen-cwt/policy/script-gaps";

import { sitesOfEventFields, type EventFieldPolicyTables } from "./event-fields.ts";
import { formatCoverageReport, type CoverageProvenance } from "./format.ts";
import type { CoverageSurface, HandWrittenOwnership, UsageOf } from "./model.ts";
import { sitesOfRegistry, type RegistryCoverageInput } from "./registries.ts";
import {
  sitesOfEffects,
  sitesOfModifiers,
  sitesOfScopeLinks,
  sitesOfTriggers,
  type ScriptRuleEmissionFacts,
} from "./script-surfaces.ts";
import { summarizeCoverage, type CoverageReport } from "./summary.ts";
import { sitesOfUnexposedType, type UnexposedTypeInput } from "./unexposed.ts";

/** The table row every unexposed type folds into. */
const UNEXPOSED_GROUP = "registries not exposed";

/** Everything the report is calculated from. Order within any list does not affect the result. */
export interface CoverageInputs {
  /** The trigger emitter's accounting, with every declared trigger key. */
  readonly triggers: ScriptRuleEmissionFacts;
  /** The effect emitter's accounting, with every declared effect key. */
  readonly effects: ScriptRuleEmissionFacts;
  /** The event emitter's skips (`emitEvents().skipped`): a fire effect it skipped has no typed method. */
  readonly fireSkips: readonly SkippedRule[];
  /** The script gap ledger reconciled with the emitters' skips; supplies issues to tracked gaps. */
  readonly scriptGaps: ScriptGapReport;
  /** Every modifier name joined with its scope evidence. */
  readonly modifiers: ModifierJoin;
  /** Every declared scope and value link key. */
  readonly declaredLinks: Iterable<string>;
  /** The link classification the link emitter reads. */
  readonly links: LinkClassification;
  /** The reviewed event and option field tables. */
  readonly eventFields: EventFieldPolicyTables;
  /** Which skipped surfaces a hand-written SDK module supplies. */
  readonly ownership: HandWrittenOwnership;
  /** One entry per exposed registry with a fixture. */
  readonly registries: readonly RegistryCoverageInput[];
  /** One entry per CWT type the manifest does not expose, with its fixture counts. */
  readonly unexposedTypes: readonly UnexposedTypeInput[];
  /** Occurrences of a trigger, effect, or modifier key across every usage root. */
  readonly scriptUsage: UsageOf;
  /** Occurrences of a bare event field key under `events/` alone. */
  readonly eventUsage: UsageOf;
  /** Occurrences of a link, credited to its declared prefix when it has one. */
  readonly linkUsage: UsageOf;
  /** What the header line cites and what the caveat line reports. */
  readonly provenance: CoverageProvenance;
}

/** The report as data and as the lines `npm run coverage` prints. */
export interface Coverage {
  /** The rows and remainders, in print order. */
  readonly report: CoverageReport;
  /** The printed report, one element per line; join with `\n`. */
  readonly lines: readonly string[];
}

function unexposedSurface(input: UnexposedTypeInput): CoverageSurface {
  return {
    id: `registry:${input.type}`,
    label: input.type,
    group: UNEXPOSED_GROUP,
    sites: sitesOfUnexposedType(input),
  };
}

/**
 * Calculates the report. Deterministic: the same inputs give the same lines,
 * whatever order their lists arrive in.
 *
 * @throws {Error} When an emitter's accounting contradicts the declared keys,
 *   a ledger row matches no site, or two surfaces share an id; see the
 *   `sitesOf*` builders and {@link summarizeCoverage}.
 */
export function coverageOf(inputs: CoverageInputs): Coverage {
  const surfaces: CoverageSurface[] = [
    {
      id: "triggers",
      label: "triggers",
      sites: sitesOfTriggers(
        inputs.triggers,
        inputs.scriptGaps,
        inputs.scriptUsage,
        inputs.ownership
      ),
    },
    {
      id: "effects",
      label: "effects",
      sites: sitesOfEffects(
        inputs.effects,
        inputs.fireSkips,
        inputs.scriptGaps,
        inputs.scriptUsage,
        inputs.ownership
      ),
    },
    {
      id: "modifiers",
      label: "modifiers",
      sites: sitesOfModifiers(inputs.modifiers, inputs.scriptUsage),
    },
    {
      id: "scope-links",
      label: "scope links",
      sites: sitesOfScopeLinks(
        inputs.declaredLinks,
        inputs.links,
        inputs.linkUsage,
        inputs.ownership
      ),
    },
    {
      id: "event-fields",
      label: "event fields",
      sites: sitesOfEventFields(inputs.eventFields, inputs.eventUsage),
    },
    ...inputs.registries.map((registry): CoverageSurface => ({
      id: `registry:${registry.registry}`,
      label: registry.registry,
      sites: sitesOfRegistry(registry),
    })),
    ...inputs.unexposedTypes.map(unexposedSurface),
  ];
  const report = summarizeCoverage(surfaces);
  return { report, lines: formatCoverageReport(report, inputs.provenance) };
}

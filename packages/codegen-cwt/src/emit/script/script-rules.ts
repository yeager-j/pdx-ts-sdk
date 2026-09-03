/**
 * The trigger, scope-link, and effect emissions, run as one unit.
 *
 * The three emitters share one order: scope links reserve the names the
 * trigger builders took, and the effect emitter reads the classified links.
 * Running them here keeps that order out of the pipeline shell, so a consumer
 * that only needs the emission facts (the coverage report) runs the same code
 * as `npm run codegen`.
 */

import { scopeIndex, type RuleSet } from "../../cwt/rules.ts";
import type { parseScopeLinks } from "../../logs/scopes.ts";
import type { parseTriggerDocs } from "../../logs/trigger-docs.ts";
import { classifyLinks, type LinkClassification } from "../../lower/links.ts";
import { lowerRuleTable } from "../../lower/lowered-rule.ts";
import type { EffectPolicy } from "../../policy/effects.ts";
import {
  formatScriptGapReport,
  reconcileScriptGaps,
  type ScriptGapReport,
  type ScriptGapReportLines,
} from "../../policy/script-gaps.ts";
import { RESERVED_TRIGGER_EXPORT_NAMES } from "../../policy/triggers.ts";
import type { ScopeAuthority } from "../../reconcile/scope-authority.ts";
import type { Emitter, Usage } from "../typescript.ts";
import { emitEffects, type EffectEmission } from "./effects.ts";
import { emitScopeLinks, type ScopeLinkEmission } from "./links.ts";
import { emitTriggers, type TriggerEmission } from "./triggers.ts";

/** Everything the trigger, scope-link, and effect emitters produced. */
export interface ScriptRuleEmission {
  /** The generated trigger builders and their skips. */
  readonly triggers: TriggerEmission;
  /** The symbols the trigger module uses. */
  readonly triggerUsage: Usage;
  /** The scope links, classified before emission. */
  readonly classifiedLinks: LinkClassification;
  /** The generated scope-link functions. */
  readonly scopeLinks: ScopeLinkEmission;
  /** The generated effect interfaces and their skips. */
  readonly effects: EffectEmission;
  /** The symbols the effect module uses. */
  readonly effectUsage: Usage;
  /** The trigger and effect skips reconciled with the gap ledger. */
  readonly scriptGaps: ScriptGapReport;
  /** {@link ScriptRuleEmission.scriptGaps} as report lines. */
  readonly scriptGapLines: ScriptGapReportLines;
}

/**
 * Emits triggers, scope links, and effects in their required order.
 *
 * The trigger and effect emissions each open and close their own file on
 * `emitter`; the caller must not be inside a file.
 *
 * @throws {Error} When the script gap ledger disagrees with the current skips.
 */
export function emitScriptRules(
  rules: RuleSet,
  docs: ReturnType<typeof parseTriggerDocs>,
  links: ReturnType<typeof parseScopeLinks>,
  emitter: Emitter,
  effectPolicy: EffectPolicy,
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
    scriptGaps,
    scriptGapLines: formatScriptGapReport(scriptGaps),
  };
}

/**
 * Sites of the four script surfaces: triggers, effects, scope links, and
 * modifiers.
 *
 * The trigger, effect, and link emitters put every declared key on exactly
 * one path: emitted, or skipped with a category. {@link sitesOfDeclaredKeys}
 * checks that accounting and turns it into sites, so a key the emitter loses
 * track of fails the report instead of vanishing from it.
 *
 * A script surface cannot report a used-but-undeclared site: a flat key count
 * cannot tell a trigger from a field. Only registries carry those.
 */

import type { ModifierJoin } from "@pdx-ts/codegen-cwt/emit/script/modifiers";
import type { LinkClassification } from "@pdx-ts/codegen-cwt/lower/links";
import type { SkippedRule } from "@pdx-ts/codegen-cwt/lower/script-shape";
import type { ScriptGapReport, ScriptRuleKind } from "@pdx-ts/codegen-cwt/policy/script-gaps";
import { compareUtf8 } from "@pdx-ts/sdk/internals";

import {
  HAND_WRITTEN_OWNERSHIP,
  siteClassOfSkip,
  type CoverageSite,
  type CoverageSurfaceId,
  type HandWrittenOwnership,
  type SiteClassification,
  type UsageOf,
} from "./model.ts";

/** What one script emitter reports about the keys it was given. */
export interface ScriptRuleEmissionFacts {
  /** Every rule key the rules declare on this surface. */
  readonly declared: Iterable<string>;
  /** The keys the emitter generated a builder for. */
  readonly emitted: Iterable<string>;
  /** The keys the emitter refused, one row per reason; a key may repeat. */
  readonly skipped: readonly SkippedRule[];
}

/** One key's skip rows, merged. */
interface SkipGroup {
  readonly category: SkippedRule["category"];
  readonly details: string[];
}

/** Groups skip rows by key. A key skipped under two categories is a contradiction. */
function groupSkips(
  surface: CoverageSurfaceId,
  skipped: readonly SkippedRule[]
): Map<string, SkipGroup> {
  const groups = new Map<string, SkipGroup>();
  for (const skip of skipped) {
    const group = groups.get(skip.name);
    if (group === undefined) {
      groups.set(skip.name, { category: skip.category, details: [skip.detail] });
    } else if (group.category !== skip.category) {
      throw new Error(
        `${surface} ${skip.name}: skipped as both ${group.category} and ${skip.category}`
      );
    } else {
      group.details.push(skip.detail);
    }
  }
  return groups;
}

/**
 * Turns one emitter's accounting into sites, one per declared key.
 *
 * @throws {Error} When a declared key is neither emitted nor skipped, when a
 *   key is both, when an emitted or skipped key is not declared, or when a
 *   key is skipped under two categories.
 */
export function sitesOfDeclaredKeys(
  surface: CoverageSurfaceId,
  facts: ScriptRuleEmissionFacts,
  classify: (skip: SkippedRule) => SiteClassification,
  usageOf: UsageOf
): CoverageSite[] {
  const declared = new Set(facts.declared);
  const emitted = new Set(facts.emitted);
  const skips = groupSkips(surface, facts.skipped);
  const problems = [
    ...[...declared]
      .filter((key) => !emitted.has(key) && !skips.has(key))
      .map((key) => `${key}: declared but neither emitted nor skipped`),
    ...[...emitted]
      .filter((key) => skips.has(key))
      .map((key) => `${key}: both emitted and skipped`),
    ...[...emitted]
      .filter((key) => !declared.has(key))
      .map((key) => `${key}: emitted but not declared`),
    ...[...skips.keys()]
      .filter((key) => !declared.has(key))
      .map((key) => `${key}: skipped but not declared`),
  ].sort(compareUtf8);
  if (problems.length > 0) {
    throw new Error(
      `${surface}: the emitter's accounting does not cover the rules:\n  ${problems.join("\n  ")}`
    );
  }
  return [...declared].sort(compareUtf8).map((key) => {
    const skip = skips.get(key);
    const classification: SiteClassification =
      skip === undefined
        ? { class: "authorable", reason: "generated from the rules" }
        : classify({ name: key, category: skip.category, detail: skip.details.join("; ") });
    return { surface, key, ...classification, used: usageOf(key) };
  });
}

/** Adds the ledger's issue and rationale to a gap the ledger tracks. */
function withTrackedGaps(
  kind: ScriptRuleKind,
  gaps: ScriptGapReport,
  classify: (skip: SkippedRule) => SiteClassification
): (skip: SkippedRule) => SiteClassification {
  const tracked = new Map(
    gaps.trackedGaps.filter((gap) => gap.kind === kind).map((gap) => [gap.name, gap])
  );
  return (skip) => {
    const classification = classify(skip);
    const row = tracked.get(skip.name);
    if (classification.class !== "gap" || row === undefined) {
      return classification;
    }
    return { class: "gap", reason: row.rationale, issue: row.issue };
  };
}

/** Sites of the trigger surface. Emitted keys are `TriggerEmission.references[].key`. */
export function sitesOfTriggers(
  facts: ScriptRuleEmissionFacts,
  gaps: ScriptGapReport,
  usageOf: UsageOf,
  ownership: HandWrittenOwnership = HAND_WRITTEN_OWNERSHIP
): CoverageSite[] {
  return sitesOfDeclaredKeys(
    "triggers",
    facts,
    withTrackedGaps("trigger", gaps, (skip) => siteClassOfSkip(skip, ownership)),
    usageOf
  );
}

/** The event-emitter skips that mean a fire effect has no typed method. */
const FIRE_SKIP_CATEGORIES = new Set<SkippedRule["category"]>([
  "missing-fire-rule-scope",
  "event-policy-rejected",
]);

/**
 * Sites of the effect surface. An `event-fire-effect` skip is policy-owned
 * only while the event emitter typed its fire method; `fireSkips` (from
 * `emitEvents().skipped`) names the keys it did not, which are gaps.
 */
export function sitesOfEffects(
  facts: ScriptRuleEmissionFacts,
  fireSkips: readonly SkippedRule[],
  gaps: ScriptGapReport,
  usageOf: UsageOf,
  ownership: HandWrittenOwnership = HAND_WRITTEN_OWNERSHIP
): CoverageSite[] {
  const untypedFires = new Map(
    fireSkips
      .filter((skip) => FIRE_SKIP_CATEGORIES.has(skip.category))
      .map((skip) => [skip.name, skip])
  );
  const classify = (skip: SkippedRule): SiteClassification => {
    const fire = skip.category === "event-fire-effect" ? untypedFires.get(skip.name) : undefined;
    return fire === undefined
      ? siteClassOfSkip(skip, ownership)
      : { class: "gap", reason: `no typed fire method: ${fire.detail}` };
  };
  return sitesOfDeclaredKeys("effects", facts, withTrackedGaps("effect", gaps, classify), usageOf);
}

/** Sites of the scope-link surface, from the classification the link emitter reads. */
export function sitesOfScopeLinks(
  declared: Iterable<string>,
  classification: LinkClassification,
  usageOf: UsageOf,
  ownership: HandWrittenOwnership = HAND_WRITTEN_OWNERSHIP
): CoverageSite[] {
  return sitesOfDeclaredKeys(
    "scope-links",
    {
      declared,
      emitted: classification.links.map((link) => link.key),
      skipped: classification.skipped,
    },
    (skip) => siteClassOfSkip(skip, ownership),
    usageOf
  );
}

/**
 * Sites of the modifier surface. A name with scope evidence is authorable;
 * a name the category table reached no scope for is a gap, gated as drift in
 * `drift-baseline.json` and tracked by no issue.
 *
 * @throws {Error} When a name appears in two partitions of the join.
 */
export function sitesOfModifiers(join: ModifierJoin, usageOf: UsageOf): CoverageSite[] {
  const sites = new Map<string, CoverageSite>();
  const add = (name: string, classification: SiteClassification): void => {
    if (sites.has(name)) {
      throw new Error(`modifiers ${name}: joined into two scope partitions`);
    }
    sites.set(name, { surface: "modifiers", key: name, ...classification, used: usageOf(name) });
  };
  for (const name of [...join.universal, ...[...join.groups.values()].flat()]) {
    add(name, { class: "authorable", reason: "scope evidence in modifier categories" });
  }
  for (const name of join.unscoped) {
    add(name, { class: "gap", reason: "no scope evidence in modifier categories (drift-gated)" });
  }
  return [...sites.values()].sort((a, b) => compareUtf8(a.key, b.key));
}

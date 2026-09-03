/**
 * The vocabulary of the syntax coverage report, and the one place a skipped
 * script rule is classified.
 *
 * A site is one unit of the game's script syntax the rules declare: a trigger
 * key, an effect key, a modifier name, a scope link, an event field, or a
 * registry field path. Every site has exactly one class. Coverage is the
 * share of sites an author can write: `authorable` plus `policy-owned`, over
 * every site that is not `removed`.
 */

import type {
  ScriptGenerationSkipCategory,
  SkippedRule,
} from "@pdx-ts/codegen-cwt/lower/script-shape";
import type { EffectPolicy } from "@pdx-ts/codegen-cwt/policy/effects";
import { HAND_WRITTEN_TRIGGER_EXPORTS } from "@pdx-ts/codegen-cwt/policy/triggers";

/**
 * What the SDK can do with one site.
 *
 * - `authorable`: generated from the rules.
 * - `policy-owned`: hand-written; expressible, outside the generator.
 * - `declined`: expressible, kept out of the surface on purpose (`CONTENT_DECLINED_FIELDS`).
 * - `partial`: some declared forms are dropped.
 * - `gap`: not expressible. Carries the Linear issue when a ledger tracks it.
 * - `removed`: the rules declare it removed from the game (`## api_status = removed`).
 */
export type CoverageClass =
  "authorable" | "policy-owned" | "declined" | "partial" | "gap" | "removed";

/** Every class, in the order the report's columns print them. */
export const COVERAGE_CLASSES: readonly CoverageClass[] = [
  "authorable",
  "policy-owned",
  "declined",
  "partial",
  "gap",
  "removed",
];

/** The classes an author can write. */
export const EXPRESSIBLE_CLASSES: ReadonlySet<CoverageClass> = new Set<CoverageClass>([
  "authorable",
  "policy-owned",
]);

/** Which surface a site belongs to. Registries are one surface each. */
export type CoverageSurfaceId =
  "triggers" | "effects" | "modifiers" | "scope-links" | "event-fields" | `registry:${string}`;

/** One classified unit of syntax. */
export interface CoverageSite {
  readonly surface: CoverageSurfaceId;
  /** The rule key, or the registry field's dotted corpus path. */
  readonly key: string;
  readonly class: CoverageClass;
  /** Why the site has its class, in the words of the source that decided it. */
  readonly reason: string;
  /** The Linear issue that owns closing a tracked gap. */
  readonly issue?: string;
  /** The declared forms a `partial` site drops. */
  readonly droppedArms?: readonly string[];
  /**
   * Vanilla occurrence count: key occurrences for script surfaces,
   * definitions for registry fields. Zero when vanilla never writes it.
   */
  readonly used: number;
}

/** One surface's sites, sorted by key. */
export interface CoverageSurface {
  readonly id: CoverageSurfaceId;
  /** The name the report prints. */
  readonly label: string;
  readonly sites: readonly CoverageSite[];
  /**
   * The table row this surface is folded into instead of printing its own.
   * Its remainder still prints under its own label.
   */
  readonly group?: string;
}

/** Looks up the vanilla occurrence count of one key. Returns zero for an unknown key. */
export type UsageOf = (key: string) => number;

/** A class and its reason, before the ledger join adds an issue. */
export interface SiteClassification {
  readonly class: CoverageClass;
  readonly reason: string;
  readonly issue?: string;
}

/** Which skipped script surfaces a hand-written SDK module supplies instead, and which it does not. */
export interface HandWrittenOwnership {
  /** Scope or value link key to the reason the SDK owns it. */
  readonly links: ReadonlyMap<string, string>;
  /** Structural effect keys the policy owns but nothing writes (`EffectPolicy.unsupportedStructuralKeys`). */
  readonly unsupportedStructuralEffects: ReadonlySet<string>;
}

/**
 * The links the generator skips and the SDK writes by hand: the polymorphic
 * links in `HAND_WRITTEN_TRIGGER_EXPORTS`, and the two value links an author
 * writes as a `ScriptValue` string.
 */
export const HAND_WRITTEN_LINKS: ReadonlyMap<string, string> = new Map([
  ...HAND_WRITTEN_TRIGGER_EXPORTS.filter((entry) => entry.kind === "polymorphic-scope-link").map(
    (entry): [string, string] => [
      entry.exportName,
      `hand-written in packages/sdk/src/script/triggers.ts: ${entry.reason}`,
    ]
  ),
  [
    "script_value",
    "written as `value:<script_value>` through ScriptValue (packages/sdk/src/script/trigger-core.ts)",
  ],
  [
    "trigger",
    "written as `trigger:<name>` through ScriptValue (packages/sdk/src/script/trigger-core.ts)",
  ],
]);

/** The ownership every real report uses: the hand-written links, and the effect policy's answer on structural keys. */
export function handWrittenOwnership(effectPolicy: EffectPolicy): HandWrittenOwnership {
  return {
    links: HAND_WRITTEN_LINKS,
    unsupportedStructuralEffects: effectPolicy.unsupportedStructuralKeys,
  };
}

/**
 * Classifies one skipped trigger, effect, or link: one dispatch over the
 * skip's category.
 *
 * Every generator-limitation category is a `gap` with the skip's detail as
 * its reason; the ledger join that adds an issue happens in the surface
 * builders. `abstract-placeholder` is policy-owned because the SDK binds
 * scripted triggers and effects by hand (`packages/sdk/src/script/scripted.ts`).
 *
 * A `structural-effect` skip is policy-owned only while an author can write
 * the key: the policy gives it a method, or names the method whose chain
 * records it. A structural key the policy marks unsupported (`switch`,
 * `inverted_switch`) is a gap here. The script gap ledger disagrees on
 * purpose: SDK-242 keeps every structural key under `effect-policy.ts`
 * ownership and forbids policy categories in the ledger, so the codegen
 * report lists them as policy-owned. Coverage asks a different question, what
 * an author can write, and these two keys nobody can.
 *
 * A `value-link` or `polymorphic-output-scope` skip is policy-owned when
 * `ownership.links` names a hand-written surface for the key; otherwise it
 * is a gap.
 *
 * @throws {Error} On an event-kind category, which names no rule.
 */
export function siteClassOfSkip(
  skip: SkippedRule,
  ownership: HandWrittenOwnership
): SiteClassification {
  switch (skip.category) {
    case "scopeless-event-kind":
    case "missing-fire-rule-scope":
    case "event-policy-rejected":
      throw new Error(`${skip.name}: ${skip.category} describes an event kind, not a rule site`);
    case "removed-api":
      return { class: "removed", reason: skip.detail };
    case "abstract-placeholder":
      return {
        class: "policy-owned",
        reason: `${skip.detail}; bound by hand in packages/sdk/src/script/scripted.ts`,
      };
    case "handwritten-trigger":
    case "event-fire-effect":
      return { class: "policy-owned", reason: skip.detail };
    case "structural-effect":
      return ownership.unsupportedStructuralEffects.has(skip.name)
        ? { class: "gap", reason: skip.detail }
        : { class: "policy-owned", reason: skip.detail };
    case "value-link":
    case "polymorphic-output-scope": {
      const owner = ownership.links.get(skip.name);
      return owner === undefined
        ? { class: "gap", reason: skip.detail }
        : { class: "policy-owned", reason: owner };
    }
    case "data-link":
    case "missing-output-scope":
    case "unknown-output-scope":
    case "unknown-input-scope":
      return { class: "gap", reason: skip.detail };
    default: {
      // Every remaining category is a generator limitation. The annotation
      // fails to compile when a new non-generation category is added above.
      const generation: ScriptGenerationSkipCategory = skip.category;
      return { class: "gap", reason: skip.detail };
    }
  }
}

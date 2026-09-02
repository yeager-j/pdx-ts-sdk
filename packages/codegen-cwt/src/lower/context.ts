/** The semantic services lowering uses without depending on TypeScript emission. */

import type { RuleType } from "../cwt/model.ts";
import type { RuleSet } from "../cwt/rules.ts";
import type { LoweredValue } from "./value.ts";

/**
 * Run-scoped source interpretation used by content and script lowering.
 */
export interface LoweringContext {
  /** Parsed CWT rules available to semantic classifiers. */
  readonly rules: RuleSet;
  /** Scope groups selected by semantic lowering. */
  readonly usedScopeGroups: Set<string>;
  /** Resolves a scope alias to its canonical name. */
  canonicalScope(name: string): string | null;
  /** Resolves a declared scope group. */
  scopeGroup(name: string): readonly string[] | null;
  /** Lowers one scalar rule type. */
  valueFor(type: RuleType, inLocalisationUnion?: boolean): LoweredValue | null;
  /** Lowers an overloaded scalar rule type. */
  unionFor(types: readonly RuleType[]): LoweredValue | null;
}

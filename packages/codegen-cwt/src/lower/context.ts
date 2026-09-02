/** The semantic services lowering uses without depending on TypeScript emission. */

import type { RuleType } from "../cwt/model.ts";
import type { RuleSet } from "../cwt/rules.ts";
import type { OverlayAudit } from "../overlay/audit.ts";
import type { LoweredValue } from "./value.ts";

/**
 * Run-scoped source interpretation used by content and script lowering.
 * Emission may implement this interface, but lowering never imports the adapter.
 */
export interface LoweringContext {
  /** Parsed CWT rules available to semantic classifiers. */
  readonly rules: RuleSet;
  /** Overlay rows consumed during this run. */
  readonly overlayAudit: OverlayAudit;
  /** Scope names used by rules but absent from `scopes.cwt`. */
  readonly unknownScopes: Set<string>;
  /** Missing or invalid scope groups encountered during lowering. */
  readonly unknownScopeGroups: Set<string>;
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

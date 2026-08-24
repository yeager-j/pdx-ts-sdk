import {
  linkedAvailability,
  scopePagesByScope,
  scopeTarget,
  type ReferenceAvailability,
  type ScopeLinkTarget,
  type ScopePageLink,
} from "./reference-index.ts";
import {
  assertSources,
  DEFAULT_SOURCES,
  summaryOf,
  type ScopeReferenceSources,
} from "./scope-reference.ts";

/** One generated trigger builder in the trigger-first reference. */
export interface TriggersIndexEntry {
  /** Public TypeScript builder name. */
  readonly method: string;
  /** Stable `triggers-<method>` deep-link target. */
  readonly anchor: string;
  /** Fixed PDXScript key recorded by the builder. */
  readonly key: string;
  /** Exact generated TypeScript call signature. */
  readonly signature: string;
  /** Generated game-description summary. */
  readonly summary: string;
  /** Scopes where the trigger key is legal. */
  readonly availability: ReferenceAvailability;
}

/** Complete trigger-first reference model. */
export interface TriggersIndexModel {
  /** One entry for every generated trigger builder. */
  readonly entries: readonly TriggersIndexEntry[];
  /** Shared link list for universally available builders. */
  readonly scopePages: readonly ScopeLinkTarget[];
}

/** Returns the stable anchor for a generated trigger builder. */
export function triggerAnchor(method: string): string {
  return `triggers-${method}`;
}

/** Builds the complete trigger-first reference from generated SDK metadata. */
export function buildTriggersIndex(
  scopePages: readonly ScopePageLink[],
  sources: ScopeReferenceSources = DEFAULT_SOURCES
): TriggersIndexModel {
  assertSources(sources);
  const pages = scopePagesByScope(scopePages, sources.scopes);
  const entries = sources.triggers
    .map((reference): TriggersIndexEntry => ({
      method: reference.method,
      anchor: triggerAnchor(reference.method),
      key: reference.key,
      signature: reference.signature,
      summary: summaryOf(reference.docs),
      availability: linkedAvailability(reference.availability, pages),
    }))
    .sort((left, right) => left.method.localeCompare(right.method));

  return {
    entries,
    scopePages: sources.scopes
      .filter((scope) => pages.has(scope))
      .map((scope) => scopeTarget(scope, pages)),
  };
}

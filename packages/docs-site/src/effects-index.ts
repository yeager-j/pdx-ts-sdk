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

/**
 * The effects-first index: one entry per generated script method, the
 * complement of the scope pages' scope-first view.
 *
 * The scope pages answer "what can I call here"; this answers "what does this
 * method write, and where is it legal". Both read the same generated rows, so
 * the index is a 1:1 map of `sources.effects` — completeness is by
 * construction rather than by a count anyone maintains.
 */

export type EffectCategory = "effect" | "structural" | "event-fire";

/** A scope named by an entry, linked when the site publishes its page. */
export type { ScopeLinkTarget, ScopePageLink } from "./reference-index.ts";

/**
 * Universal and scoped availability are structurally different, not one list
 * that happens to hold every scope: a reader can never mistake a long scope
 * list for universality, and a universal entry never has to be re-checked
 * when a scope is added.
 */
export type EffectAvailability = ReferenceAvailability;

export interface EffectsIndexEntry {
  readonly method: string;
  /** `effects-<method>`; methods are unique, which `assertSources` enforces. */
  readonly anchor: string;
  /** Absent when the method writes no fixed PDXScript key. */
  readonly key?: string;
  readonly category: EffectCategory;
  readonly signature: string;
  readonly summary: string;
  readonly availability: EffectAvailability;
  /** Event-fire entries only: the scope the fired event's body runs in. */
  readonly eventBodyScope?: ScopeLinkTarget;
}

export interface EffectsIndexModel {
  readonly entries: readonly EffectsIndexEntry[];
  /** One shared link list for methods whose availability is universal. */
  readonly scopePages: readonly ScopeLinkTarget[];
  readonly counts: {
    readonly effect: number;
    readonly structural: number;
    readonly eventFire: number;
  };
}

export function effectAnchor(method: string): string {
  return `effects-${method}`;
}

/**
 * Where a fired event's body runs, read off the generated event kind the fire
 * method names. It is a join, not a reconstruction: a fire row whose key names
 * no event kind, or names a scopeless one, is a generator defect rather than
 * something to guess around.
 */
function eventBodyScopeOf(
  method: string,
  key: string | undefined,
  pages: ReadonlyMap<string, ScopePageLink>,
  sources: ScopeReferenceSources
): ScopeLinkTarget {
  if (key === undefined) {
    throw new Error(
      `Event-fire method "${method}" has no PDXScript key, so its event kind cannot be resolved.`
    );
  }
  const eventKind = sources.eventKinds[key];
  if (eventKind === undefined) {
    throw new Error(
      `Event-fire method "${method}" names missing event kind "${key}". Run \`npm run codegen\` if the SDK output is stale.`
    );
  }
  if (eventKind.scope === null) {
    throw new Error(
      `Event kind "${key}" fired by "${method}" is scopeless, so the index cannot state where its body runs.`
    );
  }
  return scopeTarget(eventKind.scope, pages);
}

export function buildEffectsIndex(
  scopePages: readonly ScopePageLink[],
  sources: ScopeReferenceSources = DEFAULT_SOURCES
): EffectsIndexModel {
  assertSources(sources);
  const pages = scopePagesByScope(scopePages, sources.scopes);

  const entries = sources.effects
    .map((reference): EffectsIndexEntry => {
      const availability = linkedAvailability(reference.availability, pages);
      return {
        method: reference.method,
        anchor: effectAnchor(reference.method),
        ...(reference.key === undefined ? {} : { key: reference.key }),
        category: reference.kind,
        signature: reference.signature,
        summary: summaryOf(reference.docs),
        availability,
        ...(reference.kind === "event-fire"
          ? {
              eventBodyScope: eventBodyScopeOf(reference.method, reference.key, pages, sources),
            }
          : {}),
      };
    })
    .sort((left, right) => left.method.localeCompare(right.method));

  const countOf = (category: EffectCategory): number =>
    entries.filter((entry) => entry.category === category).length;

  return {
    entries,
    scopePages: sources.scopes
      .filter((scope) => pages.has(scope))
      .map((scope) => scopeTarget(scope, pages)),
    counts: {
      effect: countOf("effect"),
      structural: countOf("structural"),
      eventFire: countOf("event-fire"),
    },
  };
}

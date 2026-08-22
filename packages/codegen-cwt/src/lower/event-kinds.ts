import { scopeIndex, type RuleSet } from "../cwt/rules.ts";

/** One concrete event subtype and the scope its body runs in. */
export interface EventKindSpec {
  /** The PDXScript key that introduces this event kind. */
  readonly key: string;
  /** The CWT event subtype selected by the key. */
  readonly subtype: string;
  /** The canonical event scope, or `null` for a scopeless kind. */
  readonly scope: string | null;
}

/**
 * Derives concrete event kinds from the event type's positive key filters.
 * The result is sorted by PDXScript key for deterministic generation.
 */
export function eventKinds(rules: RuleSet): readonly EventKindSpec[] {
  const type = rules.contentTypes.get("event");
  if (type === undefined) {
    throw new Error("events/events.cwt no longer declares type[event]");
  }

  const scopes = scopeIndex(rules);
  const kinds: EventKindSpec[] = [];
  for (const subtype of type.subtypes) {
    const filter = subtype.keyFilter;
    // A negated filter names the key an event kind is not written under, so it
    // does not name the kind. None of events.cwt's do.
    if (subtype.group !== "event_type" || filter === null || filter.negated) {
      continue;
    }
    const pushed = subtype.pushScope;
    const scope = pushed === null || pushed === "any" ? null : scopes.get(pushed.toLowerCase());
    if (pushed !== null && pushed !== "any" && scope === undefined) {
      throw new Error(`event subtype ${subtype.name} pushes unknown scope ${pushed}`);
    }
    kinds.push({ key: filter.key, subtype: subtype.name, scope: scope ?? null });
  }
  return kinds.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

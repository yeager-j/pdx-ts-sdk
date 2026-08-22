import { scopeIndex, type RuleSet } from "../cwt/rules.ts";

export interface EventKindSpec {
  readonly key: string;
  readonly subtype: string;
  readonly scope: string | null;
}

export function eventKinds(rules: RuleSet): readonly EventKindSpec[] {
  const type = rules.contentTypes.get("event");
  if (type === undefined) {
    throw new Error("events/events.cwt no longer declares type[event]");
  }

  const scopes = scopeIndex(rules);
  return type.subtypes
    .filter(
      // A negated filter names the key an event kind is *not* written under, so
      // it does not name the kind. None of events.cwt's do.
      (subtype) =>
        subtype.group === "event_type" && subtype.keyFilter !== null && !subtype.keyFilter.negated
    )
    .map((subtype) => {
      const pushed = subtype.pushScope;
      const scope = pushed === null || pushed === "any" ? null : scopes.get(pushed.toLowerCase());
      if (pushed !== null && pushed !== "any" && scope === undefined) {
        throw new Error(`event subtype ${subtype.name} pushes unknown scope ${pushed}`);
      }
      return { key: subtype.keyFilter!.key, subtype: subtype.name, scope: scope ?? null };
    })
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

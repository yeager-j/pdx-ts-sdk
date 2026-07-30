/**
 * Emits the event-kind table.
 *
 * `type[event]` in `events/events.cwt` declares one `event_type` subtype per
 * event kind, each carrying `## type_key_filter = country_event` and
 * `## push_scope = country` — so which kinds exist and which scope each runs
 * in falls out of the rules rather than a hand-maintained table. The runtime
 * (`src/effect-core.ts`) registers a fire-effect encoder per kind from this
 * table, and `src/events.ts` builds the typed definition surface over it.
 */

import { docComment } from "../naming.ts";
import { Emitter } from "./types.ts";

export interface EventsEmission {
  readonly code: string;
  readonly kinds: number;
}

export function emitEvents(emitter: Emitter): EventsEmission {
  const type = emitter.rules.contentTypes.get("event");
  if (type === undefined) {
    throw new Error("events/events.cwt no longer declares type[event]");
  }
  const kinds = type.subtypes
    .filter((subtype) => subtype.group === "event_type" && subtype.keyFilter !== null)
    .map((subtype) => {
      const pushed = subtype.pushScope;
      const scope = pushed === null || pushed === "any" ? null : emitter.canonicalScope(pushed);
      if (pushed !== null && pushed !== "any" && scope === null) {
        throw new Error(`event subtype ${subtype.name} pushes unknown scope ${pushed}`);
      }
      return { key: subtype.keyFilter!, subtype: subtype.name, scope };
    })
    .sort((left, right) => left.key.localeCompare(right.key));

  const entries = kinds
    .map(
      (kind) =>
        `  ${kind.key}: { key: ${JSON.stringify(kind.key)}, subtype: ${JSON.stringify(kind.subtype)}, scope: ${kind.scope === null ? "null" : JSON.stringify(kind.scope)} },\n`
    )
    .join("");

  const code =
    "export interface EventKind {\n" +
    "  readonly key: string;\n" +
    "  readonly subtype: string;\n" +
    "  /** The event's main scope; null for scopeless events. */\n" +
    "  readonly scope: ScopeName | null;\n" +
    "}\n\n" +
    docComment([
      "Every event kind the game declares, from `type[event]`'s subtypes:",
      "script key, subtype name, and the scope the event's body runs in.",
    ]) +
    "export const EVENT_KINDS = {\n" +
    entries +
    "} as const satisfies Record<string, EventKind>;\n\n" +
    "export type EventKindKey = keyof typeof EVENT_KINDS;\n";

  return { code, kinds: kinds.length };
}

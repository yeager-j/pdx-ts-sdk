/**
 * Sites of the event-field surface: the keys of an event body and of an
 * event option, as the reviewed event field policy disposes of them.
 *
 * Both tables declare `trigger` and `custom_gui`, so keys carry their table
 * as a prefix: `event.trigger`, `option.trigger`. Usage is looked up by the
 * bare key, and the caller passes counts from `events/` alone: `id`, `name`,
 * and `trigger` are everywhere in `common/` too.
 */

import type { EventFieldPolicyEntry } from "@pdx-ts/codegen-cwt/policy/event-fields";
import { compareUtf8 } from "@pdx-ts/sdk/internals";

import type { CoverageSite, SiteClassification, UsageOf } from "./model.ts";

/** The reviewed policy for both event tables. */
export interface EventFieldPolicyTables {
  readonly event: readonly EventFieldPolicyEntry[];
  readonly option: readonly EventFieldPolicyEntry[];
}

function classificationOf(entry: EventFieldPolicyEntry): SiteClassification {
  switch (entry.disposition) {
    case "supported":
      return { class: "policy-owned", reason: entry.reason };
    case "partial":
      return { class: "partial", reason: entry.reason };
    case "unsupported":
      return { class: "gap", reason: entry.reason };
  }
}

/**
 * One site per non-synthetic policy entry. A synthetic entry is the option
 * block's `alias_name[effect]` splice, which is not a declared key.
 */
export function sitesOfEventFields(
  policy: EventFieldPolicyTables,
  usageOf: UsageOf
): CoverageSite[] {
  const tables = [
    ["event", policy.event],
    ["option", policy.option],
  ] as const;
  return tables
    .flatMap(([table, entries]) =>
      entries
        .filter((entry) => entry.synthetic !== true)
        .map((entry): CoverageSite => ({
          surface: "event-fields",
          key: `${table}.${entry.scriptKey}`,
          ...classificationOf(entry),
          ...(entry.disposition === "partial" ? { droppedArms: entry.unsupportedForms ?? [] } : {}),
          used: usageOf(entry.scriptKey),
        }))
    )
    .sort((a, b) => compareUtf8(a.key, b.key));
}

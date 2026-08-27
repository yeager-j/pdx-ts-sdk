import { kv, type PdxEntry } from "@pdx-ts/pdxscript";

import { OnActionAuthoring, onActionContributionKey } from "../events/on-actions.ts";
import type { EventItemBase } from "../events/types.ts";
import { compareUtf8, type LogicalPath } from "../ordering.ts";
import { emissionPath } from "./compile-content.ts";
import { noteStem, type BuildSession } from "./compile-session.ts";
import { immutableSet } from "./freeze.ts";
import { registerLocalization } from "./localization.ts";
import type { EmittedFile } from "./model.ts";

/** Event, on-action, and contribution products emitted by their compiler phase. */
export interface CompiledEvents {
  readonly eventFiles: readonly EmittedFile[];
  readonly orderedEvents: readonly EventItemBase[];
  readonly eventIds: ReadonlySet<string>;
  readonly onActions: PdxEntry[];
  readonly onActionStems: ReadonlySet<string>;
  readonly shipOfSizeLimits: ReadonlySet<string>;
  readonly contributionStems: ReadonlySet<string>;
}

/** Compiles events, on-actions, and shared contributions in their required order. */
export function compileEvents(session: BuildSession): CompiledEvents {
  const placedEvents = session.flat.filter(
    (placed): placed is { item: EventItemBase; stem: string | undefined } =>
      placed.item.itemKind === "event"
  );
  const eventStem = new Map(placedEvents.map(({ item, stem }) => [item, stem] as const));
  const eventGroups = groupEvents(session, placedEvents);
  const orderedEvents = eventGroups.flatMap((group) => group.events);
  const eventIds = registerEvents(session, eventGroups, eventStem);
  const eventFiles = eventGroups.map((group) => ({
    relPath: group.relPath,
    entries: [kv("namespace", group.namespace), ...group.events.map((event) => event.entry)],
  }));
  const { onActions, onActionStems } = compileOnActions(session, placedEvents);
  const { shipOfSizeLimits, contributionStems } = compileContributions(session);

  return {
    eventFiles,
    orderedEvents,
    eventIds,
    onActions,
    onActionStems,
    shipOfSizeLimits,
    contributionStems,
  };
}

interface EventGroup {
  readonly relPath: LogicalPath;
  readonly namespace: string;
  readonly events: readonly EventItemBase[];
}

function eventNumber(event: EventItemBase, namespace: string): number {
  return Number(event.id.slice(namespace.length + 1));
}

function groupEvents(
  session: BuildSession,
  placedEvents: readonly { item: EventItemBase; stem: string | undefined }[]
): EventGroup[] {
  const eventsByPath = new Map<LogicalPath, { namespace: string; events: EventItemBase[] }>();
  for (const { item, stem } of placedEvents) {
    const relPath = emissionPath(session.config.prefix, "events", stem ?? "events", ".txt");
    noteStem(session, relPath, stem);
    const group = eventsByPath.get(relPath);
    if (group === undefined) {
      eventsByPath.set(relPath, { namespace: item.namespace, events: [item] });
    } else if (group.namespace !== item.namespace) {
      throw new Error(
        `event file ${relPath} would mix namespaces "${group.namespace}" and ` +
          `"${item.namespace}" — one namespace per file; give each namespace its own file stem`
      );
    } else {
      group.events.push(item);
    }
  }

  assertOneStemPerNamespace(placedEvents);
  return [...eventsByPath]
    .sort(([a], [b]) => compareUtf8(a, b))
    .map(([relPath, group]) => ({
      relPath,
      namespace: group.namespace,
      events: [...group.events].sort(
        (a, b) => eventNumber(a, group.namespace) - eventNumber(b, group.namespace)
      ),
    }));
}

function assertOneStemPerNamespace(
  placedEvents: readonly { item: EventItemBase; stem: string | undefined }[]
): void {
  const stemsByNamespace = new Map<string, Set<string>>();
  for (const { item, stem } of placedEvents) {
    const stems = stemsByNamespace.get(item.namespace) ?? new Set<string>();
    stems.add(stem ?? "events");
    stemsByNamespace.set(item.namespace, stems);
  }
  for (const [namespace, stems] of stemsByNamespace) {
    if (stems.size <= 1) {
      continue;
    }
    const listed = [...stems].sort(compareUtf8).map((stem) => `"${stem}"`);
    throw new Error(
      `event namespace "${namespace}" is split across file stems ` +
        `${listed.slice(0, -1).join(", ")} and ${listed.at(-1)} — one file per namespace; ` +
        `give each namespace its own file stem`
    );
  }
}

function registerEvents(
  session: BuildSession,
  eventGroups: readonly EventGroup[],
  eventStem: ReadonlyMap<EventItemBase, string | undefined>
): Set<string> {
  const eventIds = new Set<string>();
  const namespaces: string[] = [];
  for (const group of eventGroups) {
    for (const item of group.events) {
      if (eventIds.has(item.id)) {
        throw new Error(`Duplicate event id "${item.id}"`);
      }
      eventIds.add(item.id);
      for (const use of item.refs) {
        session.refUses.push({ owner: `event "${item.id}"`, use });
      }
      registerLocalization(
        session.localization,
        { layer: "ordinary", stem: eventStem.get(item) },
        item.locEntries
      );
      session.warnings.push(...item.warnings);
      if (!namespaces.includes(item.namespace)) {
        namespaces.push(item.namespace);
      }
    }
  }
  for (const namespace of namespaces) {
    if (namespace !== session.config.prefix && !namespace.startsWith(`${session.config.prefix}_`)) {
      session.warnings.push({
        code: "missing-prefix",
        message:
          `event namespace "${namespace}" should be the mod prefix "${session.config.prefix}" or ` +
          `start with "${session.config.prefix}_" so its event ids cannot collide with vanilla ` +
          `or other mods`,
      });
    }
  }
  return eventIds;
}

function compileOnActions(
  session: BuildSession,
  placedEvents: readonly { item: EventItemBase; stem: string | undefined }[]
): { onActions: PdxEntry[]; onActionStems: ReadonlySet<string> } {
  const onActionAuthoring = new OnActionAuthoring(
    session.config.prefix,
    placedEvents.map(({ item }) => item)
  );
  const onActionStems = new Set<string>();
  const bindings = session.flat.flatMap(({ item, stem }) => {
    if (item.itemKind !== "on-action") {
      return [];
    }
    if (stem !== undefined) {
      onActionStems.add(stem);
    }
    return [item];
  });
  const orderedBindings = [...bindings].sort(
    (a, b) =>
      compareUtf8(a.hook.name, b.hook.name) ||
      compareUtf8(onActionContributionKey(a), onActionContributionKey(b))
  );
  for (const item of orderedBindings) {
    for (const event of item.events ?? []) {
      onActionAuthoring.register(item.hook, event);
    }
    for (const row of item.randomEvents ?? []) {
      onActionAuthoring.registerRandom(item.hook, row);
    }
  }
  return { onActions: onActionAuthoring.entries(), onActionStems };
}

function compileContributions(session: BuildSession): {
  shipOfSizeLimits: ReadonlySet<string>;
  contributionStems: ReadonlySet<string>;
} {
  const contributedLimits: string[] = [];
  const contributionStems = new Set<string>();
  for (const { item, stem } of session.flat) {
    if (item.itemKind !== "contribution") {
      continue;
    }
    if (stem !== undefined) {
      contributionStems.add(stem);
    }
    for (const id of item.ids) {
      contributedLimits.push(id);
      session.refUses.push({
        owner: `the ${item.registry} contribution`,
        use: { targets: [item.refRegistry], id, field: `default.${item.registry}` },
      });
    }
  }
  return {
    shipOfSizeLimits: immutableSet(contributedLimits.sort(compareUtf8)),
    contributionStems,
  };
}

/**
 * Emits the event-kind table, the per-kind definers, and the typed
 * fire-effect signatures.
 *
 * `type[event]` in `events/events.cwt` declares one `event_type` subtype per
 * event kind, each carrying `## type_key_filter = country_event` and
 * `## push_scope = country` — so which kinds exist and which scope each runs
 * in falls out of the rules rather than a hand-maintained table. The runtime
 * (`src/effect-core.ts`) registers a fire-effect encoder per kind from this
 * table, and `src/events.ts` builds the typed definition surface over it.
 *
 * Three outputs:
 *
 * - `events.ts` — the `EVENT_KINDS` data table.
 * - `event-factory.ts` — `createEvents(file, namespace)`, the event collection,
 *   with one `defineXEvent` definer per scoped kind, each closing over the
 *   factory's namespace and its used-id set. The scopeless `event` kind cannot
 *   type its closures, so it is skipped and reported.
 * - `event-definers.ts` — `namespace(ns)`, the same definers with no collection
 *   behind them: the events are values the author places, not registrations.
 * - `event-fires.ts` — the witness-overload pair per fire effect, merged into
 *   the generated scope interfaces. The pair cannot be generated as ordinary
 *   effects (see `FIRE_EFFECTS` in the overlay): the `id` argument is an
 *   `EventRef` carrying the fired event's FROM contract, and the second
 *   overload's `NoInfer` witness is what makes firing a `from:`-declaring
 *   event without proof a compile error. The fire method's receiving scopes
 *   come from the effect rule's own `## scopes` (observer_event is fireable
 *   anywhere, so it lands on `UniversalEffects`), while the `EventRef`'s
 *   scope is the kind's from this table.
 */

import { camelCase, docComment, indefiniteArticle, pascalCase } from "../naming.ts";
import type { SkippedRule } from "./shape.ts";
import { Emitter } from "./types.ts";

export interface EventsEmission {
  readonly code: string;
  readonly factoryCode: string;
  readonly definerCode: string;
  readonly firesCode: string;
  readonly kinds: number;
  readonly definers: number;
  readonly fireMethods: number;
  readonly skipped: readonly SkippedRule[];
}

interface EmittedKind {
  readonly key: string;
  readonly subtype: string;
  readonly scope: string | null;
}

function factorySignature(kind: EmittedKind & { scope: string }): string {
  const scope = JSON.stringify(kind.scope);
  const spoken = kind.key.replaceAll("_", " ");
  return (
    docComment(
      [
        `Defines ${indefiniteArticle(spoken)} ${spoken} in this factory's namespace; the full id is`,
        "`${namespace}.${def.id}`. Title/desc/option localization rides along, and the",
        "event's closures record eagerly, at the define site.",
      ],
      "  "
    ) +
    `  define${pascalCase(kind.key)}<From extends ScopeName | undefined = undefined>(\n` +
    `    def: EventDef<${scope}, From>\n` +
    `  ): EventItem<${scope}, From>;\n`
  );
}

function factoryBinding(kind: EmittedKind & { scope: string }): string {
  return (
    `    define${pascalCase(kind.key)}: definerOf(${JSON.stringify(kind.key)}, ` +
    `${JSON.stringify(kind.scope)}),\n`
  );
}

function definerSignature(kind: EmittedKind & { scope: string }): string {
  const scope = JSON.stringify(kind.scope);
  const spoken = kind.key.replaceAll("_", " ");
  return (
    docComment(
      [
        `Defines ${indefiniteArticle(spoken)} ${spoken} in this namespace; the full id is`,
        "`${namespace}.${def.id}`. Title/desc/option localization rides along, and the",
        "event's closures record eagerly, at the define site.",
      ],
      "  "
    ) +
    `  define${pascalCase(kind.key)}<From extends ScopeName | undefined = undefined>(\n` +
    `    def: EventDef<${scope}, From>\n` +
    `  ): EventItem<${scope}, From>;\n`
  );
}

function fireOverloads(kind: EmittedKind & { scope: string }): string {
  const method = camelCase(kind.key);
  const scope = JSON.stringify(kind.scope);
  const spoken = kind.key.replaceAll("_", " ");
  return (
    docComment(
      [
        `Fires ${indefiniteArticle(spoken)} ${spoken} for the scoped ${kind.scope}, after any ` +
          "delay.",
      ],
      "    "
    ) +
    `    ${method}(args: FireEventArgs<${scope}, undefined>): void;\n` +
    `    ${method}<F extends ScopeName>(args: WitnessedFireEventArgs<${scope}, F>): void;\n`
  );
}

export function emitEvents(emitter: Emitter): EventsEmission {
  const type = emitter.rules.contentTypes.get("event");
  if (type === undefined) {
    throw new Error("events/events.cwt no longer declares type[event]");
  }
  const skipped: SkippedRule[] = [];
  const kinds: EmittedKind[] = type.subtypes
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

  const scoped = kinds.filter((kind): kind is EmittedKind & { scope: string } => {
    if (kind.scope !== null) {
      return true;
    }
    skipped.push({ name: kind.key, reason: "scopeless event kind — closures cannot be typed" });
    return false;
  });

  const factoryCode =
    docComment([
      "The pure API's event collection: one `defineXEvent` per scoped event",
      "kind, each returning an `EventItem` that is both the registration and",
      "the value fire sites and `on()` bindings reference.",
    ]) +
    "export interface EventCollection extends Collection<EventItemBase> {\n" +
    "  readonly namespace: string;\n" +
    scoped.map(factorySignature).join("\n") +
    "}\n\n" +
    docComment([
      "File and namespace, co-declared: one namespace per event file by",
      "construction. The namespace is identity — saves persist pending fires by",
      "full id and on_actions reference it — so it is written in full here and",
      "never inferred from the file stem; prefix compliance is a build warning,",
      "the same policy as content ids.",
      "",
      "Because the namespace is known at the definition site, the recorder",
      "closures run eagerly right there — the class API's semantics — and the",
      "full id is a plain string from birth. Nothing about an event is deferred.",
      "The per-factory duplicate check catches a repeated numeric id at the",
      "define site, with a precise stack; `buildMod` keeps a global full-id",
      "check for two factories sharing one namespace string.",
    ]) +
    "export function createEvents(file: string, namespace: string): EventCollection {\n" +
    "  assertNamespace(namespace);\n" +
    "  const { collection, items } = makeCollection<EventItemBase>(file);\n" +
    "  const used = new Set<number>();\n" +
    "  const definerOf =\n" +
    "    <S extends ScopeName>(kind: EventKindKey, scope: S) =>\n" +
    "    <From extends ScopeName | undefined = undefined>(\n" +
    "      def: EventDef<S, From>\n" +
    "    ): EventItem<S, From> => {\n" +
    "      if (used.has(def.id)) {\n" +
    '        throw new Error(`Duplicate event id "${namespace}.${def.id}"`);\n' +
    "      }\n" +
    "      used.add(def.id);\n" +
    "      const locEntries: (readonly [string, string])[] = [];\n" +
    "      const built = buildEvent(kind, scope, namespace, def, {\n" +
    "        register: (key, text) => locEntries.push([key, text]),\n" +
    "      });\n" +
    '      const item = { ...built, itemKind: "event" as const, namespace, locEntries };\n' +
    "      items.push(item as EventItemBase);\n" +
    "      return item as EventItem<S, From>;\n" +
    "    };\n" +
    "  return {\n" +
    "    ...collection,\n" +
    "    namespace,\n" +
    scoped.map(factoryBinding).join("") +
    "  };\n" +
    "}\n";

  const definerCode =
    docComment([
      "An event namespace handle: the free half of the event surface (SDK-23).",
      "One `defineXEvent` per scoped event kind, each returning an `EventItem`",
      "that is the definition, the value fire sites reference, and the value",
      "`on()` binds — but registering nothing. Which file the events land in is",
      "decided by the `collection(...)` they are placed in, or by the module",
      "`discoverContent` found them exported from.",
    ]) +
    "export interface EventNamespace {\n" +
    "  /**\n" +
    "   * Discovery's marker. Exporting the handle instead of the events it\n" +
    "   * defined is the one wrong thing an author is likely to do here, so it\n" +
    "   * is recognizable enough to earn a targeted error rather than the\n" +
    "   * generic unrecognized-export one.\n" +
    "   */\n" +
    '  readonly kind: "event-namespace";\n' +
    "  readonly namespace: string;\n" +
    scoped.map(definerSignature).join("\n") +
    "}\n\n" +
    docComment([
      "Opens an event namespace. The namespace is identity — saves persist",
      "pending fires by full id and on_actions reference it — so it is written",
      "in full here and never inferred from a file name; prefix compliance is a",
      "build warning, the same policy as content ids.",
      "",
      "Because the namespace is known at the definition site, the recorder",
      "closures run eagerly right there and the full id is a plain string from",
      "birth. Nothing about an event is deferred. The per-handle duplicate check",
      "catches a repeated numeric id at the define site, with a precise stack;",
      "`buildMod` keeps a global full-id check for two handles opened on one",
      "namespace string, and requires all of a namespace's events to land in one",
      "file.",
    ]) +
    "export function namespace(ns: string): EventNamespace {\n" +
    "  assertNamespace(ns);\n" +
    "  const used = new Set<number>();\n" +
    "  const definerOf =\n" +
    "    <S extends ScopeName>(kind: EventKindKey, scope: S) =>\n" +
    "    <From extends ScopeName | undefined = undefined>(\n" +
    "      def: EventDef<S, From>\n" +
    "    ): EventItem<S, From> => {\n" +
    "      if (used.has(def.id)) {\n" +
    '        throw new Error(`Duplicate event id "${ns}.${def.id}"`);\n' +
    "      }\n" +
    "      used.add(def.id);\n" +
    "      const locEntries: (readonly [string, string])[] = [];\n" +
    "      const built = buildEvent(kind, scope, ns, def, {\n" +
    "        register: (key, text) => locEntries.push([key, text]),\n" +
    "      });\n" +
    '      const item = { ...built, itemKind: "event" as const, namespace: ns, locEntries };\n' +
    "      return item as EventItem<S, From>;\n" +
    "    };\n" +
    "  return {\n" +
    '    kind: "event-namespace",\n' +
    "    namespace: ns,\n" +
    scoped.map(factoryBinding).join("") +
    "  };\n" +
    "}\n";

  // The receiving scopes come from the fire effect's own `## scopes`; a kind
  // whose rule the effects file no longer declares gets no typed fire method
  // and is reported rather than guessed at.
  const byInterface = new Map<string, (EmittedKind & { scope: string })[]>();
  for (const kind of scoped) {
    const declarations = emitter.rules.effects.get(kind.key);
    const supported = declarations?.flatMap((decl) => decl.supportedScopes ?? []) ?? [];
    if (supported.length === 0) {
      skipped.push({ name: kind.key, reason: "no fire-effect rule with `## scopes`" });
      continue;
    }
    const targets = supported.some((scope) => scope === "any" || scope === "all")
      ? ["UniversalEffects"]
      : [
          ...new Set(
            supported.map((scope) => {
              const canonical = emitter.canonicalScope(scope);
              if (canonical === null) {
                throw new Error(`fire effect ${kind.key} declares unknown scope ${scope}`);
              }
              return `${pascalCase(canonical)}Scope`;
            })
          ),
        ];
    for (const target of targets) {
      byInterface.set(target, [...(byInterface.get(target) ?? []), kind]);
    }
  }

  const fireMethods = [...byInterface.values()].reduce((sum, list) => sum + list.length, 0);
  const firesCode =
    docComment([
      "Typed fire methods for every event kind, merged into the generated",
      "scope interfaces. The runtime encoder is registered for every kind in",
      "`EVENT_KINDS` (src/effect-core.ts); these declarations are the typed",
      "surface over it.",
    ]) +
    'declare module "./effects.ts" {\n' +
    [...byInterface.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([target, list]) =>
          `  interface ${target} {\n` + list.map(fireOverloads).join("\n") + "  }\n"
      )
      .join("\n") +
    "}\n\n" +
    "// Declarations only; the export makes this a module the augmentation\n" +
    "// consumers can side-effect import.\n" +
    "export {};\n";

  return {
    code,
    factoryCode,
    definerCode,
    firesCode,
    kinds: kinds.length,
    definers: scoped.length,
    fireMethods,
    skipped,
  };
}

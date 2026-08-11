/**
 * Emits the event-kind table, the per-kind definers, and the typed
 * fire-effect signatures.
 *
 * `type[event]` in `events/events.cwt` declares one `event_type` subtype per
 * event kind, each carrying `## type_key_filter = country_event` and
 * `## push_scope = country` — so which kinds exist and which scope each runs
 * in falls out of the rules rather than a hand-maintained table. The runtime
 * (`src/script/effects/recorder.ts`) registers fire-effect encoders from the
 * effect policy's event-kind/effect-rule join, and `src/events/types.ts` plus
 * `src/events/lower.ts` build the typed definition surface over this table.
 *
 * Three outputs:
 *
 * - `events.ts` — the `EVENT_KINDS` data table.
 * - `event-definers.ts` — internal raw event lowering: `namespace(ns)` with one
 *   `defineXEvent` definer per scoped kind. The public capability generates
 *   the author-facing event methods from the same kind table. The scopeless
 *   `event` kind cannot type its closures, so it is skipped and reported.
 * - `event-fires.ts` — the witness-overload pair per fire effect, merged into
 *   the generated scope interfaces. The pair cannot be generated as ordinary
 *   effects (the `fire` rows in `EffectPolicy`): the `id` argument is an
 *   `EventRef` carrying the fired event's FROM contract, and the second
 *   overload's `NoInfer` witness is what makes firing a `from:`-declaring
 *   event without proof a compile error. The fire method's receiving scopes
 *   come from the effect rule's own `## scopes` (observer_event is fireable
 *   anywhere, so it lands on `UniversalEffects`), while the `EventRef`'s
 *   scope is the kind's from this table.
 */

import type { EffectPolicy } from "../effect-policy.ts";
import { eventKinds, type EventKindSpec } from "../event-kinds.ts";
import { camelCase, docComment, indefiniteArticle, pascalCase } from "../naming.ts";
import type { SkippedRule } from "./shape.ts";
import { Emitter } from "./types.ts";

export interface EventsEmission {
  readonly code: string;
  readonly definerCode: string;
  readonly firesCode: string;
  readonly kinds: number;
  readonly definers: number;
  readonly fireMethods: number;
  readonly skipped: readonly SkippedRule[];
}

type EmittedKind = EventKindSpec;

function definerBinding(kind: EmittedKind & { scope: string }): string {
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
        `Internal lowering primitive for ${indefiniteArticle(spoken)} ${spoken}; the full id is`,
        "`${namespace}.${def.id}`. Public authors call the matching capability method.",
      ],
      "  "
    ) +
    `  define${pascalCase(kind.key)}<From extends ScopeName | undefined = undefined>(\n` +
    `    def: EventDef<${scope}, From>\n` +
    `  ): EventItem<${scope}, From, ${JSON.stringify(kind.subtype)}>;\n`
  );
}

function capabilityMethod(kind: EmittedKind & { scope: string }): string {
  if (!kind.key.endsWith("_event")) {
    throw new Error(`event kind ${kind.key} does not end in _event`);
  }
  return camelCase(kind.key.slice(0, -"_event".length));
}

function capabilitySignature(kind: EmittedKind & { scope: string }): string {
  const method = capabilityMethod(kind);
  const scope = JSON.stringify(kind.scope);
  const subtype = JSON.stringify(kind.subtype);
  const spoken = kind.key.replaceAll("_", " ");
  return (
    docComment(
      [
        `Defines ${indefiniteArticle(spoken)} ${spoken} with an id in this capability namespace.`,
        "The capability owns the namespace and full id; callers supply only the numeric id.",
      ],
      "  "
    ) +
    `  ${method}<const Id extends number, From extends ScopeName | undefined = undefined>(\n` +
    `    id: Id,\n` +
    `    def: Omit<EventDef<${scope}, From>, "id">\n` +
    `  ): CapabilityEventItem<P, N, Id, ${scope}, From, ${subtype}>;\n\n` +
    docComment(
      [
        `Creates an immutable ${spoken} reference in this capability namespace.`,
        "Define it later with its `define(...)` method when a cycle needs the handle first.",
      ],
      "  "
    ) +
    `  ${method}Handle<const Id extends number, From extends ScopeName | undefined = undefined>(\n` +
    `    id: Id,\n` +
    `    contract?: { readonly from?: From }\n` +
    `  ): CapabilityEventHandle<P, N, Id, ${scope}, From, ${subtype}>;\n`
  );
}

function capabilityBinding(kind: EmittedKind & { scope: string }): string {
  const method = capabilityMethod(kind);
  const scope = JSON.stringify(kind.scope);
  const subtype = JSON.stringify(kind.subtype);
  return (
    `    ${method}Handle: <const Id extends number, From extends ScopeName | undefined = undefined>(\n` +
    "      id: Id,\n" +
    "      contract: { readonly from?: From } = {}\n" +
    `    ) => minter.handle(id, ${JSON.stringify(kind.key)}, ${scope}, ${subtype}, contract.from as From),\n` +
    `    ${method}: <const Id extends number, From extends ScopeName | undefined = undefined>(\n` +
    "      id: Id,\n" +
    `      def: Omit<EventDef<${scope}, From>, "id">\n` +
    `    ) => minter.handle(id, ${JSON.stringify(kind.key)}, ${scope}, ${subtype}, def.from as From).define(def),\n`
  );
}

function fireOverloads(kind: EmittedKind & { scope: string }): string {
  const method = camelCase(kind.key);
  const scope = JSON.stringify(kind.scope);
  const subtype = JSON.stringify(kind.subtype);
  const spoken = kind.key.replaceAll("_", " ");
  return (
    docComment(
      [
        `Fires ${indefiniteArticle(spoken)} ${spoken} for the scoped ${kind.scope}, after any ` +
          "delay.",
      ],
      "    "
    ) +
    `    ${method}(args: FireEventArgs<${scope}, undefined, ${subtype}>): void;\n` +
    `    ${method}<F extends ScopeName>(\n` +
    `      args: WitnessedFireEventArgs<${scope}, F, ${subtype}>\n` +
    `    ): void;\n`
  );
}

export function emitEvents(emitter: Emitter, policy: EffectPolicy): EventsEmission {
  const skipped: SkippedRule[] = [];
  const kinds = eventKinds(emitter.rules);

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
  const fireKinds = scoped.filter((kind) => policy.fireKeys.has(kind.key));
  const capabilityNames = new Set<string>();
  for (const kind of scoped) {
    const method = capabilityMethod(kind);
    for (const name of [method, `${method}Handle`]) {
      if (name === "namespace" || capabilityNames.has(name)) {
        throw new Error(`event capability method collision at ${name}`);
      }
      capabilityNames.add(name);
    }
  }

  const definerCode =
    docComment([
      "An internal event namespace handle used by capability lowering.",
      "One `defineXEvent` per scoped event kind, each returning an `EventItem`",
      "that is the definition, the value fire sites reference, and the value",
      "`on()` binds — but registering nothing. Public authors use",
      "`mod.namespace()` and place the resulting values with `mod.feature(...)`.",
    ]) +
    "export interface EventNamespace {\n" +
    "  /**\n" +
    "   * Internal lowering marker; public feature discovery observes placed\n" +
    "   * capability features rather than raw namespace handles.\n" +
    "   */\n" +
    '  readonly kind: "event-namespace";\n' +
    "  readonly namespace: string;\n" +
    scoped.map(definerSignature).join("\n") +
    "}\n\n" +
    docComment([
      "Opens an internal event namespace. The namespace is identity — saves persist",
      "pending fires by full id and on_actions reference it — so it is written",
      "in full here and never inferred from a file name; prefix compliance is a",
      "build warning, the same policy as content ids.",
      "",
      "Because the namespace is known at the definition site, the recorder",
      "closures run eagerly right there and the full id is a plain string from",
      "birth. Nothing about an event is deferred. The per-handle duplicate check",
      "catches a repeated numeric id at the define site, with a precise stack;",
      "the internal fold keeps a global full-id check for two handles opened on one",
      "namespace string, and requires all of a namespace's events to land in one",
      "file.",
    ]) +
    "export function namespace(ns: string): EventNamespace {\n" +
    "  assertNamespace(ns);\n" +
    "  const used = new Set<number>();\n" +
    // `Kind` rides in from the key rather than the call sites: the subtype is
    // a fact the EVENT_KINDS table already records, and a kind whose subtype
    // and scope differ (observer, cosmic_storm) would otherwise have to repeat
    // it at every binding below.
    "  const definerOf =\n" +
    "    <const K extends EventKindKey, S extends ScopeName>(kind: K, scope: S) =>\n" +
    "    <From extends ScopeName | undefined = undefined>(\n" +
    "      def: EventDef<S, From>\n" +
    '    ): EventItem<S, From, (typeof EVENT_KINDS)[K]["subtype"]> => {\n' +
    "      assertEventNumber(def.id);\n" +
    "      if (used.has(def.id)) {\n" +
    '        throw new Error(`Duplicate event id "${ns}.${def.id}"`);\n' +
    "      }\n" +
    "      used.add(def.id);\n" +
    "      const locEntries: (readonly [string, string])[] = [];\n" +
    "      const built = buildEvent(kind, scope, ns, def, {\n" +
    "        register: (key, text) => locEntries.push([key, text]),\n" +
    "      });\n" +
    '      const item = { ...built, itemKind: "event" as const, namespace: ns, locEntries };\n' +
    '      return item as EventItem<S, From, (typeof EVENT_KINDS)[K]["subtype"]>;\n' +
    "    };\n" +
    "  return {\n" +
    '    kind: "event-namespace",\n' +
    "    namespace: ns,\n" +
    scoped.map(definerBinding).join("") +
    "  };\n" +
    "}\n\n" +
    'export type MintedNamespace<P extends string, N extends string> = N extends "" ? P : `${P}_${N}`;\n\n' +
    "export type MintedEventId<P extends string, N extends string, Id extends number> =\n" +
    "  `${MintedNamespace<P, N>}.${Id}`;\n\n" +
    "export type CapabilityEventItem<\n" +
    "  P extends string,\n" +
    "  N extends string,\n" +
    "  Id extends number,\n" +
    "  S extends ScopeName,\n" +
    "  From extends ScopeName | undefined,\n" +
    "  Kind extends string = S,\n" +
    "> = EventItem<S, From, Kind> & { readonly id: MintedEventId<P, N, Id> };\n\n" +
    "export type CapabilityEventHandle<\n" +
    "  P extends string,\n" +
    "  N extends string,\n" +
    "  Id extends number,\n" +
    "  S extends ScopeName,\n" +
    "  From extends ScopeName | undefined,\n" +
    "  Kind extends string = S,\n" +
    "> = EventRef<S, From, Kind> & {\n" +
    "  readonly id: MintedEventId<P, N, Id>;\n" +
    "  readonly scope: S;\n" +
    "  readonly from: From;\n" +
    '  define(def: Omit<EventDef<S, From>, "id" | "from">): CapabilityEventItem<P, N, Id, S, From, Kind>;\n' +
    "};\n\n" +
    "export interface CapabilityEventMinter<P extends string, N extends string> {\n" +
    "  readonly namespace: MintedNamespace<P, N>;\n" +
    "  handle<\n" +
    "    const Id extends number,\n" +
    "    S extends ScopeName,\n" +
    "    From extends ScopeName | undefined,\n" +
    "    Kind extends string,\n" +
    "  >(\n" +
    "    id: Id,\n" +
    "    kind: EventKindKey,\n" +
    "    scope: S,\n" +
    "    subtype: Kind,\n" +
    "    from: From\n" +
    "  ): CapabilityEventHandle<P, N, Id, S, From, Kind>;\n" +
    "}\n\n" +
    "export interface CapabilityEvents<P extends string, N extends string> {\n" +
    "  readonly namespace: MintedNamespace<P, N>;\n" +
    scoped.map(capabilitySignature).join("\n") +
    "}\n\n" +
    "export function capabilityEvents<P extends string, N extends string>(\n" +
    "  minter: CapabilityEventMinter<P, N>\n" +
    "): CapabilityEvents<P, N> {\n" +
    "  return Object.freeze({\n" +
    "    namespace: minter.namespace,\n" +
    scoped.map(capabilityBinding).join("") +
    "  }) as CapabilityEvents<P, N>;\n" +
    "}\n";

  // The receiving scopes come from the fire effect's own `## scopes`; a kind
  // whose rule the effects file no longer declares gets no typed fire method
  // and is reported rather than guessed at.
  const byInterface = new Map<string, (EmittedKind & { scope: string })[]>();
  for (const kind of fireKinds) {
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
      "scope interfaces. The runtime encoder is registered from the same generated",
      "fire-effect policy (src/script/effects/recorder.ts); these declarations are the typed",
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
    definerCode,
    firesCode,
    kinds: kinds.length,
    definers: scoped.length,
    fireMethods,
    skipped,
  };
}

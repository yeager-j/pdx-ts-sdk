/**
 * Emits the event-kind table, the per-kind definition methods, and the typed
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
 * - `event-methods.ts` — `GeneratedEventMethods`, one `defineXEvent` per
 *   scoped kind, over the same abstract-hook shape `GeneratedContentMethods`
 *   uses. The scopeless `event` kind is skipped and reported.
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

import { camelCase, docComment, pascalCase } from "../naming.ts";
import type { SkippedRule } from "./shape.ts";
import { Emitter } from "./types.ts";

export interface EventsEmission {
  readonly code: string;
  readonly methodsCode: string;
  readonly firesCode: string;
  readonly kinds: number;
  readonly defineMethods: number;
  readonly fireMethods: number;
  readonly skipped: readonly SkippedRule[];
}

interface EmittedKind {
  readonly key: string;
  readonly subtype: string;
  readonly scope: string | null;
}

function defineMethod(kind: EmittedKind & { scope: string }): string {
  const scope = JSON.stringify(kind.scope);
  return (
    docComment(
      [
        `Defines a ${kind.key.replaceAll("_", " ")} in this mod's namespace; the full id is`,
        "`${prefix}.${def.id}`. Title/desc/option localization rides along, and the",
        "event's closures record eagerly, at the define site.",
      ],
      "  "
    ) +
    `  define${pascalCase(kind.key)}<From extends ScopeName | undefined = undefined>(\n` +
    `    def: EventDef<${scope}, From>\n` +
    `  ): DefinedEvent<${scope}, From> {\n` +
    `    return this.defineEventOf(${JSON.stringify(kind.key)}, ${scope}, def);\n` +
    `  }\n`
  );
}

function fireOverloads(kind: EmittedKind & { scope: string }): string {
  const method = camelCase(kind.key);
  const scope = JSON.stringify(kind.scope);
  return (
    docComment(
      [`Fires a ${kind.key.replaceAll("_", " ")} for the scoped ${kind.scope}, after any delay.`],
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

  const methodsCode =
    docComment([
      "The `defineXEvent` methods, one per scoped event kind. `Mod` extends",
      "this the same way it extends `GeneratedContentMethods`, which this",
      "class chains to so the two generated surfaces share one base chain.",
    ]) +
    "export abstract class GeneratedEventMethods<\n" +
    "  const P extends string,\n" +
    "> extends GeneratedContentMethods<P> {\n" +
    "  protected abstract defineEventOf<S extends ScopeName, From extends ScopeName | undefined>(\n" +
    "    kind: EventKindKey,\n" +
    "    scope: S,\n" +
    "    def: EventDef<S, From>\n" +
    "  ): DefinedEvent<S, From>;\n\n" +
    scoped.map(defineMethod).join("\n") +
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
    methodsCode,
    firesCode,
    kinds: kinds.length,
    defineMethods: scoped.length,
    fireMethods,
    skipped,
  };
}

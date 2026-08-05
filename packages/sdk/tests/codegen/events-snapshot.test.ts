import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EVENT_KINDS } from "../../src/generated/events.ts";

const definers = readFileSync("packages/sdk/src/generated/event-definers.ts", "utf8");
const fires = readFileSync("packages/sdk/src/generated/event-fires.ts", "utf8");

describe("generated event surface", () => {
  it("emits a definer for every scoped kind, and only those", () => {
    // The definers come straight off the kind table, so the surface cannot
    // drift from the rules: one per scoped kind, and the scopeless `event`
    // kind — whose closures cannot be typed — is absent.
    const emitted = [...definers.matchAll(/^  (define\w+Event)</gm)].map((match) => match[1]);
    expect(emitted).toHaveLength(
      Object.values(EVENT_KINDS).filter((kind) => kind.scope !== null).length
    );
    expect(new Set(emitted).size).toBe(emitted.length);
    expect(definers).toContain(
      "  defineCountryEvent<From extends ScopeName | undefined = undefined>(\n" +
        '    def: EventDef<"country", From>\n' +
        '  ): EventItem<"country", From, "country">;'
    );
    // The kind's subtype, not its scope: an observer event runs in country
    // scope and is still not a country event to the rules.
    expect(definers).toContain('  ): EventItem<"country", From, "observer">;');
    expect(definers).toContain('  ): EventItem<"storm", From, "cosmic_storm">;');
    expect(definers).toContain(
      "  defineSituationEvent<From extends ScopeName | undefined = undefined>("
    );
    expect(definers).toContain('defineSituationEvent: definerOf("situation_event", "situation"),');
    expect(definers).not.toContain("defineEvent<From");
    expect(definers).not.toContain('"event", null');
  });

  it("keeps namespace(ns) as internal lowering with eager closures and per-namespace ids", () => {
    // The namespace is known at the definition site, so nothing is deferred:
    // buildEvent runs right there and the full id is a plain string from
    // birth. What the deleted collection factory used to add — an item array
    // to push into — is absent, because where the events land is decided
    // where they are placed.
    expect(definers).toContain("export function namespace(ns: string): EventNamespace {");
    expect(definers).toContain("export interface EventNamespace {");
    // Internal lowering still records the handle shape, while public feature
    // discovery observes capability-owned features rather than raw handles.
    expect(definers).toContain('  readonly kind: "event-namespace";');
    expect(definers).toContain("  readonly namespace: string;");
    expect(definers).toContain("  assertNamespace(ns);");
    expect(definers).toContain("const used = new Set<number>();");
    expect(definers).toContain('throw new Error(`Duplicate event id "${ns}.${def.id}"`);');
    expect(definers).toContain("const built = buildEvent(kind, scope, ns, def, {");
    expect(definers).toContain(
      'const item = { ...built, itemKind: "event" as const, namespace: ns, locEntries };'
    );
    expect(definers).not.toContain("makeCollection");
    expect(definers).not.toContain("items.push");
    expect(definers).not.toContain("Collection<");
    const publicIndex = readFileSync("packages/sdk/src/index.ts", "utf8");
    expect(publicIndex).not.toContain('from "./generated/event-definers.ts"');
    expect(publicIndex).not.toContain("export { namespace");
  });

  it("derives direct and handle capability methods from every scoped event kind", () => {
    const capability = definers.slice(definers.indexOf("export interface CapabilityEvents"));
    const methods = [...capability.matchAll(/^  (\w+)Handle(?:<|\n)/gm)].map((match) => match[1]);

    expect(methods).toHaveLength(
      Object.values(EVENT_KINDS).filter((kind) => kind.scope !== null).length
    );
    expect(new Set(methods).size).toBe(methods.length);
    expect(capability).toContain(
      "export function capabilityEvents<P extends string, N extends string>("
    );
    expect(capability).toContain('builder.handle(id, "country_event", "country", "country"');
    expect(capability).toContain('CapabilityEventHandle<P, N, Id, "country", From, "observer">');
    expect(capability).toContain(
      "Defines a country event with an id in this capability namespace."
    );
    expect(capability).toContain(
      "Creates an immutable country event reference in this capability namespace."
    );
  });

  it("emits the witness-overload pair for every fire effect", () => {
    expect(fires).toContain('declare module "./effects.ts"');
    expect(fires).toContain("interface SituationScope {");
    expect(fires).toContain(
      'situationEvent(args: FireEventArgs<"situation", undefined, "situation">): void;'
    );
    expect(fires).toContain(
      "situationEvent<F extends ScopeName>(\n" +
        '      args: WitnessedFireEventArgs<"situation", F, "situation">\n' +
        "    ): void;"
    );
  });

  it("puts observer_event on UniversalEffects, per its `## scopes = any`", () => {
    expect(fires).toContain("interface UniversalEffects {");
    const universal = fires.slice(fires.indexOf("interface UniversalEffects {"));
    // Pinned with its subtype: firing an ordinary country event through
    // `observer_event = { ... }` is a different event type to the game.
    expect(universal).toContain(
      'observerEvent(args: FireEventArgs<"country", undefined, "observer">): void;'
    );
  });

  it("keeps startSituation on the EffectsInCountry cluster", () => {
    // src/script/effects/situations.ts merges the declared-target overload into this exact
    // interface; if clustering ever moves the generated signature, the
    // augmentation would silently detach instead of overloading.
    const effects = readFileSync("packages/sdk/src/generated/effects.ts", "utf8");
    const start = effects.indexOf("export interface EffectsInCountry {");
    expect(start).toBeGreaterThan(-1);
    const cluster = effects.slice(start, effects.indexOf("\n}\n", start));
    expect(cluster).toContain("startSituation(args: {");
  });
});

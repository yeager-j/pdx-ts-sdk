import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EVENT_KINDS } from "../../src/generated/events.ts";

const methods = readFileSync("src/generated/event-methods.ts", "utf8");
const factory = readFileSync("src/generated/event-factory.ts", "utf8");
const fires = readFileSync("src/generated/event-fires.ts", "utf8");

describe("generated event surface", () => {
  it("emits one define method per scoped kind off the abstract hook", () => {
    expect(methods).toContain("export abstract class GeneratedEventMethods<");
    expect(methods).toContain("extends GeneratedContentMethods<P>");
    expect(methods).toContain(
      "defineSituationEvent<From extends ScopeName | undefined = undefined>("
    );
    expect(methods).toContain('return this.defineEventOf("situation_event", "situation", def);');
    // The scopeless `event` kind cannot type its closures and is skipped.
    expect(methods).not.toContain('"event", null');
    expect(methods).not.toContain("defineEvent<From");
  });

  it("emits createEvents with a definer for every kind the class API defines", () => {
    // The two surfaces come off one kind table, so they cannot drift apart:
    // every `defineXEvent` on the abstract class has a definer on the factory,
    // and the scopeless `event` kind is absent from both.
    const classMethods = [...methods.matchAll(/^  (define\w+Event)</gm)].map((match) => match[1]);
    const factoryDefiners = [...factory.matchAll(/^  (define\w+Event)</gm)].map(
      (match) => match[1]
    );
    expect(factoryDefiners).toEqual(classMethods);
    expect(factoryDefiners).toHaveLength(
      Object.values(EVENT_KINDS).filter((kind) => kind.scope !== null).length
    );
    expect(factory).toContain(
      "  defineCountryEvent<From extends ScopeName | undefined = undefined>(\n" +
        '    def: EventDef<"country", From>\n' +
        '  ): EventItem<"country", From>;'
    );
    expect(factory).toContain('defineSituationEvent: definerOf("situation_event", "situation"),');
    expect(factory).not.toContain("defineEvent<From");
  });

  it("keeps the factory's eager closures, per-namespace ids, and duplicate check", () => {
    // The namespace is known at the definition site, so nothing is deferred:
    // buildEvent runs right there and the full id is a plain string from birth.
    expect(factory).toContain("export function createEvents(file: string, namespace: string)");
    expect(factory).toContain("  assertNamespace(namespace);");
    expect(factory).toContain("const used = new Set<number>();");
    expect(factory).toContain('throw new Error(`Duplicate event id "${namespace}.${def.id}"`);');
    expect(factory).toContain("const built = buildEvent(kind, scope, namespace, def, {");
    expect(factory).toContain(
      'const item = { ...built, itemKind: "event" as const, namespace, locEntries };'
    );
  });

  it("emits the witness-overload pair for every fire effect", () => {
    expect(fires).toContain('declare module "./effects.ts"');
    expect(fires).toContain("interface SituationScope {");
    expect(fires).toContain('situationEvent(args: FireEventArgs<"situation", undefined>): void;');
    expect(fires).toContain(
      'situationEvent<F extends ScopeName>(args: WitnessedFireEventArgs<"situation", F>): void;'
    );
  });

  it("puts observer_event on UniversalEffects, per its `## scopes = any`", () => {
    expect(fires).toContain("interface UniversalEffects {");
    const universal = fires.slice(fires.indexOf("interface UniversalEffects {"));
    expect(universal).toContain('observerEvent(args: FireEventArgs<"country", undefined>): void;');
  });

  it("keeps startSituation on the EffectsInCountry cluster", () => {
    // src/situations.ts merges the declared-target overload into this exact
    // interface; if clustering ever moves the generated signature, the
    // augmentation would silently detach instead of overloading.
    const effects = readFileSync("src/generated/effects.ts", "utf8");
    const start = effects.indexOf("export interface EffectsInCountry {");
    expect(start).toBeGreaterThan(-1);
    const cluster = effects.slice(start, effects.indexOf("\n}\n", start));
    expect(cluster).toContain("startSituation(args: {");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EVENT_KINDS } from "../../src/generated/events.ts";

const factory = readFileSync("src/generated/event-factory.ts", "utf8");
const definers = readFileSync("src/generated/event-definers.ts", "utf8");
const fires = readFileSync("src/generated/event-fires.ts", "utf8");

describe("generated event surface", () => {
  it("emits a definer for every scoped kind, and only those", () => {
    // The definers come straight off the kind table, so the surface cannot
    // drift from the rules: one per scoped kind, and the scopeless `event`
    // kind — whose closures cannot be typed — is absent.
    const definers = [...factory.matchAll(/^  (define\w+Event)</gm)].map((match) => match[1]);
    expect(definers).toHaveLength(
      Object.values(EVENT_KINDS).filter((kind) => kind.scope !== null).length
    );
    expect(new Set(definers).size).toBe(definers.length);
    expect(factory).toContain(
      "  defineCountryEvent<From extends ScopeName | undefined = undefined>(\n" +
        '    def: EventDef<"country", From>\n' +
        '  ): EventItem<"country", From>;'
    );
    expect(factory).toContain(
      "  defineSituationEvent<From extends ScopeName | undefined = undefined>("
    );
    expect(factory).toContain('defineSituationEvent: definerOf("situation_event", "situation"),');
    expect(factory).not.toContain("defineEvent<From");
    expect(factory).not.toContain('"event", null');
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

  it("gives namespace(ns) the same definer set, with nothing to register into", () => {
    // The free surface (SDK-23): same kinds, same eager closures, same
    // per-handle duplicate check — the only thing missing is the collection,
    // because where the events land is decided where they are placed.
    const free = [...definers.matchAll(/^  (define\w+Event)</gm)].map((match) => match[1]);
    const bound = [...factory.matchAll(/^  (define\w+Event)</gm)].map((match) => match[1]);
    expect(free).toEqual(bound);
    expect(definers).toContain("export function namespace(ns: string): EventNamespace {");
    expect(definers).toContain("export interface EventNamespace {");
    // Discovery's marker, so exporting the handle instead of its events can
    // earn a targeted error rather than the generic unrecognized-export one.
    expect(definers).toContain('  readonly kind: "event-namespace";');
    expect(definers).toContain("  readonly namespace: string;");
    expect(definers).toContain("  assertNamespace(ns);");
    expect(definers).toContain("const used = new Set<number>();");
    expect(definers).toContain('throw new Error(`Duplicate event id "${ns}.${def.id}"`);');
    expect(definers).toContain("const built = buildEvent(kind, scope, ns, def, {");
    expect(definers).not.toContain("makeCollection");
    expect(definers).not.toContain("items.push");
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

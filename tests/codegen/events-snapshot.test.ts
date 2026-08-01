import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const methods = readFileSync("src/generated/event-methods.ts", "utf8");
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

/**
 * The import machinery's own contract: what `Emitter.use` accepts, what
 * `renderImports` writes, and that the recorded-but-unused check can go red.
 *
 * The real gate for "the generated output did not change" is `codegen:check`.
 * These tests pin the mechanism underneath it — in particular the one-way
 * cross-check, which is worthless unless it has been seen to fail.
 */

import type { RuleType } from "@pdx-ts/codegen-cwt/cwt/model";
import { emitScopes } from "@pdx-ts/codegen-cwt/emit/support";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/typescript";
import { referenceTargetsOf } from "@pdx-ts/codegen-cwt/lower/value";
import { referencesIdentifier } from "@pdx-ts/codegen-cwt/naming";
import {
  assertRecordedImportsAreUsed,
  ImportRecorder,
  KNOWN_SYMBOLS,
  renderImports,
} from "@pdx-ts/codegen-cwt/render/symbols";
import { describe, expect, it } from "vitest";

/** The Emitter's import recorder needs no rules, so an empty rule set will do. */
function emitter(): Emitter {
  return new Emitter({
    triggers: new Map(),
    effects: new Map(),
    aliasCategories: new Map(),
    enums: new Map(),
    complexEnums: new Set(),
    scopes: new Map(),
    scopeGroups: new Map(),
    links: new Map(),
    contentTypes: new Map(),
    bodies: new Map(),
    modifierCategories: new Map(),
    modifierTemplates: [],
  } as unknown as Emitter["rules"]);
}

describe("referenceTargetsOf", () => {
  it("keeps a complex-enum target beside exact literal alternatives", () => {
    const types: readonly RuleType[] = [
      { kind: "enum", name: "component_tag" },
      { kind: "literal", text: "citadel" },
    ];

    expect(referenceTargetsOf(types)).toEqual(["component_tag"]);
  });

  it("does not treat an open mixed union as a content reference", () => {
    const types: readonly RuleType[] = [
      { kind: "enum", name: "component_tag" },
      { kind: "scalar" },
    ];

    expect(referenceTargetsOf(types)).toBeUndefined();
  });
});

describe("KNOWN_SYMBOLS", () => {
  it("gives every name exactly one source module", () => {
    // The table throws at construction on a duplicate, so reaching this point is
    // the assertion; the count guards against the table silently emptying.
    expect(KNOWN_SYMBOLS.size).toBeGreaterThan(20);
    expect(KNOWN_SYMBOLS.get("Trigger")).toEqual({
      module: "../script/trigger-core.ts",
      kind: "type",
    });
    expect(KNOWN_SYMBOLS.get("trigger")).toEqual({
      module: "../script/trigger-core.ts",
      kind: "value",
    });
  });

  it("names the module every generated file reaches `emitScopes`'s type through", () => {
    // `ScopeName` is declared by `scopes.ts`, which the generator writes into
    // the same directory as everything importing it.
    expect(emitScopes(["planet"])).toContain("export type ScopeName");
    expect(KNOWN_SYMBOLS.get("ScopeName")).toEqual({ module: "./scopes.ts", kind: "type" });
  });
});

describe("Emitter.use", () => {
  it("returns the name so the call site reads as the spelling", () => {
    const generator = emitter();
    generator.beginFile();
    expect(`${generator.use("Trigger")}<"planet">`).toBe('Trigger<"planet">');
  });

  it("throws on a name the table does not know", () => {
    const generator = emitter();
    generator.beginFile();
    expect(() => generator.use("Triggre")).toThrow(/not a known SDK symbol/);
  });

  it("records nothing before `beginFile` resets, so a file starts empty", () => {
    const generator = emitter();
    generator.beginFile();
    generator.use("Trigger");
    generator.beginFile();
    expect(renderImports(generator.endFile().imports)).toBe("");
  });

  it("splits type and value imports of one module into separate statements", () => {
    const generator = emitter();
    generator.beginFile();
    generator.use("trigger");
    generator.use("Trigger");
    generator.use("ScriptValue");
    expect(renderImports(generator.endFile().imports)).toBe(
      'import type { ScriptValue, Trigger } from "../script/trigger-core.ts";\n' +
        'import { trigger } from "../script/trigger-core.ts";\n'
    );
  });

  it("takes a computed name's module from the call site", () => {
    const generator = emitter();
    generator.beginFile();
    generator.useFrom("../stellaris/vanilla/view.ts", "ParsedTechnology", "type");
    expect(renderImports(generator.endFile().imports)).toBe(
      'import type { ParsedTechnology } from "../stellaris/vanilla/view.ts";\n'
    );
  });
});

describe("Emitter.useAliasCategory", () => {
  it("records the type import and the bare import that orders registration", () => {
    const generator = emitter();
    generator.beginFile();
    generator.useAliasCategory("moon_initializer", "MoonInitializerFields");
    expect(renderImports(generator.endFile().imports)).toBe(
      'import type { MoonInitializerFields } from "./moon-initializer.ts";\n' +
        'import "./moon-initializer.ts";\n'
    );
  });

  it("records nothing for the category the file itself is", () => {
    const generator = emitter();
    generator.beginFile("planet_initializer");
    generator.useAliasCategory("planet_initializer", "PlanetInitializerFields");
    expect(renderImports(generator.endFile().imports)).toBe("");
  });
});

describe("renderImports", () => {
  it("sorts modules by specifier and names within a statement", () => {
    const recorder = new ImportRecorder();
    recorder.add("./z.ts", "Zed", "type");
    recorder.add("../a.ts", "Beta", "type");
    recorder.add("../a.ts", "Alpha", "type");
    expect(renderImports(recorder.snapshot())).toBe(
      'import type { Alpha, Beta } from "../a.ts";\n' + 'import type { Zed } from "./z.ts";\n'
    );
  });

  it("writes every bare side-effect import last", () => {
    // The Prettier import plugin treats a side-effect import as a reordering
    // barrier, so one written in the middle would split the sorted block.
    const recorder = new ImportRecorder();
    recorder.add("./a.ts", "Alpha", "type");
    recorder.addSideEffect("./a.ts");
    recorder.add("./z.ts", "Zed", "type");
    expect(renderImports(recorder.snapshot())).toBe(
      'import type { Alpha } from "./a.ts";\n' +
        'import type { Zed } from "./z.ts";\n' +
        'import "./a.ts";\n'
    );
  });

  it("is a pure function of the recorded set, whatever order it was recorded in", () => {
    const forwards = new ImportRecorder();
    forwards.add("./a.ts", "Alpha", "type");
    forwards.add("./z.ts", "Zed", "value");
    const backwards = new ImportRecorder();
    backwards.add("./z.ts", "Zed", "value");
    backwards.add("./a.ts", "Alpha", "type");
    expect(renderImports(forwards.snapshot())).toBe(renderImports(backwards.snapshot()));
  });

  it("refuses to record one name as both a type and a value", () => {
    const recorder = new ImportRecorder();
    recorder.add("./a.ts", "Alpha", "type");
    expect(() => recorder.add("./a.ts", "Alpha", "value")).toThrow(/both a type and a value/);
  });
});

describe("assertRecordedImportsAreUsed", () => {
  it("passes when the body references every recorded name", () => {
    const recorder = new ImportRecorder();
    recorder.add("../script/trigger-core.ts", "Trigger", "type");
    expect(() =>
      assertRecordedImportsAreUsed(
        "example.ts",
        'export type X = Trigger<"planet">;',
        recorder.snapshot(),
        referencesIdentifier
      )
    ).not.toThrow();
  });

  // The negative control. A recording made on a path whose text never reached
  // the output would emit a dead import, and this is the check that stops it —
  // so it has to be seen going red against a deliberately spurious record.
  it("fails on a recorded name the body never mentions", () => {
    const recorder = new ImportRecorder();
    recorder.add("../script/trigger-core.ts", "Trigger", "type");
    recorder.add("../content/types.ts", "WithFrom", "type");
    expect(() =>
      assertRecordedImportsAreUsed(
        "example.ts",
        'export type X = Trigger<"planet">;',
        recorder.snapshot(),
        referencesIdentifier
      )
    ).toThrow(/example\.ts records imports its body never references: WithFrom/);
  });

  // Word boundaries, not substrings: `GovernmentTriggerBlock` is not a use of
  // `Trigger`, which is the collision the old substring scan had to work around.
  it("does not count a name spelled inside a longer word", () => {
    const recorder = new ImportRecorder();
    recorder.add("../script/trigger-core.ts", "Trigger", "type");
    expect(() =>
      assertRecordedImportsAreUsed(
        "example.ts",
        "export interface GovernmentTriggerBlock {}",
        recorder.snapshot(),
        referencesIdentifier
      )
    ).toThrow(/never references: Trigger/);
  });
});

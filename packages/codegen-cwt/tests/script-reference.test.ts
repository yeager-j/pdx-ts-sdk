import {
  emitScriptReferences,
  validateScriptReferences,
  type ScriptEffectReferenceRow,
  type ScriptTriggerReferenceRow,
} from "@pdx-ts/codegen-cwt/emit/script/script-reference";
import { describe, expect, it } from "vitest";

const effect = (overrides: Partial<ScriptEffectReferenceRow> = {}): ScriptEffectReferenceRow => ({
  method: "sampleEffect",
  key: "sample_effect",
  kind: "effect",
  availability: { kind: "scopes", scopes: ["country"] },
  signature: "sampleEffect(): void;",
  docs: ["Sample effect."],
  ...overrides,
});

const trigger = (
  overrides: Partial<ScriptTriggerReferenceRow> = {}
): ScriptTriggerReferenceRow => ({
  method: "sampleTrigger",
  key: "sample_trigger",
  availability: { kind: "scopes", scopes: ["country"] },
  signature: 'sampleTrigger(value: boolean = true): Trigger<"country">',
  docs: ["Sample trigger."],
  ...overrides,
});

describe("script reference metadata validation", () => {
  it("emits canonical rows and preserves universal availability", () => {
    const result = emitScriptReferences(
      ["country", "planet"],
      [effect({ availability: { kind: "universal" } })],
      [trigger()],
      [
        {
          member: "owner",
          fromScopes: ["country"],
          toScope: "country",
          docs: ["Scopes to the owner."],
        },
      ]
    );

    expect(result.effects).toBe(1);
    expect(result.triggers).toBe(1);
    expect(result.scopeLinks).toBe(1);
    expect(result.code).toContain('availability: { kind: "universal" }');
    expect(result.code).toContain('member: "owner"');
  });

  it("rejects unknown availability scopes", () => {
    expect(() =>
      validateScriptReferences(
        ["country"],
        [effect({ availability: { kind: "scopes", scopes: ["planet"] } })],
        [],
        []
      )
    ).toThrowError('effect sampleEffect names unknown scope "planet"');
  });

  it("rejects duplicate effect members and fixed keys", () => {
    expect(() => validateScriptReferences(["country"], [effect(), effect()], [], [])).toThrowError(
      'duplicate effect member "sampleEffect"'
    );
    expect(() =>
      validateScriptReferences(
        ["country"],
        [effect({ method: "first" }), effect({ method: "second" })],
        [],
        []
      )
    ).toThrowError('duplicate fixed script key "sample_effect"');
  });

  it("rejects contradictory rows and scope links", () => {
    expect(() =>
      validateScriptReferences(
        ["country", "planet"],
        [effect(), effect({ availability: { kind: "scopes", scopes: ["planet"] } })],
        [],
        []
      )
    ).toThrowError('contradictory effect member "sampleEffect"');
    expect(() =>
      validateScriptReferences(
        ["country", "planet"],
        [],
        [],
        [
          { member: "owner", fromScopes: ["country"], toScope: "country", docs: [] },
          { member: "owner", fromScopes: ["planet"], toScope: "country", docs: [] },
        ]
      )
    ).toThrowError('contradictory scope link member "owner"');
  });

  it("rejects invalid and duplicate trigger rows", () => {
    expect(() =>
      validateScriptReferences(
        ["country"],
        [],
        [trigger({ availability: { kind: "scopes", scopes: ["planet"] } })],
        []
      )
    ).toThrowError('trigger sampleTrigger names unknown scope "planet"');
    expect(() =>
      validateScriptReferences(["country"], [], [trigger(), trigger()], [])
    ).toThrowError('duplicate trigger method "sampleTrigger"');
    expect(() =>
      validateScriptReferences(
        ["country"],
        [],
        [trigger({ method: "first" }), trigger({ method: "second" })],
        []
      )
    ).toThrowError('duplicate fixed trigger key "sample_trigger"');
  });
});

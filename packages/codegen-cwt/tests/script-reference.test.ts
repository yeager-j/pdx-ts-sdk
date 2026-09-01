import {
  emitScriptReferences,
  validateScriptReferences,
  type ScriptEffectReferenceRow,
  type ScriptTriggerReferenceRow,
  type StructuralScriptClaims,
} from "@pdx-ts/codegen-cwt/emit/script/script-reference";
import type { StructuralEffectIdentity } from "@pdx-ts/codegen-cwt/policy/effects";
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

/** No hand-written structural rows, so a case exercises only the generated rows. */
const NO_STRUCTURAL: StructuralScriptClaims = { methods: [], keys: [] };

/**
 * A miniature of the real structural surface: one method with a fixed key, one
 * without, and a structural-owned key (`else`) that no public method records.
 */
const structural = (overrides: Partial<StructuralScriptClaims> = {}): StructuralScriptClaims => ({
  methods: [
    { method: "if", key: "if" },
    { method: "run", key: null },
  ],
  keys: ["if", "else"],
  ...overrides,
});

/** A structural method declaring it shares its fixed key with a generated effect. */
const sharing = (method: string, key: string): StructuralEffectIdentity => ({
  method,
  key,
  sharesKeyWithGenerated: { reason: "both methods record the same block" },
});

describe("script reference metadata validation", () => {
  it("emits canonical rows and preserves universal availability", () => {
    const result = emitScriptReferences(
      ["country", "planet"],
      NO_STRUCTURAL,
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
        NO_STRUCTURAL,
        [effect({ availability: { kind: "scopes", scopes: ["planet"] } })],
        [],
        []
      )
    ).toThrowError('effect sampleEffect names unknown scope "planet"');
  });

  it("rejects duplicate effect members and fixed keys", () => {
    expect(() =>
      validateScriptReferences(["country"], NO_STRUCTURAL, [effect(), effect()], [], [])
    ).toThrowError('duplicate effect member "sampleEffect"');
    expect(() =>
      validateScriptReferences(
        ["country"],
        NO_STRUCTURAL,
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
        NO_STRUCTURAL,
        [effect(), effect({ availability: { kind: "scopes", scopes: ["planet"] } })],
        [],
        []
      )
    ).toThrowError('contradictory effect member "sampleEffect"');
    expect(() =>
      validateScriptReferences(
        ["country", "planet"],
        NO_STRUCTURAL,
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
        NO_STRUCTURAL,
        [],
        [trigger({ availability: { kind: "scopes", scopes: ["planet"] } })],
        []
      )
    ).toThrowError('trigger sampleTrigger names unknown scope "planet"');
    expect(() =>
      validateScriptReferences(["country"], NO_STRUCTURAL, [], [trigger(), trigger()], [])
    ).toThrowError('duplicate trigger method "sampleTrigger"');
    expect(() =>
      validateScriptReferences(
        ["country"],
        NO_STRUCTURAL,
        [],
        [trigger({ method: "first" }), trigger({ method: "second" })],
        []
      )
    ).toThrowError('duplicate fixed trigger key "sample_trigger"');
  });
});

/**
 * The emitted catalog appends the hand-written structural rows after the generated
 * ones (SDK-363), so a generated row that steals a structural method or key would
 * otherwise reach the committed module unchecked.
 */
describe("structural identity claims", () => {
  it("rejects a generated key that duplicates a structural method's fixed key", () => {
    expect(() =>
      validateScriptReferences(["country"], structural(), [effect({ key: "if" })], [], [])
    ).toThrowError('duplicate fixed script key "if" on if and sampleEffect');
  });

  it("rejects a generated method that duplicates a structural method", () => {
    expect(() =>
      validateScriptReferences(
        ["country"],
        structural(),
        [effect({ method: "run", key: "run_effect" })],
        [],
        []
      )
    ).toThrowError('effect member "run" collides with a structural effect method');
  });

  it("rejects two structural identities sharing a fixed key", () => {
    expect(() =>
      validateScriptReferences(
        ["country"],
        structural({
          methods: [
            { method: "if", key: "if" },
            { method: "whileLoop", key: "if" },
          ],
        }),
        [],
        [],
        []
      )
    ).toThrowError('duplicate fixed script key "if" on if and whileLoop');
  });

  it("rejects a generated key that duplicates a structural key with no public method", () => {
    expect(() =>
      validateScriptReferences(["country"], structural(), [effect({ key: "else" })], [], [])
    ).toThrowError(
      'duplicate fixed script key "else" on the structural effect surface and sampleEffect'
    );
  });

  it("accepts generated rows that avoid every structural method and key", () => {
    expect(() =>
      emitScriptReferences(["country"], structural(), [effect()], [], [])
    ).not.toThrowError();
  });

  it("accepts a declared shared key that a generated row records", () => {
    expect(() =>
      emitScriptReferences(
        ["country"],
        structural({ methods: [sharing("previewModifier", "tooltip")] }),
        [effect({ method: "tooltip", key: "tooltip" })],
        [],
        []
      )
    ).not.toThrowError();
  });

  it("rejects a declared shared key that no generated row records", () => {
    expect(() =>
      validateScriptReferences(
        ["country"],
        structural({ methods: [sharing("previewModifier", "tooltip")] }),
        [effect()],
        [],
        []
      )
    ).toThrowError(
      'structural method "previewModifier" shares fixed script key "tooltip" with a generated effect that does not exist'
    );
  });

  it("rejects two structural identities sharing a fixed key even when the share is declared", () => {
    expect(() =>
      validateScriptReferences(
        ["country"],
        structural({
          methods: [sharing("previewModifier", "tooltip"), sharing("whileLoop", "tooltip")],
        }),
        [effect({ method: "tooltip", key: "tooltip" })],
        [],
        []
      )
    ).toThrowError('duplicate fixed script key "tooltip" on previewModifier and whileLoop');
  });
});

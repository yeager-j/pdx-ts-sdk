/**
 * SDK-363: structural method-to-key identity has one authority, the effect
 * policy. Two derivations sit downstream of it — the committed
 * `STRUCTURAL_EFFECT_IDENTITY` constant, and the hand-written reference ledger
 * that reads its keys from that constant — and neither is regenerated when the
 * policy table changes. This test measures both against a policy computed from
 * the vendored rules, so an uncommitted regeneration fails here.
 *
 * It reads the SDK by relative path, the way `tests/overlay-audit.test.ts`
 * does. `packages/codegen-cwt/src/` may never import the SDK it generates into;
 * a test may, because it is the only place the two ends can be compared.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { createEffectPolicy } from "@pdx-ts/codegen-cwt/policy/effects";
import { describe, expect, it } from "vitest";

import { STRUCTURAL_EFFECT_IDENTITY } from "../../sdk/src/generated/effect-policy.ts";
import { STRUCTURAL_EFFECT_REFERENCES } from "../../sdk/src/script/effects/structural-reference.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));
const policy = createEffectPolicy(rules);

/** The fixed key a reference row carries, with an absent `key` read as "records none". */
function fixedKeyOf(row: (typeof STRUCTURAL_EFFECT_REFERENCES)[number]): string | null {
  return "key" in row ? row.key : null;
}

describe("structural effect identity", () => {
  it("keeps the generated identity constant equal to the policy", () => {
    expect(STRUCTURAL_EFFECT_IDENTITY.map((identity) => ({ ...identity }))).toEqual([
      ...policy.structuralIdentity,
    ]);
  });

  it("gives every reference row exactly the policy's key for its method", () => {
    const rowsByMethod = new Map<string, (typeof STRUCTURAL_EFFECT_REFERENCES)[number]>(
      STRUCTURAL_EFFECT_REFERENCES.map((reference) => [reference.method, reference])
    );
    expect([...rowsByMethod.keys()].sort()).toEqual(
      policy.structuralIdentity.map((identity) => identity.method)
    );
    for (const identity of policy.structuralIdentity) {
      const row = rowsByMethod.get(identity.method);
      expect(fixedKeyOf(row!)).toBe(identity.key);
      if (identity.key === null) {
        expect(row).not.toHaveProperty("key");
      }
    }
  });
});

/**
 * SDK-37: subtype-qualified reference targets bypassed `buildMod`'s
 * dangling-reference guard (`compiler/references.ts`) entirely.
 *
 * `registriesByTarget` matched a *qualified* target (e.g.
 * `civic_or_origin.civic`) only when a registry's own `referenceName` was
 * itself qualified — true only of the three split `component_template`
 * registries. A registry whose `referenceName` is bare, like
 * `civic_or_origin` or `component_set`, never registered a qualified key, so
 * a field whose `refTypes` named the qualified form resolved to "nothing
 * here could have defined it" and was silently skipped. Independently, the
 * `government_trigger` clause emitter recorded no `refTypes` at all for any
 * of its ten domain clauses (`authority`, `civics`, `origin`, ...) — one
 * untyped field table shared by every member — so a dangling id inside a
 * `possible`/`potential` clause was never even recorded as a reference, let
 * alone checked.
 *
 * Each `it` below is a throw-assertion that fails on `main` and passes with
 * the fix. The control sits beside them, exercising a guard path that
 * already worked, so a future refactor that weakens or removes the guard
 * cannot pass this suite vacuously.
 */
import { describe, expect, it } from "vitest";

import { createMod } from "../src/index.ts";

function configFor(prefix: string) {
  return { name: "Reference guard test", prefix, supportedVersion: "4.4.*" };
}

describe("SDK-37: subtype-qualified reference targets", () => {
  const CONFIG = configFor("referenceguard");
  const mod = createMod(CONFIG);

  it("control: a dangling technology prerequisite still throws", () => {
    const dangling = mod.technology("dangling", {
      name: "Dangling",
      area: "physics",
      category: ["computing"],
      tier: 1,
      cost: 100,
      prerequisites: ["referenceguard_tech_does_not_exist"],
    });

    expect(() => mod.compile([mod.feature("dangling_tech", [dangling])])).toThrow(
      /no such technology/
    );
  });

  it("catches a dangling id in a field whose refTypes were always recorded (registriesByTarget bare/qualified mismatch)", () => {
    // `alternateCivicVersion` records `refTypes: ["civic_or_origin.civic"]`
    // (generated/civic-or-origin.ts) unconditionally — that part was never
    // the bug. `civic_or_origin`'s own `referenceName` is the bare
    // "civic_or_origin" (generated/content-registry.ts), so before the fix
    // `registriesByTarget` held no key matching the qualified target and
    // this reference went unchecked no matter what it named.
    const dangling = mod.civicOrOrigin("dangling", {
      alternateCivicVersion: "referenceguard_civic_does_not_exist",
    });

    expect(() => mod.compile([mod.feature("dangling_civic_alt", [dangling])])).toThrow(
      /civic_or_origin/
    );
  });

  it("catches a dangling id inside a government_trigger clause (the clause emitter's missing refTypes)", () => {
    // `possible.civics` lowered through one field table
    // (`GOVERNMENT_TRIGGER_CLAUSE_FIELDS`) shared by every government_trigger
    // domain clause, with no `refTypes` recorded for any of them — nothing
    // was ever recorded for this field, so nothing could be checked
    // regardless of how `registriesByTarget` resolved.
    const dangling = mod.civicOrOrigin("clause_dangling", {
      possible: { civics: { nor: [{ values: ["referenceguard_civic_does_not_exist"] }] } },
    });

    expect(() => mod.compile([mod.feature("dangling_civic_clause", [dangling])])).toThrow(
      /civic_or_origin/
    );
  });
});

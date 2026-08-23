/**
 * Every iterator family in the vendored rules must agree on the scope it
 * iterates.
 *
 * `any_X` is a trigger, `count_X` is a trigger, and `every_X` / `random_X` are
 * effects, but all four run their nested block on the same object. The CWT
 * siblings are the only evidence for that object: the game's documentation
 * dumps state a rule's own scopes and never the scope it pushes, so an `any_X`
 * that omits `## push_scope` has nothing else to fall back on. When the four
 * disagree, at least one of them types the wrong scope.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AliasDecl } from "@pdx-ts/codegen-cwt/cwt/rules";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));

/** One sibling rule of an `any_X` iterator and the scope its nested block runs in. */
interface SiblingScope {
  /** The sibling's CWT rule key, for the failure message. */
  readonly key: string;
  /** The scope the sibling pushes, or `null` when it declares none. */
  readonly scope: string | null;
}

/**
 * True for a declaration that is nothing but a spliced trigger clause, which is
 * how the fork writes a scope-changing `any_X` iterator.
 */
function isPureTriggerClauseSplice(declaration: AliasDecl): boolean {
  const type = declaration.type;
  return type.kind === "block" && type.via === "trigger_clause";
}

/**
 * The scope a `count_X` trigger pushes. `count_X` wraps its nested triggers in
 * a `limit` field, so the annotation sits on that field rather than on the
 * declaration.
 */
function limitFieldScope(declaration: AliasDecl): string | null {
  if (declaration.type.kind !== "block") {
    return null;
  }
  const limit = declaration.type.fields.find(
    (field) => field.key.kind === "name" && field.key.name === "limit"
  );
  return limit?.scope?.this ?? null;
}

function siblingScopes(suffix: string): SiblingScope[] {
  const siblings: SiblingScope[] = [];
  const count = rules.triggers.get(`count_${suffix}`);
  if (count !== undefined) {
    siblings.push({ key: `count_${suffix}`, scope: limitFieldScope(count[0]!) });
  }
  for (const prefix of ["every", "random", "ordered"]) {
    const effect = rules.effects.get(`${prefix}_${suffix}`);
    if (effect !== undefined) {
      siblings.push({ key: `${prefix}_${suffix}`, scope: effect[0]!.scope?.this ?? null });
    }
  }
  return siblings;
}

describe("iterator push scopes", () => {
  const families = [...rules.triggers]
    .filter(
      ([key, declarations]) =>
        key.startsWith("any_") &&
        declarations.length === 1 &&
        isPureTriggerClauseSplice(declarations[0]!)
    )
    .map(([key, declarations]) => ({
      key,
      scope: declarations[0]!.scope?.this ?? null,
      siblings: siblingScopes(key.slice("any_".length)),
    }));

  it("covers every spliced any_X iterator in the rules", () => {
    expect(families.length).toBeGreaterThan(100);
    expect(families.every((family) => family.siblings.length > 0)).toBe(true);
  });

  it("agree with the count_X, every_X, random_X and ordered_X siblings", () => {
    const mismatches = families.flatMap((family) =>
      family.siblings
        .filter((sibling) => sibling.scope !== family.scope)
        .map(
          (sibling) =>
            `${family.key} pushes ${family.scope ?? "no scope"}, ` +
            `but ${sibling.key} pushes ${sibling.scope ?? "no scope"}`
        )
    );

    expect(mismatches.join("\n")).toBe("");
  });
});

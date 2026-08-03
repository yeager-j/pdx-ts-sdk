/**
 * SDK-38: nested-definition ids (a tradition's own `tradition_swap` entries)
 * never reached `builtIds`, `buildMod`'s index (`build.ts`) of what a build
 * actually defined.
 *
 * `ContentAuthoring` already tracked nested ids in `nestedIds` for its own
 * prefix and duplicate checks, but `buildMod` populated `builtIds` only from
 * top-level `defined.id`. A mod referencing its own, same-collection swap
 * (`hasTradition("<prefix>_<swap id>")`) was rejected as if the swap did not
 * exist.
 *
 * The second `it` below is a not-throw assertion that fails on `main` (the
 * guard incorrectly rejects a legitimate same-collection reference) and
 * passes with the fix. The control sits beside it, exercising a guard path
 * that already worked, so a future refactor that folds *every* nested id
 * into `builtIds` — not just the ones with a real `base_type` relationship —
 * cannot pass this suite vacuously.
 */
import { describe, expect, it } from "vitest";

import {
  buildMod,
  collection,
  defineTechnology,
  defineTradition,
  hasTradition,
} from "../src/index.ts";

function configFor(prefix: string) {
  return { name: "Reference guard test", prefix, supportedVersion: "4.4.*" };
}

describe("SDK-38: nested definition ids never entered builtIds", () => {
  const CONFIG = configFor("referenceguard");

  it("control: a dangling top-level tradition reference still throws", () => {
    const dangling = defineTechnology({
      id: "referenceguard_tech_tradition_check",
      name: "Tradition check",
      area: "physics",
      category: ["computing"],
      tier: 1,
      cost: 100,
      potential: hasTradition("referenceguard_tr_does_not_exist"),
    });

    expect(() => buildMod(CONFIG, [collection("dangling_tradition", [dangling])])).toThrow(
      /no such tradition/
    );
  });

  it("does not throw referencing its own tradition_swap id, defined in the same collection", () => {
    const tradition = defineTradition({
      id: "referenceguard_tr_adopt",
      name: "Adopt",
      traditionSwap: {
        referenceguard_tr_adopt_swap_nomad: { name: "Nomad Swap" },
      },
    });
    const checksSwap = defineTechnology({
      id: "referenceguard_tech_swap_check",
      name: "Swap check",
      area: "physics",
      category: ["computing"],
      tier: 1,
      cost: 100,
      potential: hasTradition("referenceguard_tr_adopt_swap_nomad"),
    });

    expect(() =>
      buildMod(CONFIG, [collection("swap_reference", [tradition, checksSwap])])
    ).not.toThrow();
  });
});

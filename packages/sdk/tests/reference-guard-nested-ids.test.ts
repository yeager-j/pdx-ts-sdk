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
 * The fold now reads swap ids directly off each definition's own resolved
 * `def`, for every registry the vendored rules declare a `base_type`
 * relationship for (`tradition`, `ascension_perk`, `civic_or_origin`,
 * `technology`, `job` — see `build.ts`'s `SWAP_IDENTITIES` for the complete,
 * mechanically-sourced list). A PR review on the SDK-37/38 pair caught that
 * the original fix only covered `tradition`/`ascension_perk`: enabling the
 * `civic_or_origin.civic` guard fallback (SDK-37) without also folding
 * `civic_or_origin.swap_type` ids made a mod's reference to its *own* civic
 * swap — `content_test_civic_meritocracy_swap`-shaped, already present in
 * committed output — a false "no such civic_or_origin.civic" failure. The
 * `technology`/`job` cases below exercise the same shape (CWT's "shape 3":
 * an anonymous repeated block keyed by a `name` body field, distinct from
 * `tradition.tradition_swap`'s record-keyed "shape 2").
 *
 * The not-throw assertions below fail on the pre-fix branch tip (the guard
 * incorrectly rejects a legitimate same-collection reference) and pass with
 * the fix. The controls sit beside them, exercising guard paths that already
 * worked, so a future refactor that folds *every* nested id into `builtIds`
 * — not just the ones with a real `base_type` relationship — cannot pass
 * this suite vacuously.
 */
import { describe, expect, it } from "vitest";

import {
  always,
  createMod,
  hasJobType,
  hasTradition,
  trigger,
  type Trigger,
} from "../src/index.ts";

/**
 * `hasJobType` is `Trigger<"pop_job">`, and `Trigger<in S>` is contravariant
 * — `job.possible` wants `Trigger<"pop_group">` specifically. Re-labelling
 * through the public `trigger(entries, refs)` constructor is the same
 * supported assertion the pure-api-probe fixture uses for an identical
 * scope mismatch (its `inCountryScope`), not a cast: the entries and
 * recorded refs are carried over unchanged.
 */
const asPopGroupTrigger = (condition: Trigger<"pop_job">): Trigger<"pop_group"> =>
  trigger([...condition.entries], [...condition.refs]);

function configFor(prefix: string) {
  return { name: "Reference guard test", prefix, supportedVersion: "4.4.*" };
}

describe("SDK-38: nested definition ids never entered builtIds", () => {
  const CONFIG = configFor("referenceguard");
  const mod = createMod(CONFIG);

  it("control: a dangling top-level tradition reference still throws", () => {
    const dangling = mod.technology("tradition_check", {
      name: "Tradition check",
      area: "physics",
      category: ["computing"],
      tier: 1,
      cost: 100,
      potential: hasTradition("referenceguard_tr_does_not_exist"),
    });

    expect(() => mod.compile([mod.feature("dangling_tradition", [dangling])])).toThrow(
      /no such tradition/
    );
  });

  it("does not throw referencing its own tradition_swap id, defined in the same collection", () => {
    const tradition = mod.tradition("adopt", {
      name: "Adopt",
      traditionSwap: {
        referenceguard_tr_adopt_swap_nomad: { name: "Nomad Swap" },
      },
    });
    const checksSwap = mod.technology("swap_check", {
      name: "Swap check",
      area: "physics",
      category: ["computing"],
      tier: 1,
      cost: 100,
      potential: hasTradition("referenceguard_tr_adopt_swap_nomad"),
    });

    expect(() =>
      mod.compile([mod.feature("swap_reference", [tradition, checksSwap])])
    ).not.toThrow();
  });

  it("control: a dangling civic_or_origin.civic reference still throws", () => {
    const dangling = mod.civicOrOrigin("control", {
      alternateCivicVersion: "referenceguard_civic_does_not_exist",
    });

    expect(() => mod.compile([mod.feature("dangling_civic_control", [dangling])])).toThrow(
      /civic_or_origin/
    );
  });

  it("does not throw referencing its own civic swap id, defined in the same collection", () => {
    // `civic_or_origin.swap_type` is CWT "shape 3" (`type[swapped_civic]`,
    // `name_field = "name"`, `base_type = civic_or_origin.civic` —
    // governments.cwt:95-100): an anonymous repeated block whose `name` is
    // the swap's own definition id, not a record key like
    // `tradition.tradition_swap`.
    const withSwap = mod.civicOrOrigin("meritocracy", {
      name: "Meritocracy",
      swapType: [{ name: "referenceguard_civic_meritocracy_swap", trigger: always() }],
    });
    const referencesSwap = mod.civicOrOrigin("references_swap", {
      alternateCivicVersion: "referenceguard_civic_meritocracy_swap",
    });

    expect(() =>
      mod.compile([mod.feature("civic_swap_reference", [withSwap, referencesSwap])])
    ).not.toThrow();
  });

  it("does not throw referencing its own technology_swap id, defined in the same collection", () => {
    const withSwap = mod.technology("with_swap", {
      name: "With Swap",
      area: "physics",
      category: ["computing"],
      tier: 1,
      cost: 100,
      technologySwap: [{ name: "referenceguard_tech_with_swap_advanced" }],
    });
    const checksSwap = mod.technology("checks_swap", {
      name: "Checks Swap",
      area: "physics",
      category: ["computing"],
      tier: 1,
      cost: 100,
      prerequisites: ["referenceguard_tech_with_swap_advanced"],
    });

    expect(() =>
      mod.compile([mod.feature("technology_swap_reference", [withSwap, checksSwap])])
    ).not.toThrow();
  });

  it("does not throw referencing its own job swap_type id, defined in the same collection", () => {
    const withSwap = mod.job("with_swap", {
      name: "With Swap",
      // `job.swap_type` sits inside the `swappable_data` wrapper CWT
      // declares alongside it, not at the job's own top level.
      swappableData: {
        default: {},
        swapType: [{ name: "referenceguard_job_with_swap_advanced", trigger: always(), weight: 1 }],
      },
    });
    const checksSwap = mod.job("checks_swap", {
      name: "Checks Swap",
      possible: asPopGroupTrigger(hasJobType("referenceguard_job_with_swap_advanced")),
    });

    expect(() =>
      mod.compile([mod.feature("job_swap_reference", [withSwap, checksSwap])])
    ).not.toThrow();
  });

  it("does not fold a swap id into an unrelated registry's built-id set", () => {
    // `SWAP_IDENTITIES` folds every swap id into its *own* registry's
    // `builtIds` set only — `technology`'s and `job`'s are disjoint `Set`s
    // keyed in the same `Map`, so a technology swap id must remain
    // unresolvable through a `<job>`-typed field even though both registries
    // are covered by the fold.
    const withSwap = mod.technology("cross_swap_owner", {
      name: "Cross Swap Owner",
      area: "physics",
      category: ["computing"],
      tier: 1,
      cost: 100,
      technologySwap: [{ name: "referenceguard_tech_cross_swap_advanced" }],
    });
    const wrongRegistry = mod.job("cross_swap_check", {
      name: "Cross Swap Check",
      possible: asPopGroupTrigger(hasJobType("referenceguard_tech_cross_swap_advanced")),
    });

    expect(() =>
      mod.compile([mod.feature("cross_swap_reference", [withSwap, wrongRegistry])])
    ).toThrow(/no such job/);
  });
});

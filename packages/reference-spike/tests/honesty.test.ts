/**
 * The difficult facts stay visible.
 *
 * Every other gate here checks that a page is *correct*. This one checks that
 * it is not *smooth* — that the things a plausible-looking page would quietly
 * round off are still on it, still marked, and still say what nobody knows
 * rather than a guess.
 *
 * The first block is the format's own promise and runs for every page: five
 * statuses, provenance on everything, no orphaned claims, corpus counts out of
 * the reading flow, prose out of the snapshot. The per-page blocks below it are
 * the specific things each registry would be tempted to smooth over.
 *
 * It is written against the committed snapshots rather than a fresh assembly
 * because those are what the viewer renders. A page that was honest at build
 * time and shipped a smoothed-over snapshot would pass every other test in this
 * directory.
 */

import { describe, expect, it } from "vitest";

import type { ReferenceBuild } from "../src/build.ts";
import { pageById, PAGES } from "../src/build/pages.ts";
import { readSnapshot } from "../src/build/snapshot.ts";
import { CLAIM_STATUSES } from "../src/claims.ts";

const claimIn = (build: ReferenceBuild, id: string) => {
  const found = build.claims.find((entry) => entry.id === id);
  expect(found, `claim ${id} is missing from the ${build.pageId} page`).toBeDefined();
  return found!;
};

describe.each(PAGES.map((page) => [page.id, page] as const))(
  "%s distinguishes all five claim statuses",
  (_id, page) => {
    const build = readSnapshot(page);

    it("uses every status", () => {
      const used = new Set([
        ...build.claims.map((entry) => entry.status),
        ...build.conventions.map((entry) => entry.status),
      ]);
      for (const status of CLAIM_STATUSES) {
        expect(used.has(status), `nothing on the page is a ${status}`).toBe(true);
      }
    });

    it("every claim and convention carries provenance", () => {
      for (const entry of [...build.claims, ...build.conventions]) {
        expect(entry.provenance.length, `${entry.id} has no provenance`).toBeGreaterThan(0);
      }
    });

    it("nothing is built that the page does not render", () => {
      const rendered = new Set(
        build.sections.flatMap((section) => [...section.claims, ...section.conventions])
      );
      for (const entry of [...build.claims, ...build.conventions]) {
        // A supporting observation reaches the page through the claim it
        // supports rather than through a `<Claim>` of its own.
        const host = "supports" in entry ? (entry.supports ?? entry.id) : entry.id;
        expect(rendered.has(host), `${entry.id} is never rendered`).toBe(true);
      }
    });

    it("keeps corpus counts out of the reading flow", () => {
      // An observation is evidence, not advice. "4 of 90 shipped types use this
      // form" cannot be acted on, and standing it beside a claim makes a reader
      // weigh the two — so every observed example has to hang off a claim.
      for (const claim of build.claims.filter((entry) => entry.status === "observed-example")) {
        expect(claim.supports, `${claim.id} stands alone`).toBeDefined();
      }
    });

    it("authored prose is in the MDX, not in the snapshot", () => {
      // The line the format depends on: a derived claim carries a generated
      // sentence, a convention carries only the machine half plus an extracted
      // copy for search. If a convention ever gained a `statement`, prose would
      // have started leaking back into TypeScript.
      for (const convention of build.conventions) {
        expect(convention).not.toHaveProperty("statement");
      }
      expect(build.page).toBe(page.mdxPath);
    });

    it("no unresolved claim answers the question it is admitting it cannot", () => {
      // Imperatives only. A claim is allowed to describe the surface in
      // absolute terms — what it must not do is tell the reader what to write,
      // which is the curated convention's job and is marked as such.
      for (const claim of build.claims.filter((entry) => entry.status === "unresolved-behavior")) {
        expect(claim.statement, claim.id).not.toMatch(
          /\byou should\b|\bwe recommend\b|\bnever use\b|\balways use\b|\bprefer\b/i
        );
      }
    });

    it("the field table is the whole surface, not a highlight reel", () => {
      expect(build.fields.length).toBe(build.facts.lowered.length);
      expect(build.fields.some((field) => field.level === "nested")).toBe(true);
    });

    it("says when a key's declaration lives in a shared clause", () => {
      const clause = build.fields.filter((field) => field.declaredIn === "alias-clause");
      expect(clause.length).toBeGreaterThan(0);
    });
  }
);

describe("Situations", () => {
  const build = readSnapshot(pageById("situations"));
  const claim = (id: string) => claimIn(build, id);

  describe("targetScope is presented as an SDK-authored contract", () => {
    it("says the rules declare nothing and nothing is written", () => {
      const contract = claim("target-scope-authored");
      expect(contract.status).toBe("supported-contract");
      expect(contract.statement).toMatch(/not a game field/i);
      expect(contract.provenance.some((entry) => entry.kind === "sdk-source")).toBe(true);
    });

    it("is not in the projected field table", () => {
      expect(build.fields.some((field) => field.key.includes("target_scope"))).toBe(false);
      expect(build.facts.lowered.some((member) => member.key === "target_scope")).toBe(false);
    });

    it("carries the hand-written contract's own explanation of why", () => {
      const contract = build.sdkContracts.find((entry) => entry.member === "targetScope");
      expect(contract?.serialized).toBe(false);
      expect(contract?.whyNotDerived).toMatch(/output_scope = any/);
    });
  });

  describe("the conditional picture form stays a Known omission", () => {
    it("is marked, and names both declared arms", () => {
      const omission = claim("picture-block-omitted");
      expect(omission.status).toBe("known-omission");
      expect(omission.provenance.some((entry) => entry.kind === "recorded-disposition")).toBe(true);
    });

    it("is derived from the arms, not asserted", () => {
      const partial = build.facts.partialLowerings.find((entry) => entry.key === "picture");
      expect(partial?.droppedArms).toEqual(["block"]);
      expect(partial?.keptArm).toBe("<sprite>");
    });

    it("shows what the game does without calling it legality", () => {
      const observed = claim("picture-usage");
      expect(observed.status).toBe("observed-example");
      expect(observed.provenance.some((entry) => entry.kind === "corpus")).toBe(true);
    });
  });

  describe("the stage colour contradiction stays visible", () => {
    it("says the member's own documentation is wrong", () => {
      const contradiction = claim("stage-color-contradiction");
      expect(contradiction.status).toBe("known-omission");
      expect(contradiction.statement).toMatch(/RGBA/);
      expect(contradiction.statement).toMatch(/doc comment as wrong/);
    });

    it("still shows the rules' prose that contradicts the type", () => {
      const row = build.fields.find((field) => field.key === "stages.color");
      expect(row?.docs.join(" ")).toMatch(/numeric RGBA vector/);
      expect(row?.shape).toBe("value");
    });

    it("keeps the single shipped use below the presence floor", () => {
      const row = build.fields.find((field) => field.key === "stages.color");
      expect(row?.evidence?.belowPresenceFloor).toBe(true);
    });
  });

  describe("the progress-mode interaction stays unresolved", () => {
    it("is marked unresolved rather than answered", () => {
      const unresolved = claim("progress-mode-unresolved");
      expect(unresolved.status).toBe("unresolved-behavior");
      expect(unresolved.statement).toMatch(/not something the surface can tell you/);
    });

    it("says the discriminator is not modeled", () => {
      const dynamic = build.facts.subtypes.find((entry) => entry.name === "dynamic_progress");
      expect(dynamic?.absentUnless).toBeNull();
      expect(dynamic?.gatedKeys).toContain("stages.section_weight");
      expect(dynamic?.excludedKeys).toContain("stages.end");
    });

    it("keeps the recommendation that routes around it separate, and curated", () => {
      // The advice sits directly beneath the gap, which is where it is most
      // useful — "here is the hole, here is how to walk around it". What must
      // not happen is the two reading as one statement, so this checks they stay
      // distinct claims with distinct statuses, and that the advice says out
      // loud that it is advice.
      const convention = build.conventions.find((entry) => entry.id === "prefer-end");
      expect(convention?.status).toBe("curated-convention");
      expect(convention?.text).toMatch(/recommendation/);
      expect(build.claims.some((entry) => entry.id === "prefer-end")).toBe(false);
    });
  });

  it("marks the one place the rules pin no scope", () => {
    const stage = build.fields.find((field) => field.key === "stages.target_modifier");
    const approach = build.fields.find((field) => field.key === "approach.target_modifier");
    expect(stage?.scope).toBe("any");
    expect(approach?.scope).toBe("planet");
  });

  it("has no Recipe to show, and every story says it was hand-written", () => {
    expect(build.stories.every((story) => story.origin === "hand-written")).toBe(true);
  });
});

describe("Technologies", () => {
  const build = readSnapshot(pageById("technology"));
  const claim = (id: string) => claimIn(build, id);

  describe("the start-subtype gap stays unresolved", () => {
    it("is marked unresolved rather than answered", () => {
      const unresolved = claim("start-subtype-unresolved");
      expect(unresolved.status).toBe("unresolved-behavior");
      expect(unresolved.statement).toMatch(/cannot tell which one you are writing/);
    });

    it("says the discriminator is not modeled, from the facts rather than from prose", () => {
      const start = build.facts.subtypes.find((entry) => entry.name === "start");
      expect(start?.absentUnless).toBeNull();
      // The contradiction the claim is about: one subtype declares the same two
      // keys on both sides of itself, so neither side can be enforced.
      const contested = (start?.gatedKeys ?? []).filter((key) =>
        (start?.excludedKeys ?? []).includes(key)
      );
      expect(contested).toEqual(["cost", "weight"]);
    });

    it("leaves cost optional on the surface, which is the whole problem", () => {
      const cost = build.fields.find((field) => field.key === "cost");
      expect(cost?.required).toBe(false);
      expect(cost?.shape).toBe("dual");
    });

    it("keeps the advice that routes around it separate, and curated", () => {
      const convention = build.conventions.find((entry) => entry.id === "always-cost");
      expect(convention?.status).toBe("curated-convention");
      expect(build.claims.some((entry) => entry.id === "always-cost")).toBe(false);
    });
  });

  describe("the two arity departures are derived in both directions", () => {
    it("reports the narrowing as a Known omission with a recorded disposition", () => {
      const narrowed = claim("group-weights-narrowed");
      expect(narrowed.status).toBe("known-omission");
      expect(narrowed.provenance.some((entry) => entry.kind === "recorded-disposition")).toBe(true);
      // Derived, not asserted: the rules say unbounded, the member says single.
      const declared = build.facts.declared.find(
        (entry) => entry.key === "mod_weight_if_group_picked"
      );
      expect(declared?.arms[0]?.cardinality.max).toBeNull();
      expect(
        build.fields.find((field) => field.key === "mod_weight_if_group_picked")?.repeated
      ).toBe(false);
    });

    it("reports the widening the other way, with the game as the reason", () => {
      const widened = claim("unlock-lines");
      expect(widened.status).toBe("supported-contract");
      const declared = build.facts.declared.find((entry) => entry.key === "prereqfor_desc");
      expect(declared?.arms[0]?.cardinality.max).toBe(1);
      expect(build.fields.find((field) => field.key === "prereqfor_desc")?.repeated).toBe(true);
      expect(claim("unlock-lines-usage").status).toBe("observed-example");
    });
  });

  describe("the patch surface is projected rather than announced", () => {
    it("is claimed because the emission carries rewritable slots", () => {
      expect(build.facts.patchLocalisation.length).toBeGreaterThan(0);
      expect(claim("patch-surface").status).toBe("supported-contract");
    });

    it("keeps the alternation group a Known omission of the definition surface", () => {
      const omission = claim("or-groups-omitted");
      expect(omission.status).toBe("known-omission");
      expect(build.facts.patchWidenings.join(" ")).toMatch(/AnyOf<TechnologyRef>/);
      // The definition's own member is a flat list, which is what makes the
      // patch input a widening rather than a shared shape.
      expect(build.fields.find((field) => field.key === "prerequisites")?.shape).toBe("valueList");
    });

    it("cites the override table it cannot derive, as an SDK-authored contract", () => {
      const contract = build.sdkContracts.find((entry) => entry.member === "mod.patchTechnology");
      expect(contract?.whyNotDerived).toMatch(/No rule file describes/);
    });
  });

  it("says a display name is the SDK's requirement and not the rules'", () => {
    const contract = build.sdkContracts.find((entry) => entry.member === "name");
    expect(contract).toBeDefined();
    // The rules genuinely do not mark it required — which is the fact that
    // makes the contract necessary rather than decorative.
    expect(build.facts.localisation.find((slot) => slot.member === "name")?.required).toBe(false);
  });

  it("shows the Recipe's own output, marked as a Recipe", () => {
    const recipes = build.stories.filter((story) => story.origin === "recipe");
    expect(recipes).toHaveLength(1);
    const [starter] = recipes;
    expect(starter?.source).toMatch(/^npx create-stellaris-mod generate technology /);
    // The bytes are the Catalog's, not the page's: the import a scaffolded
    // project's files carry is the tell, and no hand-written story has it.
    expect(starter?.code).toContain('import { mod } from "#mod";');
    expect(build.stories.filter((story) => story.origin === "hand-written").length).toBeGreaterThan(
      3
    );
    for (const story of build.stories.filter((entry) => entry.origin === "hand-written")) {
      expect(story.code, `${story.id} imports #mod`).not.toContain('from "#mod"');
    }
  });
});

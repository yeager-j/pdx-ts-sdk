/**
 * Projection parity: every committed snapshot still describes the real surface.
 *
 * This is the gate that makes a snapshot a contribution rather than a copy.
 * It re-runs the probe against the vendored rules and compares the result to
 * what was committed, so a codegen change that moves the authoring model fails
 * here — before anybody reads a page that now describes a surface nobody ships.
 *
 * The negative controls run in the same file on purpose. A parity assertion
 * with no demonstration that it can fail is a green test with unknown reach.
 * They are written against the Situation page, because a mutation is a surgical
 * edit to one registry's facts; what they demonstrate about the comparison is
 * true of every page that goes through it.
 */

import { describe, expect, it } from "vitest";

import { assembleReferenceBuild } from "../src/build/assemble.ts";
import { pageById, PAGES } from "../src/build/pages.ts";
import { readSnapshot } from "../src/build/snapshot.ts";
import { probeRegistryFacts } from "../src/probe/codegen-probe.ts";
import { FORMATTING_MUTATIONS, SEMANTIC_MUTATIONS } from "./mutations.ts";

describe.each(PAGES.map((page) => [page.id, page] as const))(
  "projection parity — %s",
  (_id, page) => {
    const committed = readSnapshot(page);

    it("the committed snapshot matches what the sources project today", () => {
      const fresh = assembleReferenceBuild(page);
      expect(JSON.parse(JSON.stringify(fresh))).toEqual(committed);
    });

    it("the probe is deterministic", () => {
      expect(probeRegistryFacts(page.registry)).toEqual(probeRegistryFacts(page.registry));
    });

    it("records the five source versions", () => {
      for (const [key, value] of Object.entries(committed.identity)) {
        expect(value, `${key} is empty`).toBeTruthy();
      }
      expect(committed.identity.cwtCommit).toMatch(/^[0-9a-f]{40}$/);
    });

    it("names the page it was built for", () => {
      expect(committed.pageId).toBe(page.id);
      expect(committed.registry).toBe(page.registry);
      expect(committed.page).toBe(page.mdxPath);
    });
  }
);

describe("negative controls, on the Situation page", () => {
  const situations = pageById("situations");
  const committed = readSnapshot(situations);

  describe("a semantic change breaks parity", () => {
    for (const mutation of SEMANTIC_MUTATIONS) {
      it(mutation.name, () => {
        // Two acceptable outcomes, and both are the gate working. Usually the
        // build differs from what was committed. Sometimes it refuses to
        // assemble at all — a fact the page renders by id can vanish, and a
        // `<Claim>` that resolves to nothing is caught before it can render as
        // a paragraph the page silently stopped writing. What must never
        // happen is the mutated sources producing the committed page.
        let built: unknown = null;
        let threw = false;
        try {
          built = JSON.parse(
            JSON.stringify(
              assembleReferenceBuild(
                situations,
                mutation.apply(probeRegistryFacts(situations.registry))
              )
            )
          );
        } catch {
          threw = true;
        }
        if (!threw) {
          expect(
            built,
            `${mutation.name} did not move the projection, so parity is not watching it`
          ).not.toEqual(committed);
        }
      });
    }
  });

  describe("formatting alone does not", () => {
    for (const mutation of FORMATTING_MUTATIONS) {
      it(mutation.name, () => {
        const mutated = assembleReferenceBuild(
          situations,
          mutation.apply(probeRegistryFacts(situations.registry))
        );
        // Line numbers and member order are presentation: a gate that failed on
        // them would be a gate a maintainer stops reading.
        expect(mutated.facts.repeatedStructs).toEqual(committed.facts.repeatedStructs);
        expect(mutated.facts.partialLowerings).toEqual(committed.facts.partialLowerings);
        expect([...mutated.facts.lowered].sort((a, b) => (a.key < b.key ? -1 : 1))).toEqual(
          [...committed.facts.lowered].sort((a, b) => (a.key < b.key ? -1 : 1))
        );
      });
    }
  });
});

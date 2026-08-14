/**
 * Curated guidance is only as good as the facts it was written about.
 *
 * Every curated convention on every page declares the contracts and evidence it
 * interpreted. This recomputes each declared fingerprint from today's facts and
 * fails when a contract dependency moved — the advice was written about a
 * surface that no longer exists — and reports when an evidence dependency
 * moved, which needs a person rather than a build failure.
 *
 * The generic half runs for every page. The negative controls are the Situation
 * page's, because a negative control is a surgical edit to one registry's facts
 * and cannot be written once for all of them: they demonstrate both halves —
 * a semantic change to a depended-on fact invalidates the guidance that named
 * it and leaves the rest alone, and a formatting change invalidates nothing.
 */

import { describe, expect, it } from "vitest";

import type { CuratedConvention } from "../src/build.ts";
import { curatedConventions } from "../src/build/conventions.ts";
import { readRegistryEvidence } from "../src/build/corpus-evidence.ts";
import { fingerprintOf } from "../src/build/fingerprints.ts";
import { parsePage } from "../src/build/mdx.ts";
import { pageById, PAGES, type ReferencePage } from "../src/build/pages.ts";
import type { RegistryFacts } from "../src/facts.ts";
import { probeRegistryFacts } from "../src/probe/codegen-probe.ts";
import { FORMATTING_MUTATIONS, SEMANTIC_MUTATIONS } from "./mutations.ts";

function assemble(page: ReferencePage) {
  const facts = probeRegistryFacts(page.registry);
  const evidence = readRegistryEvidence(facts.registry);
  const parsed = parsePage(page);
  return {
    facts,
    evidence,
    parsed,
    claims: page.claims(facts, evidence, page),
    curated: curatedConventions(
      page.conventions,
      facts,
      evidence,
      parsed.conventions,
      page.mdxPath
    ),
  };
}

/** Which recorded dependencies no longer match the facts they were taken from. */
function staleAgainst(
  curated: readonly CuratedConvention[],
  against: RegistryFacts
): { claim: string; subject: string; kind: string }[] {
  const currentEvidence = readRegistryEvidence(against.registry);
  return curated.flatMap((claim) =>
    claim.guidance
      .filter(
        (dependency) =>
          fingerprintOf(dependency.subject, against, currentEvidence) !== dependency.fingerprint
      )
      .map((dependency) => ({
        claim: claim.id,
        subject: dependency.subject,
        kind: dependency.kind,
      }))
  );
}

describe.each(PAGES.map((page) => [page.id, page] as const))(
  "curated guidance freshness — %s",
  (_id, page) => {
    const { facts, evidence, parsed, claims, curated } = assemble(page);

    it("every curated convention declares at least one dependency", () => {
      expect(curated.length).toBeGreaterThan(0);
      for (const claim of curated) {
        expect(claim.guidance.length, `${claim.id} declares no dependencies`).toBeGreaterThan(0);
      }
    });

    it("only curated conventions carry dependencies", () => {
      for (const claim of claims) {
        expect(claim.guidance, `${claim.id} is derived but declares dependencies`).toEqual([]);
        expect(claim.status, `${claim.id} is curated but built as a derived claim`).not.toBe(
          "curated-convention"
        );
      }
    });

    it("every declared convention is written on the page, and every written one declared", () => {
      expect(curated.map((entry) => entry.id).sort()).toEqual(
        parsed.conventions.map((entry) => entry.id).sort()
      );
      for (const convention of curated) {
        expect(convention.text.length, `${convention.id} has no prose`).toBeGreaterThan(80);
      }
    });

    it("no recorded fingerprint is stale against today's facts", () => {
      expect(staleAgainst(curated, facts)).toEqual([]);
    });

    it("a dependency the fingerprinter cannot compute is refused", () => {
      expect(() => fingerprintOf("nonsense:whatever", facts, evidence)).toThrow(
        /no fingerprint is defined/
      );
    });
  }
);

describe("negative controls, on the Situation page's facts", () => {
  const { facts, curated } = assemble(pageById("situations"));
  const stale = (against: RegistryFacts) => staleAgainst(curated, against);

  describe("changing a depended-on fact invalidates its guidance", () => {
    for (const mutation of SEMANTIC_MUTATIONS.filter((entry) => entry.invalidates.length > 0)) {
      it(mutation.name, () => {
        const invalidated = stale(mutation.apply(facts));
        expect(invalidated.length, `${mutation.name} invalidated nothing`).toBeGreaterThan(0);
        for (const subject of mutation.invalidates) {
          expect(
            invalidated.some((entry) => entry.subject === subject),
            `${mutation.name} should have invalidated ${subject}, invalidated ${JSON.stringify(
              invalidated
            )}`
          ).toBe(true);
        }
      });
    }
  });

  it("unrelated guidance survives a targeted change", () => {
    const mutation = SEMANTIC_MUTATIONS.find((entry) => entry.name.startsWith("stages becomes"))!;
    const invalidated = stale(mutation.apply(facts)).map((entry) => entry.claim);
    expect(invalidated).toContain("two-stages");
    expect(invalidated).not.toContain("progress-desc");
    expect(invalidated).not.toContain("default-approach");
  });

  describe("formatting invalidates nothing", () => {
    for (const mutation of FORMATTING_MUTATIONS) {
      it(mutation.name, () => {
        expect(stale(mutation.apply(facts))).toEqual([]);
      });
    }
  });
});

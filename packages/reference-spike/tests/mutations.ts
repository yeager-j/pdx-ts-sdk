/**
 * The negative controls, as data.
 *
 * Two of the spike's acceptance claims are about failure: a semantic contract
 * change must break projection parity, and a change to a depended-on fact must
 * invalidate the curated guidance that interpreted it. Neither claim is worth
 * anything unless the failure is demonstrated, so each mutation below is a
 * deliberate, surgical edit to the probed facts that the gates then run
 * against.
 *
 * The formatting-only mutations are the other half, and the more important
 * one. A gate that fires on everything is a gate a maintainer learns to
 * ignore. These prove the parity comparison and the fingerprints survive key
 * reordering, member reordering and line-number movement — the three things
 * that change constantly and mean nothing.
 */

import type { RegistryFacts } from "../src/facts.ts";

export interface Mutation {
  readonly name: string;
  readonly what: string;
  /** Which guidance subjects a maintainer should expect this to invalidate. */
  readonly invalidates: readonly string[];
  readonly apply: (facts: RegistryFacts) => RegistryFacts;
}

/** Deep structural clone, so a mutation cannot leak into the next test. */
function clone(facts: RegistryFacts): RegistryFacts {
  return structuredClone(facts) as RegistryFacts;
}

export const SEMANTIC_MUTATIONS: readonly Mutation[] = [
  {
    name: "stages becomes siblings-keyed",
    what:
      "The emitted layout flips: the whole `stages-layout` contract and every curated sentence " +
      "about writing entries inside one block stop being true.",
    invalidates: ["layout:stages", "member:stages"],
    apply: (facts) => {
      const next = clone(facts);
      return {
        ...next,
        repeatedStructs: next.repeatedStructs.map((entry) =>
          entry.key === "stages" ? { ...entry, keying: "siblings", identityKey: "name" } : entry
        ),
        lowered: next.lowered.map((member) =>
          member.key === "stages" ? { ...member, repeated: true } : member
        ),
      };
    },
  },
  {
    name: "monthlyProgress becomes optional",
    what:
      "A required member becomes optional, which changes what the smallest legal definition is " +
      "and makes the page's floor claim wrong.",
    invalidates: ["member:monthly_progress"],
    apply: (facts) => {
      const next = clone(facts);
      return {
        ...next,
        declared: next.declared.map((entry) =>
          entry.key === "monthly_progress"
            ? {
                ...entry,
                arms: entry.arms.map((arm) => ({
                  ...arm,
                  cardinality: { min: 0, max: arm.cardinality.max },
                })),
              }
            : entry
        ),
      };
    },
  },
  {
    name: "picture's block arm is lowered as a dual",
    what:
      "The Known omission is fixed. The page must stop claiming the conditional form is " +
      "unauthorable rather than keep saying so — and because the MDX renders that claim by id, " +
      "assembly refuses to build a page whose <Claim> now resolves to nothing.",
    invalidates: [],
    apply: (facts) => {
      const next = clone(facts);
      return {
        ...next,
        partialLowerings: next.partialLowerings.filter((entry) => entry.key !== "picture"),
        lowered: next.lowered.map((member) =>
          member.key === "picture" ? { ...member, shape: "dual" } : member
        ),
      };
    },
  },
  {
    name: "the dynamic_progress discriminator becomes modeled",
    what:
      "The reason the progress mode is unresolved goes away, and the convention that steers " +
      "authors around it has to be re-read.",
    invalidates: ["subtype:dynamic_progress"],
    apply: (facts) => {
      const next = clone(facts);
      return {
        ...next,
        subtypes: next.subtypes.map((subtype) =>
          subtype.name === "dynamic_progress"
            ? { ...subtype, absentUnless: "total_progress" }
            : subtype
        ),
      };
    },
  },
  {
    name: "a stage target modifier gets pinned to planet",
    what:
      "An unpinned scope becomes pinned, which is the difference between 'nothing is checking " +
      "this' and 'this is checked'.",
    invalidates: ["member:stages.target_modifier"],
    apply: (facts) => {
      const next = clone(facts);
      return {
        ...next,
        lowered: next.lowered.map((member) =>
          member.key === "stages.target_modifier" ? { ...member, scope: ["planet"] } : member
        ),
      };
    },
  },
];

export const FORMATTING_MUTATIONS: readonly Mutation[] = [
  {
    name: "every declaration moves down 100 lines",
    what: "Somebody added a comment block at the top of the rules file.",
    invalidates: [],
    apply: (facts) => {
      const next = clone(facts);
      return {
        ...next,
        declared: next.declared.map((entry) => ({
          ...entry,
          arms: entry.arms.map((arm) => ({ ...arm, line: arm.line + 100 })),
        })),
      };
    },
  },
  {
    name: "the lowered member list is reversed",
    what: "The emitter iterates its fields in a different order.",
    invalidates: [],
    apply: (facts) => {
      const next = clone(facts);
      return { ...next, lowered: [...next.lowered].reverse() };
    },
  },
];

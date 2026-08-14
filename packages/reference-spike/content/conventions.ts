/**
 * What each curated convention depends on. The prose lives in the MDX.
 *
 * The split is the point, and it is the same one the page itself draws: a
 * convention's *text* is authored, so it belongs in `situations.mdx` where
 * somebody can write and edit it like writing; a convention's *dependencies*
 * are a machine-readable contract that has to be typed, resolvable, and
 * checkable, so they belong here. Putting the dependencies in MDX frontmatter
 * would make an unresolvable subject a runtime surprise instead of a build
 * error, and putting the prose here would put us back in a `.ts` file.
 *
 * A subject the fingerprinter does not recognize throws during assembly, so a
 * dependency that would never fire cannot be committed.
 */

/** One curated convention's machine-readable half. */
export interface ConventionDeclaration {
  /** Matches the `<Convention id="…">` in the MDX. */
  readonly id: string;
  /** What the advice is about: a member path, a layout, a capability. */
  readonly subject: string;
  /**
   * Contracts and evidence this judgment interpreted.
   *
   * A `contract` that moves fails the documentation gate — the advice was
   * written about a surface that no longer exists. An `evidence` dependency
   * that moves raises a review item instead: shipped data changed, which may
   * or may not make the advice wrong, and only a person can say which.
   */
  readonly dependsOn: readonly {
    readonly subject: string;
    readonly kind: "contract" | "evidence";
  }[];
  /** Extra provenance beyond the maintainer judgment itself. */
  readonly cites: readonly {
    readonly kind: "corpus" | "sdk-source";
    readonly source: string;
    readonly detail?: string;
  }[];
}

const CORPUS = "packages/sdk/tests/fixtures/corpus/situation_type.json";
const TECHNOLOGY_CORPUS = "packages/sdk/tests/fixtures/corpus/technology.json";

export const SITUATION_CONVENTIONS: readonly ConventionDeclaration[] = [
  {
    id: "two-stages",
    subject: "stages",
    dependsOn: [
      { subject: "layout:stages", kind: "contract" },
      { subject: "member:stages", kind: "contract" },
      { subject: "evidence:stages", kind: "evidence" },
    ],
    cites: [{ kind: "corpus", source: CORPUS, detail: "how many shipped types declare stages" }],
  },
  {
    id: "progress-desc",
    subject: "monthlyProgress",
    dependsOn: [
      { subject: "member:monthly_progress", kind: "contract" },
      { subject: "evidence:monthly_progress.modifier", kind: "evidence" },
    ],
    cites: [{ kind: "corpus", source: CORPUS, detail: "how many write at least one modifier row" }],
  },
  {
    id: "default-approach",
    subject: "approach",
    dependsOn: [
      { subject: "member:approach.default", kind: "contract" },
      { subject: "member:approach.icon", kind: "contract" },
      { subject: "evidence:approach.default", kind: "evidence" },
    ],
    cites: [{ kind: "corpus", source: CORPUS, detail: "how many mark a default approach" }],
  },
  {
    id: "prefer-end",
    subject: "stages.end",
    dependsOn: [
      { subject: "subtype:dynamic_progress", kind: "contract" },
      { subject: "arms:total_progress", kind: "contract" },
      { subject: "evidence:stages.end", kind: "evidence" },
      { subject: "evidence:total_progress", kind: "evidence" },
    ],
    cites: [{ kind: "corpus", source: CORPUS, detail: "how many use per-stage `end`" }],
  },
  {
    id: "declare-target-scope",
    subject: "targetScope",
    dependsOn: [
      // The advice explains that `targetScope` emits nothing. It stops being
      // true the moment the game grows a real key by that name, which is
      // exactly what this fingerprint watches.
      { subject: "absent:target_scope", kind: "contract" },
      { subject: "member:stages.target_modifier", kind: "contract" },
    ],
    cites: [
      {
        kind: "sdk-source",
        source: "packages/sdk/src/script/effects/situations.ts",
        detail: "the checked `startSituation` overload",
      },
    ],
  },
];

export const TECHNOLOGY_CONVENTIONS: readonly ConventionDeclaration[] = [
  {
    id: "always-cost",
    subject: "cost",
    dependsOn: [
      // The advice exists because the surface cannot enforce what the rules
      // ask for. It stops being advice the moment either half moves: `cost`
      // becoming required, or the subtype's discriminator becoming modeled.
      { subject: "member:cost", kind: "contract" },
      { subject: "subtype:start", kind: "contract" },
      { subject: "evidence:cost", kind: "evidence" },
    ],
    cites: [
      {
        kind: "corpus",
        source: TECHNOLOGY_CORPUS,
        detail: "how many shipped technologies write a cost",
      },
    ],
  },
  {
    id: "one-category",
    subject: "category",
    dependsOn: [
      { subject: "member:category", kind: "contract" },
      { subject: "evidence:category", kind: "evidence" },
    ],
    cites: [
      {
        kind: "corpus",
        source: TECHNOLOGY_CORPUS,
        detail: "how many shipped technologies write a category, and in what form",
      },
    ],
  },
  {
    id: "bind-prerequisites",
    subject: "prerequisites",
    dependsOn: [
      { subject: "member:prerequisites", kind: "contract" },
      { subject: "evidence:prerequisites", kind: "evidence" },
    ],
    cites: [
      {
        kind: "corpus",
        source: TECHNOLOGY_CORPUS,
        detail: "how many shipped technologies declare prerequisites",
      },
    ],
  },
  {
    id: "say-what-it-unlocks",
    subject: "prereqforDesc",
    dependsOn: [
      { subject: "member:prereqfor_desc", kind: "contract" },
      { subject: "member:prereqfor_desc.custom.title", kind: "contract" },
      { subject: "evidence:prereqfor_desc", kind: "evidence" },
    ],
    cites: [
      {
        kind: "corpus",
        source: TECHNOLOGY_CORPUS,
        detail: "how many shipped technologies write an unlock line of their own",
      },
    ],
  },
];

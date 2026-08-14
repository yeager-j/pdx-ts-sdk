/**
 * One immutable Reference build: the value the snapshot file holds and the
 * viewer renders.
 *
 * Internal by design. `schemaVersion` exists so the viewer can refuse data it
 * does not understand, not so a third party can depend on the shape — if
 * machine consumers ever become a product, they get a schema designed for them
 * rather than this one promoted. Nothing outside `packages/reference-spike`
 * reads it, and the architecture gate keeps it that way.
 *
 * Browser-safe: types only, so the viewer imports it without dragging Node in.
 */

import type { RegistryEvidence } from "./build/corpus-evidence.ts";
import type { GuidanceDependency, Provenance, ReferenceClaim } from "./claims.ts";
import type { RegistryFacts, SdkAuthoredContract } from "./facts.ts";

/**
 * The exact sources that support this build's claims.
 *
 * All five, always. Evidence extracted from one game build, against rules
 * vendored at one commit, against documentation dumped for one release, is not
 * interchangeable with the same evidence from another — and a page that shows
 * them together without saying so has quietly invented a timeless view of a
 * game that patches every few weeks.
 */
export interface BuildIdentity {
  /** `@pdx-ts/sdk`'s version, the surface these claims describe. */
  readonly sdkVersion: string;
  /** The vendored cwtools-stellaris-config commit the rules came from. */
  readonly cwtCommit: string;
  /** The Paradox documentation dump directory codegen reads. */
  readonly docsRevision: string;
  /** The game build the committed corpus fixture was extracted from. */
  readonly corpusGameVersion: string;
  /** `@pdx-ts/stellaris-ids`' version, the vanilla identifiers authors reference. */
  readonly vanillaIdsVersion: string;
}

/**
 * One story: a fenced block from the MDX, and what running it produced.
 *
 * The unit is deliberately a story rather than a page-sized example. One big
 * example shows a finished thing; a family of small ones shows the decisions,
 * and a decision is what a reader is actually stuck on. It also changes who can
 * contribute — adding a story is fifteen minutes, writing a registry's
 * narrative is not.
 */
export interface Story {
  readonly id: string;
  readonly title: string;
  /** Where the fence is, so a reader can go edit the thing they are reading. */
  readonly source: string;
  readonly code: string;
  /**
   * What synthesizing it wrote, keyed by output path. Recorded rather than
   * described: the claim that `stages` and `approach` emit two different
   * layouts is only worth making if the reader can see both in the bytes.
   */
  readonly output: Readonly<Record<string, string>>;
  /**
   * Whether the story came from a Recipe.
   *
   * A hand-written story isolates one decision, and the page's author chose
   * both the decision and the shape. A Recipe story is neither: it is the exact
   * source `create-stellaris-mod` writes into a new project, rendered through
   * the Catalog at build time. The distinction has to reach the reader, because
   * the two carry different promises — one is an illustration, the other is
   * what they will actually be looking at ten minutes from now.
   *
   * There is no Situation Recipe today, so every story on that page is
   * hand-written and says so.
   */
  readonly origin: "hand-written" | "recipe";
}

/**
 * A curated convention, with its prose left in the MDX.
 *
 * Separate from {@link ReferenceClaim} because the authored/derived split is
 * structural rather than a value of an enum: a derived claim carries a
 * generated sentence, and a convention carries a maintainer's writing, which
 * belongs somewhere a person can write. `text` is the extracted plain text,
 * present so search can index prose the viewer renders from the MDX itself.
 */
export interface CuratedConvention {
  readonly id: string;
  readonly subject: string;
  readonly status: "curated-convention";
  readonly text: string;
  readonly provenance: readonly Provenance[];
  readonly guidance: readonly GuidanceDependency[];
}

/** One field row in the complete supported-field reference. */
export interface FieldRow {
  /** The game's key, dotted below the registry. */
  readonly key: string;
  /** The authored member path. */
  readonly member: string;
  readonly shape: string;
  readonly required: boolean;
  readonly repeated: boolean;
  readonly scope: string | null;
  readonly clause: "trigger" | "effect" | null;
  readonly literals: readonly string[] | null;
  readonly level: "top" | "nested";
  readonly declaredIn: "body" | "alias-clause";
  /** `###` prose the rules attach, verbatim, empty when they attach none. */
  readonly docs: readonly string[];
  /** The rules' own declaration site, `common/situations.cwt:252`. */
  readonly declaration: string | null;
  /** What the committed corpus observed, when it observed anything. */
  readonly evidence: {
    readonly definitions: number;
    readonly scalars: number;
    readonly blocks: number;
    readonly belowPresenceFloor: boolean;
  } | null;
  /** Claim ids attached to this row, so the table can mark the difficult ones. */
  readonly claims: readonly string[];
}

/**
 * One `<Section>` of the authored page, in reading order.
 *
 * The prose is not here — the viewer renders it from the MDX. What is here is
 * the structure everything else needs: the anchor to jump to, the title for
 * navigation, the plain text for the search index, and which claims,
 * conventions and stories the section referenced, so assembly can fail on a
 * reference that resolves to nothing.
 */
export interface PageSection {
  readonly id: string;
  readonly title: string;
  /** Plain text of the section's authored prose, for search only. */
  readonly text: string;
  readonly claims: readonly string[];
  readonly conventions: readonly string[];
  readonly stories: readonly string[];
  /** Derived components the section renders, by name, for the ones with no id. */
  readonly components: readonly string[];
}

export interface ReferenceBuild {
  /** Bumped when the viewer's expectations change. Not a public contract. */
  readonly schemaVersion: 1;
  readonly identity: BuildIdentity;
  /** Which page this is, matching its row in `src/build/pages.ts`. */
  readonly pageId: string;
  readonly registry: string;
  readonly title: string;
  readonly summary: string;
  readonly facts: RegistryFacts;
  readonly sdkContracts: readonly SdkAuthoredContract[];
  readonly evidence: RegistryEvidence;
  /** Derived claims, each carrying a generated sentence. */
  readonly claims: readonly ReferenceClaim[];
  /** Curated conventions, whose prose the viewer renders from the MDX. */
  readonly conventions: readonly CuratedConvention[];
  /** Repo-relative path of the MDX the page was authored in. */
  readonly page: string;
  readonly sections: readonly PageSection[];
  readonly fields: readonly FieldRow[];
  readonly stories: readonly Story[];
  /** Extra words the search index should reach this page by. */
  readonly aliases: readonly string[];
  /** What the search box suggests trying, in this page's own vocabulary. */
  readonly searchHint: string;
}

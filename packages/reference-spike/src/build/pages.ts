/**
 * Every page this Reference build carries, and everything that is page-shaped
 * about it.
 *
 * The spike shipped with one page, and the page's identity was spread across
 * the modules that needed it: a `PAGE_PATH` in the MDX reader, a
 * `SNAPSHOT_PATH` in the snapshot reader, a registry name defaulted into the
 * probe, an alias list in the assembler, a claim builder imported by name. None
 * of that was wrong for one page and all of it was in the way of a second, so
 * it is collected here — one row per page, and the modules downstream take a
 * row rather than knowing a name.
 *
 * What a row is allowed to hold is narrow on purpose. Paths, the registry it
 * projects, the words search should reach it by, and the three curated inputs
 * that cannot be derived: the conventions' declarations, the hand-written SDK
 * contracts, and the function that turns facts into that page's claims.
 * Anything a page could derive belongs in the derivation, not here.
 */

import {
  SITUATION_CONVENTIONS,
  TECHNOLOGY_CONVENTIONS,
  type ConventionDeclaration,
} from "../../content/conventions.ts";
import type { ReferenceClaim } from "../claims.ts";
import type { RegistryFacts, SdkAuthoredContract } from "../facts.ts";
import type { RegistryEvidence } from "./corpus-evidence.ts";
import { situationClaims } from "./curation.ts";
import { SITUATION_CONTRACTS, TECHNOLOGY_CONTRACTS } from "./sdk-contracts.ts";
import { technologyClaims } from "./technology-curation.ts";

/**
 * A story the page shows that no fence produced.
 *
 * The Recipe Catalog already writes the source a new author's first technology
 * file has in it, reviewed and shipped, and a Reference page that hand-wrote a
 * different "start here" example would be teaching a second opinion. So the
 * page asks the Catalog for the same bytes it would write into a project. The
 * request is complete — a recipe id, the name an author typed, and every
 * question answered — because that is what `generate` demands.
 */
export interface RecipeStorySource {
  /** The story id, which is also the module the extraction writes. */
  readonly id: string;
  readonly title: string;
  readonly recipeId: string;
  /** What the author would have typed after `generate <recipe>`. */
  readonly name: string;
  readonly answers: Readonly<Record<string, string>>;
}

export interface ReferencePage {
  /** Short, url-safe, and the directory its extracted stories live in. */
  readonly id: string;
  /** The CWT registry the page projects. */
  readonly registry: string;
  /** The rule file the registry is declared in, for provenance lines. */
  readonly cwtSource: string;
  /**
   * How the page names its definitions when it counts them: `shipped
   * technologies`. The counts are derived; the noun is the page's own English,
   * and there is no reading of `technology` that produces `technologies`.
   */
  readonly definitionNoun: string;
  /** Repo-relative path of the MDX the page is written in. */
  readonly mdxPath: string;
  /** Repo-relative path of the committed snapshot the viewer reads. */
  readonly snapshotPath: string;
  /** Extra words the search index should reach the page by. */
  readonly aliases: readonly string[];
  /**
   * What the search box suggests trying.
   *
   * Page prose rather than a derivation. The first few aliases would be a
   * plausible-looking substitute and a worse hint: the Situation page's
   * placeholder deliberately offers `colour`, which is not a member name at
   * all — it is the spelling a reader who learned the field from the game's own
   * files would type, and offering it is how the page says that both work.
   */
  readonly searchHint: string;
  readonly conventions: readonly ConventionDeclaration[];
  readonly contracts: readonly SdkAuthoredContract[];
  readonly recipeStories: readonly RecipeStorySource[];
  claims(facts: RegistryFacts, evidence: RegistryEvidence, page: ReferencePage): ReferenceClaim[];
}

/** Where a page's extracted story modules are committed. */
export function storiesPathOf(page: ReferencePage): string {
  return `packages/reference-spike/src/example/generated/${page.id}`;
}

export const PAGES: readonly ReferencePage[] = [
  {
    id: "situations",
    registry: "situation_type",
    cwtSource: "vendor/cwtools-stellaris-config/config/common/situations.cwt",
    definitionNoun: "shipped situation types",
    searchHint: "Search — try monthly_progress, startSituation, stages, or colour…",
    mdxPath: "packages/reference-spike/content/situations.mdx",
    snapshotPath: "packages/reference-spike/data/situation-reference.json",
    conventions: SITUATION_CONVENTIONS,
    contracts: SITUATION_CONTRACTS,
    recipeStories: [],
    claims: situationClaims,
    aliases: [
      "situation",
      "situations",
      "situation_type",
      "situationType",
      "mod.situationType",
      "stages",
      "approach",
      "monthly_progress",
      "monthlyProgress",
      "start_situation",
      "startSituation",
      "targetScope",
      "situation log",
      "progress bar",
      "section_weight",
      "total_progress",
    ],
  },
  {
    id: "technology",
    registry: "technology",
    cwtSource: "vendor/cwtools-stellaris-config/config/common/technologies_consolidated.cwt",
    definitionNoun: "shipped technologies",
    searchHint: "Search — try prerequisites, weightModifier, prereqfor_desc, or tier…",
    mdxPath: "packages/reference-spike/content/technology.mdx",
    snapshotPath: "packages/reference-spike/data/technology-reference.json",
    conventions: TECHNOLOGY_CONVENTIONS,
    contracts: TECHNOLOGY_CONTRACTS,
    recipeStories: [
      {
        id: "recipe-starter",
        title: "What `generate technology` writes",
        recipeId: "technology",
        name: "Filament Weaving",
        answers: {},
      },
    ],
    claims: technologyClaims,
    aliases: [
      "technology",
      "technologies",
      "tech",
      "mod.technology",
      "patchTechnology",
      "research",
      "research tree",
      "prerequisites",
      "technology_swap",
      "technologySwap",
      "prereqfor_desc",
      "prereqforDesc",
      "weight_modifier",
      "weightModifier",
      "ai_weight",
      "aiWeight",
      "cost",
      "tier",
      "category",
      "area",
      "repeatable technology",
    ],
  },
];

export function pageById(id: string): ReferencePage {
  const page = PAGES.find((entry) => entry.id === id);
  if (page === undefined) {
    throw new Error(
      `no Reference page is called "${id}" — known pages: ${PAGES.map((entry) => entry.id).join(", ")}`
    );
  }
  return page;
}

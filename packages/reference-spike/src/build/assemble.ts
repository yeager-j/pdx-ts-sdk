/**
 * Assembling one Reference build.
 *
 * Everything upstream of here is single-purpose: the probe knows the authoring
 * model, the fixture reader knows the corpus, the MDX holds what a person
 * wrote, the extracted stories know what they synthesize to, the Recipe Catalog
 * knows what a Recipe writes. This module is the only one that sees all of
 * them, and its job is to compose without deciding.
 *
 * Most of its actual work is refusing to compose things that do not fit. A
 * claim the page never renders, a section referencing a claim that does not
 * exist, a story panel with nothing behind it, a convention with no prose —
 * each is a way for the page and the machinery to drift apart while both look
 * fine on their own, so each throws here rather than shipping.
 *
 * It is page-agnostic: everything it used to know about Situations by name now
 * arrives as a `ReferencePage` row.
 */

import type { CuratedConvention, FieldRow, PageSection, ReferenceBuild, Story } from "../build.ts";
import { synthesizeStories } from "../example/synthesize.ts";
import type { RegistryFacts } from "../facts.ts";
import { probeRegistryFacts } from "../probe/codegen-probe.ts";
import { curatedConventions } from "./conventions.ts";
import { readRegistryEvidence, type RegistryEvidence } from "./corpus-evidence.ts";
import { isRequired } from "./fingerprints.ts";
import { parsePage } from "./mdx.ts";
import type { ReferencePage } from "./pages.ts";
import { buildIdentity } from "./provenance.ts";
import { storySourcesOf } from "./stories.ts";

/**
 * The complete supported-field table.
 *
 * Every lowered member gets a row, including the ones nested inside repeated
 * structs and struct fields — a table that showed only top-level keys would
 * describe about half the surface. Its job on the page is less to inform than
 * to keep the prose honest: it is what the fingerprints hang off, which is why
 * it is complete and why the viewer collapses it by default.
 */
function fieldRows(
  page: ReferencePage,
  facts: RegistryFacts,
  evidence: RegistryEvidence,
  claimsBySubject: ReadonlyMap<string, string[]>
): FieldRow[] {
  return facts.lowered
    .map((member): FieldRow => {
      const declared = facts.declared.find((entry) => entry.key === member.key);
      const observed = evidence.fields.find((field) => field.key === member.key);
      const arm = declared?.arms[0];
      return {
        key: member.key,
        member: member.memberPath.join("."),
        shape: member.shape,
        required: isRequired(facts, member.key),
        repeated: member.repeated,
        scope:
          member.scope === null
            ? null
            : member.scope === "any"
              ? "any"
              : Array.isArray(member.scope)
                ? member.scope.join(" | ")
                : (member.scope as { parameter: readonly string[] }).parameter.join(" | "),
        clause: member.clause,
        literals: member.literals,
        level: member.level,
        declaredIn: member.declaredIn,
        docs: arm?.docs ?? [],
        declaration: arm === undefined ? null : `${page.cwtSource}:${arm.line}`,
        evidence:
          observed === undefined
            ? null
            : {
                definitions: observed.definitions,
                scalars: observed.scalars,
                blocks: observed.blocks,
                belowPresenceFloor: observed.belowPresenceFloor,
              },
        claims: claimsBySubject.get(member.key) ?? claimsBySubject.get(member.memberPath[0]!) ?? [],
      };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function assembleReferenceBuild(
  page: ReferencePage,
  facts: RegistryFacts = probeRegistryFacts(page.registry)
): ReferenceBuild {
  const evidence = readRegistryEvidence(facts.registry);
  const parsed = parsePage(page);
  const claims = page.claims(facts, evidence, page);
  const conventions = curatedConventions(
    page.conventions,
    facts,
    evidence,
    parsed.conventions,
    page.mdxPath
  );
  const outputs = synthesizeStories(page.id);
  const sources = storySourcesOf(page);

  const compose = (
    id: string,
    title: string,
    code: string,
    source: string,
    origin: Story["origin"]
  ): Story => {
    const output = outputs[id];
    if (output === undefined) {
      throw new Error(
        `story "${id}" has a source but no extracted module — run ` +
          "`npm run stories -w @pdx-ts/reference-spike` and commit the result"
      );
    }
    return { id, title, source, code, output, origin };
  };

  const stories: Story[] = [
    ...sources.fences.map((fence) =>
      compose(fence.id, fence.title, fence.code, `${page.mdxPath}:${fence.line}`, "hand-written")
    ),
    ...sources.recipes.map((recipe) =>
      compose(recipe.id, recipe.title, recipe.contents, recipe.command, "recipe")
    ),
  ];

  const sections: PageSection[] = parsed.sections.map((section) => ({
    id: section.id,
    title: section.title,
    text: section.text,
    claims: section.claims,
    conventions: section.conventions,
    stories: section.stories,
    components: section.components,
  }));

  // Five ways the page and the machinery can drift apart, all of them silent.
  const claimIds = new Set(claims.map((claim) => claim.id));
  const rendered = new Set(sections.flatMap((section) => section.claims));
  const dangling = [...rendered].filter((id) => !claimIds.has(id));
  if (dangling.length > 0) {
    throw new Error(
      `${page.mdxPath} renders claims that are not built: ${dangling.join(", ")} — a <Claim id> ` +
        "with no claim behind it renders as nothing, which reads as a page that forgot to say " +
        "something rather than as a mistake"
    );
  }
  // A supporting observation is rendered through the claim it supports, so it
  // counts as placed when its parent is — and its parent has to exist, or the
  // observation reaches the page through nothing.
  const orphanedSupport = claims
    .filter((claim) => claim.supports !== undefined && !claimIds.has(claim.supports))
    .map((claim) => `${claim.id} → ${claim.supports}`);
  if (orphanedSupport.length > 0) {
    throw new Error(
      `these observations support claims that do not exist: ${orphanedSupport.join(", ")}`
    );
  }
  const unplaced = claims
    .filter((claim) => {
      const host = claim.supports ?? claim.id;
      return !rendered.has(host);
    })
    .map((claim) => claim.id);
  if (unplaced.length > 0) {
    throw new Error(
      `these claims are built but never rendered: ${unplaced.join(", ")} — a claim that reaches ` +
        "no section is a claim nobody reads, which is the same as not making it"
    );
  }
  const placed = new Set(sections.flatMap((section) => section.stories));
  const unrendered = stories.filter((entry) => !placed.has(entry.id));
  if (unrendered.length > 0) {
    throw new Error(
      `stories outside any section: ${unrendered.map((entry) => entry.id).join(", ")} — a fence ` +
        "places itself, and a Recipe story is placed with an explicit <StoryPanel id>"
    );
  }
  const empty = [...placed].filter((id) => !stories.some((entry) => entry.id === id));
  if (empty.length > 0) {
    throw new Error(
      `${page.mdxPath} places story panels with nothing behind them: ${empty.join(", ")}`
    );
  }

  const bySubject = new Map<string, string[]>();
  for (const claim of claims) {
    const key = claim.subject.replace(/^mod\./, "");
    bySubject.set(key, [...(bySubject.get(key) ?? []), claim.id]);
  }

  return {
    schemaVersion: 1,
    identity: buildIdentity(),
    pageId: page.id,
    registry: facts.registry,
    title: parsed.frontmatter["title"] ?? page.id,
    summary: parsed.frontmatter["summary"] ?? "",
    facts,
    sdkContracts: page.contracts,
    evidence,
    claims,
    conventions,
    page: page.mdxPath,
    sections,
    fields: fieldRows(page, facts, evidence, bySubject),
    stories,
    aliases: page.aliases,
    searchHint: page.searchHint,
  };
}

export type { CuratedConvention };

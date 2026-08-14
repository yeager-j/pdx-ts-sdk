/**
 * Deterministic local search over one Reference build.
 *
 * Two languages have to reach the same place. An author who knows Stellaris
 * types `monthly_progress` or `start_situation`; an author who knows the SDK
 * types `monthlyProgress` or `startSituation`; and the reader this page is
 * written for often knows one and not the other. So every entry is indexed
 * under both spellings, plus the curated aliases, plus the ordinary words of
 * its own text.
 *
 * No index-time cleverness and no ranking model — scoring is a small, readable
 * function of where a term matched, because a reference whose search results
 * cannot be explained is a reference nobody trusts twice. Semantic search is
 * explicitly out of scope for the spike.
 *
 * Browser-safe: no Node imports, no I/O.
 */

import type { ReferenceBuild } from "./build.ts";
import type { ClaimStatus } from "./claims.ts";

export type EntryKind = "page" | "section" | "claim" | "field" | "example";

export interface SearchEntry {
  readonly id: string;
  readonly kind: EntryKind;
  readonly title: string;
  /** One line of context under the title in the result list. */
  readonly detail: string;
  /** The section to scroll to. */
  readonly sectionId: string;
  readonly registry: string;
  readonly status: ClaimStatus | null;
  /** Canonical scopes this entry is about, for the scope filter. */
  readonly scopes: readonly string[];
  /** Every term the entry can be found by, lowercased. */
  readonly terms: readonly string[];
}

/** `monthlyProgress` → `monthly progress`, so a camel-case symbol matches word queries. */
function splitCamel(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/**
 * Both spellings of the words this repo is deliberately of two minds about.
 *
 * `localisation` is the game's directory name and a CWT keyword; `localization`
 * is the SDK's own machinery, and both are correct in their place. `colour` is
 * the same split one level down — the rules spell the type `<named_color>`, and
 * a reader who learned the field from the game's own files did not.
 *
 * Indexed rather than rewritten at query time so the mapping applies to entry
 * text as well as to what somebody types.
 */
const SPELLINGS: readonly (readonly [string, string])[] = [
  ["colour", "color"],
  ["localisation", "localization"],
  ["behaviour", "behavior"],
];

function spellingVariants(term: string): string[] {
  const variants = [term];
  for (const [british, american] of SPELLINGS) {
    if (term.includes(british)) {
      variants.push(term.replaceAll(british, american));
    } else if (term.includes(american)) {
      variants.push(term.replaceAll(american, british));
    }
  }
  return variants;
}

function termsOf(...parts: readonly (string | null | undefined)[]): string[] {
  const terms = new Set<string>();
  const add = (term: string): void => {
    for (const variant of spellingVariants(term)) {
      terms.add(variant);
    }
  };
  for (const part of parts) {
    if (part === null || part === undefined || part === "") {
      continue;
    }
    const normalized = splitCamel(part).toLowerCase();
    add(part.toLowerCase());
    add(normalized);
    for (const word of normalized.split(/[^a-z0-9_.]+/)) {
      if (word.length > 1) {
        add(word);
      }
    }
  }
  return [...terms].sort();
}

export function buildSearchIndex(build: ReferenceBuild): SearchEntry[] {
  // Section ids are slugged from the headings, so nothing here may hardcode
  // one: a reworded heading would turn a hardcoded fallback into a link to
  // nowhere. The first section is where a result with no home belongs anyway.
  const firstSection = build.sections[0]?.id ?? "";
  const entries: SearchEntry[] = [
    {
      id: "page",
      kind: "page",
      title: build.title,
      detail: build.summary,
      sectionId: firstSection,
      registry: build.registry,
      status: null,
      scopes: [],
      terms: termsOf(build.title, build.summary, build.registry, ...build.aliases),
    },
  ];

  for (const section of build.sections) {
    entries.push({
      id: `section:${section.id}`,
      kind: "section",
      title: section.title,
      detail: section.text.slice(0, 160),
      sectionId: section.id,
      registry: build.registry,
      status: null,
      scopes: [],
      terms: termsOf(section.title, section.text),
    });
  }

  // Where a claim or a convention lives, so a hit jumps to the section that
  // explains it rather than to a symbol stub.
  const sectionOf = new Map<string, string>();
  for (const section of build.sections) {
    for (const id of [...section.claims, ...section.conventions, ...section.stories]) {
      sectionOf.set(id, section.id);
    }
  }

  for (const claim of build.claims) {
    entries.push({
      id: `claim:${claim.id}`,
      kind: "claim",
      title: claim.subject,
      detail: claim.statement,
      sectionId: sectionOf.get(claim.id) ?? firstSection,
      registry: build.registry,
      status: claim.status,
      scopes: [],
      terms: termsOf(claim.subject, claim.statement, claim.id, claim.status),
    });
  }

  // Curated prose is indexed from the text extracted out of the MDX, so search
  // reaches sentences the viewer renders from the MDX rather than from here.
  for (const convention of build.conventions) {
    entries.push({
      id: `claim:${convention.id}`,
      kind: "claim",
      title: convention.subject,
      detail: convention.text,
      sectionId: sectionOf.get(convention.id) ?? firstSection,
      registry: build.registry,
      status: convention.status,
      scopes: [],
      terms: termsOf(convention.subject, convention.text, convention.id, convention.status),
    });
  }

  // Every field row lives in whichever section rendered the table. That
  // section is found by asking which one renders `<FieldTable>` — it used to be
  // found by looking for one particular Situation claim id, which worked
  // exactly as long as there was one page.
  const fieldSection =
    build.sections.find((section) => section.components.includes("FieldTable"))?.id ?? firstSection;

  for (const field of build.fields) {
    entries.push({
      id: `field:${field.key}`,
      kind: "field",
      title: field.member,
      detail: `${field.key} · ${field.shape}${field.scope === null ? "" : ` · ${field.scope}`}`,
      sectionId: fieldSection,
      registry: build.registry,
      status: null,
      scopes: field.scope === null ? [] : field.scope.split(" | "),
      terms: termsOf(field.key, field.member, field.shape, field.scope, ...field.docs),
    });
  }

  // A story is indexed by its code as well as its title: "how do I write a
  // second approach" is a question best answered by the story that does it,
  // and the reader searching for `sectionWeight` wants the story that uses it.
  for (const story of build.stories) {
    entries.push({
      id: `example:${story.id}`,
      kind: "example",
      title: story.title,
      detail: story.source,
      sectionId: sectionOf.get(story.id) ?? firstSection,
      registry: build.registry,
      status: null,
      scopes: [],
      terms: termsOf(story.title, story.id, story.code),
    });
  }

  return entries;
}

export interface SearchFilters {
  readonly kinds?: readonly EntryKind[];
  readonly statuses?: readonly ClaimStatus[];
  readonly scopes?: readonly string[];
}

/**
 * An exact term match outranks a prefix match, which outranks a substring —
 * and a match in the title outranks the same match in the body.
 *
 * Small enough to hold in your head, which is the requirement: a maintainer
 * looking at a surprising result should be able to say why it ranked there.
 */
function score(entry: SearchEntry, query: string): number {
  const title = splitCamel(entry.title).toLowerCase();
  let best = 0;
  for (const term of entry.terms) {
    if (term === query) {
      best = Math.max(best, 100);
    } else if (term.startsWith(query)) {
      best = Math.max(best, 60);
    } else if (term.includes(query)) {
      best = Math.max(best, 30);
    }
  }
  if (best === 0) {
    return 0;
  }
  if (title === query) {
    return best + 25;
  }
  return title.includes(query) ? best + 10 : best;
}

export function search(
  index: readonly SearchEntry[],
  rawQuery: string,
  filters: SearchFilters = {}
): SearchEntry[] {
  const query = splitCamel(rawQuery.trim()).toLowerCase();
  const queries = spellingVariants(query);
  const matches = (entry: SearchEntry): boolean => {
    if (
      filters.kinds !== undefined &&
      filters.kinds.length > 0 &&
      !filters.kinds.includes(entry.kind)
    ) {
      return false;
    }
    if (filters.statuses !== undefined && filters.statuses.length > 0) {
      if (entry.status === null || !filters.statuses.includes(entry.status)) {
        return false;
      }
    }
    if (filters.scopes !== undefined && filters.scopes.length > 0) {
      if (!entry.scopes.some((scope) => filters.scopes!.includes(scope))) {
        return false;
      }
    }
    return true;
  };

  const filtered = index.filter(matches);
  if (query === "") {
    return filtered;
  }
  return (
    filtered
      .map((entry) => ({
        entry,
        rank: Math.max(...queries.map((variant) => score(entry, variant))),
      }))
      .filter((row) => row.rank > 0)
      // Ties break on id so the same query always produces the same order.
      .sort((a, b) => b.rank - a.rank || (a.entry.id < b.entry.id ? -1 : 1))
      .map((row) => row.entry)
  );
}

/** Every scope any field mentions, for the scope filter's options. */
export function scopeOptions(index: readonly SearchEntry[]): string[] {
  return [...new Set(index.flatMap((entry) => entry.scopes))].sort();
}

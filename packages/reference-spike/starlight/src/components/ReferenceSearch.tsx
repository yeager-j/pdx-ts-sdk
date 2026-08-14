/**
 * The reference's own search, which is the one piece of the first viewer that
 * the framework could not absorb.
 *
 * Starlight ships Pagefind, it is offline, it is good, and it was measured
 * before being replaced. It finds every term this page needs — `colour` and
 * `color`, `monthly_progress` and `monthlyProgress`, `startSituation` and
 * `start_situation` — because the prose and the field table both reach the
 * HTML it indexes. Where it stops is granularity and facets:
 *
 * - a result is a page, with heading-level sub-results. `section_weight` lands
 *   on "What will bite you", not on the field-table row that defines it.
 * - `data-pagefind-filter` does give it facets, and two attributes were enough
 *   to expose `status` and `registry`. But a filter selects *pages*: asking for
 *   `status:known-omission` returns both pages with no sub-results, because
 *   every page has an omission somewhere in it. On a reference with forty
 *   registries that is an answer to no question anybody has.
 *
 * The truth model is the product here. A reader who wants to know what the SDK
 * cannot do needs the omissions themselves, not the pages containing one — so
 * the entry-level index stays, unchanged, imported from `src/search.ts`. What
 * changed is that it is now global rather than per-page: the first viewer
 * rendered one page at a time and could say "nothing on this page matches
 * that", and a sidebar with every registry in it makes that the wrong scope.
 */

import { useMemo, useState } from "react";

import { Card, Input, Toggle } from "../../../src/app/components/ui/primitives.tsx";
import { CLAIM_STATUSES, STATUS_LABEL, type ClaimStatus } from "../../../src/claims.ts";
import {
  buildSearchIndex,
  scopeOptions,
  search,
  type EntryKind,
  type SearchEntry,
} from "../../../src/search.ts";
import { BUILDS } from "../builds.ts";

const KINDS: readonly EntryKind[] = ["section", "claim", "field", "example"];

/** An entry, plus the page it is on — which a single-page index never needed. */
interface Located extends SearchEntry {
  readonly page: string;
  readonly pageTitle: string;
}

function locatedIndex(): Located[] {
  return Object.entries(BUILDS).flatMap(([page, build]) =>
    buildSearchIndex(build).map((entry) => ({
      ...entry,
      page,
      pageTitle: build.title,
    }))
  );
}

export function ReferenceSearch() {
  const index = useMemo(locatedIndex, []);
  const scopes = useMemo(() => scopeOptions(index), [index]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState<EntryKind[]>([]);
  const [statuses, setStatuses] = useState<ClaimStatus[]>([]);
  const [scope, setScope] = useState<string | null>(null);

  const filtered = kinds.length > 0 || statuses.length > 0 || scope !== null;
  const results = useMemo(
    () =>
      query.trim() === "" && !filtered
        ? []
        : (search(index, query, {
            kinds,
            statuses,
            scopes: scope === null ? [] : [scope],
          }).slice(0, 40) as Located[]),
    [index, query, kinds, statuses, scope, filtered]
  );

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void): void =>
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <div className="not-content relative w-full max-w-xl">
      <Input
        type="search"
        placeholder="Search — try monthly_progress, prerequisites, startSituation, or colour…"
        aria-label="Search the reference"
        data-testid="search-input"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-background p-2 shadow-lg">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {KINDS.map((kind) => (
              <Toggle
                key={kind}
                active={kinds.includes(kind)}
                onClick={() => toggle(kinds, kind, setKinds)}
              >
                {kind}
              </Toggle>
            ))}
            <span className="mx-1 w-px self-stretch bg-border" />
            {CLAIM_STATUSES.map((status) => (
              <Toggle
                key={status}
                active={statuses.includes(status)}
                onClick={() => toggle(statuses, status, setStatuses)}
              >
                {STATUS_LABEL[status]}
              </Toggle>
            ))}
            <span className="mx-1 w-px self-stretch bg-border" />
            {scopes.map((option) => (
              <Toggle
                key={option}
                active={scope === option}
                onClick={() => setScope(scope === option ? null : option)}
              >
                scope: {option}
              </Toggle>
            ))}
          </div>
          {results.length > 0 && (
            <Card className="max-h-96 overflow-auto p-1" data-testid="search-results">
              <ul>
                {results.map((entry) => (
                  <li key={`${entry.page}:${entry.id}`}>
                    <a
                      href={`/${entry.page}/#${entry.sectionId}`}
                      data-testid={`result-${entry.id}`}
                      className="block rounded-md px-3 py-2 hover:bg-accent"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-sm">{entry.title}</span>
                        <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                          {entry.kind}
                        </span>
                        {/*
                          The page, which a single-page index never had to say.
                          Both pages have a story called `minimal` and a claim
                          called `registry`, so a result without its page is
                          ambiguous exactly where it matters.
                        */}
                        <span className="ml-auto text-[0.7rem] text-muted-foreground">
                          {entry.pageTitle}
                        </span>
                      </div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">
                        {entry.detail}
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {(query.trim() !== "" || filtered) && results.length === 0 && (
            <p data-testid="search-empty" className="px-1 py-2 text-xs text-muted-foreground">
              Nothing in this Reference build matches that.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

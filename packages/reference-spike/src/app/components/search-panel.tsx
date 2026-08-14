/**
 * The search box, its filters, and the results.
 *
 * The claim being tested here is narrow and worth stating: an author who only
 * knows the game's word for something has to be able to find the SDK's word for
 * it, and the other way round. So the results list shows both spellings, and
 * every hit jumps to the section that explains it rather than to a symbol
 * stub.
 */

import { useMemo, useState } from "react";

import type { ReferenceBuild } from "../../build.ts";
import { CLAIM_STATUSES, STATUS_LABEL, type ClaimStatus } from "../../claims.ts";
import { buildSearchIndex, scopeOptions, search, type EntryKind } from "../../search.ts";
import { Card, Input, Toggle } from "./ui/primitives.tsx";

const KINDS: readonly EntryKind[] = ["section", "claim", "field", "example"];

export function SearchPanel({ build }: { build: ReferenceBuild }) {
  const index = useMemo(() => buildSearchIndex(build), [build]);
  const scopes = useMemo(() => scopeOptions(index), [index]);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<EntryKind[]>([]);
  const [statuses, setStatuses] = useState<ClaimStatus[]>([]);
  const [scope, setScope] = useState<string | null>(null);

  const results = useMemo(
    () =>
      query.trim() === "" && kinds.length === 0 && statuses.length === 0 && scope === null
        ? []
        : search(index, query, {
            kinds,
            statuses,
            scopes: scope === null ? [] : [scope],
          }).slice(0, 40),
    [index, query, kinds, statuses, scope]
  );

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void): void =>
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder={build.searchHint}
        aria-label="Search the reference"
        data-testid="search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex flex-wrap gap-1.5">
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
              <li key={entry.id}>
                <a
                  href={`#${entry.sectionId}`}
                  data-testid={`result-${entry.id}`}
                  className="block rounded-md px-3 py-2 hover:bg-accent"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm">{entry.title}</span>
                    <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                      {entry.kind}
                    </span>
                  </div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{entry.detail}</div>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {query.trim() !== "" && results.length === 0 && (
        <p data-testid="search-empty" className="px-1 text-xs text-muted-foreground">
          Nothing on this page matches that.
        </p>
      )}
    </div>
  );
}

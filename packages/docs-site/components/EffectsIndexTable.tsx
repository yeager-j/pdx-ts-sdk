"use client";

import {
  columnFilteringFeature,
  constructFilterFn,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  filterFn_equalsString,
  filterFn_includesString,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import Link from "fumadocs-core/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { TypeTableFrame, TypeTableItem, type TypeNode } from "@/src/components/type-table";
import type {
  EffectAvailability,
  EffectCategory,
  EffectsIndexEntry,
  ScopeLinkTarget,
} from "@/src/effects-index";

/**
 * The index row as the server hands it over: the model entry plus the two
 * things only the server can produce — the rendered summary HTML and the
 * compact signature. Everything here is plain data, so it crosses the RSC
 * boundary as-is.
 */
export interface EffectsIndexRow extends EffectsIndexEntry {
  readonly summaryHtml: string;
  readonly signatureSummary: string;
}

const PAGE_SIZE = 50;
const ANCHOR_PREFIX = "effects-";

const CATEGORY_LABELS: Record<EffectCategory, string> = {
  effect: "Effect",
  structural: "Structural",
  "event-fire": "Event fire",
};

export const UNIVERSAL_SCOPE_FILTER = "__universal__";

export function matchesScopeFilter(
  availability: EffectAvailability,
  filterValue: unknown
): boolean {
  const selectedScope = String(filterValue);
  if (selectedScope === "") return true;
  if (selectedScope === UNIVERSAL_SCOPE_FILTER) {
    return availability.kind === "universal";
  }
  return (
    availability.kind === "universal" ||
    availability.scopes.some((target) => target.scope === selectedScope)
  );
}

const features = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const filterFn_legalOnScope = constructFilterFn<typeof features, EffectsIndexRow>({
  filter: matchesScopeFilter,
  autoRemove: (filterValue) => filterValue === undefined || filterValue === "",
});

const helper = createColumnHelper<typeof features, EffectsIndexRow>();

/**
 * Rows are rendered through `TypeTableItem`, not through cells, so these
 * columns exist only to carry the three filters. The order the reader sees is
 * the model's order; the table slices it into pages.
 */
const columns = helper.columns([
  helper.accessor((row) => `${row.method} ${row.key ?? ""}`, {
    id: "text",
    filterFn: filterFn_includesString,
  }),
  helper.accessor((row) => row.availability, {
    id: "scope",
    filterFn: filterFn_legalOnScope,
  }),
  helper.accessor((row) => row.category, {
    id: "category",
    filterFn: filterFn_equalsString,
  }),
]);

const initialState = { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } };

function ScopeList({ targets }: { targets: readonly ScopeLinkTarget[] }) {
  return (
    <span className="[overflow-wrap:anywhere]">
      {targets.map((target, index) => (
        <Fragment key={target.scope}>
          {index > 0 && ", "}
          {target.href === undefined ? (
            <code>{target.scope}</code>
          ) : (
            <Link href={target.href} title={target.title}>
              <code>{target.scope}</code>
            </Link>
          )}
        </Fragment>
      ))}
    </span>
  );
}

function availabilityNode(row: EffectsIndexRow): ReactNode {
  if (row.availability.kind === "universal") {
    return <>Every generated scope interface. See the shared scope list above.</>;
  }
  return <ScopeList targets={row.availability.scopes} />;
}

function typeNodeOf(row: EffectsIndexRow): TypeNode {
  return {
    // A method row has no optional-member `?` suffix to suppress.
    required: true,
    // The category rides in the row's own line, not in the type column: the
    // type column is hidden on a narrow container, and which of the three
    // kinds a method is has to be readable at every width.
    badge: CATEGORY_LABELS[row.category],
    type: <code>{row.signatureSummary}</code>,
    typeDescription: (
      <code className="whitespace-pre-wrap [overflow-wrap:anywhere]">{row.signature}</code>
    ),
    gameKey:
      row.key === undefined ? (
        <em className="text-fd-muted-foreground">No fixed PDXScript key</em>
      ) : (
        <code>{row.key}</code>
      ),
    availability: availabilityNode(row),
    ...(row.eventBodyScope === undefined
      ? {}
      : { eventBodyScope: <ScopeList targets={[row.eventBodyScope]} /> }),
    description: <span dangerouslySetInnerHTML={{ __html: row.summaryHtml }} />,
  };
}

export function EffectsIndexTable({
  rows,
  scopeOptions,
  scopePages,
}: {
  rows: readonly EffectsIndexRow[];
  scopeOptions: readonly string[];
  scopePages: readonly ScopeLinkTarget[];
}) {
  /**
   * `autoResetPageIndex` is off because it fires from the filtered row model's
   * recompute, which happens during the next render rather than when the
   * filter is set — late enough to clobber a page the deep-link effect had
   * already chosen. Returning to the first page on a filter change is this
   * component's own job instead, in `applyFilter`.
   */
  const table = useTable({
    features,
    columns,
    data: rows,
    initialState,
    autoResetPageIndex: false,
  });
  const [requestedAnchor, setRequestedAnchor] = useState<string | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  /**
   * `useTable` returns a fresh instance object on every render, so the table
   * is held in a ref: an effect that took it as a dependency would re-run —
   * and re-apply its filters and page — after every state change.
   */
  const tableRef = useRef(table);
  tableRef.current = table;

  const pageOfMethod = useMemo(() => {
    const pages = new Map<string, number>();
    rows.forEach((row, index) => pages.set(row.anchor, Math.floor(index / PAGE_SIZE)));
    return pages;
  }, [rows]);

  useEffect(() => {
    const readHash = (): void => setRequestedAnchor(window.location.hash.slice(1));
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  /**
   * A `#effects-<method>` link must land on its row whatever the reader had
   * filtered or paged to, so a requested anchor clears the filters and moves
   * to the page holding that row. With no filter the reader sees the model's
   * own order, so the page is arithmetic rather than a row-model lookup.
   */
  useEffect(() => {
    if (requestedAnchor === null || !requestedAnchor.startsWith(ANCHOR_PREFIX)) return;
    const page = pageOfMethod.get(requestedAnchor);
    if (page === undefined) return;
    tableRef.current.resetColumnFilters();
    tableRef.current.setPageIndex(page);
    setPendingAnchor(requestedAnchor);
  }, [pageOfMethod, requestedAnchor]);

  useEffect(() => {
    if (pendingAnchor === null) return;
    const target = document.getElementById(pendingAnchor);
    target?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "center" });
    setPendingAnchor(null);
  }, [pendingAnchor]);

  const textColumn = table.getColumn("text");
  const scopeColumn = table.getColumn("scope");
  const categoryColumn = table.getColumn("category");
  const applyFilter = (column: typeof textColumn, value: string): void => {
    column?.setFilterValue(value);
    table.setPageIndex(0);
  };
  const matched = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  const pageIndex = table.state.pagination?.pageIndex ?? 0;
  const visibleRows = table.getRowModel().rows;
  const focusClass =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

  return (
    <div className="not-prose my-6 flex flex-col gap-3">
      <details className="rounded-xl border bg-fd-card px-3 py-2">
        <summary className={`cursor-pointer font-medium ${focusClass}`}>
          Scope pages for universal methods ({scopePages.length})
        </summary>
        <p className="mt-2 text-sm">
          Universal methods are available on every generated scope interface:{" "}
          <ScopeList targets={scopePages} />.
        </p>
      </details>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-fd-muted-foreground text-sm" htmlFor="effects-filter-text">
            Method or PDXScript key
          </label>
          <input
            id="effects-filter-text"
            type="search"
            className={`max-w-full rounded-lg border bg-fd-card px-3 py-1.5 text-sm ${focusClass}`}
            placeholder="addResource, add_resource"
            value={String(textColumn?.getFilterValue() ?? "")}
            onChange={(event) => applyFilter(textColumn, event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-fd-muted-foreground text-sm" htmlFor="effects-filter-scope">
            Legal on scope
          </label>
          <select
            id="effects-filter-scope"
            className={`max-w-full rounded-lg border bg-fd-card px-3 py-1.5 text-sm ${focusClass}`}
            value={String(scopeColumn?.getFilterValue() ?? "")}
            onChange={(event) => applyFilter(scopeColumn, event.target.value)}
          >
            <option value="">Any scope</option>
            <option value={UNIVERSAL_SCOPE_FILTER}>Universal</option>
            {scopeOptions.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-fd-muted-foreground text-sm" htmlFor="effects-filter-category">
            Category
          </label>
          <select
            id="effects-filter-category"
            className={`max-w-full rounded-lg border bg-fd-card px-3 py-1.5 text-sm ${focusClass}`}
            value={String(categoryColumn?.getFilterValue() ?? "")}
            onChange={(event) => applyFilter(categoryColumn, event.target.value)}
          >
            <option value="">Every category</option>
            {Object.entries(CATEGORY_LABELS).map(([category, label]) => (
              <option key={category} value={category}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-fd-muted-foreground text-sm" aria-live="polite">
        {matched} of {rows.length} methods
        {pageCount > 1 ? `, page ${pageIndex + 1} of ${pageCount}` : ""}.
      </p>

      {visibleRows.length === 0 ? (
        <p>No methods match the selected filters.</p>
      ) : (
        <TypeTableFrame id="effects" nameHeader="Method" typeHeader="Signature" className="my-0">
          {visibleRows.map((row) => (
            <TypeTableItem
              key={row.original.method}
              parentId="effects"
              name={row.original.method}
              item={typeNodeOf(row.original)}
              hasKeyColumn
            />
          ))}
        </TypeTableFrame>
      )}

      {/*
        `nextPage` clamps only against a manual page count, which client
        pagination never sets, so clicks arriving faster than React can
        disable the button would run off the end into an empty page. The
        handler re-reads the live state rather than trusting the rendered
        `disabled`.
      */}
      <div className="flex items-center gap-3" hidden={pageCount <= 1}>
        <button
          type="button"
          className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ${focusClass}`}
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous page
        </button>
        <button
          type="button"
          className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ${focusClass}`}
          onClick={() => {
            if (table.getCanNextPage()) table.nextPage();
          }}
          disabled={!table.getCanNextPage()}
        >
          Next page
        </button>
      </div>
    </div>
  );
}

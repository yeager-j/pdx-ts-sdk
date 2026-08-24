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
import type { ReferenceAvailability, ScopeLinkTarget } from "@/src/reference-index";

/** A fully rendered script-reference row passed across the server/client boundary. */
export interface ReferenceIndexRow {
  /** Public TypeScript member name. */
  readonly method: string;
  /** Stable deep-link target. */
  readonly anchor: string;
  /** Fixed PDXScript key, when the member records one. */
  readonly key?: string;
  /** Exact public TypeScript signature. */
  readonly signature: string;
  /** Compact signature shown in the table column. */
  readonly signatureSummary: string;
  /** Server-rendered description markup. */
  readonly summaryHtml: string;
  /** Scopes where the member is legal. */
  readonly availability: ReferenceAvailability;
  /** Optional row classification shown as a badge. */
  readonly badge?: string;
  /** Optional category value used by the category filter. */
  readonly category?: string;
  /** Scope where a fired event body runs, for event-fire effect rows. */
  readonly eventBodyScope?: ScopeLinkTarget;
}

/** Labels and control text for an optional category filter. */
export interface ReferenceCategoryFilter {
  /** User-facing filter label. */
  readonly label: string;
  /** User-facing empty-selection label. */
  readonly allLabel: string;
  /** Category value to display-label mapping. */
  readonly labels: Readonly<Record<string, string>>;
}

/** The sentinel value used to select only universally available members. */
export const UNIVERSAL_SCOPE_FILTER = "__universal__";

/** Tests whether generated availability matches one scope-filter selection. */
export function matchesScopeFilter(
  availability: ReferenceAvailability,
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

const PAGE_SIZE = 50;
const features = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const filterFn_legalOnScope = constructFilterFn<typeof features, ReferenceIndexRow>({
  filter: matchesScopeFilter,
  autoRemove: (filterValue) => filterValue === undefined || filterValue === "",
});
const helper = createColumnHelper<typeof features, ReferenceIndexRow>();
const columns = helper.columns([
  helper.accessor((row) => `${row.method} ${row.key ?? ""}`, {
    id: "text",
    filterFn: filterFn_includesString,
  }),
  helper.accessor((row) => row.availability, {
    id: "scope",
    filterFn: filterFn_legalOnScope,
  }),
  helper.accessor((row) => row.category ?? "", {
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

function availabilityNode(row: ReferenceIndexRow): ReactNode {
  if (row.availability.kind === "universal") {
    return <>Every generated scope interface. See the shared scope list above.</>;
  }
  return <ScopeList targets={row.availability.scopes} />;
}

function typeNodeOf(row: ReferenceIndexRow): TypeNode {
  return {
    required: true,
    ...(row.badge === undefined ? {} : { badge: row.badge }),
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

/** Renders a searchable, paginated script-reference inventory with stable deep links. */
export function ReferenceIndexTable({
  id,
  nameHeader,
  itemName,
  rows,
  scopeOptions,
  scopePages,
  searchPlaceholder,
  categoryFilter,
}: {
  /** Table and form-control id prefix, which must match row anchors. */
  readonly id: string;
  /** Header for the public member-name column. */
  readonly nameHeader: string;
  /** Lowercase plural noun used in status text. */
  readonly itemName: string;
  /** Complete rendered reference rows. */
  readonly rows: readonly ReferenceIndexRow[];
  /** Canonical scopes offered by the legal-scope filter. */
  readonly scopeOptions: readonly string[];
  /** Published scope pages used for universal availability links. */
  readonly scopePages: readonly ScopeLinkTarget[];
  /** Example text shown in the method/key search field. */
  readonly searchPlaceholder: string;
  /** Optional category filter used by the effects inventory. */
  readonly categoryFilter?: ReferenceCategoryFilter;
}) {
  // TanStack resets pagination after the filtered model recomputes, which is
  // late enough to overwrite the page selected for a deep link. Filter changes
  // reset the page explicitly below, so automatic reset must stay disabled.
  const table = useTable({
    features,
    columns,
    data: rows,
    initialState,
    autoResetPageIndex: false,
  });
  const [requestedAnchor, setRequestedAnchor] = useState<string | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  // `useTable` returns a fresh instance object on each render. Holding the
  // current instance in a ref keeps deep-link effects from rerunning after
  // every table state update.
  const tableRef = useRef(table);
  tableRef.current = table;

  const pageOfAnchor = useMemo(() => {
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

  useEffect(() => {
    if (requestedAnchor === null || !requestedAnchor.startsWith(`${id}-`)) return;
    const page = pageOfAnchor.get(requestedAnchor);
    if (page === undefined) return;
    tableRef.current.resetColumnFilters();
    tableRef.current.setPageIndex(page);
    setPendingAnchor(requestedAnchor);
  }, [id, pageOfAnchor, requestedAnchor]);

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
          {`Scope pages for universal ${itemName} (${scopePages.length})`}
        </summary>
        <p className="mt-2 text-sm">
          {`Universal ${itemName} are available on every generated scope interface: `}
          <ScopeList targets={scopePages} />.
        </p>
      </details>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-fd-muted-foreground text-sm" htmlFor={`${id}-filter-text`}>
            Method or PDXScript key
          </label>
          <input
            id={`${id}-filter-text`}
            type="search"
            className={`max-w-full rounded-lg border bg-fd-card px-3 py-1.5 text-sm ${focusClass}`}
            placeholder={searchPlaceholder}
            value={String(textColumn?.getFilterValue() ?? "")}
            onChange={(event) => applyFilter(textColumn, event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-fd-muted-foreground text-sm" htmlFor={`${id}-filter-scope`}>
            Legal on scope
          </label>
          <select
            id={`${id}-filter-scope`}
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
        {categoryFilter === undefined ? null : (
          <div className="flex flex-col gap-1">
            <label className="text-fd-muted-foreground text-sm" htmlFor={`${id}-filter-category`}>
              {categoryFilter.label}
            </label>
            <select
              id={`${id}-filter-category`}
              className={`max-w-full rounded-lg border bg-fd-card px-3 py-1.5 text-sm ${focusClass}`}
              value={String(categoryColumn?.getFilterValue() ?? "")}
              onChange={(event) => applyFilter(categoryColumn, event.target.value)}
            >
              <option value="">{categoryFilter.allLabel}</option>
              {Object.entries(categoryFilter.labels).map(([category, label]) => (
                <option key={category} value={category}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="text-fd-muted-foreground text-sm" aria-live="polite">
        {matched} of {rows.length} {itemName}
        {pageCount > 1 ? `, page ${pageIndex + 1} of ${pageCount}` : ""}.
      </p>

      {visibleRows.length === 0 ? (
        <p>No {itemName} match the selected filters.</p>
      ) : (
        <TypeTableFrame id={id} nameHeader={nameHeader} typeHeader="Signature" className="my-0">
          {visibleRows.map((row) => (
            <TypeTableItem
              key={row.original.method}
              parentId={id}
              name={row.original.method}
              item={typeNodeOf(row.original)}
              hasKeyColumn
            />
          ))}
        </TypeTableFrame>
      )}

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
            // `nextPage` does not clamp client-side pagination against the
            // filtered row count when two clicks arrive before React disables
            // the button, so re-check the live state in the handler.
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

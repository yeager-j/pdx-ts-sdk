/**
 * The report as lines: one table, then every surface's remainder.
 *
 * Every remainder prints its heading, even when empty, so the listing is
 * visibly complete. No line carries a timestamp.
 */

import type { CoverageSite } from "./model.ts";
import type { CoverageReport, CoverageSummary } from "./summary.ts";

/** What the header line cites. */
export interface CoverageProvenance {
  /** The 40-character commit of the cwtools config fork. */
  readonly rulesCommit: string;
  /** The game version the corpus fixture was extracted from. */
  readonly gameVersion: string;
}

const LABEL_WIDTH = 32;

/** Column title and width, in print order after the label. */
const COLUMNS: readonly (readonly [string, number])[] = [
  ["declared", 9],
  ["used", 9],
  ["sites", 7],
  ["authorable", 11],
  ["policy", 7],
  ["declined", 9],
  ["partial", 8],
  ["gap", 6],
  ["removed", 8],
];

function percent(ratio: number | null): string {
  return ratio === null ? "n/a" : `${(ratio * 100).toFixed(1)}%`;
}

function tableRow(label: string, cells: readonly string[]): string {
  return (
    label.padEnd(LABEL_WIDTH) +
    cells.map((cell, index) => cell.padStart(COLUMNS[index]![1])).join("")
  );
}

function summaryRow(summary: CoverageSummary): string {
  const counts = summary.counts;
  return tableRow(summary.label, [
    percent(summary.declared),
    percent(summary.used),
    String(summary.sites),
    String(counts.authorable),
    String(counts["policy-owned"]),
    String(counts.declined),
    String(counts.partial),
    String(counts.gap),
    String(counts.removed),
  ]);
}

function remainderMiddle(site: CoverageSite): string {
  if (site.class === "gap") {
    return `${site.issue ?? "untracked"}: ${site.reason}`;
  }
  if (site.class === "partial" && site.droppedArms !== undefined) {
    return `${site.reason}; omits ${site.droppedArms.join(", ")}`;
  }
  return site.reason;
}

function remainderLine(site: CoverageSite): string {
  return `  ${site.class} ${site.key} — ${remainderMiddle(site)} (used ${site.used})`;
}

/** Renders the report. One array element per line; join with `\n` to print. */
export function formatCoverageReport(
  report: CoverageReport,
  provenance: CoverageProvenance
): string[] {
  const lines = [
    `syntax coverage: cwtools-stellaris-config @ ${provenance.rulesCommit.slice(0, 12)}; ` +
      `vanilla ${provenance.gameVersion} (corpus fixture)`,
    "",
    tableRow(
      "surface",
      COLUMNS.map(([title]) => title)
    ),
    ...report.surfaces.map((surface) => summaryRow(surface.summary)),
    summaryRow(report.registries),
    summaryRow(report.overall),
    "(used weights are key occurrences for script surfaces and definitions for registries; " +
      "overall mixes them)",
    "",
  ];
  for (const surface of report.surfaces) {
    lines.push(`Remainder — ${surface.summary.label} (${surface.remainder.length}):`);
    lines.push(...surface.remainder.map(remainderLine));
  }
  return lines;
}

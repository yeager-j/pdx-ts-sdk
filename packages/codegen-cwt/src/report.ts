/**
 * Report accumulation and printing for the codegen pipeline.
 *
 * `main()` (`index.ts`) collects every line as it becomes available rather
 * than printing at the point it is computed, then hands the finished list to
 * {@link printReport} — so what the report says and how it reaches stdout are
 * two separate concerns instead of one interleaved with the pipeline itself.
 */

export function reportSection(report: string[], title: string, lines: readonly string[]): void {
  if (lines.length === 0) {
    return;
  }
  report.push(`\n${title} (${lines.length}):`);
  for (const line of lines) {
    report.push(`  ${line}`);
  }
}

/**
 * Prints the codegen report, in the order its lines were collected.
 *
 * The one place `main()`'s report reaches `console.log`: every per-registry
 * and per-category line is data by the time it gets here, pushed onto
 * {@link report} as `main()` computed it rather than printed where it was
 * computed.
 */
export function printReport(report: readonly string[]): void {
  for (const line of report) {
    console.log(line);
  }
}

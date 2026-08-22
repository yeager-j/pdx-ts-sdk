/** Appends a titled section when it contains at least one report line. */
export function reportSection(report: string[], title: string, lines: readonly string[]): void {
  if (lines.length === 0) {
    return;
  }
  report.push(`\n${title} (${lines.length}):`);
  for (const line of lines) {
    report.push(`  ${line}`);
  }
}

/** Writes each collected report line to standard output in its original order. */
export function printReport(report: readonly string[]): void {
  for (const line of report) {
    console.log(line);
  }
}

import type { EventFieldPolicyEntry } from "./policy/event-fields.ts";

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

/**
 * Formats event and option fields whose supported authoring surface is
 * incomplete, naming each field's disposition.
 *
 * An `unsupported` field is absent from the generated interface entirely; a
 * `partial` one is present but drops some of the forms the rules admit, and
 * those forms are the loss worth reading. Both are filtered out of the emitted
 * authoring surface, so the report is where they stay visible.
 */
export function eventFieldSupportLossLines(
  policy: readonly EventFieldPolicyEntry[]
): readonly string[] {
  return policy
    .filter((entry) => entry.disposition !== "supported")
    .map((entry) => {
      if (entry.disposition === "unsupported") {
        return `${entry.scriptKey} — unsupported: ${entry.reason}`;
      }
      const unsupportedForms = entry.unsupportedForms?.join(", ") ?? "not recorded";
      return `${entry.scriptKey} — partial (${entry.reason}); omits ${unsupportedForms}`;
    });
}

/** Writes each collected report line to standard output in its original order. */
export function printReport(report: readonly string[]): void {
  for (const line of report) {
    console.log(line);
  }
}

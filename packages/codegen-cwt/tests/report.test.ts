import { describe, expect, it } from "vitest";

import type { EventFieldPolicyEntry } from "../src/policy/event-fields.ts";
import { eventFieldSupportLossLines, reportSection } from "../src/report.ts";

describe("event field support report", () => {
  it("surfaces unsupported and partial policy entries with their losses", () => {
    const eventPolicy = [
      {
        scriptKey: "legacy_field",
        shape: "scalar 0..1",
        disposition: "unsupported",
        reason: "the legacy field has no authoring representation",
      },
    ] satisfies readonly EventFieldPolicyEntry[];
    const optionPolicy = [
      {
        scriptKey: "name",
        shape: "scalar 1..inf",
        disposition: "partial",
        reason: "one localized scalar name arm",
        unsupportedForms: ["repeated scalar names", "triggered name blocks"],
      },
    ] satisfies readonly EventFieldPolicyEntry[];
    const report: string[] = [];

    reportSection(
      report,
      "Event fields not fully supported",
      eventFieldSupportLossLines(eventPolicy)
    );
    reportSection(
      report,
      "Event option fields not fully supported",
      eventFieldSupportLossLines(optionPolicy)
    );

    expect(report).toEqual([
      "\nEvent fields not fully supported (1):",
      "  legacy_field — unsupported: the legacy field has no authoring representation",
      "\nEvent option fields not fully supported (1):",
      "  name — partial (one localized scalar name arm); omits repeated scalar names, triggered name blocks",
    ]);
  });
});

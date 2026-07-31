/**
 * The probe's vitest matcher pack — assertions take objects, not strings
 * (the cross-references-are-objects pillar extended to tests). Probe-local:
 * `expect.extend` runs at import time, so the test file just imports this
 * module; no vitest config changes.
 *
 * - `toContainEvent(event, { day?, from? })` on `world.fired`; the failure
 *   message prints the full fired log — the rich log doubling as the trace.
 * - `toHoldFor(scope)` on a `Trigger`; the failure message is the rendered
 *   explain tree, so it names the failing subcondition.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";
import { expect } from "vitest";

import { explainFor, renderExplanation } from "../../src/testing/interpret.ts";
import type { Country, FiredRecord, Planet } from "../../src/testing/state.ts";
import { containsFired, renderFiredRecords } from "../../src/testing/world.ts";

interface ProbeMatchers<R = unknown> {
  toContainEvent(
    event: { readonly id: string },
    details?: { readonly day?: number; readonly from?: Country | Planet }
  ): R;
  toHoldFor(scope: Country | Planet): R;
}

declare module "vitest" {
  // The `any` mirrors vitest's own Assertion declaration.
  interface Assertion<T = any> extends ProbeMatchers<T> {}
  interface AsymmetricMatchersContaining extends ProbeMatchers {}
}

expect.extend({
  toContainEvent(
    received: readonly FiredRecord[],
    event: { readonly id: string },
    details?: { readonly day?: number; readonly from?: Country | Planet }
  ) {
    const pass = containsFired(received, event.id, details);
    const wanted = [
      event.id,
      details?.day === undefined ? undefined : `day ${details.day}`,
      details?.from === undefined ? undefined : `from ${details.from.simScope}`,
    ]
      .filter((part) => part !== undefined)
      .join(", ");
    return {
      pass,
      message: () =>
        `expected the fired log ${pass ? "not " : ""}to contain ${wanted}\n` +
        `fired log:\n${received.length === 0 ? "  (empty)" : renderFiredRecords(received)}`,
    };
  },

  toHoldFor(received: { readonly entries: readonly PdxEntry[] }, scope: Country | Planet) {
    const explanation = explainFor(received, scope);
    return {
      pass: explanation.result,
      message: () =>
        `expected the trigger ${explanation.result ? "not " : ""}to hold for ` +
        `${scope.simScope} "${scope.name}"\n` +
        renderExplanation(explanation),
    };
  },
});

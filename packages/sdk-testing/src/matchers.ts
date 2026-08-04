/**
 * The testing module's Vitest matcher pack. Assertions take objects, not
 * strings. Installation is explicit so importing the testing module has no
 * Vitest side effect.
 *
 * - `toContainEvent(event, { day?, from? })` on `world.fired`; the failure
 *   message prints the full fired log — the rich log doubling as the trace.
 * - `toHoldFor(scope)` on a `Trigger`; the failure message is the rendered
 *   explain tree, so it names the failing subcondition.
 *
 * This is the one module in the package that imports Vitest, which is why the
 * package declares it as an *optional* peer dependency: the subpath boundary
 * keeps it out of every program that does not ask for it (`src/index.ts` does
 * not re-export `./testing`), so a consumer without Vitest is a supported
 * configuration and one importing this file without Vitest installed gets an
 * npm warning instead of a broken build. SDK-28 moves this into its own
 * package; until then the dependency is at least declared rather than implied.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";
import { expect } from "vitest";

import { explainFor, renderExplanation } from "./interpret.ts";
import type { AnySimHandle, FiredRecord } from "./state.ts";
import { containsFired, renderFiredRecords } from "./world.ts";

interface ProbeMatchers<R = unknown> {
  toContainEvent(
    event: { readonly id: string },
    details?: { readonly day?: number; readonly from?: AnySimHandle }
  ): R;
  toHoldFor(scope: AnySimHandle): R;
}

declare module "vitest" {
  // The `any` mirrors vitest's own Assertion declaration.
  interface Assertion<T = any> extends ProbeMatchers<T> {}
  interface AsymmetricMatchersContaining extends ProbeMatchers {}
}

export function installMatchers(): void {
  expect.extend({
    toContainEvent(
      received: readonly FiredRecord[],
      event: { readonly id: string },
      details?: { readonly day?: number; readonly from?: AnySimHandle }
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

    toHoldFor(received: { readonly entries: readonly PdxEntry[] }, scope: AnySimHandle) {
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
}

/**
 * The probe's gate.
 *
 * Install-gated the way `packages/sdk/tests/real-install.test.ts` and
 * `packages/stellaris-ids/tests/committed-output.test.ts` are: CI has no copy
 * of Stellaris, and a measurement of vanilla cannot be faked into existence.
 * The negative cases run everywhere, because they are hand-built bodies and
 * they are the half that carries the soundness claim.
 *
 * The distribution is printed, not asserted. Thresholds nobody can justify are
 * how a measurement turns into a ritual; the numbers belong in
 * `docs/verdict-scripted-scope.md`, next to the reasoning that accepted them.
 * What IS asserted is the golden (hand-derived before the analysis ran) and
 * every negative case.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { locateInstall } from "../../packages/sdk/src/stellaris/locate.ts";
import { checkCallSites } from "./callsites.ts";
import { GOLDEN_EFFECTS, GOLDEN_TRIGGERS } from "./golden.ts";
import { inferScopes } from "./infer.ts";
import { negativeCases } from "./probe-negative.ts";
import { formatReport, runProbe } from "./probe.ts";
import { loadScopeTables } from "./scope-tables.ts";

let installRoot: string | undefined;
try {
  installRoot = locateInstall();
} catch {
  installRoot = undefined;
}

describe("the analysis never narrows on an unreadable body", () => {
  const tables = loadScopeTables();
  const cases = negativeCases();
  const inferred = new Map(
    inferScopes(tables, { trigger: cases, effect: [] }).trigger.map((one) => [one.name, one.scopes])
  );

  for (const one of cases) {
    it(`leaves ${one.name} unconstrained`, () => {
      const scopes = inferred.get(one.name);
      expect(scopes, one.why).toEqual(one.allowed ?? "universal");
    });
  }
});

describe.skipIf(installRoot === undefined)("measured against a real install", () => {
  // A skipped describe's factory still executes at collection, so the probe
  // must not run eagerly: on a machine without an install (CI) it would crash
  // the whole file instead of letting the suite skip. `beforeAll` never runs
  // for a skipped suite, which is the guarantee the gate actually needs.
  let report!: ReturnType<typeof runProbe>;
  let sites!: ReturnType<typeof checkCallSites>;
  beforeAll(() => {
    report = runProbe(installRoot!);
    const lowered = (registry: "trigger" | "effect") =>
      new Map(report[registry].inferred.map((one) => [one.name.toLowerCase(), one.scopes]));
    sites = checkCallSites(installRoot!, {
      trigger: lowered("trigger"),
      effect: lowered("effect"),
    });
  });

  it("prints the distribution", () => {
    console.log(`\n${formatReport(report.trigger)}\n\n${formatReport(report.effect)}\n`);
    expect(report.trigger.total).toBeGreaterThan(1000);
    expect(report.effect.total).toBeGreaterThan(1000);
    // A parse repair in a body the analysis reads would mean it is reasoning
    // about something other than what the game loads.
    expect(report.trigger.parseDiagnostics).toBe(0);
    expect(report.effect.parseDiagnostics).toBe(0);
  });

  const scopesOf = (registry: "trigger" | "effect") =>
    new Map(report[registry].inferred.map((one) => [one.name, one.scopes]));

  describe("agrees with the hand-derived golden", () => {
    // Looked up inside each test rather than hoisted: the maps read `report`,
    // which does not exist until the suite's beforeAll has run.
    for (const entry of GOLDEN_TRIGGERS) {
      it(entry.name, () => {
        expect(scopesOf("trigger").get(entry.name), entry.derivation).toEqual(entry.scopes);
      });
    }
    for (const entry of GOLDEN_EFFECTS) {
      it(entry.name, () => {
        expect(scopesOf("effect").get(entry.name), entry.derivation).toEqual(entry.scopes);
      });
    }
  });

  describe("contradicts no call site vanilla ships", () => {
    it("checks a meaningful number of them", () => {
      // Guards the assertion below against passing because it measured nothing.
      // The `pushed scope constrains the caller` mutation — the likeliest error
      // in the whole design — produces 328 contradictions here, so the check has
      // demonstrated power and not merely coverage.
      expect(sites.events).toBeGreaterThan(5000);
      expect(sites.checked).toBeGreaterThan(3000);
      expect(sites.covered).toBeGreaterThan(500);
    });

    it("finds no false narrowing", () => {
      const shown = sites.contradictions
        .slice(0, 20)
        .map(
          (one) =>
            `${one.name} called in ${one.scope} scope (${one.file}), inferred ${one.inferred.join("|")}`
        )
        .join("\n");
      expect(sites.contradictions.length, `\n${shown}`).toBe(0);
    });
  });
});

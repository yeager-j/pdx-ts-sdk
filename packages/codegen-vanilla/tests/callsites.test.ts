/**
 * The standing falsification gate for the scope inference (SDK-13).
 *
 * Install-gated, like `packages/stellaris-ids/tests/committed-output.test.ts`:
 * CI has no copy of Stellaris, and a measurement of vanilla cannot be faked
 * into existence. Maintainer-local, and run before committing a regeneration.
 *
 * Why this and not only the type tests: everything else proves the emitted
 * scopes follow from the CWT rules. This is the only evidence that the rules
 * follow the game. It is also the check that would go red if a game patch
 * started calling a scripted trigger somewhere its body no longer justifies —
 * exactly the drift a regeneration is supposed to surface.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuleScopes } from "@pdx-ts/codegen-cwt/scope-facts";
import { locateInstall, requireGameVersion } from "@pdx-ts/sdk/installation";
import { beforeAll, describe, expect, it } from "vitest";

import { checkCallSites } from "../src/callsites.ts";
import type { ScriptedKind } from "../src/infer-scopes.ts";
import { readVanillaEvents } from "../src/read-events.ts";
import { readVanillaFacts } from "../src/read-facts.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1");

let installRoot: string | undefined;
try {
  installRoot = locateInstall();
} catch {
  installRoot = undefined;
}

function measure(root: string) {
  const facts = readVanillaFacts({
    installRoot: root,
    gameVersion: requireGameVersion(root),
    configRoot: CONFIG,
    docsRoot: DOCS,
  });
  const lowered = (registry: ScriptedKind): ReadonlyMap<string, RuleScopes> =>
    new Map(facts.inferredScopes[registry].map((one) => [one.name.toLowerCase(), one.scopes]));
  return checkCallSites(
    facts.events.sourceFiles,
    { trigger: lowered("trigger"), effect: lowered("effect") },
    facts.eventKinds
  );
}

it("checks nested files from the event extractor's inventory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pdx-event-callsites-"));
  const nested = path.join(root, "events/nested");
  try {
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      path.join(nested, "calls.txt"),
      "country_event = { id = nested.1 trigger = { known_trigger = yes } }\n"
    );

    const events = readVanillaEvents(root, CONFIG);
    const report = checkCallSites(
      events.sourceFiles,
      {
        trigger: new Map([["known_trigger", ["country"]]]),
        effect: new Map(),
      },
      events.definitions
    );

    expect(events.definitions.map((event) => event.id)).toEqual(["nested.1"]);
    expect(events.sourceFiles.map((file) => file.source)).toEqual(["nested/calls.txt"]);
    expect(report).toMatchObject({ events: 1, checked: 1, covered: 1, contradictions: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(installRoot === undefined)(
  "inferred scopes against vanilla's own call sites",
  () => {
    // A skipped describe's factory still executes at collection, so the
    // measurement must wait for beforeAll — which never runs for a skipped
    // suite. Eager here, this file crashed instead of skipping on any machine
    // without an install.
    let report!: ReturnType<typeof measure>;
    // Explicit timeout because the default hook timeout (10s) now applies
    // where collection-time execution had none: the measurement walks several
    // thousand vanilla files. ~0.4s measured warm on a local SSD; 60s is two
    // orders of magnitude of headroom for a cold or networked disk.
    beforeAll(() => {
      report = measure(installRoot!);
    }, 60_000);

    it("measures enough call sites to be able to fail", () => {
      // Guards the assertion below against passing because it measured nothing.
      // The `a link's body constrains its caller` mutation — the likeliest error
      // in the analysis — produces 328 contradictions here, so this check has
      // demonstrated power and not merely coverage.
      expect(report.events).toBeGreaterThan(5000);
      expect(report.checked).toBeGreaterThan(3000);
      expect(report.covered).toBeGreaterThan(500);
    });

    it("narrows no definition away from a scope the game calls it in", () => {
      const shown = report.contradictions
        .slice(0, 20)
        .map(
          (one) =>
            `${one.kind} ${one.name} is called in ${one.scope} scope (${one.file}) ` +
            `but inferred ${one.inferred.join("|")}`
        )
        .join("\n");
      expect(report.contradictions.length, `\n${shown}`).toBe(0);
    });
  }
);

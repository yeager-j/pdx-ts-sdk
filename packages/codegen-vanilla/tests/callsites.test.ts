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

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadScopeFacts, type RuleScopes } from "@pdx-ts/codegen-cwt/scope-facts";
import { locateInstall } from "@pdx-ts/sdk/stellaris";
import { beforeAll, describe, expect, it } from "vitest";

import { checkCallSites } from "../src/callsites.ts";
import { inferScopes, type Registry } from "../src/infer-scopes.ts";
import { VANILLA_MANIFEST, type VanillaScriptedRow } from "../src/manifest.ts";
import { readScriptedDefinitions } from "../src/read-scripted.ts";

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
  const rows = VANILLA_MANIFEST.filter((row): row is VanillaScriptedRow => row.kind === "scripted");
  const read = (registry: string) => {
    const row = rows.find((one) => one.registry === registry)!;
    return readScriptedDefinitions(root, row.registry, row.dir).definitions;
  };
  const inferred = inferScopes(loadScopeFacts(CONFIG, DOCS), {
    trigger: read("scripted_trigger"),
    effect: read("scripted_effect"),
  });
  const lowered = (registry: Registry): ReadonlyMap<string, RuleScopes> =>
    new Map(inferred[registry].map((one) => [one.name.toLowerCase(), one.scopes]));
  return checkCallSites(root, { trigger: lowered("trigger"), effect: lowered("effect") });
}

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
      // demonstrated power and not merely coverage
      // (`docs/verdict-scripted-scope.md`).
      expect(report.events).toBeGreaterThan(5000);
      expect(report.checked).toBeGreaterThan(3000);
      expect(report.covered).toBeGreaterThan(500);
    });

    it("narrows no definition away from a scope the game calls it in", () => {
      const shown = report.contradictions
        .slice(0, 20)
        .map(
          (one) =>
            `${one.registry} ${one.name} is called in ${one.scope} scope (${one.file}) ` +
            `but inferred ${one.inferred.join("|")}`
        )
        .join("\n");
      expect(report.contradictions.length, `\n${shown}`).toBe(0);
    });
  }
);

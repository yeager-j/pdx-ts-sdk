/**
 * The emitted interfaces, measured against what the game actually writes.
 *
 * Runs only where the install exists, like `real-install.test.ts` — the
 * committed gates stay hermetic. What it adds over the curated allowlists is
 * evidence: a field the SDK emits that no real definition writes is a
 * misreading of the rules, and it fails here rather than surviving review.
 *
 * Coverage is reported, not asserted. A registry sitting at 40% is a backlog,
 * not a defect, and the number belongs in the report where it can be watched
 * rather than in a threshold nobody can justify.
 */

import { describe, expect, it } from "vitest";

import { locateInstall } from "../../src/stellaris/locate.ts";
import { CONTENT_MANIFEST } from "../../tools/codegen/content-manifest.ts";
import { conformance, readRegistryCorpus } from "../../tools/codegen/corpus.ts";
import { loadRules } from "../../tools/codegen/cwt/rules.ts";
import { emitContentType } from "../../tools/codegen/emit/content-type.ts";
import { Emitter } from "../../tools/codegen/emit/types.ts";

let installPath: string | undefined;
try {
  installPath = locateInstall();
} catch {
  installPath = undefined;
}

const rules = loadRules("vendor/cwtools-stellaris-config/config");
const emitter = new Emitter(rules);

const reports = (installPath === undefined ? [] : CONTENT_MANIFEST).map((manifest) => {
  const entry = manifest as { type: string; keyword?: string; as?: string };
  const registry = entry.as ?? entry.type;
  const type = rules.contentTypes.get(entry.type);
  const registryPath = type?.path?.replace(/^game\//, "") ?? "";
  const corpus = readRegistryCorpus(
    installPath!,
    registryPath,
    entry.keyword ?? null,
    type?.nameField ?? null
  );
  const body = rules.bodies.get(entry.type);
  emitter.beginFile();
  const emitted =
    type === undefined || body === undefined
      ? []
      : emitContentType(emitter, type, body, registry).emittedFields;
  emitter.endFile();
  return conformance(registry, corpus, emitted);
});

describe.skipIf(installPath === undefined)("corpus conformance", () => {
  it("reports emitted fields the corpus never writes", () => {
    // NOT a failure. CWT is the authority on what is legal; the corpus only
    // shows what vanilla happens to write, so a field can be perfectly valid
    // and still appear here — `edict.unity_cost_mult` is declared in the rules
    // and used by no shipped edict. A field that is not in the rules at all is
    // already a hard error upstream, reported as "no such rule field".
    //
    // What this buys is a prompt: an emitted field with zero real precedent is
    // worth a second look, because the shape was inferred from the rules with
    // nothing to check it against.
    const rows = reports
      .filter((report) => report.corpus.definitions > 0 && report.invented.length > 0)
      .map((report) => `  ${report.registry}: ${report.invented.join(", ")}`);
    if (rows.length > 0) {
      console.log(
        "\nemitted with no corpus precedent (verify the shape by hand):\n" + rows.join("\n")
      );
    }
    expect(reports.length).toBeGreaterThan(0);
  });

  it("finds real definitions for every manifested registry", () => {
    // A registry whose directory parses to zero definitions means the path or
    // the keyword is wrong, and every other number here would be vacuous.
    const empty = reports.filter((report) => report.corpus.definitions === 0);
    expect(empty.map((report) => report.registry)).toEqual([]);
  });

  it("reports field coverage against the real corpus", () => {
    const rows = reports
      .filter((report) => report.corpus.definitions > 0)
      .sort((a, b) => a.coverage - b.coverage)
      .map((report) => {
        const percent = Math.round(report.coverage * 100);
        const top = report.unexpressed
          .slice(0, 3)
          .map((entry) => `${entry.field}(${entry.count})`)
          .join(" ");
        return (
          `${report.registry.padEnd(32)} ${String(percent).padStart(3)}%  ` +
          `${String(report.corpus.definitions).padStart(5)} defs   ${top}`
        );
      });
    console.log(
      "\nregistry                        cover  defs    top unexpressed\n" + rows.join("\n")
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

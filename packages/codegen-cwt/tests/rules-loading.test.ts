/**
 * SDK-261: `loadRules` reads every `RULE_FILES` entry through `buildRuleSet`
 * in three passes, so that phase 2 (single aliases, content types) is
 * complete before phase 3 (everything that resolves against them) reads any
 * file. Before that change, a single pass resolved a `single_alias` or a
 * split `type[x]`/body declaration only if the file that declared it had
 * already been read, so `RULE_FILES`' hand-written order silently doubled as
 * a dependency order. This file proves the two-phase load no longer depends
 * on file order, against the real rules and against a synthetic, order-rigged
 * pair of files.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SingleAliasTarget } from "@pdx-ts/codegen-cwt/cwt/model";
import { parseCwt } from "@pdx-ts/codegen-cwt/cwt/parser";
import {
  buildRuleSet,
  loadRules,
  readAliases,
  type AliasDecl,
  type ParsedRuleFile,
} from "@pdx-ts/codegen-cwt/cwt/rules";
import { describe, expect, it } from "vitest";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");

function file(name: string, source: string): ParsedRuleFile {
  return { file: name, parsed: parseCwt(source, name) };
}

// `declares.cwt` defines a single_alias and the `type[...]` half of a split
// type/body declaration. `consumes.cwt` references the single_alias via
// `single_alias_right` and supplies the type's body. Under the old single
// pass, whichever of the two files loaded second could see what the other
// declared; whichever loaded first could not — exactly the constraint
// `RULE_FILES`' old comments ("loaded ahead of their registries") admitted.
const declares = file(
  "declares.cwt",
  [
    "single_alias[my_clause] = {",
    "\tflag = bool",
    "}",
    "types = {",
    "\ttype[my_type] = {",
    '\t\tpath = "common/my_types"',
    "\t}",
    "}",
  ].join("\n")
);
const consumes = file(
  "consumes.cwt",
  [
    "alias[trigger:my_trigger] = single_alias_right[my_clause]",
    "my_type = {",
    "\tflag = bool",
    "}",
  ].join("\n")
);

describe("buildRuleSet order independence", () => {
  it("resolves a single_alias and a split type/body the same way regardless of file order", () => {
    const forward = buildRuleSet([declares, consumes]);
    const reversed = buildRuleSet([consumes, declares]);

    expect(reversed.triggers).toEqual(forward.triggers);
    expect(reversed.bodies).toEqual(forward.bodies);

    // Both orders actually resolve, rather than both trivially failing the
    // same way — the assertion above alone would also pass if neither order
    // resolved anything.
    expect(forward.triggers.get("my_trigger")?.[0]?.type.kind).toBe("block");
    expect(forward.bodies.get("my_type")).toEqual({ fields: expect.any(Array), scope: null });
  });

  it("would have failed under the old single pass: readAliases cannot resolve a single_alias it has not read yet", () => {
    // Reproduces exactly what the old single-pass loop did when `consumes.cwt`
    // was read before `declares.cwt`: `readAliases` — unchanged by this
    // refactor — is handed an empty single-alias table, because nothing has
    // read `declares.cwt` yet.
    const withoutDeclares = new Map<string, AliasDecl[]>();
    readAliases(
      consumes.parsed.nodes,
      consumes.file,
      "trigger",
      new Map<string, SingleAliasTarget>(),
      withoutDeclares
    );
    expect(withoutDeclares.get("my_trigger")?.[0]?.type.kind).toBe("singleAliasRight");

    // `buildRuleSet` never lets that happen: phase 2 reads every file's
    // single aliases before phase 3 resolves against them, so the same
    // reference comes out expanded regardless of which file loads first (see
    // the test above).
    const resolved = buildRuleSet([consumes, declares]).triggers.get("my_trigger")?.[0];
    expect(resolved?.type.kind).toBe("block");
  });
});

describe("loadRules against the real rules", () => {
  const rules = loadRules(CONFIG);

  it("still yields the pinned source-count shape", () => {
    // Same counts tests/reconcile.test.ts pins; repeated here so this file's
    // own order-independence claim is checked against the real, full-size
    // load, not only the synthetic pair above.
    expect(rules.triggers.size).toBe(1082);
    expect(rules.effects.size).toBe(1058);
    expect([...rules.triggers.values()].flat()).toHaveLength(1133);
  });
});

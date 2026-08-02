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
 *
 * Shape conformance is the other half: every lowered type measured against the
 * values behind it. `form` and `scope` mismatches are asserted against
 * {@link ACKNOWLEDGED}, because they name a field the SDK emits and no author
 * can fill; `arity` and `literal` are reported, because a list the game never
 * repeats and an oddly spelled scalar are both legal.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { locateInstall } from "../../src/stellaris/locate.ts";
import { CONTENT_MANIFEST } from "../../tools/codegen/content-manifest.ts";
import {
  conformance,
  readRegistryCorpus,
  shapeConformance,
  type RepeatedStructField,
  type RuleScopes,
} from "../../tools/codegen/corpus.ts";
import { loadRules, scopeIndex } from "../../tools/codegen/cwt/rules.ts";
import { emitContentType } from "../../tools/codegen/emit/content-type.ts";
import { joinModifierScopes } from "../../tools/codegen/emit/modifiers.ts";
import { canonicalScopeSet, declaredScopes } from "../../tools/codegen/emit/shape.ts";
import { Emitter } from "../../tools/codegen/emit/types.ts";
import { parseModifierDocs } from "../../tools/codegen/logs/modifier-docs.ts";
import { parseTriggerDocs } from "../../tools/codegen/logs/trigger-docs.ts";
import { REPEATED_STRUCT_DEFINITIONS } from "../../tools/codegen/overlay.ts";

/**
 * Shape mismatches that are real, understood, and not this gate's to fix, each
 * with the reason. Anything else fails.
 *
 * Every entry here is a field the SDK emits that an author cannot fill with
 * what vanilla writes. They fall into two families:
 *
 * - **A field CWT declares twice, once as a scalar and once as a block.** The
 *   picker keeps whichever arm lowers first and drops the other, so half the
 *   corpus becomes unwritable. `number | WeightBlock` already generalizes the
 *   one case where both arms are weights; the rest await the same treatment.
 *   See `docs/roadmap.md`'s "Accept both scalar and block".
 * - **A field CWT scopes `any`.** `Trigger<ScopeName>` accepts only rules legal
 *   in every scope, so "the scope varies per definition" and "no author can
 *   write a condition here" are the same statement. The fix is a scope the
 *   definition itself supplies, not an assertion — see `docs/roadmap.md`'s
 *   "Per-definition field scopes".
 */
const ACKNOWLEDGED = new Map<string, string>([
  [
    "global_ship_design.upgrades_to form",
    "CWT declares the scalar form only; one space-whale design writes a two-element block anyway. " +
      "An upstream rules gap rather than a misreading — the SDK should not invent an arm the " +
      "rules do not declare.",
  ],
  [
    "ship_size.graphical_culture form",
    "Declared twice: a block of <graphical_culture> refs and a bare bool. Orbital rings write " +
      "`graphical_culture = yes`, everything else writes the list.",
  ],
  [
    "ship_size.construction_type form",
    "Declared twice, as value_set[construction_type] and as a block of the same.",
  ],
  [
    "starbase_level.picture form",
    "Declared twice, as a trigger+picture block and as a bare <sprite>.",
  ],
  [
    "situation_type.picture form",
    "Declared twice, as a trigger+picture block and as a bare scalar.",
  ],
  ["situation_type.title form", "Declared twice, as a trigger+text block and as a bare scalar."],
  [
    "situation_type.desc form",
    "Declared twice; the overlay pins the block arm because the bare localisation arm is what " +
      "the `desc` localisation slot already covers. The scalar writes are that arm.",
  ],
  [
    "archaeological_site_type.desc form",
    "Declared twice, as a trigger+text block and as a bare localisation key.",
  ],
  [
    "civic_or_origin.modification form",
    "Declared twice, as a bool and as a block; 109 of 142 definitions write the bool.",
  ],
  [
    "species_class.randomized form",
    "Declared twice, as a bool and as a trigger block; 13 definitions write the block.",
  ],
  [
    "global_ship_design.growth_stages form",
    "CWT declares a block of named fields, but every shipped design writes a bare list of " +
      "<global_ship_design> ids.",
  ],
  [
    "ship_size.triggered_ship_roles form",
    "CWT declares a block of named fields, but every shipped ship size writes a bare list.",
  ],
  [
    "species_class.resources form",
    "CWT declares the economic_template splice, but the 16 shipped species classes write bare " +
      "values there.",
  ],
  [
    "decision.potential scope",
    "CWT scopes the decision body `this = any` deliberately — a decision on a nomadic ship " +
      "colony is ship-scoped, on a planet planet-scoped. Its own comment says so.",
  ],
  ["decision.allow scope", "Same `this = any` decision body."],
  ["decision.effect scope", "Same `this = any` decision body."],
  ["decision.on_queued scope", "Same `this = any` decision body."],
  ["decision.on_unqueued scope", "Same `this = any` decision body."],
  [
    "ship_size.potential_construction scope",
    "CWT scopes this field `this = any`: a ship size is constructed at a starbase, a planet, or " +
      "a fleet, and the condition is evaluated against whichever.",
  ],
]);

let installPath: string | undefined;
try {
  installPath = locateInstall();
} catch {
  installPath = undefined;
}

const rules = loadRules("vendor/cwtools-stellaris-config/config");
const emitter = new Emitter(rules);
const scopes = scopeIndex(rules);

/**
 * Every modifier name the SDK's generated surface knows, from the same join
 * `emitModifiers` runs. A registry that splices `alias_name[modifier]` unkeyed
 * into its body admits all of them as top-level keys, so coverage has to
 * resolve the category rather than read a field list.
 */
const MODIFIER_NAMES = (() => {
  const join = joinModifierScopes(
    rules,
    parseModifierDocs(
      readFileSync("vendor/cwtools-stellaris-config/script-docs/v4.4.1/modifiers.log", "utf8")
    ),
    (token) => emitter.canonicalScope(token)
  );
  return new Set([...join.universal, ...[...join.groups.values()].flat()]);
})();

/**
 * Which scopes each trigger and effect is legal in, resolved exactly the way
 * the trigger and effect emitters resolve it — the rules' own `## scopes`, with
 * the game's dump as fallback. A key neither source knows resolves to `null`,
 * which the shape gate skips: vanilla's ~1449 scripted triggers and every scope
 * link land there, and they are the vanilla-surface backlog rather than
 * evidence about the field holding them.
 */
const RULE_SCOPES = (() => {
  const dump = parseTriggerDocs(
    readFileSync("vendor/cwtools-stellaris-config/script-docs/v4.4.1/triggers.log", "utf8"),
    readFileSync("vendor/cwtools-stellaris-config/script-docs/v4.4.1/effects.log", "utf8")
  );
  const resolve = (
    table: typeof rules.triggers,
    docs: typeof dump.triggers
  ): Map<string, RuleScopes> => {
    const out = new Map<string, RuleScopes>();
    for (const [key, declarations] of table) {
      const supported = declaredScopes(declarations, docs.get(key));
      const set = supported.length === 0 ? null : canonicalScopeSet(supported, scopes);
      if (set !== null) {
        out.set(key.toLowerCase(), set);
      }
    }
    return out;
  };
  return {
    trigger: resolve(rules.triggers, dump.triggers),
    effect: resolve(rules.effects, dump.effects),
  };
})();

function splicedKeysOf(categories: readonly string[]): ReadonlySet<string> {
  return categories.includes("modifier") ? MODIFIER_NAMES : new Set<string>();
}

/** This registry's repeated-struct fields, straight from the same overlay the emitter reads. */
function repeatedStructFieldsOf(registry: string): readonly RepeatedStructField[] {
  return [...REPEATED_STRUCT_DEFINITIONS]
    .filter(([path]) => path.startsWith(`${registry}.`))
    .map(([path, config]) => ({
      field: path.slice(registry.length + 1),
      keying: config.keying ?? "siblings",
      identityKey: config.identityKey,
    }));
}

const reports = (installPath === undefined ? [] : CONTENT_MANIFEST).map((manifest) => {
  const entry = manifest as { type: string; keyword?: string; as?: string };
  const registry = entry.as ?? entry.type;
  const type = rules.contentTypes.get(entry.type);
  const registryPath = type?.path?.replace(/^game\//, "") ?? "";
  const corpus = readRegistryCorpus(
    installPath!,
    registryPath,
    entry.keyword ?? null,
    type?.nameField ?? null,
    repeatedStructFieldsOf(registry)
  );
  const body = rules.bodies.get(entry.type);
  emitter.beginFile();
  const emission =
    type === undefined || body === undefined
      ? null
      : emitContentType(emitter, type, body, registry);
  emitter.endFile();
  // Nested paths come back prefixed with the registry (`situation_type.stages.icon`,
  // matching the dotted paths CONTENT_DECLINED_FIELDS/CONTENT_FIELD_OVERRIDES use)
  // — strip that prefix so they line up with the corpus's own unprefixed dotted
  // paths (`stages.icon`).
  const emitted = [
    ...(emission?.emittedFields ?? []),
    ...(emission?.nestedEmittedFields ?? []).map((field) => ({
      ...field,
      field: field.field.slice(registry.length + 1),
    })),
  ];
  return {
    ...conformance(
      registry,
      corpus,
      emitted.map((field) => field.field),
      splicedKeysOf(emission?.inlineSplices ?? [])
    ),
    shape: shapeConformance(
      corpus,
      emitted,
      (clause, key) => RULE_SCOPES[clause].get(key.toLowerCase()) ?? null
    ),
  };
});

/** Every shape mismatch, as `registry.field kind` keys matching {@link ACKNOWLEDGED}. */
function mismatchesOfKind(kinds: readonly string[]): { key: string; detail: string }[] {
  return reports.flatMap((report) =>
    report.shape
      .filter((mismatch) => kinds.includes(mismatch.kind))
      .map((mismatch) => ({
        key: `${report.registry}.${mismatch.field} ${mismatch.kind}`,
        detail: mismatch.detail,
      }))
  );
}

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

  it("emits no field the corpus proves unfillable", () => {
    // A `form` or `scope` mismatch is not a legality question the way `invented`
    // is: the game writes it, so it is legal, and the emitted type cannot hold
    // it. Acknowledging one takes a reason; adding a new one takes a fix.
    const unacknowledged = mismatchesOfKind(["form", "scope"])
      .filter((mismatch) => !ACKNOWLEDGED.has(mismatch.key))
      .map((mismatch) => `${mismatch.key}: ${mismatch.detail}`)
      .sort();
    expect(unacknowledged).toEqual([]);
  });

  it("keeps every acknowledged shape mismatch live", () => {
    // The other direction: a row whose defect has been fixed is stale, and
    // leaving it would quietly re-acknowledge the defect if it came back.
    const live = new Set(mismatchesOfKind(["form", "scope"]).map((mismatch) => mismatch.key));
    expect([...ACKNOWLEDGED.keys()].filter((key) => !live.has(key))).toEqual([]);
  });

  it("reports arity and literal mismatches", () => {
    // Reported, not asserted, in both directions. A list CWT declares and the
    // game never repeats is still legal, and asserting it would demand an
    // overlay row per registry for a shape that is merely wider than it needs
    // to be. A stray scalar is usually an upstream spelling (`LARGE` for
    // `large`), which the game reads case-insensitively and the SDK does not
    // need to.
    const rows = mismatchesOfKind(["arity", "literal"])
      .map((mismatch) => `  ${mismatch.key}: ${mismatch.detail}`)
      .sort();
    console.log("\nshape observations (reported, not failed):\n" + rows.join("\n"));
    expect(reports.length).toBeGreaterThan(0);
  });
});

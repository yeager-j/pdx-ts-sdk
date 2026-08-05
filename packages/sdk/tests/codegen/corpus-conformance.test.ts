/**
 * The emitted interfaces, measured against what the game actually writes —
 * hermetically, against the committed fixture under `tests/fixtures/corpus/`.
 *
 * The install-gated version of this gate skipped entirely without a local
 * game, so CI never ran it, and it reported field-presence coverage instead of
 * asserting it. The realized consequence, twice: fields the rules declare and
 * the game writes heavily (`building.triggered_planet_modifier`, 672 shipped
 * occurrences) were silently unauthorable with every gate green. Now the
 * install-facing half lives in `npm run corpus:extract` / `corpus:check`
 * (see `corpus-fixture.ts`), and this file loads what those commit — no
 * skip, no install, every assertion in plain `npm test` and CI.
 *
 * Three kinds of assertion:
 *
 * - **Presence floor.** A field the game writes in `PRESENCE_FLOOR`+
 *   definitions must be authorable, unless `CONTENT_DECLINED_FIELDS` declines
 *   it or `corpus-gaps.ts` acknowledges it. Near-floor fields are reported,
 *   not failed, so ratcheting the floor down is an informed move.
 * - **Shape conformance.** Every lowered type measured against the values
 *   behind it. `form` and `scope` mismatches are asserted against
 *   {@link ACKNOWLEDGED}, because they name a field the SDK emits and no
 *   author can fill; `arity` and `literal` are reported, because a list the
 *   game never repeats and an oddly spelled scalar are both legal.
 * - **Fixture integrity.** Every manifested registry has a fixture with a
 *   nonzero definition count, and no stale fixture lingers.
 *
 * The version canary is the loop's freshness signal: with no local install it
 * is silent; with an install whose build differs from the fixture's it prints
 * a banner and skips a visibly named test — a warning, never a failure,
 * because CI without an install must pass and a maintainer with a patched
 * game must notice.
 */

import { conformance, shapeConformance, type RuleScopes } from "@pdx-ts/codegen-cwt/corpus";
import { describe, expect, it } from "vitest";

import { InstallNotFoundError } from "../../src/errors.ts";
import {
  corpusOfFixture,
  FIXTURE_PATH,
  fixtureStems,
  loadMeta,
  loadRegistryFixture,
  MEASUREMENTS,
  NEAR_FLOOR,
  PRESENCE_FLOOR,
  ruleScopesOf,
  versionCanary,
} from "./corpus-fixture.ts";
import { ACKNOWLEDGED_GAPS } from "./corpus-gaps.ts";

/**
 * Shape mismatches that are real, understood, and not this gate's to fix, each
 * with the reason. Anything else fails.
 *
 * Every entry here is a field the SDK emits that an author cannot fill with
 * what vanilla writes. Three families remain, none of them a misreading the
 * emitter could fix on its own:
 *
 * - **The corpus writes a form CWT does not declare.** Inventing an arm the
 *   rules deny would be guessing at game semantics from one shipped file.
 * - **Two declarations whose arms are indistinguishable.** A dual dispatches on
 *   what the author passed, so two arms that both author as arrays cannot be
 *   told apart. See `lowerDual`.
 * - **A field CWT scopes `any` whose legal set is not settled.** The fix is a
 *   scope the definition supplies (`CONTENT_SCOPE_PARAMETERS`, which `decision`
 *   now uses), and a row there needs the same evidence any assertion does. Once
 *   one exists the gate stops acknowledging and starts checking: it asks
 *   whether the declared set covers what the corpus writes.
 */
const ACKNOWLEDGED = new Map<string, string>([
  [
    "global_ship_design.upgrades_to form",
    "CWT declares the scalar form only; one space-whale design writes a two-element block anyway. " +
      "An upstream rules gap rather than a misreading — the SDK should not invent an arm the " +
      "rules do not declare.",
  ],
  [
    "situation_type.picture form",
    "Declared twice, as a bare <sprite> and as a trigger+picture block — but both declarations " +
      "carry `cardinality = 0..inf`, so both arms author as arrays and the writer could not tell " +
      "which one a value belongs to. `title` and `desc` dual cleanly because their scalar arm is " +
      "`0..1`. An `arity` assertion cannot help: it would narrow the block arm too, and the block " +
      "form really does repeat.",
  ],
  [
    "species_class.resources form",
    "CWT declares the economic_template splice, but the 16 shipped species classes write bare " +
      "values there.",
  ],
  [
    "ship_size.potential_construction scope",
    "`Trigger<ScopeName>` is the right type and the clause needs narrowing inside it, not a " +
      "declaration: one ship size's construction clause is evaluated against several scope types " +
      "and vanilla branches on which, testing `is_scope_type` 13 times across these clauses " +
      "(zero shipped decisions do, which is why a scope parameter fit there and not here). " +
      "SDK-24 tracks the `inScope` combinator; it waits on SDK-13, since most bodies here " +
      "delegate to vanilla scripted triggers the SDK cannot name yet.",
  ],
]);

const REMEDY = "run npm run corpus:extract and review the fixture diff";

const meta = loadMeta();
const reports = MEASUREMENTS.flatMap((measurement) => {
  const fixture = loadRegistryFixture(measurement.registry);
  if (fixture === null) {
    return [];
  }
  const corpus = corpusOfFixture(fixture);
  return [
    {
      measurement,
      ...conformance(
        measurement.registry,
        corpus,
        measurement.emitted.map((field) => field.field),
        measurement.splicedKeys
      ),
      shape: shapeConformance(corpus, measurement.emitted, ruleScopesOf),
    },
  ];
});
const byRegistry = new Map(reports.map((report) => [report.registry, report]));

/** Observed fields nothing can author: unexpressed minus the declined rows. */
function unauthorable(report: (typeof reports)[number]) {
  return report.unexpressed.filter((entry) => !report.measurement.declinedPaths.has(entry.field));
}

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

describe("corpus conformance", () => {
  it("has a committed fixture for every manifested registry", () => {
    // The hermetic gate is only as honest as its evidence: a manifested
    // registry with no fixture would silently measure nothing, which is the
    // exact failure mode this rewrite exists to close.
    const missing = MEASUREMENTS.filter(
      (measurement) => loadRegistryFixture(measurement.registry) === null
    ).map((measurement) => `${FIXTURE_PATH}/${measurement.registry}.json is missing — ${REMEDY}`);
    if (meta === null) {
      missing.push(`${FIXTURE_PATH}/meta.json is missing — ${REMEDY}`);
    }
    expect(missing).toEqual([]);
  });

  it("keeps no fixture for a registry no longer manifested", () => {
    // The reverse direction: a stale fixture is dead evidence that would read
    // as coverage. The extractor prunes these; a leftover means it never ran.
    const manifested = new Set(MEASUREMENTS.map((measurement) => measurement.registry));
    const stale = fixtureStems()
      .filter((stem) => !manifested.has(stem))
      .map((stem) => `${FIXTURE_PATH}/${stem}.json names no manifested registry — ${REMEDY}`);
    expect(stale).toEqual([]);
  });

  it("records real definitions for every manifested registry", () => {
    // A registry whose corpus records zero definitions means the path or the
    // keyword is wrong, and every other number here would be vacuous.
    const empty = reports.filter((report) => report.corpus.definitions === 0);
    expect(empty.map((report) => report.registry)).toEqual([]);
  });

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

  it("reports field coverage against the corpus fixture", () => {
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

  it("keeps every heavily written field authorable", () => {
    // The presence floor. Below it the corpus stays a lower bound that proves
    // nothing about absence; at or above it, absence is a hole in the SDK's
    // "a mod author does not run out of API" promise, and it fails by name
    // instead of sitting in a report nobody is obliged to read.
    const acknowledged = new Set(ACKNOWLEDGED_GAPS.map((gap) => `${gap.registry}.${gap.field}`));
    const failures = reports.flatMap((report) =>
      unauthorable(report)
        .filter(
          (entry) =>
            entry.count >= PRESENCE_FLOOR && !acknowledged.has(`${report.registry}.${entry.field}`)
        )
        .map(
          (entry) =>
            `${report.registry}.${entry.field}: ${entry.count} shipped definitions write it and ` +
            `no author can — fix the lowering, or acknowledge it with a reason in corpus-gaps.ts`
        )
    );
    expect(failures).toEqual([]);
  });

  it("keeps every acknowledged gap live", () => {
    // The other direction: a row whose field became authorable, was declined,
    // or fell below the floor is stale, and leaving it would quietly
    // re-acknowledge the gap if it came back.
    const stale = ACKNOWLEDGED_GAPS.flatMap((gap) => {
      const name = `${gap.registry}.${gap.field}`;
      const report = byRegistry.get(gap.registry);
      if (report === undefined) {
        return [`${name}: names no manifested registry — remove the row`];
      }
      const entry = unauthorable(report).find((one) => one.field === gap.field);
      if (entry === undefined) {
        return [`${name}: now authorable or declined — remove the row`];
      }
      if (entry.count < PRESENCE_FLOOR) {
        return [`${name}: ${entry.count} occurrences is below the floor — remove the row`];
      }
      return [];
    });
    expect(stale).toEqual([]);
  });

  it("reports near-floor unauthorable fields", () => {
    // Printed, not failed: what ratcheting PRESENCE_FLOOR down would add, so
    // the next lowering (or the next floor) is chosen with the numbers in view.
    const rows = reports.flatMap((report) =>
      unauthorable(report)
        .filter((entry) => entry.count >= NEAR_FLOOR && entry.count < PRESENCE_FLOOR)
        .map((entry) => `  ${report.registry}.${entry.field} (${entry.count})`)
    );
    if (rows.length > 0) {
      console.log(
        `\nunauthorable below the presence floor (${NEAR_FLOOR}-${PRESENCE_FLOOR - 1}, ` +
          "reported for future ratcheting):\n" +
          rows.join("\n")
      );
    }
    expect(reports.length).toBeGreaterThan(0);
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

/**
 * The freshness canary, computed once at collection so the mismatch can reach
 * both the banner and the skipped test's name. A verdict, never a failure:
 * see {@link versionCanary}.
 */
const canary = meta === null ? null : versionCanary(meta.gameVersion);
if (canary?.kind === "mismatch") {
  // Written to the stream rather than through console.error: the runner
  // intercepts console output and its non-TTY reporter drops it, and a
  // freshness warning a reporter can swallow is no warning. The skipped test
  // below carries the same message into the run summary.
  process.stderr.write(
    "\n============================================================================\n" +
      `STALE CORPUS FIXTURE: installed Stellaris is ${canary.installed}, but the committed\n` +
      `fixture was extracted from ${canary.fixture}. The hermetic corpus gate is measuring\n` +
      `against the old build — ${REMEDY}.\n` +
      "============================================================================\n"
  );
}

describe("corpus fixture version canary", () => {
  it.skipIf(canary?.kind === "mismatch")(
    canary?.kind === "mismatch"
      ? `STALE FIXTURE: installed ${canary.installed} vs fixture ${canary.fixture} — ${REMEDY}`
      : "committed fixture matches any locally installed game",
    () => {
      // Reached only for "no meta" (its own test above fails), "no-install"
      // (nothing to compare, hermetic by design) and "match".
      expect(canary?.kind === "mismatch").toBe(false);
    }
  );

  // The three verdicts, each through the injected seams — the only way all of
  // them are testable on one machine, and the proof CI's install-less branch
  // takes the silent path rather than merely happening not to throw here.
  const missing = (): string => {
    throw new InstallNotFoundError("no install anywhere");
  };

  it("stays silent when no install exists", () => {
    expect(versionCanary("4.4.6", missing)).toEqual({ kind: "no-install" });
  });

  it("treats a bad STELLARIS_PATH's loud error as no install", () => {
    // `locateInstall` throws InstallNotFoundError for an explicit path that
    // fails the sentinel too; for the canary that still means "no usable
    // install", not a broken test run.
    const explicit = (): string => {
      throw new InstallNotFoundError("STELLARIS_PATH=/nowhere is not a Stellaris install");
    };
    expect(versionCanary("4.4.6", explicit)).toEqual({ kind: "no-install" });
  });

  it("matches when the installed version equals the fixture's", () => {
    expect(
      versionCanary(
        "4.4.6",
        () => "/game",
        () => "4.4.6"
      )
    ).toEqual({
      kind: "match",
      version: "4.4.6",
    });
  });

  it("flags a mismatched install, including one stating no version", () => {
    expect(
      versionCanary(
        "4.4.6",
        () => "/game",
        () => "4.5.0"
      )
    ).toEqual({
      kind: "mismatch",
      installed: "4.5.0",
      fixture: "4.4.6",
    });
    expect(
      versionCanary(
        "4.4.6",
        () => "/game",
        () => undefined
      )
    ).toEqual({
      kind: "mismatch",
      installed: "unknown (launcher-settings.json states no version)",
      fixture: "4.4.6",
    });
  });

  it("rethrows anything that is not an install-not-found", () => {
    // Any other error is a real defect in the canary's own plumbing, and
    // swallowing it would turn the canary into a silence generator.
    const broken = (): string => {
      throw new Error("EACCES");
    };
    expect(() => versionCanary("4.4.6", broken)).toThrow("EACCES");
  });
});

/**
 * The gate's own logic, against a corpus built here rather than parsed.
 *
 * Hermetic on purpose, like everything else in this file now — but this one
 * would stay even if the fixture vanished: a check that has only ever been
 * green proves nothing, and the real corpus cannot be made to contain the case
 * this has to detect. Every shipped decision picks one scope, so only a
 * synthetic definition shows that the parameter check is per definition rather
 * than per key.
 */
describe("shape conformance, per-definition scope", () => {
  const RULES = new Map<string, RuleScopes>([
    ["is_capital", ["planet"]],
    ["has_ship_flag", ["ship"]],
    ["always", "universal"],
  ]);
  const scopesOf = (_clause: "trigger" | "effect", key: string): RuleScopes | null =>
    RULES.get(key) ?? null;

  const potential = {
    field: "potential",
    shape: "trigger",
    repeated: false,
    clause: "trigger",
    scope: { parameter: ["planet", "ship"] },
  } as const;

  function corpusOf(...definitions: readonly (readonly string[])[]) {
    const keysByDefinition = definitions.map((keys) => new Set(keys));
    return {
      definitions: definitions.length,
      files: 1,
      occurrences: new Map([
        [
          "potential",
          {
            definitions: definitions.length,
            repeated: 0,
            scalars: 0,
            blocks: definitions.length,
            bareBlocks: 0,
            values: new Set<string>(),
            keys: new Set(definitions.flat()),
            keysByDefinition,
          },
        ],
      ]),
    };
  }

  it("accepts definitions that each pick one scope", () => {
    // The shape of the real corpus: some definitions planet, some ship, none
    // mixing. Universal rules and rules nothing knows constrain nothing.
    const mismatches = shapeConformance(
      corpusOf(["is_capital", "always"], ["has_ship_flag"], ["some_scripted_trigger"]),
      [potential],
      scopesOf
    );
    expect(mismatches).toEqual([]);
  });

  it("rejects one definition whose conditions share no scope", () => {
    // The case the merged key set could not see: per key, each of these is
    // legal under one declared scope, so a per-key check passes a definition
    // no single `scope:` declaration can express.
    const mismatches = shapeConformance(
      corpusOf(["is_capital", "has_ship_flag"]),
      [potential],
      scopesOf
    );
    expect(mismatches.map((mismatch) => mismatch.kind)).toEqual(["scope"]);
    expect(mismatches[0]?.detail).toContain("no single scope of planet/ship");
  });
});

/**
 * The interior form check's two unkeyed shapes, whose evidence is the reverse
 * of every other block's.
 *
 * A wrapped struct writes bare blocks (`discrete_terms = { { key = … } }`), so
 * "no named keys" is what it looks like when correct — reading that as a defect
 * is what made four real, authorable fields report as unfillable, two of them
 * acknowledged for months with a reason the fixture contradicts. Both
 * directions are asserted: the exemption must not become a blanket one, or a
 * misread wrapper would go unreported.
 */
describe("shape conformance, wrapped struct interiors", () => {
  // `repeated` describes the outer *key*, which a wrapper is what stops from
  // repeating: the repetition moved inside it. `discrete_terms` is `0..1`.
  const wrapped = { field: "discrete_terms", shape: "struct", repeated: false, wrapped: true };
  const plain = { field: "discrete_terms", shape: "struct", repeated: false };
  const noScopes = (): null => null;

  function corpusOf(observed: { bareBlocks: number; keys: readonly string[] }) {
    return {
      definitions: 1,
      files: 1,
      occurrences: new Map([
        [
          "discrete_terms",
          {
            definitions: 1,
            repeated: 0,
            scalars: 0,
            blocks: 1,
            bareBlocks: observed.bareBlocks,
            values: new Set<string>(),
            keys: new Set(observed.keys),
            keysByDefinition: [new Set(observed.keys)],
          },
        ],
      ]),
    };
  }

  it("accepts the bare blocks a wrapped struct writes", () => {
    const bareBlocks = corpusOf({ bareBlocks: 1, keys: [] });
    expect(shapeConformance(bareBlocks, [wrapped], noScopes)).toEqual([]);
    // The same observation against a struct that is not wrapped is the real
    // defect the check exists for, and must still be reported.
    expect(shapeConformance(bareBlocks, [plain], noScopes).map((one) => one.kind)).toEqual([
      "form",
    ]);
  });

  it("reports a wrapped struct whose blocks are keyed after all", () => {
    // The wrapper was misread: the game writes named entries where the lowering
    // expects anonymous ones, so the emitted array cannot hold them.
    const mismatches = shapeConformance(
      corpusOf({ bareBlocks: 0, keys: ["key"] }),
      [wrapped],
      noScopes
    );
    expect(mismatches.map((one) => one.kind)).toEqual(["form"]);
    expect(mismatches[0]?.detail).toContain("lowered as a wrapped struct");
  });
});

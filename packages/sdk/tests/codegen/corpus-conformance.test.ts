/**
 * The emitted interfaces, measured against the committed vanilla-only fixture
 * under `tests/fixtures/corpus/`. This is an observed lower bound, not proof of
 * complete authorability.
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
 * - **Presence floor.** A field the vanilla fixture observes in
 *   `PRESENCE_FLOOR`+ definitions must be authorable, unless
 *   `CONTENT_DECLINED_FIELDS` declines it or `corpus-gaps.ts` acknowledges it.
 *   Near-floor fields are reported, not failed, so the green gate makes no
 *   completeness claim below the ratchet or behind an explicit waiver.
 * - **Shape conformance.** Every lowered type measured against the values
 *   behind it. `form` and `scope` mismatches are asserted against
 *   `ACKNOWLEDGED_MISMATCHES`, because they name a field the SDK emits and no
 *   author can fill. `arity` and `literal` are legal — a list the game never
 *   repeats and an oddly spelled scalar are both things CWT permits — so they
 *   are held against the classified baseline in `corpus-observations.ts`
 *   instead: not a legality failure, but a *new or changed* one fails until
 *   somebody says which kind of legal it is.
 * - **Fixture integrity.** Every manifested registry has a fixture with a
 *   nonzero definition count, no stale fixture lingers, and no fixture
 *   predates a descent the emitter now produces — the one staleness the
 *   install-gated half cannot report to CI.
 *
 * The version canary is the loop's freshness signal: with no local install it
 * is silent; with an install whose build differs from the fixture's it prints
 * a banner and skips a visibly named test — a warning, never a failure,
 * because CI without an install must pass and a maintainer with a patched
 * game must notice.
 */

import {
  conformance,
  DESCENT_MODES,
  shapeConformance,
  VALUE_SAMPLE,
  type DescentNode,
  type RuleScopes,
} from "@pdx-ts/codegen-cwt/corpus";
import { OBSERVED_CASINGS } from "@pdx-ts/codegen-cwt/corpus/casing";
import type { EmittedField } from "@pdx-ts/codegen-cwt/emit/content/field-projection";
import { describe, expect, it } from "vitest";

import { InstallNotFoundError } from "../../src/errors.ts";
import { isEffectKey } from "../../src/script/effects/recorder.ts";
import {
  corpusOfFixture,
  FIXTURE_PATH,
  fixtureStems,
  isRuleTriggerKey,
  loadMeta,
  loadRegistryFixture,
  MEASUREMENTS,
  NEAR_FLOOR,
  PRESENCE_FLOOR,
  ruleScopesOf,
  versionCanary,
} from "./corpus-fixture.ts";
import { ACKNOWLEDGED_GAPS } from "./corpus-gaps.ts";
import {
  ACKNOWLEDGED_MISMATCHES,
  compareObservations,
  observationStub,
  shapeKey,
  type ClassifiedObservation,
  type ObservationKind,
  type ObservedShape,
} from "./corpus-observations.ts";

/** The `form`/`scope` acknowledgements, by the key {@link mismatchesOfKind} builds. */
const ACKNOWLEDGED = new Map(ACKNOWLEDGED_MISMATCHES.map((row) => [shapeKey(row), row.rationale]));

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

/**
 * Descent modes {@link TOTAL_RECORDING_MODES} deliberately excludes, each with
 * the reason an empty interior under it is a correct reading rather than a
 * stale fixture.
 *
 * `weightModifiers` and `triggeredModifierPotential` are selective by design:
 * a weight block written as `{ factor = 2 }` has no `modifier` row, and
 * recording nothing there is correct, not a hole. Eleven such blocks exist
 * across the fixture today. `economicResourceOperationTrigger` is the same
 * shape of selective: the operation's `trigger` declaration is `0..1`
 * (`economicResourceOperationParts` in codegen-cwt's `emit/rule-shapes.ts`),
 * so an operation with no trigger row is legal and records nothing under
 * `<field>.trigger`.
 */
const SELECTIVE_DESCENT_MODES = new Set([
  "weightModifiers",
  "triggeredModifierPotential",
  "economicResourceOperationTrigger",
]);

/**
 * The descent modes that record *every* key of the blocks they reach, so an
 * observed non-empty block under one of them must leave at least one interior
 * path behind. Every {@link DESCENT_MODES} member lands in exactly one of this
 * set or {@link SELECTIVE_DESCENT_MODES} — asserted below — so a new descent
 * mode fails this suite instead of silently joining neither.
 */
const TOTAL_RECORDING_MODES = new Set([
  "struct",
  "wrappedStruct",
  "structMap",
  "repeatedStruct",
  "triggerStruct",
]);

describe("the descent-mode classification stays exhaustive", () => {
  it("puts every DESCENT_MODES member in TOTAL_RECORDING_MODES or SELECTIVE_DESCENT_MODES, never both", () => {
    for (const mode of DESCENT_MODES) {
      const total = TOTAL_RECORDING_MODES.has(mode);
      const selective = SELECTIVE_DESCENT_MODES.has(mode);
      expect(total || selective, `${mode} is classified as neither total nor selective`).toBe(true);
      expect(total && selective, `${mode} is classified as both total and selective`).toBe(false);
    }
    expect(TOTAL_RECORDING_MODES.size + SELECTIVE_DESCENT_MODES.size).toBe(DESCENT_MODES.length);
  });
});

/** Every descent path in one registry's tree, with the mode that reaches it. */
function descentPaths(
  nodes: readonly DescentNode[],
  prefix = ""
): { path: string; mode: string }[] {
  return nodes.flatMap((node) => {
    const path = prefix === "" ? node.field : `${prefix}.${node.field}`;
    return [{ path, mode: node.mode }, ...descentPaths(node.children, path)];
  });
}

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
        key: shapeKey({ registry: report.registry, field: mismatch.field, kind: mismatch.kind }),
        detail: mismatch.detail,
      }))
  );
}

/**
 * The `arity` and `literal` mismatches as structured rows, which is the half the
 * baseline compares. The `detail` prose stays behind: it carries a definition
 * count that moves with every patch and a stray sample that truncates at six,
 * and a baseline keyed on either would fail for a reason nobody has to answer
 * for while missing one somebody does.
 */
function observedShapes(): ObservedShape[] {
  return reports.flatMap((report) =>
    report.shape
      .filter((mismatch): mismatch is typeof mismatch & { kind: ObservationKind } =>
        ["arity", "literal"].includes(mismatch.kind)
      )
      .map((mismatch) => ({
        registry: report.registry,
        field: mismatch.field,
        kind: mismatch.kind,
        evidence: mismatch.evidence,
      }))
  );
}

describe("corpus conformance", () => {
  it("keeps create_ambient_object observed in initializer effects and generated", () => {
    const solarSystem = loadRegistryFixture("solar_system_initializer");
    const initEffect = solarSystem?.fields.init_effect;
    expect(initEffect?.keys).toContain("create_ambient_object");
    expect(
      initEffect?.keysByDefinition.some((keys) => keys.includes("create_ambient_object"))
    ).toBe(true);
    expect(isEffectKey("create_ambient_object")).toBe(true);
  });

  it("records mixed trigger structs at their sibling and synthetic trigger paths", () => {
    const megastructure = loadRegistryFixture("megastructure")!;
    expect(megastructure.fields.placement_rules).toMatchObject({
      definitions: 27,
      blocks: 27,
      emptyBlocks: 4,
    });
    expect(megastructure.fields["placement_rules.planet_possible"]).toMatchObject({
      definitions: 23,
      blocks: 23,
      keys: ["custom_tooltip", "if", "is_planet_class", "is_star_class"],
    });
    // Vanilla 4.4.6 writes no direct alias-trigger entries in placement_rules;
    // the generated `when` remains legal API rather than a corpus invention.
    expect(megastructure.fields["placement_rules.when"]).toBeUndefined();

    const decision = loadRegistryFixture("decision")!;
    expect(decision.fields["custom_tooltip.success_text"]).toMatchObject({
      definitions: 4,
      scalars: 4,
    });
    expect(decision.fields["custom_tooltip.when"]).toMatchObject({
      definitions: 4,
      blocks: 4,
      keys: ["NOT", "check_variable", "count_deposits", "owner"],
    });
  });

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

  it("records the interior of every block the emitter descends into", () => {
    // The one kind of fixture staleness the loop could not otherwise see. The
    // install-gated `corpus:check` re-extracts and diffs, but CI has no
    // install, so a fixture that is not the emitter's own output rides along
    // with every gate green — and one did: `special_project.json` was
    // committed without `desc.text` / `desc.trigger` even though `desc` was
    // already lowered, descended, and observed writing six non-empty blocks.
    // Nothing failed for three PRs, and the paths reappeared as unexplained
    // drift the next time anyone ran the extractor.
    //
    // This is the hermetic half of that check, and it needs no install: the
    // reader records every key of a block it descends with a total mode, so an
    // observed non-empty block with no interior path beneath it is a
    // contradiction between the fixture and the emitter that produced it. It
    // cannot prove a fixture current — only re-extraction does that — but it
    // does prove the fixture was extracted with these descents in place.
    const stale = reports.flatMap((report) =>
      descentPaths(report.measurement.descents)
        .filter((node) => TOTAL_RECORDING_MODES.has(node.mode))
        .flatMap((node) => {
          const observation = report.corpus.occurrences.get(node.path);
          if (observation === undefined || observation.blocks - observation.emptyBlocks === 0) {
            return [];
          }
          const interior = [...report.corpus.occurrences.keys()].some((field) =>
            field.startsWith(`${node.path}.`)
          );
          return interior
            ? []
            : [
                `${report.registry}.${node.path}: ${observation.blocks} blocks observed and no ` +
                  `interior path recorded, so the fixture predates the ${node.mode} descent — ` +
                  REMEDY,
              ];
        })
    );
    expect(stale).toEqual([]);
  });

  it("records real definitions for every manifested registry", () => {
    // A registry whose corpus records zero definitions means the path or the
    // keyword is wrong, and every other number here would be vacuous.
    const empty = reports.filter((report) => report.corpus.definitions === 0);
    expect(empty.map((report) => report.registry)).toEqual([]);
  });

  it("leaves no two field keys of a casing-enforced registry differing only by case", () => {
    // The hermetic half of `casing.ts`. The extractor throws on an unaudited
    // near-miss, but the extractor is install-gated: this reads the committed
    // fixture instead, so a fold that stopped working — or a variant somebody
    // added to the table but pointed at the wrong canonical — shows up in CI as
    // two half-counted fields rather than as nothing at all.
    const collisions = [...OBSERVED_CASINGS.keys()].flatMap((registry) => {
      const fixture = loadRegistryFixture(registry);
      const byLower = new Map<string, string[]>();
      for (const field of Object.keys(fixture?.fields ?? {})) {
        const lower = field.toLowerCase();
        byLower.set(lower, [...(byLower.get(lower) ?? []), field]);
      }
      return [...byLower.values()]
        .filter((spellings) => spellings.length > 1)
        .map((spellings) => `${registry}: ${spellings.join(", ")}`);
    });
    expect(collisions).toEqual([]);
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

  it("keeps every heavily observed vanilla field authorable or acknowledged", () => {
    // The presence floor is a ratchet over observed vanilla data. Below it the
    // corpus proves nothing about absence; at or above it, an unauthorable
    // field must fail by name or carry an explicit acknowledged-gap row.
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

  it("reports weight rows the corpus writes with no condition", () => {
    // Reported, not failed, and the evidence behind `Modifier.when` being
    // optional: a `modifier` row whose only content is an operation is an
    // unconditional adjustment, legal and shipped. Counted after the strip, so
    // an empty block at one of these paths is exactly an ungated row.
    const rows = reports.flatMap((report) =>
      report.measurement.emitted
        .filter((field) => field.shape === "weightModifier")
        .flatMap((field) => {
          const observation = report.corpus.occurrences.get(field.field);
          return observation === undefined || observation.emptyBlocks === 0
            ? []
            : [
                `  ${report.registry}.${field.field}: ${observation.emptyBlocks} of ` +
                  `${observation.definitions} definitions`,
              ];
        })
    );
    if (rows.length > 0) {
      console.log("\nweight rows written with no gating condition:\n" + rows.join("\n"));
    }
    expect(reports.length).toBeGreaterThan(0);
  });

  it("emits no field the corpus proves unfillable", () => {
    // A `form` or `scope` mismatch is not a legality question the way `invented`
    // is: the game writes it, so it is legal, and the emitted type either cannot
    // hold it or holds it unchecked (see {@link ACKNOWLEDGED} for the split).
    // Acknowledging one takes a reason; adding a new one takes a fix.
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

  it("keeps every closed literal union under the value-sample cap", () => {
    // What makes the `literal` half of the baseline honest, and the one thing
    // the evidence cannot say about itself.
    //
    // The reader remembers at most VALUE_SAMPLE distinct scalars per field. A
    // field that fills the sample before an out-of-union spelling appears never
    // records that spelling, so `shapeConformance` reports no stray for it and
    // the baseline stays green over a value nobody reviewed — a new unsupported
    // game value passing a gate whose whole claim is that it would not. Below
    // the cap there is no sample: the set is everything the corpus wrote, and
    // the verdict is complete.
    //
    // So the claim is asserted rather than assumed. Vanilla's widest closed
    // union sits well under the cap today, and if one ever reaches it this
    // fails by name — the remedy is to raise VALUE_SAMPLE or to record the
    // overflow, not to accept a filtered verdict. A field that happens to hold
    // exactly VALUE_SAMPLE values with nothing dropped fails here too; the
    // remedy is the same, so the conservative reading costs nothing.
    const saturated = reports.flatMap((report) =>
      report.measurement.emitted
        .filter((field) => field.literals !== undefined)
        .flatMap((field) => {
          const observation = report.corpus.occurrences.get(field.field);
          return observation === undefined || observation.values.size < VALUE_SAMPLE
            ? []
            : [
                `${report.registry}.${field.field}: ${observation.values.size} distinct values ` +
                  `reaches the ${VALUE_SAMPLE}-value sample cap, so a stray outside its ` +
                  `${field.literals!.length}-member union could be dropped unreported — raise ` +
                  "VALUE_SAMPLE or record the overflow",
              ];
        })
    );
    expect(saturated).toEqual([]);
  });

  it("holds the classified arity and literal observation baseline", () => {
    // NOT a legality assertion, in either direction. A list CWT declares and
    // the game never repeats is still legal, and asserting it would demand an
    // overlay row per registry for a shape that is merely wider than it needs
    // to be. A stray scalar is usually an upstream spelling (`LARGE` for
    // `large`), which the game reads case-insensitively and the SDK does not
    // need to.
    //
    // What fails is *movement*. Printing these to the console instead — which
    // is what this replaced — meant a new observation scrolled past beside the
    // forty already there, and the next game patch's scrolled past beside
    // those. So each one carries a classification and the reason for it in
    // `corpus-observations.ts`, and an observation that is new, gone, or
    // holding different values than its row records fails until somebody looks.
    const differences = compareObservations(observedShapes());
    const stubs = observedShapes()
      .filter((one) => differences.some((line) => line.startsWith(`  + ${shapeKey(one)}:`)))
      .map((one) => observationStub(one));
    if (stubs.length > 0) {
      console.log("\nrows to classify in corpus-observations.ts:\n" + stubs.join("\n"));
    }
    expect(differences).toEqual([]);
  });

  it("measures building.ai_resource_production and its colony trigger interior (SDK-65)", () => {
    const building = byRegistry.get("building")!;
    const operation = building.corpus.occurrences.get("ai_resource_production");
    const trigger = building.corpus.occurrences.get("ai_resource_production.trigger");
    expect(operation).toMatchObject({ definitions: 39, repeated: 12, blocks: 39 });
    expect(trigger).toMatchObject({ definitions: 21, repeated: 0, blocks: 21 });
    expect(building.unexpressed).not.toContainEqual(
      expect.objectContaining({ field: "ai_resource_production" })
    );
    expect(building.shape).not.toContainEqual(
      expect.objectContaining({ field: "ai_resource_production" })
    );
    expect(building.shape).not.toContainEqual(
      expect.objectContaining({ field: "ai_resource_production.trigger" })
    );
  });

  it("measures technology.mod_weight_if_group_picked's single open map (SDK-66)", () => {
    const technology = byRegistry.get("technology")!;
    const observation = technology.corpus.occurrences.get("mod_weight_if_group_picked");
    expect(observation).toMatchObject({
      definitions: 34,
      repeated: 0,
      blocks: 34,
      emptyBlocks: 1,
    });
    // One empty outer block leaves 33 blocks with inner rows; the fixture's
    // block count includes that empty declaration.
    expect(observation!.blocks - observation!.emptyBlocks).toBe(33);
    expect(observation!.keys).toEqual(new Set(["deposit_blockers", "repeatable"]));
    expect(technology.unexpressed).not.toContainEqual(
      expect.objectContaining({ field: "mod_weight_if_group_picked" })
    );
    expect(technology.shape).not.toContainEqual(
      expect.objectContaining({ field: "mod_weight_if_group_picked" })
    );
  });

  it("measures weapon target_weights' flat open map (SDK-67)", () => {
    const weapon = byRegistry.get("weapon_component_template")!;
    const observation = weapon.corpus.occurrences.get("target_weights");
    expect(observation).toMatchObject({
      definitions: 25,
      repeated: 0,
      blocks: 25,
    });
    expect(observation?.keys).toEqual(
      new Set([
        "battleship",
        "corvette",
        "cruiser",
        "destroyer",
        "frigate",
        "harbinger_stage_1",
        "harbinger_stage_2",
        "harbinger_stage_3",
        "mauler_stage_1",
        "mauler_stage_2",
        "mauler_stage_3",
        "stinger_stage_1",
        "stinger_stage_2",
        "stinger_stage_3",
        "titan",
        "weaver_stage_1",
        "weaver_stage_2",
        "weaver_stage_3",
      ])
    );
    expect(weapon.unexpressed).not.toContainEqual(
      expect.objectContaining({ field: "target_weights" })
    );
    expect(weapon.shape).not.toContainEqual(expect.objectContaining({ field: "target_weights" }));
  });

  /**
   * The one thing the presence-floor gate structurally cannot see, pinned by
   * hand so it is not invisible.
   *
   * A gap row is matched against a corpus *path*, and a path inside a block
   * exists only where the emitter emits a `DescentNode`. `economicResources`
   * is a hand-written block shape (`EconomicResourceBlock`, not a CWT field
   * table), so it emits none and nothing under `resources.` is ever a path —
   * a `building.resources.inline_script` row is reported stale by "keeps every
   * acknowledged gap live" the moment it is added, which is prose wearing a
   * gate's clothes. What the fixture *does* record for a non-descended block
   * is the observed sub-key set, so that is what this pins.
   */
  it("pins the sub-keys shipped buildings write inside resources (SDK-62 residue)", () => {
    const observation = byRegistry.get("building")?.corpus.occurrences.get("resources");
    // EconomicResourceBlock's members, minus `logistics`, which no building
    // writes. Every observed sub-key outside this set is unauthorable.
    const expressible = new Set(["category", "cost", "produces", "upkeep", "logistics"]);
    const inexpressible = [...(observation?.keys ?? [])].filter((key) => !expressible.has(key));
    // Exactly one, and it is a known gap with an owner: `inline_script`, the
    // same macro[inline_script] machinery SDK-17 tracks for the top-level
    // building.inline_script row. A second entry here is a NEW hole and this
    // fails naming it; an empty list means inline_script support landed and
    // the overlay row's residue paragraph needs deleting.
    expect(inexpressible).toEqual(["inline_script"]);
    // 332 of 458 shipped buildings nest it (install-measured at 4.4.6). The
    // fixture carries no per-sub-key count, so the shape census is the
    // fixture-side proxy that moves when that population does: 7 of the 14
    // distinct key-sets vanilla writes include inline_script, and exactly one
    // of those is `category` + `inline_script` alone — building_order_keep,
    // whose whole resources block is inexpressible rather than merely
    // lossy.
    const shapes = observation?.keysByDefinition ?? [];
    const withInline = shapes.filter((keys) => keys.has("inline_script"));
    expect([shapes.length, withInline.length]).toEqual([14, 7]);
    expect(withInline.filter((keys) => keys.size === 2)).toHaveLength(1);
  });
});

describe("the trigger-key predicate the extractor reads a mixed trigger struct with", () => {
  // What rides on each answer: a key this admits is folded into the struct's
  // synthetic `when` clause, and a key it refuses is recorded at its own path,
  // where the presence floor can report it as unauthorable. Refusing a real
  // condition invents a field; admitting a real field hides one.
  it("reads a chained scope path by its head", () => {
    expect(isRuleTriggerKey("owner.capital_scope")).toBe(true);
  });

  it("reads an optional scope path by its head", () => {
    expect(isRuleTriggerKey("starbase?")).toBe(true);
  });

  it("admits a data-driven scope path whatever name follows the prefix", () => {
    expect(isRuleTriggerKey("event_target:foo")).toBe(true);
  });

  it("refuses the bare name of a data-driven link, which is a prefix", () => {
    // `pop_faction_parameter` is a `from_data` link: script writes it
    // `parameter:x` and never on its own, so a definition writing the bare
    // name is writing something else and has to stay visible.
    expect(isRuleTriggerKey("pop_faction_parameter")).toBe(false);
    expect(isRuleTriggerKey("parameter:some_parameter")).toBe(true);
  });

  it("admits a structural combinator, which no rule table declares", () => {
    expect(isRuleTriggerKey("NOT")).toBe(true);
  });

  it("refuses a key the rules know nothing about", () => {
    expect(isRuleTriggerKey("brand_new_field")).toBe(false);
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
            bareValues: 0,
            bareBlocks: 0,
            emptyBlocks: 0,
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
 * The interior form check's three shapes, each of which is what the other two
 * being wrong looks like.
 *
 * A wrapped struct writes bare sub-blocks (`discrete_terms = { { key = … } }`),
 * a value list writes bare scalars (`{ foo bar }`), every other block shape
 * writes named keys. Reading "no named keys" as a defect is what made four
 * real, authorable fields report as unfillable, two of them acknowledged for
 * months with a reason the fixture contradicts — and then reading bare scalars
 * and bare sub-blocks as one "is it bare" flag hid the opposite defect just as
 * quietly. Every pairing is asserted here because a check that only ever passes
 * is what let both through.
 *
 * The fourth case has no lowering of its own: a block with no interior at all.
 * `resources = { }` is compatible with all three, so it is absence of evidence
 * rather than evidence of a defect, and must produce no verdict for any of them.
 */
describe("shape conformance, unkeyed block interiors", () => {
  // `repeated` describes the outer *key*, which a wrapper is what stops from
  // repeating: the repetition moved inside it. `discrete_terms` is `0..1`.
  const wrapped = { field: "field", shape: "struct", repeated: false, wrapped: true };
  const plain = { field: "field", shape: "struct", repeated: false };
  const list = { field: "field", shape: "valueList", repeated: false };
  const noScopes = (): null => null;

  function corpusOf(observed: {
    bareValues?: number;
    bareBlocks?: number;
    emptyBlocks?: number;
    keys?: readonly string[];
  }) {
    const keys = observed.keys ?? [];
    return {
      definitions: 1,
      files: 1,
      occurrences: new Map([
        [
          "field",
          {
            definitions: 1,
            repeated: 0,
            scalars: 0,
            blocks: 1,
            bareValues: observed.bareValues ?? 0,
            bareBlocks: observed.bareBlocks ?? 0,
            emptyBlocks: observed.emptyBlocks ?? 0,
            values: new Set(observed.bareValues === undefined ? [] : ["foo"]),
            keys: new Set(keys),
            keysByDefinition: [new Set(keys)],
          },
        ],
      ]),
    };
  }

  const kinds = (corpus: ReturnType<typeof corpusOf>, field: typeof wrapped | typeof plain) =>
    shapeConformance(corpus, [field], noScopes).map((one) => one.kind);

  const bareBlocks = corpusOf({ bareBlocks: 1 });
  const bareValues = corpusOf({ bareValues: 1 });
  const keyed = corpusOf({ keys: ["key"] });

  it("accepts each lowering against the interior it writes", () => {
    expect(kinds(bareBlocks, wrapped)).toEqual([]);
    expect(kinds(bareValues, list)).toEqual([]);
    expect(kinds(keyed, plain)).toEqual([]);
  });

  it("reports a wrapped struct against bare scalars", () => {
    // The defect one conflated "is it bare" flag hid: `{ foo bar }` satisfied
    // the wrapped check, so a field misread as a wrapper reported nothing.
    const mismatches = shapeConformance(bareValues, [wrapped], noScopes);
    expect(mismatches.map((one) => one.kind)).toEqual(["form"]);
    expect(mismatches[0]?.detail).toContain("lowered as a wrapped struct");
    expect(mismatches[0]?.detail).toContain("bare scalars (foo)");
  });

  it("reports a value list against bare sub-blocks", () => {
    // The same conflation in the other direction: anonymous blocks are not the
    // scalars a value list would lower each element of.
    const mismatches = shapeConformance(bareBlocks, [list], noScopes);
    expect(mismatches.map((one) => one.kind)).toEqual(["form"]);
    expect(mismatches[0]?.detail).toContain("lowered as a value list");
    expect(mismatches[0]?.detail).toContain("bare blocks");
  });

  it("reports either unkeyed lowering against a keyed interior", () => {
    // The wrapper or the list was misread: the game writes named entries where
    // the lowering expects anonymous ones.
    expect(kinds(keyed, wrapped)).toEqual(["form"]);
    expect(kinds(keyed, list)).toEqual(["form"]);
  });

  it("still reports an ordinary struct against either bare interior", () => {
    // The check the exemptions must not become blanket.
    expect(kinds(bareBlocks, plain)).toEqual(["form"]);
    expect(kinds(bareValues, plain)).toEqual(["form"]);
  });

  it("gives no verdict when every block is empty", () => {
    // `species_class.resources` is `resources = { }` in all 16 shipped species
    // classes. That is compatible with every block lowering, so a verdict there
    // reported the corpus having nothing to say as a defect — the same
    // false-positive species as the two above, and it stood acknowledged with a
    // reason ("write bare values there") the observation contradicts.
    const empty = corpusOf({});
    expect(kinds(empty, wrapped)).toEqual([]);
    expect(kinds(empty, list)).toEqual([]);
    expect(kinds(empty, plain)).toEqual([]);
    expect(kinds(empty, { field: "field", shape: "economicResources", repeated: false })).toEqual(
      []
    );
  });

  it("still judges a block lowering the moment one block has content", () => {
    // Absence of interior evidence is what buys silence, not the shape being a
    // block: one keyed block among empty ones is evidence again.
    expect(kinds(corpusOf({ keys: ["key"] }), list)).toEqual(["form"]);
    expect(kinds(corpusOf({ bareValues: 1 }), plain)).toEqual(["form"]);
  });
});

/**
 * A weight block's `modifier` rows, measured the way no other interior can be.
 *
 * The rows are stripped down to their gating keys before the reader records
 * them, so the observation at `<field>.modifier` is a set of trigger keys and
 * nothing else — which is what makes the scope question askable there at all.
 * Both branches are asserted here rather than left to the fixture: the shipped
 * corpus exercises whichever ones it happens to contain, and a branch that has
 * only ever been green proves nothing about the one it has not seen.
 */
describe("shape conformance, weight-block modifier rows", () => {
  const RULES = new Map<string, RuleScopes>([
    ["is_capital", ["planet"]],
    ["has_ship_flag", ["ship"]],
    ["always", "universal"],
  ]);
  const scopesOf = (_clause: "trigger" | "effect", key: string): RuleScopes | null =>
    RULES.get(key) ?? null;

  const row = (scope: EmittedField["scope"]): EmittedField => ({
    field: "ai_weight.modifier",
    shape: "weightModifier",
    repeated: true,
    clause: "trigger",
    scope,
  });

  /** One observation per definition's row keys; an empty set is an ungated row. */
  function corpusOf(...definitions: readonly (readonly string[])[]) {
    const gated = definitions.filter((keys) => keys.length > 0);
    return {
      definitions: definitions.length,
      files: 1,
      occurrences: new Map([
        [
          "ai_weight.modifier",
          {
            definitions: definitions.length,
            // Every definition writes several rows, as the shipped ones do —
            // otherwise the descriptor's `repeated: true` adds an arity remark
            // to every case here and buries the verdict under test.
            repeated: definitions.length,
            scalars: 0,
            blocks: definitions.length,
            bareValues: 0,
            bareBlocks: 0,
            emptyBlocks: definitions.length - gated.length,
            values: new Set<string>(),
            keys: new Set(definitions.flat()),
            keysByDefinition: definitions.map((keys) => new Set(keys)),
          },
        ],
      ]),
    };
  }

  it("rejects a condition the holder's own scope cannot express", () => {
    // The fixed-scope branch: a country-scoped weight block's rows are
    // `Trigger<"country">`, so a planet condition in one is unwritable.
    const mismatches = shapeConformance(
      corpusOf(["is_capital", "always"]),
      [row(["country"])],
      scopesOf
    );
    expect(mismatches.map((one) => one.kind)).toEqual(["scope"]);
    expect(mismatches[0]?.detail).toContain("typed for scope country");
    expect(mismatches[0]?.detail).toContain("is_capital");
  });

  it("reads an unpinned holder as a lost check rather than an unwritable field", () => {
    // The unpinned branch: `contravariantScopeType` widens the holder to
    // `WeightBlock<never>`, whose rows are `Trigger<never>` — writable, and
    // checking nothing. The finding is the same size; what it costs is the
    // check, and the wording has to say so or the row reads as a defect the
    // author would hit.
    const mismatches = shapeConformance(corpusOf(["is_capital"]), [row("any")], scopesOf);
    expect(mismatches.map((one) => one.kind)).toEqual(["scope"]);
    expect(mismatches[0]?.detail).toContain("unchecked (Trigger<never>)");
    expect(mismatches[0]?.detail).toContain("is_capital");
  });

  it("accepts a condition legal in the scope the holder was lowered at", () => {
    expect(shapeConformance(corpusOf(["is_capital"]), [row(["planet"])], scopesOf)).toEqual([]);
  });

  it("asks the parameterised holder per definition", () => {
    // `decision.ai_weight` is the shipped case: the definition declares its own
    // scope, so a planet row and a ship row in two definitions are both
    // writable — and one definition mixing them is not.
    const parameter = { parameter: ["planet", "ship"] } as const;
    expect(
      shapeConformance(corpusOf(["is_capital"], ["has_ship_flag"]), [row(parameter)], scopesOf)
    ).toEqual([]);
    const stranded = shapeConformance(
      corpusOf(["is_capital", "has_ship_flag"]),
      [row(parameter)],
      scopesOf
    );
    expect(stranded.map((one) => one.kind)).toEqual(["scope"]);
    expect(stranded[0]?.detail).toContain("no single scope of planet/ship");
  });

  it("gives no verdict where every row is ungated", () => {
    // An ungated row strips to an empty block, which is the interior check's
    // "no evidence" case rather than a defect — no exemption for this shape is
    // needed, and asserting it is what keeps that true.
    const mismatches = shapeConformance(corpusOf([], []), [row(["country"])], scopesOf);
    expect(mismatches.map((one) => one.kind)).toEqual([]);
  });

  it("still judges the gated rows beside ungated ones", () => {
    // Silence is bought by absence of evidence, not by the ungated rows being
    // present: one condition among them is evidence again.
    const mismatches = shapeConformance(corpusOf([], ["is_capital"]), [row(["country"])], scopesOf);
    expect(mismatches.map((one) => one.kind)).toEqual(["scope"]);
  });
});

describe("shape conformance, triggered-modifier potential", () => {
  const RULES = new Map<string, RuleScopes>([
    ["is_capital", ["planet"]],
    ["always", "universal"],
  ]);
  const scopesOf = (_clause: "trigger" | "effect", key: string): RuleScopes | null =>
    RULES.get(key) ?? null;
  const observation = {
    definitions: 1,
    files: 1,
    occurrences: new Map([
      [
        "building.triggered_country_modifier.potential",
        {
          definitions: 1,
          repeated: 0,
          scalars: 0,
          blocks: 1,
          bareValues: 0,
          bareBlocks: 0,
          emptyBlocks: 0,
          values: new Set<string>(),
          keys: new Set(["is_capital"]),
          keysByDefinition: [new Set(["is_capital"])],
        },
      ],
    ]),
  };
  const field = (scope: EmittedField["scope"]): EmittedField => ({
    field: "building.triggered_country_modifier.potential",
    shape: "trigger",
    repeated: false,
    clause: "trigger",
    scope,
  });

  it("rejects reusing the modifier scope for a pushed potential", () => {
    const mismatches = shapeConformance(observation, [field(["country"])], scopesOf);
    expect(mismatches.map((one) => one.kind)).toEqual(["scope"]);
    expect(mismatches[0]?.detail).toContain("typed for scope country");
    expect(shapeConformance(observation, [field(["planet"])], scopesOf)).toEqual([]);
  });

  it("rejects a scalar potential the TriggeredModifier interface cannot author", () => {
    const scalar = {
      ...observation,
      occurrences: new Map([
        [
          "building.triggered_country_modifier.potential",
          {
            ...observation.occurrences.get("building.triggered_country_modifier.potential")!,
            scalars: 1,
            blocks: 0,
            values: new Set(["yes"]),
            keys: new Set<string>(),
            keysByDefinition: [new Set<string>()],
          },
        ],
      ]),
    };
    const mismatches = shapeConformance(scalar, [field(["planet"])], scopesOf);
    expect(mismatches.map((one) => one.kind)).toEqual(["form"]);
    expect(mismatches[0]?.detail).toContain("write a scalar (yes)");
  });
});

/** One observation, with only the fields a given check reads set to anything. */
function observationOf(observed: {
  definitions?: number;
  repeated?: number;
  scalars?: number;
  blocks?: number;
  bareValues?: number;
  values?: readonly string[];
}) {
  const definitions = observed.definitions ?? 1;
  return {
    definitions,
    files: 1,
    occurrences: new Map([
      [
        "field",
        {
          definitions,
          repeated: observed.repeated ?? 0,
          scalars: observed.scalars ?? definitions,
          blocks: observed.blocks ?? 0,
          bareValues: observed.bareValues ?? 0,
          bareBlocks: 0,
          emptyBlocks: 0,
          values: new Set(observed.values ?? []),
          keys: new Set<string>(),
          keysByDefinition: [] as ReadonlySet<string>[],
        },
      ],
    ]),
  };
}

const noScopesOf = (): null => null;

describe("shape conformance, written forms", () => {
  const scalar = { field: "field", shape: "value", repeated: false } as const;

  it("uses an injected written-form lookup", () => {
    const mismatches = shapeConformance(
      observationOf({ scalars: 1 }),
      [scalar],
      noScopesOf,
      () => "block"
    );

    expect(mismatches.map((mismatch) => mismatch.kind)).toEqual(["form"]);
  });
});

/**
 * The arity branch, which had no control of its own until the baseline started
 * failing on it.
 *
 * The interesting assertion is the last one. The verdict says a list is never
 * repeated; the prose says how many definitions were looked at. Only the first
 * is the finding — the count moves with every game patch — so the evidence the
 * baseline compares has to be empty here, and a test is the only thing that
 * keeps the two from drifting back together.
 */
describe("shape conformance, list arity", () => {
  const list = { field: "field", shape: "value", repeated: true } as const;
  const single = { field: "field", shape: "value", repeated: false } as const;

  it("reports a list lowering the corpus never repeats", () => {
    const mismatches = shapeConformance(observationOf({ definitions: 3 }), [list], noScopesOf);
    expect(mismatches.map((one) => one.kind)).toEqual(["arity"]);
    expect(mismatches[0]?.detail).toContain("no definition writes it twice");
  });

  it("stays silent where one definition writes the key twice", () => {
    // One repetition anywhere is the whole question answered: the list is used.
    const observed = observationOf({ definitions: 3, repeated: 1 });
    expect(shapeConformance(observed, [list], noScopesOf)).toEqual([]);
  });

  it("stays silent for a single-valued lowering", () => {
    // The check is one-directional by construction — a field CWT declares
    // `0..1` and the game writes twice is unauthorable, and `corpus/` cannot
    // see it. `CONTENT_FIELD_OVERRIDES`' `arity: "repeated"` is that fix, read
    // off the fixture's own `repeated` count.
    expect(shapeConformance(observationOf({ definitions: 3 }), [single], noScopesOf)).toEqual([]);
  });

  it("keeps the definition count in the prose and out of the evidence", () => {
    // The identity split, asserted rather than assumed: two runs a patch apart
    // see different counts and the same finding, and the baseline must not read
    // that as a changed observation.
    const [mismatch] = shapeConformance(observationOf({ definitions: 3 }), [list], noScopesOf);
    expect(mismatch?.detail).toContain("3 defs");
    expect(mismatch?.evidence).toEqual([]);
  });
});

/**
 * The literal branch, likewise uncontrolled until now — and the reason the
 * baseline compares `evidence` rather than `detail`: the prose stops at six
 * strays, so a seventh would have ridden along under a row written for the
 * first six.
 */
describe("shape conformance, closed literal unions", () => {
  const sized = {
    field: "field",
    shape: "value",
    repeated: false,
    literals: ["large", "small"],
  } as const;

  it("accepts values inside the emitted union", () => {
    const observed = observationOf({ definitions: 2, values: ["large", "small"] });
    expect(shapeConformance(observed, [sized], noScopesOf)).toEqual([]);
  });

  it("reports every stray as evidence, past the six the prose shows", () => {
    const strays = ["a", "b", "c", "d", "e", "f", "g"];
    const observed = observationOf({ definitions: 8, values: ["large", ...strays] });
    const [mismatch] = shapeConformance(observed, [sized], noScopesOf);
    expect(mismatch?.kind).toBe("literal");
    expect(mismatch?.detail).toContain("a b c d e f");
    expect(mismatch?.detail).not.toContain(" g");
    expect(mismatch?.evidence).toEqual(strays);
  });

  it("stays silent where the lowering closed no set", () => {
    // An open `<technology>` field admits whatever the registry defines, so
    // there is no union for a value to be outside of.
    const open = { field: "field", shape: "value", repeated: false };
    expect(shapeConformance(observationOf({ values: ["anything"] }), [open], noScopesOf)).toEqual(
      []
    );
  });

  it("reads strays out of a value list's bare elements", () => {
    // A list's elements land in `values` the same way a scalar write does, and
    // the union constrains each element — so the check is right to see them.
    const list = {
      field: "field",
      shape: "valueList",
      repeated: false,
      literals: ["large"],
    } as const;
    const observed = observationOf({
      scalars: 0,
      blocks: 1,
      bareValues: 2,
      values: ["large", "LARGE"],
    });
    const [mismatch] = shapeConformance(observed, [list], noScopesOf);
    expect(mismatch?.kind).toBe("literal");
    expect(mismatch?.evidence).toEqual(["LARGE"]);
  });

  it("gives no verdict for a dual whose arms cannot be told apart", () => {
    // `ship_size.graphical_culture` is `bool` beside `{ <graphical_culture> }`,
    // and a dual carries only its scalar arm's literals. The observation merges
    // both positions' scalars, so judging them against `yes`/`no` measured one
    // arm against the other and reported 25 culture ids as strays. Absence of
    // attribution, not evidence of a defect — the same reading as the interior
    // form check's dual exemption.
    const dual = {
      field: "field",
      shape: "dual",
      repeated: false,
      literals: ["yes", "no"],
    } as const;
    const mixed = observationOf({
      definitions: 2,
      scalars: 1,
      blocks: 1,
      bareValues: 1,
      values: ["yes", "ancient"],
    });
    expect(shapeConformance(mixed, [dual], noScopesOf)).toEqual([]);
    // A dual nobody wrote a block for has nothing to attribute, so the scalar
    // arm's union is judged as usual — the exemption must not become blanket.
    const scalarOnly = observationOf({ definitions: 1, scalars: 1, values: ["Yes"] });
    expect(shapeConformance(scalarOnly, [dual], noScopesOf).map((one) => one.kind)).toEqual([
      "literal",
    ]);
  });
});

/**
 * The baseline comparison itself, over synthetic rows.
 *
 * Every direction is asserted because the gate is green against the committed
 * table and would stay green if the comparison did nothing at all. The
 * validation half matters just as much: "rationale-bearing" is a property
 * something has to check, or a row with an empty string satisfies it.
 */
describe("corpus observation baseline", () => {
  const observed = (
    field: string,
    kind: ObservationKind,
    evidence: readonly string[] = []
  ): ObservedShape => ({ registry: "building", field, kind, evidence });

  const row = (
    field: string,
    kind: ObservationKind,
    evidence: readonly string[] = [],
    extra: Partial<ClassifiedObservation> = {}
  ): ClassifiedObservation => ({
    registry: "building",
    field,
    kind,
    evidence,
    classification: kind === "arity" ? "rules-wider-than-vanilla" : "engine-lenient-spelling",
    rationale: "because",
    ...(kind === "arity" ? { declaration: "buildings.cwt:1 — ## cardinality = 0..inf" } : {}),
    ...extra,
  });

  it("holds when every observation has a live row", () => {
    const baseline = [row("resources", "arity"), row("size", "literal", ["LARGE"])];
    const measured = [observed("resources", "arity"), observed("size", "literal", ["LARGE"])];
    expect(compareObservations(measured, baseline)).toEqual([]);
  });

  it("fails an observation with no row", () => {
    expect(compareObservations([observed("resources", "arity")], [])).toEqual([
      "  + building.resources arity: new observation — classify it in corpus-observations.ts",
    ]);
  });

  it("fails a row whose observation is gone", () => {
    const lines = compareObservations([], [row("resources", "arity")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("- building.resources arity: no longer observed");
    // The one benign way a row can vanish, named in the remedy so nobody
    // deletes forty rows because one fixture failed to load.
    expect(lines[0]).toContain("fixture failed to load");
  });

  it("fails a row whose literal evidence changed", () => {
    const lines = compareObservations(
      [observed("size", "literal", ["LARGE", "SMALL"])],
      [row("size", "literal", ["LARGE"])]
    );
    expect(lines).toEqual([
      "  ~ building.size literal: evidence [LARGE] -> [LARGE SMALL] — re-review the row and " +
        "update it",
    ]);
  });

  it("compares evidence as a set, not a sequence", () => {
    // The corpus reader's `values` is a Set, and the order it happens to
    // enumerate in is not a fact about the game.
    const lines = compareObservations(
      [observed("size", "literal", ["b", "a"])],
      [row("size", "literal", ["a", "b"])]
    );
    expect(lines).toEqual([]);
  });

  it("rejects a row with no rationale", () => {
    const lines = compareObservations(
      [observed("resources", "arity")],
      [row("resources", "arity", [], { rationale: "   " })]
    );
    expect(lines).toEqual(["  ! building.resources arity: no rationale"]);
  });

  it("rejects a deferred narrowing with no issue", () => {
    const lines = compareObservations(
      [observed("resources", "arity")],
      [row("resources", "arity", [], { classification: "narrowing-deferred" })]
    );
    expect(lines).toEqual([
      "  ! building.resources arity: narrowing-deferred names work, so it needs the Linear " +
        "issue that will do it",
    ]);
    const owned = compareObservations(
      [observed("resources", "arity")],
      [row("resources", "arity", [], { classification: "narrowing-deferred", issue: "SDK-1" })]
    );
    expect(owned).toEqual([]);
  });

  it("rejects a classification the kind cannot carry", () => {
    const lines = compareObservations(
      [observed("size", "literal", [])],
      [row("size", "literal", [], { classification: "rules-wider-than-vanilla" })]
    );
    expect(lines).toEqual([
      "  ! building.size literal: rules-wider-than-vanilla classifies a arity observation, " +
        "not a literal one",
    ]);
  });

  it("rejects an arity row that cites no declaration", () => {
    const lines = compareObservations(
      [observed("resources", "arity")],
      [row("resources", "arity", [], { declaration: "" })]
    );
    expect(lines).toEqual([
      "  ! building.resources arity: rules-wider-than-vanilla cites no CWT declaration",
    ]);
  });

  it("rejects a duplicate row", () => {
    const lines = compareObservations(
      [observed("resources", "arity")],
      [row("resources", "arity"), row("resources", "arity")]
    );
    expect(lines).toContain("  ! building.resources arity: duplicate row");
  });

  it("rejects rows out of order", () => {
    // A forty-row table is only reviewable if its diff is, and an append-anywhere
    // table drifts into one where a related row is impossible to find.
    const lines = compareObservations(
      [observed("resources", "arity"), observed("empire_limit.modifier", "arity")],
      [row("resources", "arity"), row("empire_limit.modifier", "arity")]
    );
    expect(lines).toEqual([
      "  ! building.empire_limit.modifier arity: out of order — sort rows by registry, field, kind",
    ]);
  });

  it("reports two emitted fields sharing one path rather than deduplicating", () => {
    const lines = compareObservations(
      [observed("resources", "arity"), observed("resources", "arity")],
      [row("resources", "arity")]
    );
    expect(lines).toEqual([
      "  ! building.resources arity: duplicate observation — two emitted fields share this path",
    ]);
  });

  it("prints a stub whose classification does not typecheck", () => {
    // The forcing function: paste the stub, and `npm run typecheck` fails until
    // a human picks a classification the union actually has.
    const stub = observationStub(observed("size", "literal", ["b", "a"]));
    expect(stub).toContain('classification: "TODO-classify"');
    expect(stub).toContain('evidence: ["a", "b"]');
    expect(stub).toContain('rationale: ""');
    expect(stub).not.toContain("declaration");
    expect(observationStub(observed("resources", "arity"))).toContain("declaration");
  });
});

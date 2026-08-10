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
  shapeConformance,
  type DescentNode,
  type RuleScopes,
} from "@pdx-ts/codegen-cwt/corpus";
import type { EmittedField } from "@pdx-ts/codegen-cwt/emit/fields";
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
 * Every entry here is a field the SDK emits whose type and the shipped values
 * disagree: an author cannot write what vanilla writes, or — where an unpinned
 * trigger clause widened to `Trigger<never>` — can write it with nothing
 * checking it. Four families remain, none of them a misreading the emitter
 * could fix on its own:
 *
 * - **The corpus writes a form CWT does not declare.** Inventing an arm the
 *   rules deny would be guessing at game semantics from one shipped file.
 * - **Two declarations whose arms are indistinguishable.** A dual dispatches on
 *   what the author passed, so two arms that both author as arrays cannot be
 *   told apart. See `lowerDual`.
 * - **A scope the rules pin and the corpus contradicts, on evidence too thin
 *   to overrule them.** Asserting over a stated scope is a stronger claim than
 *   filling in an omitted one, and needs more than a couple of definitions.
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
    "bombardment_stance.planet_damage.modifier scope",
    "The one row here where the rules do state a scope and the corpus disagrees. " +
      "bombardment_stances.cwt:50 pins the block `## replace_scopes = { root = fleet " +
      "this = fleet from = planet }`, and 2 of the 13 shipped stances gate a weight row on " +
      "`planet_devastation`, which cwtools scopes to the planet family (carrier/colony/planet/" +
      "ship). Two readings fit: cwtools' trigger list is missing fleet, or the rows really do " +
      "evaluate planet-side and the game resolves it through the declared FROM. Two definitions " +
      "cannot settle which, and an overlay assertion overruling a scope the rules state — as " +
      "opposed to filling in one they omit, which is what the three ai_weight rows do — needs " +
      "more than that.",
  ],
  [
    "economic_category.triggered_cost_modifier.trigger scope",
    "CWT annotates no scope, so the clause lowers to `Trigger<never>` — writable but unchecked. " +
      "The category's modifiers are evaluated against whatever is paying, and the corpus shows " +
      "the game itself branching on that: `is_scope_valid` appears in all four definitions " +
      "writing this clause, guarding ship conditions (is_ship_class, is_ship_size, " +
      "is_space_fauna, has_ship_owner_type) against a scope that may not be one. That is the " +
      "SDK-24 narrowing case, not a declaration — the same finding as " +
      "ship_size.potential_construction below.",
  ],
  [
    "economic_category.triggered_produces_modifier.trigger scope",
    "Same declaration and same finding as triggered_cost_modifier above " +
      "(single_alias[economic_category_triggered_modifier], economic_categories.cwt:76-87). " +
      "Its 13 definitions spread wider still — ship category, specimen category, planet, and " +
      "species traits — which is what an unannotated clause evaluated per consumer looks like.",
  ],
  [
    "economic_category.triggered_upkeep_modifier.trigger scope",
    "Same declaration and same finding as its two siblings above. Its 10 definitions divide by " +
      "consumer rather than mixing: one writes only ship conditions, another only pop " +
      "(has_trait, is_robot_pop_group, is_unemployed), a third only `exists = planet`.",
  ],
  [
    "scripted_loc.text.trigger scope",
    "A scripted localization is rendered wherever its key is referenced, so its condition runs " +
      "in whatever scope did the referencing — genuinely any, and CWT is right to annotate " +
      "none. The corpus is the same shape: 1072 definitions across 206 distinct condition sets, " +
      "spanning country, species, planet and variable scopes. Nothing to declare; SDK-24's " +
      "narrowing inside the clause is the only remedy.",
  ],
  [
    "scripted_loc.text.weight.modifier scope",
    "The weight sibling of the row above, and the same finding one field over: a scripted " +
      "localization is rendered wherever its key is referenced, so the conditions gating its " +
      "weight rows run in whatever scope did the referencing. The 5 definitions that gate a " +
      "weight row are the same shape as the 1072 that gate the text — country and species " +
      "conditions (`has_ethic`, `has_trait`) in separate definitions, no single scope to " +
      "declare. SDK-24's narrowing inside the clause is the remedy for both.",
  ],
  [
    "ship_size.potential_construction scope",
    "The widened `Trigger<never>` is the right type and the clause needs narrowing inside it, " +
      "not a declaration: one ship size's construction clause is evaluated against several scope " +
      "types and vanilla branches on which, testing `is_scope_type` 13 times across these " +
      "clauses " +
      "(zero shipped decisions do, which is why a scope parameter fit there and not here). " +
      "SDK-24 tracks the `inScope` combinator; it waits on SDK-13, since most bodies here " +
      "delegate to vanilla scripted triggers the SDK cannot name yet.",
  ],
  [
    "ship_size.triggered_ship_roles.trigger scope",
    "The wrapped struct one level inside the field above, and the same registry's finding: a " +
      "scope parameter does not fit ship_size. Its 43 definitions do write one coherent " +
      "country-scope set (OR, has_technology, has_battleship_cloaking_tech), so a `scope` " +
      "assertion is not ruled out the way the sibling clauses' are — but which country the " +
      "role is evaluated for is exactly what the rules decline to state, and an assertion here " +
      "would be read off the corpus alone. SDK-24.",
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

/**
 * The descent modes that record *every* key of the blocks they reach, so an
 * observed non-empty block under one of them must leave at least one interior
 * path behind.
 *
 * `weightModifiers` and `triggeredModifierPotential` are excluded because they
 * are selective by design: a weight block written as `{ factor = 2 }` has no
 * `modifier` row, and recording nothing there is the correct reading, not a
 * hole. Eleven such blocks exist across the fixture today.
 */
const TOTAL_RECORDING_MODES = new Set([
  "struct",
  "wrappedStruct",
  "structMap",
  "repeatedStruct",
  "triggerStruct",
]);

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
        key: `${report.registry}.${mismatch.field} ${mismatch.kind}`,
        detail: mismatch.detail,
      }))
  );
}

describe("corpus conformance", () => {
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

/**
 * Runtime evidence for the SDK-22 pure authoring API.
 *
 * The headline claim is byte parity: the same content pushed through the
 * `Mod` builder and through `buildMod`/`render` produces identical file
 * maps, patch plan included. The builder was deleted when the migration
 * landed, so the parity half now measures the probe's pipeline against the
 * goldens captured from `Mod.render()` (tests/__snapshots__/pure-api/) —
 * the same bytes, frozen. The rest pins the fold's validation story —
 * duplicate ids, the prefix warning, the vanilla collision guard, dangling
 * event references, on-action ownership, loc dedupe, the
 * `modifierDescKeys` ordering hazard — and the factory-collection
 * semantics: creation is registration, one namespace per event file, and
 * split files feeding the patch plan's path order.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  always,
  and,
  hasOwner,
  hasTechnology,
  isScopeValid,
  onActions,
} from "../../packages/sdk/src/index.ts";
import { viewFromFiles } from "../../packages/sdk/src/vanilla/surface.ts";
import { TECH_FILE, VARS_FILE } from "../../packages/sdk/tests/fixtures/vanilla-fixture.ts";
import { buildMod } from "./build.ts";
import {
  createCountryShipOfSizeLimits,
  createEvents,
  createOnActions,
  createSituationTypes,
  createTechnologies,
} from "./factories.ts";
import type { Collection, ModItemInput } from "./items.ts";
import { resonancePack } from "./pack.ts";
import { render } from "./render.ts";

const FILES = {
  "common/technology/pp_soc_tech.txt": TECH_FILE,
  "common/scripted_variables/pp_vars.txt": VARS_FILE,
};

const CONFIG = {
  name: "Pure API Probe",
  prefix: "pp_mod",
  supportedVersion: "4.4.*",
} as const;

const vanilla = viewFromFiles(FILES, { gameVersion: "4.4.6" });

/**
 * The representative fixture through the pure API. Collection order mirrors
 * the fold's grouping (content → events → on → limits → patch) so the class
 * twin below produces the same localization insertion order.
 */
function pureCollections(): ModItemInput[] {
  const techs = createTechnologies();
  const situations = createSituationTypes();
  const limits = createCountryShipOfSizeLimits();
  const events = createEvents("events", "pp_mod");
  const hooks = createOnActions();

  const grafts = techs.defineTechnology({
    id: "pp_mod_tech_chimeric_grafts",
    name: "Chimeric Grafts",
    area: "society",
    tier: 3,
    category: "biology",
  });
  situations.defineSituationType({
    id: "pp_mod_situation_probe",
    name: "Probe Situation",
    targetScope: "planet",
    monthlyProgress: {
      base: 2,
      modifiers: [
        {
          mult: 1.5,
          desc: "The probe is spreading.",
          descKey: "probe_is_spreading",
          when: always(),
        },
      ],
    },
  });
  const titan = limits.defineCountryShipOfSizeLimit({
    id: "pp_mod_limit_titan",
    shipTypes: ["ship_size_titan"],
    base: 80,
    max: 1600,
    show: and(isScopeValid(), hasTechnology("tech_titans")),
  });
  const aftershock = events.definePlanetEvent({
    id: 2,
    from: "country",
    title: "Aftershock",
    isTriggeredOnly: true,
    immediate: (planet, ctx) => {
      ctx.from.effects((country) => {
        country.addResource({ resource: "influence", amount: 50 });
      });
    },
    options: [{ name: "Noted." }],
  });
  const hum = events.defineCountryEvent({
    id: 1,
    title: "The Hum",
    isTriggeredOnly: true,
    immediate: (country, ctx) => {
      country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
        planet.planetEvent({ id: aftershock, from: ctx.self, days: 30 });
      });
    },
    options: [{ name: "Fascinating." }],
  });
  hooks.on(onActions.onGameStartCountry, hum);
  limits.addShipOfSizeLimits([titan, "third_party_limit"]);
  techs.patchTechnology(
    vanilla.technology("tech_gene_forging").require("cost", "prerequisites"),
    (t) => ({
      cost: t.cost.value * 2,
      prerequisites: [...t.prerequisites, grafts],
    })
  );
  return [techs, situations, limits, events, hooks];
}

function techsWith(file: string | undefined, ...ids: string[]): Collection {
  const techs = createTechnologies(file);
  for (const id of ids) {
    techs.defineTechnology({ id, name: id, area: "physics", tier: 1, category: "particles" });
  }
  return techs;
}

describe("parity with the class builder", () => {
  // The class builder is gone; its bytes for this fixture live on as the
  // goldens the migration captured from `Mod.render()` while both APIs were
  // live. The probe's own pipeline is measured against those same files, so
  // this record still asserts exactly what it always asserted: the fold
  // reproduces the builder byte for byte.
  //
  // They used to be read straight out of `tests/__snapshots__/pure-api/`.
  // SDK-23 made the shipping SDK's emission order a function of the content
  // (files and ids sort; source position no longer shows through), which moved
  // those goldens — so the SDK-22 bytes are frozen here instead, beside the
  // frozen pipeline that produced them. This directory is a design record: it
  // is not regenerated, and the shipping suites are the live evidence.
  const goldenDir = new URL("./goldens/", import.meta.url);
  const golden = (relPath: string): string =>
    readFileSync(new URL(relPath.replaceAll("/", "__"), goldenDir), "utf8");

  it("renders byte-identical files for the full representative fixture", () => {
    const pure = render(buildMod(CONFIG, pureCollections(), { vanilla }));
    // The fixture exercises every emission channel.
    expect([...pure.keys()]).toEqual([
      "descriptor.mod",
      "common/technology/pp_mod_technology.txt",
      "common/situations/pp_mod_situations.txt",
      "common/country_limits/ship_of_size_limits/pp_mod_ship_of_size_limits.txt",
      "events/pp_mod_events.txt",
      "common/country_limits/ownership_limits/pp_mod_ownership_limits.txt",
      "common/on_actions/pp_mod_on_actions.txt",
      "localisation/english/pp_mod_l_english.yml",
      "common/technology/pp_soc_tech_pp_mod_patch.txt",
    ]);
    for (const [relPath, content] of pure) {
      expect(content, relPath).toEqual(golden(relPath));
    }
  });

  it("computes the same patch plan, win assertions included", () => {
    const pure = buildMod(CONFIG, pureCollections(), { vanilla });
    expect(JSON.stringify(pure.patchPlan?.assertions, null, 2) + "\n").toEqual(
      golden("patch-plan-assertions.json")
    );
    expect(pure.warnings).toEqual([]);
  });
});

describe("composability", () => {
  it("accepts a pack's collection, nested arrays and all", () => {
    const mod = buildMod({ name: "Pack Consumer", prefix: "pp_probe", supportedVersion: "4.4.*" }, [
      [resonancePack],
    ]);
    const tech = render(mod).get("common/technology/pp_probe_technology.txt");
    expect(tech).toContain("pp_probe_tech_resonance_theory");
    expect(tech).toContain('prerequisites = { "pp_probe_tech_resonance_theory" "tech_lasers_2" }');
  });
});

describe("assembly-time validation", () => {
  it("rejects duplicate content ids across collections at buildMod", () => {
    // Each factory is inert until built; the same id in two collections is
    // only discoverable at assembly.
    const first = techsWith(undefined, "pp_mod_tech_twin");
    const second = techsWith(undefined, "pp_mod_tech_twin");
    expect(() => buildMod(CONFIG, [first, second])).toThrow(
      'Duplicate technology id "pp_mod_tech_twin"'
    );
  });

  it("demotes a missing prefix to a warning on the built value", () => {
    const mod = buildMod(CONFIG, [techsWith(undefined, "unprefixed_tech")]);
    expect(mod.warnings).toEqual([
      {
        code: "missing-prefix",
        message:
          'technology id "unprefixed_tech" must start with the mod prefix "pp_mod_" ' +
          "so it cannot collide with vanilla or other mods",
      },
    ]);
    expect(render(mod).get("common/technology/pp_mod_technology.txt")).toContain("unprefixed_tech");
  });

  it("hard-errors when an id collides with a real vanilla id under a view", () => {
    expect(() =>
      buildMod(CONFIG, [techsWith(undefined, "tech_gene_forging")], { vanilla })
    ).toThrow('technology id "tech_gene_forging" collides with a vanilla technology');
    // Unprefixed but non-colliding stays a warning even with the view loaded.
    const mod = buildMod(CONFIG, [techsWith(undefined, "tech_probe_original")], { vanilla });
    expect(mod.warnings.map((warning) => warning.code)).toEqual(["missing-prefix"]);
  });

  it("rejects duplicate localization keys across definitions", () => {
    const techs = createTechnologies();
    techs.defineTechnology({
      id: "pp_mod_a",
      name: "A",
      desc: "first",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    // Its name key is "pp_mod_a_desc" — exactly the first tech's desc key.
    techs.defineTechnology({
      id: "pp_mod_a_desc",
      name: "B",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    expect(() => buildMod(CONFIG, [techs])).toThrow('Duplicate localization key "pp_mod_a_desc"');
  });

  it("reports quote replacement as a warning datum, not console output", () => {
    const techs = createTechnologies();
    techs.defineTechnology({
      id: "pp_mod_quoted",
      name: 'The "Hum"',
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const mod = buildMod(CONFIG, [techs]);
    expect(mod.warnings.map((warning) => warning.code)).toEqual(["loc-quote-replaced"]);
    expect(render(mod).get("localisation/english/pp_mod_l_english.yml")).toContain(
      "pp_mod_quoted:0 \"The 'Hum'\""
    );
  });
});

describe("event factories", () => {
  it("rejects a duplicate id at the definition site, with its namespace", () => {
    const events = createEvents("events", "pp_mod_dup");
    events.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    expect(() => events.defineCountryEvent({ id: 1, isTriggeredOnly: true })).toThrow(
      'Duplicate event id "pp_mod_dup.1"'
    );
  });

  it("rejects the same full id from two factories at buildMod", () => {
    const first = createEvents("a_events", "pp_mod_shared");
    first.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    const second = createEvents("b_events", "pp_mod_shared");
    second.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    expect(() => buildMod(CONFIG, [first, second])).toThrow('Duplicate event id "pp_mod_shared.1"');
  });

  it("keeps one namespace per emitted file, catching same-stem merges", () => {
    const alpha = createEvents("shared", "pp_mod_alpha");
    alpha.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    const beta = createEvents("shared", "pp_mod_beta");
    beta.defineCountryEvent({ id: 2, isTriggeredOnly: true, hideWindow: true });
    expect(() => buildMod(CONFIG, [alpha, beta])).toThrow(
      'event file events/pp_mod_shared.txt would mix namespaces "pp_mod_alpha" and "pp_mod_beta"'
    );
  });

  it("gives each namespace its own numeric id space and file", () => {
    const alpha = createEvents("alpha_events", "pp_mod_alpha");
    alpha.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    const beta = createEvents("beta_events", "pp_mod_beta");
    beta.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    const files = render(buildMod(CONFIG, [alpha, beta]));
    const alphaFile = files.get("events/pp_mod_alpha_events.txt")!;
    const betaFile = files.get("events/pp_mod_beta_events.txt")!;
    expect(alphaFile).toContain("namespace = pp_mod_alpha");
    expect(alphaFile).toContain("id = pp_mod_alpha.1");
    expect(betaFile).toContain("namespace = pp_mod_beta");
    expect(betaFile).toContain("id = pp_mod_beta.1");
  });

  it("warns when a namespace does not carry the mod prefix", () => {
    const events = createEvents("events", "rogue_ns");
    events.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    const mod = buildMod(CONFIG, [events]);
    expect(mod.warnings.map((warning) => warning.code)).toEqual(["missing-prefix"]);
    expect(mod.warnings[0]!.message).toContain('event namespace "rogue_ns"');
  });

  it("rejects a namespace that is not snake_case at the factory", () => {
    expect(() => createEvents("events", "Bad.Namespace")).toThrow(
      'Event namespace "Bad.Namespace" must be lowercase snake_case'
    );
  });

  it("fails loudly on a fired event whose collection was not passed", () => {
    const orphans = createEvents("orphan_events", "pp_mod_orphans");
    const orphan = orphans.definePlanetEvent({ id: 22, from: "country", isTriggeredOnly: true });
    const included = createEvents("events", "pp_mod");
    included.defineCountryEvent({
      id: 21,
      isTriggeredOnly: true,
      hideWindow: true,
      immediate: (country, ctx) => {
        country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
          planet.planetEvent({ id: orphan, from: ctx.self });
        });
      },
    });
    // `orphans` is never passed — the emitted id has no definition behind it.
    expect(() => buildMod(CONFIG, [included])).toThrow(
      '"pp_mod_orphans.22" looks like one of this mod\'s event ids'
    );
  });

  it("requires on-action events to be collections of the same build", () => {
    const foreign = createEvents("events", "pp_mod");
    const event = foreign.defineCountryEvent({ id: 31, isTriggeredOnly: true });
    const hooks = createOnActions();
    hooks.on(onActions.onGameStartCountry, event);
    expect(() => buildMod(CONFIG, [hooks])).toThrow(
      'Event "pp_mod.31" is not among the collections passed to buildMod'
    );
  });
});

describe("collections", () => {
  it("merges same-stem content collections in item order", () => {
    const first = techsWith("shared", "pp_mod_tech_first");
    const second = techsWith("shared", "pp_mod_tech_second");
    const files = render(buildMod(CONFIG, [first, second]));
    const shared = files.get("common/technology/pp_mod_shared.txt")!;
    expect(shared.indexOf("pp_mod_tech_first")).toBeGreaterThanOrEqual(0);
    expect(shared.indexOf("pp_mod_tech_first")).toBeLessThan(shared.indexOf("pp_mod_tech_second"));
  });

  it("rejects stems that are not flat snake_case", () => {
    // Registries do not read subdirectories (common/technology/category/ is
    // a different registry, not layout), and the same check keeps the
    // emitted path safe by construction.
    expect(() => createTechnologies("category/dawn")).toThrow(
      'Collection file stem "category/dawn" must be lowercase snake_case'
    );
    expect(() => createEvents("../escape", "pp_mod")).toThrow(/must be lowercase snake_case/);
    // A hand-built Collection value bypasses the factories; flattening
    // re-asserts every stem.
    const forged: Collection = {
      itemKind: "collection",
      file: "category/dawn",
      items: [],
    };
    expect(() => buildMod(CONFIG, [forged])).toThrow(/must be lowercase snake_case/);
  });

  it("feeds every own technology file into the patch plan's path order", () => {
    // Split tech emission + a patch: the plan must reserve and enumerate
    // BOTH own files — the SDK-19 constraint with teeth.
    const alpha = techsWith("alpha_techs", "pp_mod_tech_alpha");
    const beta = techsWith("beta_techs", "pp_mod_tech_beta");
    const patches = createTechnologies();
    patches.patchTechnology(vanilla.technology("tech_gene_forging").require("cost"), (t) => ({
      cost: t.cost.value * 2,
    }));
    const mod = buildMod(CONFIG, [alpha, beta, patches], { vanilla });
    const files = render(mod);
    const ownPaths = [
      "common/technology/pp_mod_alpha_techs.txt",
      "common/technology/pp_mod_beta_techs.txt",
    ];
    for (const ownPath of ownPaths) {
      expect(files.has(ownPath)).toBe(true);
    }
    // The computed patch path never lands on one of the mod's own files.
    expect(ownPaths).not.toContain(mod.patchPlan!.relPath);
    expect(files.get(mod.patchPlan!.relPath)).toContain("tech_gene_forging");
  });
});

describe("lowering determinism", () => {
  it("renders byte-identical output across repeated and reordered builds", () => {
    // Shares one set of collections across two builds: the modifierDescKeys
    // WeakMap is re-registered with identical derived keys, and rendering
    // the earlier build after the later one must not change a byte.
    const collections = pureCollections();
    const first = buildMod(CONFIG, collections, { vanilla });
    const second = buildMod(CONFIG, collections, { vanilla });
    const secondFiles = render(second);
    const firstFiles = render(first);
    expect([...firstFiles.entries()]).toEqual([...secondFiles.entries()]);
  });
});

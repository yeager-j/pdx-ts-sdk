/**
 * Runtime evidence for the pure authoring API (SDK-22).
 *
 * The headline claim is byte parity with the `Mod` builder the pure API
 * replaced. While both APIs were live the parity test built one fixture
 * through each and compared the file maps directly; the builder's bytes are
 * now committed as goldens under `tests/__snapshots__/pure-api/`, captured
 * from the class API's own `render()` and asserted identical in all three
 * directions (class → goldens, pure → class, pure → goldens) before the
 * class half was deleted.
 *
 * SDK-23 recaptured them once, on purpose: emission order became a function
 * of the content rather than of source position, so entries within a file and
 * groups within a registry moved. The recapture was reviewed as pure
 * reordering — every affected golden's line set (loc yml) or top-level key set
 * (block files) is unchanged, only its order. The class API's exact bytes for
 * this fixture are frozen separately in `design/pure-api-probe/goldens/`.
 *
 * SDK-23 chunk 2 added a second parity gate of the same shape, for the same
 * reason: the free definers and the factories are both live, so the same
 * fixture goes through each and the two mods are compared directly. That test
 * is what makes migrating every consumer (chunk 3) and deleting the factories
 * (chunk 4) mechanical, and it dies with the factories.
 *
 * The rest pins the fold's validation story — duplicate ids, the prefix
 * warning, the vanilla collision guard, dangling event references,
 * on-action ownership, loc dedupe, the `modifierDescKeys` ordering hazard —
 * and the collection semantics: creation is registration on the factory path,
 * one file per namespace and one namespace per file on both, and split files
 * feeding the patch plan's path order.
 */

import { describe, expect, it } from "vitest";

import {
  addShipOfSizeLimits,
  always,
  and,
  buildMod,
  collection,
  createCountryShipOfSizeLimits,
  createEvents,
  createOnActions,
  createSituationTypes,
  createTechnologies,
  createTraditions,
  defineCountryShipOfSizeLimit,
  defineSituationType,
  defineTechnology,
  eventTarget,
  hasOwner,
  hasTechnology,
  isScopeValid,
  namespace,
  on,
  onActions,
  patchTechnology,
  render,
  type Collection,
  type ModItemInput,
} from "../src/index.ts";
import { viewFromFiles } from "../src/vanilla/surface.ts";
import { resonancePack } from "./fixtures/resonance-pack.ts";
import { TECH_FILE, VARS_FILE } from "./fixtures/vanilla-fixture.ts";

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
      modifiers: [{ mult: 1.5, desc: "The probe is spreading.", when: always() }],
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
      planet.within(ctx.from, (country) => {
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

/**
 * The same fixture through the free definers (SDK-23): every definition is a
 * value, and `collection(file, items)` is the only thing that places it. The
 * factory twin above and this one must produce the same mod — that is the
 * whole claim of chunk 2, and it is what makes chunks 3 and 4 a migration
 * rather than a rewrite.
 *
 * The collections are deliberately built in the same shape as the factories'
 * (one per registry, the event stem co-declared) so the comparison isolates
 * the authoring surface rather than also testing the file layout.
 */
function freeCollections(): ModItemInput[] {
  const events = namespace("pp_mod");

  const grafts = defineTechnology({
    id: "pp_mod_tech_chimeric_grafts",
    name: "Chimeric Grafts",
    area: "society",
    tier: 3,
    category: "biology",
  });
  const situation = defineSituationType({
    id: "pp_mod_situation_probe",
    name: "Probe Situation",
    targetScope: "planet",
    monthlyProgress: {
      base: 2,
      modifiers: [{ mult: 1.5, desc: "The probe is spreading.", when: always() }],
    },
  });
  const titan = defineCountryShipOfSizeLimit({
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
      planet.within(ctx.from, (country) => {
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
  const patch = patchTechnology(
    vanilla.technology("tech_gene_forging").require("cost", "prerequisites"),
    (t) => ({
      cost: t.cost.value * 2,
      prerequisites: [...t.prerequisites, grafts],
    })
  );
  return [
    collection(undefined, [grafts, patch]),
    collection(undefined, [situation]),
    collection(undefined, [titan, addShipOfSizeLimits([titan, "third_party_limit"])]),
    collection("events", [aftershock, hum]),
    collection(undefined, [on(onActions.onGameStartCountry, [hum])]),
  ];
}

/** Every emission channel the representative fixture exercises, in order. */
const FIXTURE_CHANNELS = [
  "descriptor.mod",
  "common/technology/pp_mod_technology.txt",
  "common/situations/pp_mod_situations.txt",
  "common/country_limits/ship_of_size_limits/pp_mod_ship_of_size_limits.txt",
  "events/pp_mod_events.txt",
  "common/country_limits/ownership_limits/pp_mod_ownership_limits.txt",
  "common/on_actions/pp_mod_on_actions.txt",
  "localisation/english/pp_mod_l_english.yml",
  "common/technology/pp_soc_tech_pp_mod_patch.txt",
];

/** Goldens mirror the emitted tree with `/` flattened, as the other suites do. */
function goldenPath(relPath: string): string {
  return `__snapshots__/pure-api/${relPath.replaceAll("/", "__")}`;
}

function techsWith(file: string | undefined, ...ids: string[]): Collection {
  const techs = createTechnologies(file);
  for (const id of ids) {
    techs.defineTechnology({ id, name: id, area: "physics", tier: 1, category: "particles" });
  }
  return techs;
}

describe("parity with the deleted class builder", () => {
  const pure = buildMod(CONFIG, pureCollections(), { vanilla });
  const files = render(pure);

  // The path list is the guard on the goldens themselves: a missing golden is
  // written rather than failed, so an emission channel that silently moved
  // would mint a new file instead of failing. Pinning the keys first makes
  // that a test failure.
  it("emits exactly the channels the fixture exercises", () => {
    expect([...files.keys()]).toEqual(FIXTURE_CHANNELS);
  });

  for (const [relPath, content] of files) {
    it(`renders the builder's bytes for ${relPath}`, async () => {
      await expect(content).toMatchFileSnapshot(goldenPath(relPath));
    });
  }

  it("computes the builder's patch plan, win assertions included", async () => {
    await expect(JSON.stringify(pure.patchPlan?.assertions, null, 2) + "\n").toMatchFileSnapshot(
      "__snapshots__/pure-api/patch-plan-assertions.json"
    );
    expect(pure.warnings).toEqual([]);
  });
});

/**
 * The keystone gate for the SDK-23 migration (chunk 2).
 *
 * Both authoring surfaces are live at once, so the free definers can be held
 * to the factories' exact output before a single consumer moves. Every channel
 * the fixture has goes through the comparison: content with localization, the
 * situation graft's `targetScope`, two events that fire each other with a FROM
 * witness, an on-action binding (one event through the factory method, an
 * array of one through free `on()`), the contribution sink, and a patch.
 *
 * This test dies with the factories in chunk 4; until then it is what makes
 * "migrate the consumers" a mechanical rewrite rather than a leap.
 */
describe("parity between the factories and the free definers", () => {
  const throughFactories = buildMod(CONFIG, pureCollections(), { vanilla });
  const throughDefiners = buildMod(CONFIG, freeCollections(), { vanilla });

  it("renders the same files, byte for byte", () => {
    const files = render(throughDefiners);
    // Pinned first, so "both surfaces emitted nothing" cannot pass as parity.
    expect([...files.keys()]).toEqual(FIXTURE_CHANNELS);
    expect([...files.entries()]).toEqual([...render(throughFactories).entries()]);
  });

  it("computes the same patch plan and the same warnings", () => {
    expect(JSON.stringify(throughDefiners.patchPlan)).toEqual(
      JSON.stringify(throughFactories.patchPlan)
    );
    expect(throughDefiners.warnings).toEqual(throughFactories.warnings);
    expect(throughDefiners.shipOfSizeLimits).toEqual(throughFactories.shipOfSizeLimits);
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

  it("rejects the same full id from two factories sharing a file", () => {
    // Same stem and same namespace is a legal merge — the bijection below
    // holds — so this is exactly the case the define-site check cannot see:
    // each factory has its own `used` set, and only the global check across
    // every collection knows the two collided.
    const first = createEvents("shared_events", "pp_mod_shared");
    first.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    const second = createEvents("shared_events", "pp_mod_shared");
    second.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    expect(() => buildMod(CONFIG, [first, second])).toThrow('Duplicate event id "pp_mod_shared.1"');
    // The merge itself is fine: distinct ids in the two collections land in
    // one file, exactly as two same-stem content collections do.
    const third = createEvents("shared_events", "pp_mod_shared");
    third.defineCountryEvent({ id: 2, isTriggeredOnly: true, hideWindow: true });
    const merged = render(buildMod(CONFIG, [first, third])).get("events/pp_mod_shared_events.txt")!;
    expect(merged).toContain("id = pp_mod_shared.1");
    expect(merged).toContain("id = pp_mod_shared.2");
  });

  it("keeps one file per namespace, the other half of the bijection", () => {
    // SDK-23 decision 1. A namespace split across two files splits its
    // numeric id space across two independent define-site checks, and makes
    // the emitted file a fact about layout rather than about identity.
    const first = createEvents("a_events", "pp_mod_shared");
    first.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    const second = createEvents("b_events", "pp_mod_shared");
    second.defineCountryEvent({ id: 2, isTriggeredOnly: true, hideWindow: true });
    expect(() => buildMod(CONFIG, [first, second])).toThrow(
      'event namespace "pp_mod_shared" is split across file stems "a_events" and "b_events" — ' +
        "one file per namespace; give each namespace its own file stem"
    );
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

describe("content reference integrity", () => {
  it("resolves a reference across two collections of the same build", () => {
    const base = techsWith("base_techs", "pp_mod_tech_base");
    const derived = createTechnologies("derived_techs");
    derived.defineTechnology({
      id: "pp_mod_tech_derived",
      name: "Derived",
      area: "physics",
      tier: 2,
      category: "particles",
      prerequisites: ["pp_mod_tech_base"],
    });
    const files = render(buildMod(CONFIG, [base, derived]));
    expect(files.get("common/technology/pp_mod_derived_techs.txt")).toContain(
      'prerequisites = { "pp_mod_tech_base" }'
    );
  });

  it("fails loudly on a reference whose collection was not passed", () => {
    const orphans = createTechnologies("orphan_techs");
    const orphan = orphans.defineTechnology({
      id: "pp_mod_tech_orphan",
      name: "Orphan",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const included = createTechnologies();
    included.defineTechnology({
      id: "pp_mod_tech_dependent",
      name: "Dependent",
      area: "physics",
      tier: 2,
      category: "particles",
      prerequisites: [orphan],
    });
    // `orphans` is never passed — the emitted id has no definition behind it.
    expect(() => buildMod(CONFIG, [included])).toThrow(
      'technology "pp_mod_tech_dependent" references technology "pp_mod_tech_orphan" in ' +
        '"prerequisites", but no such technology is among the collections passed to buildMod'
    );
  });

  it("names the registry, not merely the id: a tradition is not a technology", () => {
    // Same id, different registry. An existence-only check would pass this.
    const traditions = createTraditions();
    traditions.defineTradition({
      id: "pp_mod_ghost",
      name: "Ghost",
      effects: "Nothing at all.",
    });
    const techs = createTechnologies();
    techs.defineTechnology({
      id: "pp_mod_tech_haunted",
      name: "Haunted",
      area: "physics",
      tier: 2,
      category: "particles",
      prerequisites: ["pp_mod_ghost"],
    });
    expect(() => buildMod(CONFIG, [traditions, techs])).toThrow(
      'references technology "pp_mod_ghost" in "prerequisites"'
    );
  });

  it("checks an own-prefixed raw string exactly like a branded ref", () => {
    // The prefix is per-mod, so an own-prefixed string in a reference field is
    // this mod's content however it was written — which is what catches typos.
    const techs = createTechnologies();
    techs.defineTechnology({
      id: "pp_mod_tech_base",
      name: "Base",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    techs.defineTechnology({
      id: "pp_mod_tech_typo",
      name: "Typo",
      area: "physics",
      tier: 2,
      category: "particles",
      prerequisites: ["pp_mod_tech_bass"],
    });
    expect(() => buildMod(CONFIG, [techs])).toThrow(
      'references technology "pp_mod_tech_bass" in "prerequisites"'
    );
  });

  it("exempts vanilla and third-party ids, and fields no registry backs", () => {
    const techs = createTechnologies();
    techs.defineTechnology({
      id: "pp_mod_tech_open",
      name: "Open",
      area: "physics",
      // `<technology_tier>` is not a registry this SDK authors, so nothing
      // here could have defined it and its absence proves nothing.
      tier: "pp_mod_tier_custom",
      category: "particles",
      prerequisites: ["tech_lasers_2", "someone_elses_tech"],
    });
    expect(buildMod(CONFIG, [techs]).warnings).toEqual([]);
  });

  it("leaves own-prefixed flags, targets and loc keys alone", () => {
    // The scalars a post-hoc scan of the emitted tree would trip over: all
    // own-prefixed, none of them content references.
    const events = createEvents("events", "pp_mod");
    events.defineCountryEvent({
      id: 40,
      title: "Hum",
      isTriggeredOnly: true,
      immediate: (country) => {
        country.setCountryFlag("pp_mod_heard_the_hum");
        country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
          planet.saveEventTargetAs(eventTarget<"planet">("pp_mod_storm_world"));
        });
      },
      options: [{ name: "Noted." }],
    });
    expect(buildMod(CONFIG, [events]).warnings).toEqual([]);
  });

  it("holds a patch's references to the same standard", () => {
    // The calibration anchor's shape: a vanilla technology patched to require
    // one of this mod's own. In the build it resolves; alone it cannot.
    const orphans = createTechnologies("orphan_techs");
    const marker = orphans.defineTechnology({
      id: "pp_mod_tech_marker",
      name: "Marker",
      area: "society",
      tier: 0,
      category: "biology",
      startTech: true,
    });
    const patches = createTechnologies();
    patches.patchTechnology(
      vanilla.technology("tech_gene_forging").require("prerequisites"),
      (t) => ({ prerequisites: [...t.prerequisites, marker] })
    );
    expect(
      render(buildMod(CONFIG, [orphans, patches], { vanilla })).get(
        "common/technology/pp_mod_orphan_techs.txt"
      )
    ).toContain("pp_mod_tech_marker");
    expect(() => buildMod(CONFIG, [patches], { vanilla })).toThrow(
      'the patch of tech_gene_forging references technology "pp_mod_tech_marker" in ' +
        '"prerequisites", but no such technology is among the collections passed to buildMod'
    );
  });

  it("holds the contribution sink to the same standard", () => {
    const limits = createCountryShipOfSizeLimits();
    const titan = limits.defineCountryShipOfSizeLimit({
      id: "pp_mod_limit_titan",
      shipTypes: ["ship_size_titan"],
      base: 80,
      show: isScopeValid(),
    });
    limits.addShipOfSizeLimits([titan, "third_party_limit"]);
    expect(buildMod(CONFIG, [limits]).shipOfSizeLimits).toEqual(
      new Set(["pp_mod_limit_titan", "third_party_limit"])
    );

    const dangling = createCountryShipOfSizeLimits();
    dangling.addShipOfSizeLimits(["pp_mod_limit_never_defined"]);
    expect(() => buildMod(CONFIG, [dangling])).toThrow(
      "the ship_of_size_limits contribution references country_ship_of_size_limit " +
        '"pp_mod_limit_never_defined" in "default.ship_of_size_limits"'
    );
  });
});

describe("collections", () => {
  it("merges same-stem content collections, ordering the merge by id", () => {
    // Passed second-collection-first: the merged file is still id-sorted, so
    // which collection contributed a definition is not observable in the
    // output (SDK-23).
    const first = techsWith("shared", "pp_mod_tech_first");
    const second = techsWith("shared", "pp_mod_tech_second");
    const files = render(buildMod(CONFIG, [second, first]));
    const shared = files.get("common/technology/pp_mod_shared.txt")!;
    expect(shared.indexOf("pp_mod_tech_first")).toBeGreaterThanOrEqual(0);
    expect(shared.indexOf("pp_mod_tech_first")).toBeLessThan(shared.indexOf("pp_mod_tech_second"));
  });

  it("orders file groups within a registry by path, not by first appearance", () => {
    const beta = techsWith("beta_techs", "pp_mod_tech_beta");
    const alpha = techsWith("alpha_techs", "pp_mod_tech_alpha");
    const paths = [...render(buildMod(CONFIG, [beta, alpha])).keys()].filter((relPath) =>
      relPath.startsWith("common/technology/")
    );
    expect(paths).toEqual([
      "common/technology/pp_mod_alpha_techs.txt",
      "common/technology/pp_mod_beta_techs.txt",
    ]);
  });

  it("orders events inside a file numerically, not lexically", () => {
    // `ns.10` after `ns.2` — the reason the event sort reads the numeric half
    // of the id instead of comparing the full id as text.
    const events = createEvents("events", "pp_mod");
    for (const id of [10, 2, 1]) {
      events.defineCountryEvent({ id, isTriggeredOnly: true, hideWindow: true });
    }
    const file = render(buildMod(CONFIG, [events])).get("events/pp_mod_events.txt")!;
    expect([...file.matchAll(/id = (pp_mod\.\d+)/g)].map((match) => match[1])).toEqual([
      "pp_mod.1",
      "pp_mod.2",
      "pp_mod.10",
    ]);
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

/**
 * Emission order is a function of the content, never of where the author put
 * it (SDK-23 decision 4). This is the property the whole chunk exists for, so
 * it is checked as a property rather than through goldens: one fixture built
 * twice, with everything an author controls but the output must not observe
 * flipped — the order collections are passed to `buildMod`, and the order the
 * definitions were authored in.
 *
 * What is deliberately NOT reversed: the arrays inside a definition
 * (prerequisites, event options, the `addShipOfSizeLimits` argument list) and
 * two registrations on the *same* on-action hook. Those are author data, and
 * reversing them is supposed to change the output.
 */
describe("order purity", () => {
  const PROBE_TECH_FILE = `tech_probe_alpha = {
	cost = 100
	area = physics
	tier = 1
	category = { particles }
}

tech_probe_zeta = {
	cost = 200
	area = physics
	tier = 1
	category = { particles }
}
`;
  const probeVanilla = viewFromFiles(
    { "common/technology/00_probe_tech.txt": PROBE_TECH_FILE },
    { gameVersion: "4.4.6" }
  );

  function orderProbe(reversed: boolean): ModItemInput[] {
    const alpha = createTechnologies("alpha_techs");
    const beta = createTechnologies("beta_techs");
    const limits = createCountryShipOfSizeLimits();
    const events = createEvents("events", "pp_mod");
    const zetaEvents = createEvents("zeta_events", "pp_mod_zeta");
    const hooks = createOnActions();

    const steps: (() => void)[] = [
      () => {
        // Two ids in one file, out of sorted order among themselves.
        beta.defineTechnology({
          id: "pp_mod_tech_beta_two",
          name: "Beta Two",
          area: "physics",
          tier: 1,
          category: "particles",
        });
      },
      () => {
        beta.defineTechnology({
          id: "pp_mod_tech_beta_one",
          name: "Beta One",
          area: "physics",
          tier: 1,
          category: "particles",
        });
      },
      () => {
        alpha.defineTechnology({
          id: "pp_mod_tech_alpha_one",
          name: "Alpha One",
          area: "physics",
          tier: 1,
          category: "particles",
        });
      },
      () => {
        const limit = limits.defineCountryShipOfSizeLimit({
          id: "pp_mod_limit_zeta",
          shipTypes: ["ship_size_titan"],
          base: 1,
          show: isScopeValid(),
        });
        limits.addShipOfSizeLimits([limit]);
      },
      () => {
        const limit = limits.defineCountryShipOfSizeLimit({
          id: "pp_mod_limit_alpha",
          shipTypes: ["ship_size_juggernaut"],
          base: 2,
          show: isScopeValid(),
        });
        limits.addShipOfSizeLimits([limit]);
      },
      () => {
        // 10 before 2: the numeric event sort, from both directions.
        const event = events.defineCountryEvent({
          id: 10,
          title: "Ten",
          isTriggeredOnly: true,
          options: [{ name: "Noted." }],
        });
        hooks.on(onActions.onGameStartCountry, event);
      },
      () => {
        const event = events.defineCountryEvent({
          id: 2,
          title: "Two",
          isTriggeredOnly: true,
          options: [{ name: "Fascinating." }],
        });
        // A different hook, so the two registrations are hook-block ordering
        // rather than the within-hook list the author owns.
        hooks.on(onActions.onDecadePulseCountry, event);
      },
      () => {
        zetaEvents.defineCountryEvent({
          id: 1,
          title: "Zeta",
          isTriggeredOnly: true,
          options: [{ name: "Noted." }],
        });
      },
      () => {
        beta.patchTechnology(probeVanilla.technology("tech_probe_zeta").require("cost"), (t) => ({
          cost: t.cost.value * 2,
        }));
      },
      () => {
        alpha.patchTechnology(probeVanilla.technology("tech_probe_alpha").require("cost"), (t) => ({
          cost: t.cost.value * 3,
        }));
      },
    ];
    for (const step of reversed ? [...steps].reverse() : steps) {
      step();
    }
    const collections = [alpha, beta, limits, events, zetaEvents, hooks];
    return reversed ? [...collections].reverse() : collections;
  }

  it("renders byte-identical output when collection and authoring order reverse", () => {
    const forward = render(buildMod(CONFIG, orderProbe(false), { vanilla: probeVanilla }));
    const backward = render(buildMod(CONFIG, orderProbe(true), { vanilla: probeVanilla }));
    // The fixture has to actually exercise every channel, or the property is
    // asserted over nothing.
    expect([...forward.keys()]).toEqual([
      "descriptor.mod",
      "common/technology/pp_mod_alpha_techs.txt",
      "common/technology/pp_mod_beta_techs.txt",
      "common/country_limits/ship_of_size_limits/pp_mod_ship_of_size_limits.txt",
      "events/pp_mod_events.txt",
      "events/pp_mod_zeta_events.txt",
      "common/country_limits/ownership_limits/pp_mod_ownership_limits.txt",
      "common/on_actions/pp_mod_on_actions.txt",
      "localisation/english/pp_mod_l_english.yml",
      "common/technology/00_probe_tech_pp_mod_patch.txt",
    ]);
    expect([...backward.entries()]).toEqual([...forward.entries()]);
  });
});

/**
 * Runtime evidence for capability authoring and the pure fold.
 *
 * The representative capability fixture is pinned to the bytes captured from
 * the deleted class builder. The remaining low-level tests intentionally call
 * internal fold primitives to exercise malformed, forged, and assembly-time
 * invariants that capability authoring makes unrepresentable. Layer 6 can
 * remove those calls together with the legacy public surface once their
 * remaining coverage has an explicit internal-test home.
 */

import { describe, expect, it } from "vitest";

import { buildMod as buildInternal } from "../src/build.ts";
import {
  defineSituationType as defineSituationTypeInternal,
  on as onInternal,
} from "../src/definers.ts";
import {
  addShipOfSizeLimits as addShipOfSizeLimitsInternal,
  defineCountryShipOfSizeLimit as defineCountryShipOfSizeLimitInternal,
  defineGlobalShipDesign as defineGlobalShipDesignInternal,
  defineTechnology as defineTechnologyInternal,
  defineTradition as defineTraditionInternal,
  defineUtilityComponentTemplate as defineUtilityComponentTemplateInternal,
  defineWeaponComponentTemplate as defineWeaponComponentTemplateInternal,
  patchTechnology as patchTechnologyInternal,
} from "../src/generated/content-definers.ts";
import { namespace as namespaceInternal } from "../src/generated/event-definers.ts";
import {
  always,
  and,
  createMod,
  eventTarget,
  hasOwner,
  hasTechnology,
  isScopeValid,
  onActions,
  render,
  type ModConfig,
  type ModifierClosure,
  type ScopeObjOf,
} from "../src/index.ts";
import {
  collection as collectionInternal,
  type Collection,
  type EventItem,
  type ModItem,
  type ModItemInput,
} from "../src/items.ts";
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
 * The representative capability fixture: every definition is a value, and an
 * explicit feature places it. It exercises every channel the mod has — content with
 * localization, the situation graft's `targetScope`, two events that fire each
 * other with a FROM witness, an on-action binding, the contribution sink, and
 * a patch.
 *
 * The features preserve the stems the goldens were captured under.
 */
const defaultCapability = createMod(CONFIG);
const capability = createMod(CONFIG, {
  ids: {
    ...defaultCapability.ids,
    situationType: "situation",
    countryShipOfSizeLimit: "limit",
  },
});

function capabilityFeatures() {
  const events = capability.namespace();

  const grafts = capability.technology("chimeric_grafts", {
    name: "Chimeric Grafts",
    area: "society",
    tier: 3,
    category: "biology",
  });
  const situation = capability.situationType("probe", {
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
  const titan = capability.countryShipOfSizeLimit("titan", {
    shipTypes: ["ship_size_titan"],
    base: 80,
    max: 1600,
    show: and(isScopeValid(), hasTechnology("tech_titans")),
  });
  const aftershock = events.planet(2, {
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
  const hum = events.country(1, {
    title: "The Hum",
    isTriggeredOnly: true,
    immediate: (country, ctx) => {
      country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
        planet.planetEvent({ id: aftershock, from: ctx.self, days: 30 });
      });
    },
    options: [{ name: "Fascinating." }],
  });
  const patch = capability.patchTechnology(
    vanilla.technology("tech_gene_forging").require("cost", "prerequisites"),
    (t) => ({
      cost: t.cost.value * 2,
      prerequisites: [...t.prerequisites, grafts],
    })
  );
  return [
    capability.feature(undefined, [grafts, patch]),
    capability.feature(undefined, [situation]),
    capability.feature(undefined, [
      titan,
      capability.addShipOfSizeLimits([titan, "third_party_limit"]),
    ]),
    capability.feature("events", [aftershock, hum]),
    capability.feature(undefined, [capability.on(onActions.onGameStartCountry, [hum])]),
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
  return collectionInternal(
    file,
    ids.map((id) =>
      defineTechnologyInternal({ id, name: id, area: "physics", tier: 1, category: "particles" })
    )
  );
}

describe("parity with the deleted class builder", () => {
  const pure = capability.compile(capabilityFeatures(), { vanilla });
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

describe("composability", () => {
  it("accepts a capability-bound pack as an explicit feature", () => {
    const mod = createMod({ name: "Pack Consumer", prefix: "pp_probe", supportedVersion: "4.4.*" });
    const compiled = mod.compile([resonancePack(mod)]);
    const tech = render(compiled).get("common/technology/pp_probe_technology.txt");
    expect(tech).toContain("pp_probe_tech_resonance_theory");
    expect(tech).toContain('prerequisites = { "pp_probe_tech_resonance_theory" "tech_lasers_2" }');
  });
});

describe("assembly-time validation", () => {
  it("rejects duplicate content ids across collections at the fold", () => {
    // Each factory is inert until built; the same id in two collections is
    // only discoverable at assembly.
    const first = techsWith(undefined, "pp_mod_tech_twin");
    const second = techsWith(undefined, "pp_mod_tech_twin");
    expect(() => buildInternal(CONFIG, [first, second])).toThrow(
      'Duplicate technology id "pp_mod_tech_twin"'
    );
  });

  it("rejects duplicate localization keys across definitions", () => {
    const techs = collectionInternal(undefined, [
      defineTechnologyInternal({
        id: "pp_mod_a",
        name: "A",
        desc: "first",
        area: "physics",
        tier: 1,
        category: "particles",
      }),
      // Its name key is "pp_mod_a_desc" — exactly the first tech's desc key.
      defineTechnologyInternal({
        id: "pp_mod_a_desc",
        name: "B",
        area: "physics",
        tier: 1,
        category: "particles",
      }),
    ]);
    expect(() => buildInternal(CONFIG, [techs])).toThrow(
      'Duplicate localization key "pp_mod_a_desc"'
    );
  });

  it("reports quote replacement as a warning datum, not console output", () => {
    const techs = collectionInternal(undefined, [
      defineTechnologyInternal({
        id: "pp_mod_quoted",
        name: 'The "Hum"',
        area: "physics",
        tier: 1,
        category: "particles",
      }),
    ]);
    const mod = buildInternal(CONFIG, [techs]);
    expect(mod.warnings.map((warning) => warning.code)).toEqual(["loc-quote-replaced"]);
    expect(render(mod).get("localisation/english/pp_mod_l_english.yml")).toContain(
      "pp_mod_quoted:0 \"The 'Hum'\""
    );
  });
});

describe("event namespaces", () => {
  it("rejects a duplicate id at the definition site, with its namespace", () => {
    const events = namespaceInternal("pp_mod_dup");
    events.defineCountryEvent({ id: 1, isTriggeredOnly: true, hideWindow: true });
    expect(() => events.defineCountryEvent({ id: 1, isTriggeredOnly: true })).toThrow(
      'Duplicate event id "pp_mod_dup.1"'
    );
  });

  it("rejects the same full id from two namespace handles sharing a file", () => {
    // Same stem and same namespace is a legal merge — the bijection below
    // holds — so this is exactly the case the define-site check cannot see:
    // each namespace handle has its own `used` set, and only the global check
    // across every collection knows the two collided.
    const first = collectionInternal("shared_events", [
      namespaceInternal("pp_mod_shared").defineCountryEvent({
        id: 1,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    const second = collectionInternal("shared_events", [
      namespaceInternal("pp_mod_shared").defineCountryEvent({
        id: 1,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    expect(() => buildInternal(CONFIG, [first, second])).toThrow(
      'Duplicate event id "pp_mod_shared.1"'
    );
    // The merge itself is fine: distinct ids in the two collections land in
    // one file, exactly as two same-stem content collections do.
    const third = collectionInternal("shared_events", [
      namespaceInternal("pp_mod_shared").defineCountryEvent({
        id: 2,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    const merged = render(buildInternal(CONFIG, [first, third])).get(
      "events/pp_mod_shared_events.txt"
    )!;
    expect(merged).toContain("id = pp_mod_shared.1");
    expect(merged).toContain("id = pp_mod_shared.2");
  });

  it("keeps one file per namespace, the other half of the bijection", () => {
    // SDK-23 decision 1. A namespace split across two files splits its
    // numeric id space across two independent define-site checks, and makes
    // the emitted file a fact about layout rather than about identity.
    const first = collectionInternal("a_events", [
      namespaceInternal("pp_mod_shared").defineCountryEvent({
        id: 1,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    const second = collectionInternal("b_events", [
      namespaceInternal("pp_mod_shared").defineCountryEvent({
        id: 2,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    expect(() => buildInternal(CONFIG, [first, second])).toThrow(
      'event namespace "pp_mod_shared" is split across file stems "a_events" and "b_events" — ' +
        "one file per namespace; give each namespace its own file stem"
    );
  });

  it("keeps one namespace per emitted file, catching same-stem merges", () => {
    const alpha = collectionInternal("shared", [
      namespaceInternal("pp_mod_alpha").defineCountryEvent({
        id: 1,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    const beta = collectionInternal("shared", [
      namespaceInternal("pp_mod_beta").defineCountryEvent({
        id: 2,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    expect(() => buildInternal(CONFIG, [alpha, beta])).toThrow(
      'event file events/pp_mod_shared.txt would mix namespaces "pp_mod_alpha" and "pp_mod_beta"'
    );
  });

  it("gives each namespace its own numeric id space and file", () => {
    const alpha = collectionInternal("alpha_events", [
      namespaceInternal("pp_mod_alpha").defineCountryEvent({
        id: 1,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    const beta = collectionInternal("beta_events", [
      namespaceInternal("pp_mod_beta").defineCountryEvent({
        id: 1,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    const files = render(buildInternal(CONFIG, [alpha, beta]));
    const alphaFile = files.get("events/pp_mod_alpha_events.txt")!;
    const betaFile = files.get("events/pp_mod_beta_events.txt")!;
    expect(alphaFile).toContain("namespace = pp_mod_alpha");
    expect(alphaFile).toContain("id = pp_mod_alpha.1");
    expect(betaFile).toContain("namespace = pp_mod_beta");
    expect(betaFile).toContain("id = pp_mod_beta.1");
  });

  it("rejects a namespace that is not snake_case when it is opened", () => {
    expect(() => namespaceInternal("Bad.Namespace")).toThrow(
      'Event namespace "Bad.Namespace" must be lowercase snake_case'
    );
  });

  it("fails loudly on a fired event whose collection was not passed", () => {
    const orphan = namespaceInternal("pp_mod_orphans").definePlanetEvent({
      id: 22,
      from: "country",
      isTriggeredOnly: true,
    });
    const included = collectionInternal("events", [
      namespaceInternal("pp_mod").defineCountryEvent({
        id: 21,
        isTriggeredOnly: true,
        hideWindow: true,
        immediate: (country, ctx) => {
          country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
            planet.planetEvent({ id: orphan, from: ctx.self });
          });
        },
      }),
    ]);
    // `orphans` is never passed — the emitted id has no definition behind it.
    expect(() => buildInternal(CONFIG, [included])).toThrow(
      '"pp_mod_orphans.22" looks like one of this mod\'s event ids'
    );
  });

  it("leaves alone a foreign event whose namespace merely starts with the prefix", () => {
    // `pp_module_extras` is somebody else's namespace: the accepted own
    // namespaces are `pp_mod` and `pp_mod_*`, and this is neither. Firing it
    // must not demand a definition this mod was never going to supply.
    const foreign = namespaceInternal("pp_module_extras").definePlanetEvent({
      id: 22,
      from: "country",
      isTriggeredOnly: true,
    });
    const included = collectionInternal("events", [
      namespaceInternal("pp_mod").defineCountryEvent({
        id: 23,
        isTriggeredOnly: true,
        hideWindow: true,
        immediate: (country, ctx) => {
          country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
            planet.planetEvent({ id: foreign, from: ctx.self });
          });
        },
      }),
    ]);
    const files = render(buildInternal(CONFIG, [included]));
    expect(files.get("events/pp_mod_events.txt")).toContain("id = pp_module_extras.22");
  });

  it("requires on-action events to be collections of the same build", () => {
    const event = namespaceInternal("pp_mod").defineCountryEvent({ id: 31, isTriggeredOnly: true });
    const hooks = collectionInternal(undefined, [
      onInternal(onActions.onGameStartCountry, [event]),
    ]);
    expect(() => buildInternal(CONFIG, [hooks])).toThrow(
      'Event "pp_mod.31" is not among the collections passed to buildMod'
    );
  });
});

describe("content reference integrity", () => {
  it("resolves a reference across two collections of the same build", () => {
    const base = techsWith("base_techs", "pp_mod_tech_base");
    const derived = collectionInternal("derived_techs", [
      defineTechnologyInternal({
        id: "pp_mod_tech_derived",
        name: "Derived",
        area: "physics",
        tier: 2,
        category: "particles",
        prerequisites: ["pp_mod_tech_base"],
      }),
    ]);
    const files = render(buildInternal(CONFIG, [base, derived]));
    expect(files.get("common/technology/pp_mod_derived_techs.txt")).toContain(
      'prerequisites = { "pp_mod_tech_base" }'
    );
  });

  // An id reaching the output through a script closure is a reference just as
  // much as one written into a declarative field. The recorder reports what
  // the closure wrote, so both face the same guard — a well-formed,
  // own-prefixed id with no definition behind it never builds clean.
  it("fails loudly on a reference an effect closure wrote", () => {
    const orphan = defineTechnologyInternal({
      id: "pp_mod_tech_closure_orphan",
      name: "Closure orphan",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const events = collectionInternal("events", [
      namespaceInternal("pp_mod").defineCountryEvent({
        id: 41,
        isTriggeredOnly: true,
        hideWindow: true,
        immediate: (country) => {
          country.giveTechnology({ tech: orphan });
        },
      }),
    ]);
    expect(() => buildInternal(CONFIG, [events])).toThrow(
      'event "pp_mod.41" references technology "pp_mod_tech_closure_orphan" in ' +
        '"immediate.give_technology.tech"'
    );
  });

  it("fails loudly on a reference a trigger inside a closure wrote", () => {
    const orphan = defineTechnologyInternal({
      id: "pp_mod_tech_gated_orphan",
      name: "Gated orphan",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const events = collectionInternal("events", [
      namespaceInternal("pp_mod").defineCountryEvent({
        id: 42,
        isTriggeredOnly: true,
        hideWindow: true,
        immediate: (country) => {
          country.if(and(hasTechnology(orphan)), (owner) => {
            owner.addResource({ resource: "energy", amount: 1 });
          });
        },
      }),
    ]);
    expect(() => buildInternal(CONFIG, [events])).toThrow(
      'event "pp_mod.42" references technology "pp_mod_tech_gated_orphan" in ' +
        '"immediate.has_technology"'
    );
  });

  it("resolves a closure reference when its collection is passed", () => {
    const tech = defineTechnologyInternal({
      id: "pp_mod_tech_granted",
      name: "Granted",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const events = collectionInternal("events", [
      namespaceInternal("pp_mod").defineCountryEvent({
        id: 43,
        isTriggeredOnly: true,
        hideWindow: true,
        immediate: (country) => {
          country.giveTechnology({ tech });
        },
      }),
    ]);
    const files = render(buildInternal(CONFIG, [collectionInternal("granted", [tech]), events]));
    expect(files.get("events/pp_mod_events.txt")).toContain("tech = pp_mod_tech_granted");
  });

  it("fails loudly on a reference whose collection was not passed", () => {
    const orphan = defineTechnologyInternal({
      id: "pp_mod_tech_orphan",
      name: "Orphan",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const included = collectionInternal(undefined, [
      defineTechnologyInternal({
        id: "pp_mod_tech_dependent",
        name: "Dependent",
        area: "physics",
        tier: 2,
        category: "particles",
        prerequisites: [orphan],
      }),
    ]);
    // `orphans` is never passed — the emitted id has no definition behind it.
    expect(() => buildInternal(CONFIG, [included])).toThrow(
      'technology "pp_mod_tech_dependent" references technology "pp_mod_tech_orphan" in ' +
        '"prerequisites", but no such technology is among the collections passed to buildMod'
    );
  });

  it("names the registry, not merely the id: a tradition is not a technology", () => {
    // Same id, different registry. An existence-only check would pass this.
    const traditions = collectionInternal(undefined, [
      defineTraditionInternal({
        id: "pp_mod_ghost",
        name: "Ghost",
        effects: "Nothing at all.",
      }),
    ]);
    const techs = collectionInternal(undefined, [
      defineTechnologyInternal({
        id: "pp_mod_tech_haunted",
        name: "Haunted",
        area: "physics",
        tier: 2,
        category: "particles",
        prerequisites: ["pp_mod_ghost"],
      }),
    ]);
    expect(() => buildInternal(CONFIG, [traditions, techs])).toThrow(
      'references technology "pp_mod_ghost" in "prerequisites"'
    );
  });

  it("checks a reference whose registry the manifest split off a shared CWT type", () => {
    // The guard matches a field's declared `refTypes` against the registries
    // this SDK can author. Those refTypes are CWT names — a component
    // template's is `component_template.utility_component_template` — so
    // keying by the registry name meant nothing ever matched and every
    // component template reference read as somebody else's to define.
    const designs = collectionInternal(undefined, [
      defineGlobalShipDesignInternal({
        id: "pp_mod_design_ghost_component",
        shipSize: "ship_size_corvette",
        growthStages: [
          {
            shipSize: "ship_size_corvette",
            requiredComponent: ["pp_mod_component_missing"],
          },
        ],
      }),
    ]);
    expect(() => buildInternal(CONFIG, [designs])).toThrow(
      'references component_template.utility_component_template "pp_mod_component_missing"'
    );

    // Defined, it passes — and the id is matched against that registry's own
    // definitions, not merely against something built somewhere.
    const components = collectionInternal(undefined, [
      defineUtilityComponentTemplateInternal({ id: "pp_mod_component_missing", icon: "GFX_x" }),
    ]);
    expect(() => buildInternal(CONFIG, [designs, components])).not.toThrow();
  });

  it("resolves an unqualified reference across every registry split out of its type", () => {
    // `template` holds a bare `<component_template>`, which any of the three
    // subtype registries satisfies. Keying only by the qualified names left
    // the bare type absent from the map, so these references — the majority
    // of them — read as unauthorable and went unchecked.
    const designs = collectionInternal(undefined, [
      defineGlobalShipDesignInternal({
        id: "pp_mod_design_ghost_template",
        shipSize: "ship_size_corvette",
        section: [
          { slot: "mid", component: [{ slot: "aux", template: "pp_mod_template_missing" }] },
        ],
      }),
    ]);
    expect(() => buildInternal(CONFIG, [designs])).toThrow(
      'references component_template "pp_mod_template_missing"'
    );

    // Any of the three registries accounts for it, since the field takes any.
    const weapons = collectionInternal(undefined, [
      defineWeaponComponentTemplateInternal({ id: "pp_mod_template_missing", icon: "GFX_x" }),
    ]);
    expect(() => buildInternal(CONFIG, [designs, weapons])).not.toThrow();
  });

  it("checks an own-prefixed raw string exactly like a branded ref", () => {
    // The prefix is per-mod, so an own-prefixed string in a reference field is
    // this mod's content however it was written — which is what catches typos.
    const techs = collectionInternal(undefined, [
      defineTechnologyInternal({
        id: "pp_mod_tech_base",
        name: "Base",
        area: "physics",
        tier: 1,
        category: "particles",
      }),
      defineTechnologyInternal({
        id: "pp_mod_tech_typo",
        name: "Typo",
        area: "physics",
        tier: 2,
        category: "particles",
        prerequisites: ["pp_mod_tech_bass"],
      }),
    ]);
    expect(() => buildInternal(CONFIG, [techs])).toThrow(
      'references technology "pp_mod_tech_bass" in "prerequisites"'
    );
  });

  it("exempts vanilla and third-party ids, and fields no registry backs", () => {
    const techs = collectionInternal(undefined, [
      defineTechnologyInternal({
        id: "pp_mod_tech_open",
        name: "Open",
        area: "physics",
        // `<technology_tier>` is not a registry this SDK authors, so nothing
        // here could have defined it and its absence proves nothing.
        tier: "pp_mod_tier_custom",
        category: "particles",
        prerequisites: ["tech_lasers_2", "someone_elses_tech"],
      }),
    ]);
    expect(buildInternal(CONFIG, [techs]).warnings).toEqual([]);
  });

  it("leaves own-prefixed flags, targets and loc keys alone", () => {
    // The scalars a post-hoc scan of the emitted tree would trip over: all
    // own-prefixed, none of them content references.
    const events = collectionInternal("events", [
      namespaceInternal("pp_mod").defineCountryEvent({
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
      }),
    ]);
    expect(buildInternal(CONFIG, [events]).warnings).toEqual([]);
  });

  it("holds a patch's references to the same standard", () => {
    // The calibration anchor's shape: a vanilla technology patched to require
    // one of this mod's own. In the build it resolves; alone it cannot.
    const marker = defineTechnologyInternal({
      id: "pp_mod_tech_marker",
      name: "Marker",
      area: "society",
      tier: 0,
      category: "biology",
      startTech: true,
    });
    const orphans = collectionInternal("orphan_techs", [marker]);
    const patches = collectionInternal(undefined, [
      patchTechnologyInternal(
        vanilla.technology("tech_gene_forging").require("prerequisites"),
        (t) => ({
          prerequisites: [...t.prerequisites, marker],
        })
      ),
    ]);
    expect(
      render(buildInternal(CONFIG, [orphans, patches], { vanilla })).get(
        "common/technology/pp_mod_orphan_techs.txt"
      )
    ).toContain("pp_mod_tech_marker");
    expect(() => buildInternal(CONFIG, [patches], { vanilla })).toThrow(
      'the patch of tech_gene_forging references technology "pp_mod_tech_marker" in ' +
        '"prerequisites", but no such technology is among the collections passed to buildMod'
    );
  });

  it("holds the contribution sink to the same standard", () => {
    const titan = defineCountryShipOfSizeLimitInternal({
      id: "pp_mod_limit_titan",
      shipTypes: ["ship_size_titan"],
      base: 80,
      show: isScopeValid(),
    });
    const limits = collectionInternal(undefined, [
      titan,
      addShipOfSizeLimitsInternal([titan, "third_party_limit"]),
    ]);
    expect(buildInternal(CONFIG, [limits]).shipOfSizeLimits).toEqual(
      new Set(["pp_mod_limit_titan", "third_party_limit"])
    );

    const dangling = collectionInternal(undefined, [
      addShipOfSizeLimitsInternal(["pp_mod_limit_never_defined"]),
    ]);
    expect(() => buildInternal(CONFIG, [dangling])).toThrow(
      "the ship_of_size_limits contribution references country_ship_of_size_limit " +
        '"pp_mod_limit_never_defined" in "default.ship_of_size_limits"'
    );
  });
});

describe("collections", () => {
  it("fans one stem out to every registry the collection's items belong to", () => {
    // The internal mechanism behind capability feature colocation:
    // one collection holding a technology and an event is one *feature*, and
    // the stem it carries names a file in each registry directory those items
    // land in. Stellaris still gets one directory per registry; the author
    // still writes one module per feature.
    const amplifiers = collectionInternal("amplifiers", [
      defineTechnologyInternal({
        id: "pp_mod_tech_amplifier",
        name: "Amplifier",
        area: "physics",
        tier: 1,
        category: "particles",
      }),
      namespaceInternal("pp_mod_amp").defineCountryEvent({
        id: 1,
        isTriggeredOnly: true,
        hideWindow: true,
      }),
    ]);
    const files = render(buildInternal(CONFIG, [amplifiers]));
    expect([...files.keys()]).toEqual([
      "descriptor.mod",
      "common/technology/pp_mod_amplifiers.txt",
      "events/pp_mod_amplifiers.txt",
      "localisation/english/pp_mod_l_english.yml",
    ]);
    expect(files.get("common/technology/pp_mod_amplifiers.txt")).toContain(
      "pp_mod_tech_amplifier = {"
    );
    expect(files.get("events/pp_mod_amplifiers.txt")).toContain("namespace = pp_mod_amp");
  });

  it("merges same-stem content collections, ordering the merge by id", () => {
    // Passed second-collection-first: the merged file is still id-sorted, so
    // which collection contributed a definition is not observable in the
    // output (SDK-23).
    const first = techsWith("shared", "pp_mod_tech_first");
    const second = techsWith("shared", "pp_mod_tech_second");
    const files = render(buildInternal(CONFIG, [second, first]));
    const shared = files.get("common/technology/pp_mod_shared.txt")!;
    expect(shared.indexOf("pp_mod_tech_first")).toBeGreaterThanOrEqual(0);
    expect(shared.indexOf("pp_mod_tech_first")).toBeLessThan(shared.indexOf("pp_mod_tech_second"));
  });

  it("orders file groups within a registry by path, not by first appearance", () => {
    const beta = techsWith("beta_techs", "pp_mod_tech_beta");
    const alpha = techsWith("alpha_techs", "pp_mod_tech_alpha");
    const paths = [...render(buildInternal(CONFIG, [beta, alpha])).keys()].filter((relPath) =>
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
    const ns = namespaceInternal("pp_mod");
    const events = collectionInternal(
      "events",
      [10, 2, 1].map((id) => ns.defineCountryEvent({ id, isTriggeredOnly: true, hideWindow: true }))
    );
    const file = render(buildInternal(CONFIG, [events])).get("events/pp_mod_events.txt")!;
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
    expect(() => collectionInternal("category/dawn", [])).toThrow(
      'Collection file stem "category/dawn" must be lowercase snake_case'
    );
    expect(() => collectionInternal("../escape", [])).toThrow(/must be lowercase snake_case/);
    // A hand-built Collection value bypasses `collection()`; flattening
    // re-asserts every stem.
    const forged: Collection = {
      itemKind: "collection",
      file: "category/dawn",
      items: [],
    };
    expect(() => buildInternal(CONFIG, [forged])).toThrow(/must be lowercase snake_case/);
  });

  it("rejects a mod name the descriptor cannot express", () => {
    // `descriptor.mod` writes name="<name>" and PDXScript has no quote escape,
    // so a quote produces a descriptor the launcher refuses without saying why.
    expect(() => buildInternal({ ...CONFIG, name: 'The "Real" Mod' }, [])).toThrow(
      /cannot contain a double quote/
    );
    expect(() => buildInternal({ ...CONFIG, name: "The 'Real' Mod" }, [])).not.toThrow();
  });

  it("rejects every descriptor field the format cannot express, naming the field", () => {
    // `descriptor.mod` is `key="value"` lines with no escaping, so a quote
    // ends the value and a newline ends the line — either one turns the rest
    // of the author's text into further descriptor fields the launcher reads
    // as real.
    expect(() => buildInternal({ ...CONFIG, name: 'a"\nsupported_version="v9.9.*' }, [])).toThrow(
      /Mod name .* cannot contain/
    );
    expect(() => buildInternal({ ...CONFIG, name: "line\nbreak" }, [])).toThrow(
      /Mod name .* cannot contain a newline/
    );
    expect(() => buildInternal({ ...CONFIG, name: "nul\0byte" }, [])).toThrow(
      /Mod name .* cannot contain a NUL byte/
    );
    expect(() => buildInternal({ ...CONFIG, version: '1.0"\nname="Other' }, [])).toThrow(
      /Mod version .* cannot contain/
    );
    expect(() => buildInternal({ ...CONFIG, tags: ["Fine", 'Bad"\nname="Other'] }, [])).toThrow(
      /Mod tags\[1\] .* cannot contain/
    );
    expect(() =>
      buildInternal({ ...CONFIG, supportedVersion: 'v4.4.*"\nname="Other' }, [])
    ).toThrow(/Mod supportedVersion .* cannot contain/);
  });

  it("renders from its own copy of the config, not the caller's object", () => {
    // `PureMod` used to hold the caller's config by reference, so mutating it
    // after the build changed what `render` emitted — including `prefix`,
    // which names emitted files whose *contents* were compiled against the
    // old one, desynchronizing paths from the ids inside them.
    const config: ModConfig = {
      name: "Mutable Probe",
      prefix: "pp_mod",
      version: "1.0.0",
      supportedVersion: "4.4.*",
      tags: ["Technologies"],
    };
    const mod = buildInternal(config, [
      collectionInternal(undefined, [
        defineTechnologyInternal({
          id: "pp_mod_tech_frozen",
          name: "Frozen",
          area: "physics",
          tier: 1,
          category: "computing",
        }),
      ]),
    ]);
    const before = render(mod);

    config.name = "Renamed After The Build";
    config.prefix = "other_prefix";
    config.version = "9.9.9";
    config.supportedVersion = "v9.9.*";
    config.tags!.push("Gameplay");

    expect([...render(mod).entries()]).toEqual([...before.entries()]);
    expect(mod.config.name).toBe("Mutable Probe");
    expect(mod.config.tags).toEqual(["Technologies"]);
  });

  it("rejects a line break in localization text, pointing at the escape vanilla uses", () => {
    // The emitted yml is one ` key:0 "text"` line per entry and the game reads
    // it line by line, so a break inside the text is read as a further entry —
    // a definition's own description silently overriding a key it does not own.
    expect(() =>
      buildInternal(CONFIG, [
        collectionInternal(undefined, [
          defineTechnologyInternal({
            id: "pp_mod_tech_injected",
            name: 'Fine"\n pp_mod_tech_other:0 "Forged',
            area: "physics",
            tier: 1,
            category: "computing",
          }),
        ]),
      ])
    ).toThrow(/Localization text .* cannot contain a line break/);
  });

  it("rejects a supportedVersion the launcher could not read", () => {
    // It is written verbatim into descriptor.mod, and the launcher answers an
    // unreadable one by refusing the mod without saying so — the exact silent
    // failure the build is supposed to convert into an error.
    for (const supportedVersion of ["totally bogus", "4.4.x", "", "v", "4.4.6.1"]) {
      expect(() => buildInternal({ ...CONFIG, supportedVersion }, [])).toThrow(
        /is not a launcher version pattern/
      );
    }
  });

  it("accepts a launcher version pattern with or without the leading v", () => {
    // Both load, so neither is rewritten into an author's emitted bytes; the
    // SDK picks a side only for what it derives itself.
    for (const supportedVersion of ["v4.4.*", "4.4.*", "v4.*", "4.4.6", "*"]) {
      expect(() => buildInternal({ ...CONFIG, supportedVersion }, [])).not.toThrow();
    }
  });

  it("feeds every own technology file into the patch plan's path order", () => {
    // Split tech emission + a patch: the plan must reserve and enumerate
    // BOTH own files — the SDK-19 constraint with teeth.
    const alpha = techsWith("alpha_techs", "pp_mod_tech_alpha");
    const beta = techsWith("beta_techs", "pp_mod_tech_beta");
    const patches = collectionInternal(undefined, [
      patchTechnologyInternal(vanilla.technology("tech_gene_forging").require("cost"), (t) => ({
        cost: t.cost.value * 2,
      })),
    ]);
    const mod = buildInternal(CONFIG, [alpha, beta, patches], { vanilla });
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
    const features = capabilityFeatures();
    const first = capability.compile(features, { vanilla });
    const second = capability.compile(features, { vanilla });
    const secondFiles = render(second);
    const firstFiles = render(first);
    expect([...firstFiles.entries()]).toEqual([...secondFiles.entries()]);
  });
});

/**
 * A recorder is valid only inside the closure it was handed to.
 *
 * Both recorders — the effect scope object (`effect-core.ts`) and the modifier
 * path recorder (`content.ts`) — are proxies over an entry array that the
 * lowering keeps by reference. Stored somewhere longer-lived than the closure,
 * either one used to record into an already-built, already-frozen `PureMod`:
 * no error, and a second `render` of that same value emitting different bytes
 * than the first. Determinism above is asserted over honest builds; this is
 * the same property held against a caller actively trying to break it.
 */
describe("recorder liveness", () => {
  it("refuses an effect recorded on a scope object that escaped its closure", () => {
    let leaked: ScopeObjOf<"country"> | undefined;
    const events = namespaceInternal("pp_mod_leak");
    const event = events.defineCountryEvent({
      id: 1,
      title: "Leak",
      desc: "Leak",
      isTriggeredOnly: true,
      immediate: (country) => {
        leaked = country;
        country.log("recorded inside the closure");
      },
      options: [{ name: "ok" }],
    });
    const mod = buildInternal(CONFIG, [collectionInternal(undefined, [event])]);
    const before = render(mod);

    expect(() => leaked!.log("recorded after the closure returned")).toThrow(
      /scope object whose effect closure has already returned/
    );

    // The mutation attempt changed nothing: the same built value renders the
    // same bytes it did before the attempt.
    expect([...render(mod).entries()]).toEqual([...before.entries()]);
  });

  it("refuses a modifier recorded on a path recorder that escaped its closure", () => {
    let leaked: Parameters<ModifierClosure<"country">>[0] | undefined;
    const tradition = defineTraditionInternal({
      id: "pp_mod_leaky_tradition",
      name: "Leaky",
      effects: "Nothing at all.",
      modifier: (m) => {
        leaked = m;
        m.command.limit.add(1);
      },
    });
    const mod = buildInternal(CONFIG, [collectionInternal(undefined, [tradition])]);
    const before = render(mod);

    expect(() => leaked!.command.limit.add(2)).toThrow(
      /modifier closure that has already returned/
    );

    expect([...render(mod).entries()]).toEqual([...before.entries()]);
  });
});

/**
 * Emission order is a function of the content, never of where the author put
 * it (SDK-23 decision 4). This is the property the whole chunk exists for, so
 * it is checked as a property rather than through goldens: one fixture built
 * twice, with everything an author controls but the output must not observe
 * flipped — the order features are passed to `compile`, and the order the
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

  const orderMod = createMod(CONFIG, {
    ids: { ...createMod(CONFIG).ids, countryShipOfSizeLimit: "limit" },
  });

  function orderProbe(reversed: boolean) {
    const events = orderMod.namespace();
    const zetaNamespace = orderMod.namespace("zeta");

    const alphaItems: ModItem[] = [];
    const betaItems: ModItem[] = [];
    const limitItems: ModItem[] = [];
    const eventItems: EventItem[] = [];
    const zetaEventItems: EventItem[] = [];
    const hookItems: ModItem[] = [];

    const steps: (() => void)[] = [
      () => {
        // Two ids in one file, out of sorted order among themselves.
        betaItems.push(
          orderMod.technology("beta_two", {
            name: "Beta Two",
            area: "physics",
            tier: 1,
            category: "particles",
          })
        );
      },
      () => {
        betaItems.push(
          orderMod.technology("beta_one", {
            name: "Beta One",
            area: "physics",
            tier: 1,
            category: "particles",
          })
        );
      },
      () => {
        alphaItems.push(
          orderMod.technology("alpha_one", {
            name: "Alpha One",
            area: "physics",
            tier: 1,
            category: "particles",
          })
        );
      },
      () => {
        const limit = orderMod.countryShipOfSizeLimit("zeta", {
          shipTypes: ["ship_size_titan"],
          base: 1,
          show: isScopeValid(),
        });
        limitItems.push(limit, orderMod.addShipOfSizeLimits([limit]));
      },
      () => {
        const limit = orderMod.countryShipOfSizeLimit("alpha", {
          shipTypes: ["ship_size_juggernaut"],
          base: 2,
          show: isScopeValid(),
        });
        limitItems.push(limit, orderMod.addShipOfSizeLimits([limit]));
      },
      () => {
        // 10 before 2: the numeric event sort, from both directions.
        const event = events.country(10, {
          title: "Ten",
          isTriggeredOnly: true,
          options: [{ name: "Noted." }],
        });
        eventItems.push(event);
        hookItems.push(orderMod.on(onActions.onGameStartCountry, [event]));
      },
      () => {
        const event = events.country(2, {
          title: "Two",
          isTriggeredOnly: true,
          options: [{ name: "Fascinating." }],
        });
        eventItems.push(event);
        // A different hook, so the two registrations are hook-block ordering
        // rather than the within-hook list the author owns.
        hookItems.push(orderMod.on(onActions.onDecadePulseCountry, [event]));
      },
      () => {
        zetaEventItems.push(
          zetaNamespace.country(1, {
            title: "Zeta",
            isTriggeredOnly: true,
            options: [{ name: "Noted." }],
          })
        );
      },
      () => {
        betaItems.push(
          orderMod.patchTechnology(
            probeVanilla.technology("tech_probe_zeta").require("cost"),
            (t) => ({
              cost: t.cost.value * 2,
            })
          )
        );
      },
      () => {
        alphaItems.push(
          orderMod.patchTechnology(
            probeVanilla.technology("tech_probe_alpha").require("cost"),
            (t) => ({
              cost: t.cost.value * 3,
            })
          )
        );
      },
    ];
    for (const step of reversed ? [...steps].reverse() : steps) {
      step();
    }
    const features = [
      orderMod.feature("alpha_techs", alphaItems),
      orderMod.feature("beta_techs", betaItems),
      orderMod.feature(undefined, limitItems),
      orderMod.feature("events", eventItems),
      orderMod.feature("zeta_events", zetaEventItems),
      orderMod.feature(undefined, hookItems),
    ];
    return reversed ? [...features].reverse() : features;
  }

  it("renders byte-identical output when feature and authoring order reverse", () => {
    const forward = render(orderMod.compile(orderProbe(false), { vanilla: probeVanilla }));
    const backward = render(orderMod.compile(orderProbe(true), { vanilla: probeVanilla }));
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

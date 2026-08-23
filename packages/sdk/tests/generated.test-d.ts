import { describe, expectTypeOf, it } from "vitest";

import type { EdictRef, TechnologyRef } from "../src/generated/refs.ts";
import type { ScopeName } from "../src/generated/scopes.ts";
import type { TechnologyDef } from "../src/generated/technology.ts";
import { countryFlags, planetFlags, type CountryFlag } from "../src/generated/value-sets.ts";
import { eventTarget } from "../src/index.ts";
import { makeScope } from "../src/script/effects/recorder.ts";
import {
  aiArmorRatio,
  anyTraitOfSpecies,
  checkEconomicProductionModifierForJob,
  checkVariable,
  customTooltip,
  hasActiveEvent,
  hasCountryFlag,
  hasEdict,
  hasElectionType,
  hasPlanetFlag,
  hasResource,
  intelLevel,
  isWarParticipant,
  numMoons,
  popGroupSize,
  relativePower,
  totalWorkforceWithJobTag,
  traitHasAllTags,
  type Trigger,
} from "../src/script/triggers.ts";

const base = {
  id: "mymod_tech_x",
  name: "X",
  cost: 100,
  tier: 1,
  category: "particles",
} as const;

/**
 * `relative_power.who` is `scope_group[target_country]`, so it takes a scope
 * the game will coerce to a country rather than a bare word.
 */
const rival = eventTarget<"country">("mymod_rival");

describe("research areas", () => {
  it("accepts each of the three the game actually uses", () => {
    const physics: TechnologyDef = { ...base, area: "physics" };
    const society: TechnologyDef = { ...base, area: "society" };
    const engineering: TechnologyDef = { ...base, area: "engineering" };
    void physics;
    void society;
    void engineering;
  });

  it("rejects psionics, which canonical cwtools lists and the game does not have", () => {
    // @ts-expect-error — no vanilla technology uses it, and enum[research_area] omits it
    const def: TechnologyDef = { ...base, area: "psionics" };
    void def;
  });

  it("rejects an area that was never plausible", () => {
    // @ts-expect-error — enum[research_area] has three members and this is not one
    const def: TechnologyDef = { ...base, area: "biology" };
    void def;
  });
});

describe("shapes the rules give a signature", () => {
  it("accepts custom tooltip's scalar and gated-block forms", () => {
    customTooltip("requires_ascension_theory");
    customTooltip({
      failText: "default",
      successText: "ascension_theory_ready",
      conditions: hasCountryFlag("ascension_ready"),
    });
    // @ts-expect-error — the block form must still carry the conditions it explains
    customTooltip({ failText: "requires_ascension_theory" });
  });

  it("requires an operator on a comparison trigger", () => {
    numMoons("<", 4);
    // @ts-expect-error — num_moons is written `num_moons < 4`, so the operator is not optional
    numMoons(4);
  });

  it("distinguishes numeric comparisons from CWT value-field comparisons", () => {
    popGroupSize(">", 8);
    popGroupSize(">", "local_spent_biomass");
    popGroupSize(">", "@minimum_pop_group_size");
    aiArmorRatio(">", 0.5);
    // @ts-expect-error — ai_armor_ratio is a plain CWT float comparison
    aiArmorRatio(">", "local_spent_biomass");
  });

  it("types a repeated comparison as one value, one pair, or a list of pairs", () => {
    checkVariable({ which: "var_unrest", value: 5 });
    checkVariable({ which: "var_unrest", value: [">", 2] });
    checkVariable({
      which: "var_unrest",
      value: [
        [">", 2],
        ["<", 10],
      ],
    });

    checkVariable({
      which: "var_unrest",
      // @ts-expect-error — a comparison pairs one operator with one operand
      value: [">", 2, 3],
    });
    checkVariable({
      which: "var_unrest",
      // @ts-expect-error — repeated comparisons nest their pairs; bare operands carry no operator
      value: [5, 6],
    });
    checkVariable({
      which: "var_unrest",
      // @ts-expect-error — a list of comparisons names at least one
      value: [],
    });
  });

  it("closes the enum on a block trigger's field", () => {
    relativePower({ who: rival, category: "fleet", value: "superior" });
    // @ts-expect-error — "typo" is not in enum[relative_power_categories]
    relativePower({ who: rival, category: "typo", value: "superior" });
  });

  it("keeps a block trigger's required fields required", () => {
    // @ts-expect-error — `value` has cardinality 1..1
    relativePower({ who: rival });
  });

  it("closes the enum on a scalar trigger", () => {
    hasElectionType("oligarchic");
    // @ts-expect-error — not an election type
    hasElectionType("monarchy_of_vibes");
  });

  it("types ordered bare-value trigger blocks as arrays", () => {
    hasActiveEvent(["mymod.1", { id: "mymod.2" }]);
    traitHasAllTags(["biological", "lithoid"]);
    totalWorkforceWithJobTag({ tags: ["farmer", "researcher"], value: [">=", 100] });

    // @ts-expect-error — a bare-value block is an ordered array, not one scalar
    hasActiveEvent("mymod.1");
    // @ts-expect-error — nested bare values stay inside their enclosing list block
    totalWorkforceWithJobTag({ tags: "farmer", value: 100 });
  });
});

describe("scope brands from the game's documentation", () => {
  function countrySlot(_trigger: Trigger<"country">): void {}
  function federationSlot(_trigger: Trigger<"federation">): void {}
  function planetSlot(_trigger: Trigger<"planet">): void {}

  const anywhere = relativePower({ who: rival, value: "superior" });

  it("accepts a two-scope trigger in either of its scopes", () => {
    countrySlot(anywhere);
    federationSlot(anywhere);
  });

  it("rejects it in a scope the game does not support", () => {
    // @ts-expect-error — relative_power is documented `country federation`
    planetSlot(anywhere);
  });

  it("covers every scope the rules define, not the four that were hand-written", () => {
    expectTypeOf<"espionage_operation">().toExtend<ScopeName>();
    expectTypeOf<"species_trait">().toExtend<ScopeName>();
    expectTypeOf<"no_scope">().toExtend<ScopeName>();
  });

  it("uses the canonical scope name, not whichever alias a rule happened to write", () => {
    // `any_trait_of_species` is annotated `## push_scope = trait`, which
    // `scopes.cwt` defines as an alias of "Species trait".
    expectTypeOf(anyTraitOfSpecies).parameter(0).toEqualTypeOf<Trigger<"species_trait">>();
  });
});

describe("references", () => {
  it("accepts a raw id or anything carrying one", () => {
    hasEdict("crystal_sonar");
    hasEdict({ id: "crystal_sonar" });
  });

  it("rejects a reference explicitly typed as another content type", () => {
    const technology: TechnologyRef = { id: "tech_lasers_1" };
    // @ts-expect-error — a <technology> is not an <edict>
    hasEdict(technology);
  });

  it("lets an unbranded id through by design, so vanilla ids keep working", () => {
    const loose: { id: string } = { id: "crystal_sonar" };
    hasEdict(loose);
    expectTypeOf<{ id: string }>().toExtend<EdictRef>();
  });
});

describe("value sets", () => {
  const country = countryFlags("mymod_heard_the_hum", "mymod_pacifist_path");
  const planet = planetFlags("mymod_surveyed");

  it("keys the lookup by the names themselves", () => {
    expectTypeOf(country).toEqualTypeOf<{
      readonly mymod_heard_the_hum: CountryFlag;
      readonly mymod_pacifist_path: CountryFlag;
    }>();
  });

  it("rejects a name that was never declared", () => {
    // @ts-expect-error — a typo here is a condition that would never fire in game
    country.mymod_heard_the_humm;
  });

  it("accepts a declared country flag", () => {
    hasCountryFlag(country.mymod_heard_the_hum);
  });

  it("rejects a planet flag where a country flag belongs", () => {
    // @ts-expect-error — has_country_flag draws from value[country_flag]
    hasCountryFlag(planet.mymod_surveyed);
    // @ts-expect-error — and the reverse, since has_planet_flag draws from value[planet_flag]
    hasPlanetFlag(country.mymod_heard_the_hum);
  });

  it("still accepts a raw string, so vanilla and other mods' flags keep working", () => {
    hasCountryFlag("some_vanilla_flag");
    const fromConfig: string = "computed_at_build_time";
    hasCountryFlag(fromConfig);
  });
});

describe("technology field widenings", () => {
  it("takes a tier as the integer modders actually write", () => {
    const def: TechnologyDef = { ...base, area: "physics", tier: 3 };
    void def;
  });

  it("takes one category or several", () => {
    const one: TechnologyDef = { ...base, area: "physics", category: "particles" };
    const many: TechnologyDef = { ...base, area: "physics", category: ["particles", "voidcraft"] };
    void one;
    void many;
  });
});

describe("scalar-or-block trigger overloads", () => {
  const war = eventTarget<"war">("mymod_war");

  it("takes either arm of has_resource", () => {
    hasResource(true);
    hasResource("sr_zro");
    hasResource({ id: "sr_zro" });
    hasResource({ type: "minor_artifacts", amount: [">=", 1000] });
  });

  it("rejects a block missing a required field", () => {
    // @ts-expect-error — the block arm needs an amount, and `{ type }` is no resource reference
    hasResource({ type: "minor_artifacts" });
  });

  it("rejects a value belonging to neither arm", () => {
    // @ts-expect-error — has_resource takes a resource, a bool, or its block
    hasResource(5);
  });

  it("keeps the intel_level enum closed on both arms", () => {
    intelLevel("high");
    intelLevel({ level: "high", system: eventTarget<"system">("mymod_system") });
    // @ts-expect-error — enum[intel_level] has five members and this is not one
    intelLevel("not_a_level");
  });

  it("keeps is_war_participant's scalar arm to scopes", () => {
    isWarParticipant(war);
    isWarParticipant({ war, side: "attackers" });
    // @ts-expect-error — the scalar arm is a scope value, never a bare word
    isWarParticipant("attackers");
  });
});

describe("open-keyed argument blocks", () => {
  const country = makeScope<"country">([]);

  it("takes any key the script invents, with the rules' value type", () => {
    country.setTradeConversions({ trade: 0.5, mymod_resource: "@share" });
    country.setCountryCodeFlags({ colonizer: true });
    country.addResourceFromDebris({ resources: { minerals: 1000 } });
  });

  it("keeps the map's value type", () => {
    // @ts-expect-error — value_set[country_flag] = bool takes a boolean, not "yes"
    country.setCountryCodeFlags({ colonizer: "yes" });
  });

  it("keeps a spliced map under its own member", () => {
    // @ts-expect-error — the resource map lives under `resources`, not at the top level
    country.addResourceFromDebris({ minerals: 1 });
  });

  it("keys an int-filtered map on numbers", () => {
    country.createLeader({
      class: "commander",
      traits: { entries: { 1: "leader_trait_eager", 2: "random_trait" } },
    });
    country.createLeader({
      class: "commander",
      // @ts-expect-error — `int = <trait.leader_trait>` is a numeric key filter,
      // and the game reads a word here as no level at all
      traits: { entries: { first: "random_trait" } },
    });
  });

  it("takes either arm of a scalar-or-map trigger field", () => {
    checkEconomicProductionModifierForJob({
      job: "researcher",
      resource: "minerals",
      value: 1,
    });
    checkEconomicProductionModifierForJob({
      job: "researcher",
      resource: { physics_research: [">", 0.5] },
      value: 1,
    });
    checkEconomicProductionModifierForJob({
      job: "researcher",
      // @ts-expect-error — the map's values are numbers, not words
      resource: { physics_research: "most" },
      value: 1,
    });
  });
});

import { describe, expectTypeOf, it } from "vitest";

import type { EdictRef, TechnologyRef } from "../src/generated/refs.ts";
import type { ScopeName } from "../src/generated/scopes.ts";
import type { TechnologyDef } from "../src/generated/technology.ts";
import { countryFlags, planetFlags, type CountryFlag } from "../src/generated/value-sets.ts";
import {
  anyTraitOfSpecies,
  hasCountryFlag,
  hasEdict,
  hasElectionType,
  hasPlanetFlag,
  numMoons,
  relativePower,
  type Trigger,
} from "../src/script/triggers.ts";

const base = {
  id: "mymod_tech_x",
  name: "X",
  cost: 100,
  tier: 1,
  category: "particles",
} as const;

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
  it("requires an operator on a comparison trigger", () => {
    numMoons("<", 4);
    // @ts-expect-error — num_moons is written `num_moons < 4`, so the operator is not optional
    numMoons(4);
  });

  it("closes the enum on a block trigger's field", () => {
    relativePower({ who: "root", category: "fleet", value: "superior" });
    // @ts-expect-error — "typo" is not in enum[relative_power_categories]
    relativePower({ who: "root", category: "typo", value: "superior" });
  });

  it("keeps a block trigger's required fields required", () => {
    // @ts-expect-error — `value` has cardinality 1..1
    relativePower({ who: "root" });
  });

  it("closes the enum on a scalar trigger", () => {
    hasElectionType("oligarchic");
    // @ts-expect-error — not an election type
    hasElectionType("monarchy_of_vibes");
  });
});

describe("scope brands from the game's documentation", () => {
  function countrySlot(_trigger: Trigger<"country">): void {}
  function federationSlot(_trigger: Trigger<"federation">): void {}
  function planetSlot(_trigger: Trigger<"planet">): void {}

  const anywhere = relativePower({ who: "root", value: "superior" });

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

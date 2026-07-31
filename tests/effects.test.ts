import { serialize, type PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { eventTarget, makeScope } from "../src/effect-core.ts";
import { countryFlags } from "../src/generated/value-sets.ts";
import { hasOwner, isAtWar } from "../src/triggers.ts";

const flags = countryFlags("effects_test_flag");
const stormWorld = eventTarget<"planet">("effects_test_target");

describe("the effect recorder over generated meta", () => {
  it("round-trips a closure through every meta shape", () => {
    const sink: PdxEntry[] = [];
    const country = makeScope<"country">(sink);

    country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
      planet.saveEventTargetAs(stormWorld);
      planet.destroyColony();
      planet.addModifier({ modifier: "terraforming_candidate", days: 360 });
    });
    country
      .if(isAtWar(), (c) => c.setCountryFlag(flags.effects_test_flag))
      .else((c) => c.log("peace held"));
    country.addResource({ resource: "influence", amount: 50 });

    expect(serialize(sink)).toBe(`every_owned_planet = {
	limit = {
		has_owner = yes
	}
	save_event_target_as = effects_test_target
	destroy_colony = yes
	add_modifier = {
		modifier = terraforming_candidate
		days = 360
	}
}

if = {
	limit = {
		is_at_war = yes
	}
	set_country_flag = effects_test_flag
}

else = {
	log = "peace held"
}

add_resource = {
	influence = 50
}
`);
  });

  it("records weighted arms with modifiers through randomList", () => {
    const sink: PdxEntry[] = [];
    const country = makeScope<"country">(sink);
    country.randomList([
      { weight: 60, do: (c) => c.setCountryFlag(flags.effects_test_flag) },
      {
        weight: 40,
        modifiers: [{ factor: 2, when: isAtWar() }],
        do: (c) => c.log("war doubles this arm"),
      },
    ]);

    expect(serialize(sink)).toBe(`random_list = {
	60 = {
		set_country_flag = effects_test_flag
	}
	40 = {
		modifier = {
			factor = 2
			is_at_war = yes
		}
		log = "war doubles this arm"
	}
}
`);
  });

  it("throws when effects are recorded between if chain links", () => {
    const sink: PdxEntry[] = [];
    const country = makeScope<"country">(sink);
    const chain = country.if(isAtWar(), () => {});
    country.log("interleaved");
    expect(() => chain.else(() => {})).toThrow(/between an if\(\) chain/);
  });

  it("throws on an effect name missing from the meta table", () => {
    const sink: PdxEntry[] = [];
    const scope = makeScope<"country">(sink) as unknown as { bogusEffect(): void };
    expect(() => scope.bogusEffect()).toThrow(/Unknown effect "bogusEffect"/);
  });
});

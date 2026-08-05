import { serialize, type PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { isAtWar } from "../../packages/sdk/src/script/triggers.ts";
import { makeScope } from "./effect-core.ts";
import { aftershock, humReturns } from "./probe.ts";

// The golden below was written BY HAND from the PDXScript the probe scenario
// should produce, before the recorder ran — the acceptance test is that the
// recorded closures round-trip to exactly this text.
const GOLDEN = `planet_event = {
	id = hello_probe.2
	title = hello_probe.2.name
	desc = hello_probe.2.desc
	is_triggered_only = yes
	immediate = {
		from = {
			add_resource = {
				influence = 50
			}
		}
	}
	option = {
		name = hello_probe.2.a
	}
}

country_event = {
	id = hello_probe.1
	title = hello_probe.1.name
	desc = hello_probe.1.desc
	is_triggered_only = yes
	immediate = {
		random_list = {
			60 = {
				set_country_flag = hg_heard_the_hum
			}
			40 = {
				modifier = {
					factor = 2
					is_at_war = yes
				}
				every_owned_planet = {
					limit = {
						has_owner = yes
					}
					save_event_target_as = hg_storm_world
					planet_event = {
						id = hello_probe.2
						days = 30
					}
				}
			}
		}
		if = {
			limit = {
				has_country_flag = hg_heard_the_hum
			}
			event_target:hg_storm_world = {
				add_deposit = d_minerals_1
			}
		}
		else = {
			log = "the hum went unheard"
		}
	}
	option = {
		name = hello_probe.1.a
	}
}
`;

describe("effects probe", () => {
  it("round-trips the recorded closures to the hand-written golden", () => {
    expect(serialize([aftershock.entry, humReturns.entry])).toBe(GOLDEN);
  });

  it("throws when effects are recorded between if chain links", () => {
    const sink: PdxEntry[] = [];
    const scope = makeScope<"country">(sink);
    const chain = scope.if(isAtWar(), () => {});
    scope.log("interleaved");
    expect(() => chain.else(() => {})).toThrow(/between an if\(\) chain/);
  });

  it("throws on an effect name missing from the meta table", () => {
    const sink: PdxEntry[] = [];
    const scope = makeScope<"country">(sink) as unknown as { bogusEffect(): void };
    expect(() => scope.bogusEffect()).toThrow(/Unknown effect "bogusEffect"/);
  });
});

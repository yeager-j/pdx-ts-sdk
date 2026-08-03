import { serialize, type PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { eventTarget, makeScope, recordEffects, scopeRef } from "../src/effect-core.ts";
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

  it("records the author-asserted target link", () => {
    const sink: PdxEntry[] = [];
    const situation = makeScope<"situation">(sink);
    situation.target<"country">((country) => {
      country.setCountryFlag(flags.effects_test_flag);
    });

    expect(serialize(sink)).toBe(`target = {
	set_country_flag = effects_test_flag
}
`);
  });

  it("records a scope link as a body-only block", () => {
    const sink: PdxEntry[] = [];
    const planet = makeScope<"planet">(sink);
    planet.owner((country) => {
      country.setCountryFlag(flags.effects_test_flag);
      country.addResource({ resource: "influence", amount: 10 });
    });

    expect(serialize(sink)).toBe(`owner = {
	set_country_flag = effects_test_flag
	add_resource = {
		influence = 10
	}
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

  it("keeps a hidden_effect's entries inside it, at the enclosing scope", () => {
    // `hidden_effect` changes no scope, so the closure gets the same scope
    // back. It takes one at all because the entries have to land inside the
    // block: the enclosing scope object writes to the enclosing block, which
    // is the whole difference between hiding an effect and not.
    const from = scopeRef<"planet">("from");
    const sink = recordEffects<"country">([], (country) => {
      country.log("shown");
      country.hiddenEffect((hidden) => {
        hidden.log("not shown");
        from.effects((planet) => planet.log("nested"));
      });
    });

    expect(serialize(sink)).toBe(`log = shown

hidden_effect = {
	log = "not shown"
	from = {
		log = nested
	}
}
`);
  });

  it("opens a ref's block where it is written, not where its scope object came from", () => {
    // The property the recording stack exists for. `from = { }` written inside
    // `every_owned_planet = { }` runs once per planet; at the top level it runs
    // once. Both are legal script and they mean different things, so the block
    // has to land where the author put the call — which is why the ref cannot
    // simply hold the sink it was created against.
    const from = scopeRef<"planet">("from");
    const sink = recordEffects<"country">([], (country) => {
      from.effects((planet) => planet.log("outer"));
      country.everyOwnedPlanet({ limit: hasOwner() }, () => {
        from.effects((planet) => planet.log("inner"));
      });
    });

    expect(serialize(sink)).toBe(`from = {
	log = outer
}

every_owned_planet = {
	limit = {
		has_owner = yes
	}
	from = {
		log = inner
	}
}
`);
  });

  it("throws when a ref is opened with no block to record into", () => {
    // Escaping the closure is the one way to reach this: nothing outside a
    // recording has a sink, and guessing one would silently drop the entries.
    expect(() => stormWorld.effects((planet) => planet.destroyColony())).toThrow(
      /outside any effect closure/
    );
  });

  it("opens a ref as a condition without any recording at all", () => {
    // The trigger side is a pure value, so it works anywhere — no sink, no
    // stack, nothing to escape from.
    expect(serialize([...stormWorld.trigger(hasOwner()).entries]))
      .toBe(`event_target:effects_test_target = {
	has_owner = yes
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

  it("throws on a randomList modifier's desc, which has no once-only point to register a key against", () => {
    // Modifier.desc is display text that content definitions auto-register
    // as localisation at define() time (see content.test.ts's monthly_progress
    // coverage). randomList/lockedRandomList/random run inside effect
    // closures with no stable definition id and no once-only guarantee — a
    // render() can be called more than once — so there is nowhere safe to
    // register a key, and modifierEntry refuses rather than silently writing
    // the author's display text as a script identifier.
    const sink: PdxEntry[] = [];
    const country = makeScope<"country">(sink);
    expect(() =>
      country.randomList([
        {
          weight: 40,
          modifiers: [{ factor: 2, desc: "This arm is favored during war.", when: isAtWar() }],
          do: () => {},
        },
      ])
    ).toThrow(/desc is only supported on modifiers inside a content definition's WeightBlock/);
  });
});

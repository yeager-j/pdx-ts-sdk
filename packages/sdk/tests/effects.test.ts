import { serialize, type PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import type { EffectPathOf } from "../src/generated/effects.ts";
import {
  ambientObjectFlags,
  armyFlags,
  countryFlags,
  megastructureFlags,
} from "../src/generated/value-sets.ts";
import {
  eventTarget,
  isEventFireKey,
  makeScope,
  recordEffects,
  scopeRef,
  scopeValue,
} from "../src/script/effects/recorder.ts";
import { hasOwner, isAtWar } from "../src/script/triggers.ts";

const flags = countryFlags("effects_test_flag");
const stormWorld = eventTarget<"planet">("effects_test_target");
const createdArmyFlags = armyFlags("effects_test_created_army");
const createdMegastructureFlags = megastructureFlags("effects_test_created_megastructure");

describe("the effect recorder over generated meta", () => {
  it("serializes a minimal ambient-object placement", () => {
    const sink: PdxEntry[] = [];
    const system = makeScope<"system">(sink);

    system.createAmbientObject({
      type: "effects_test_probe",
      location: scopeValue<"system">("this"),
    });

    expect(serialize(sink)).toBe(`create_ambient_object = {
	type = effects_test_probe
	location = this
}
`);
  });

  it("serializes a scaled explicit-location ambient object", () => {
    const sink: PdxEntry[] = [];
    const system = makeScope<"system">(sink);

    system.createAmbientObject({
      type: "effects_test_scaled_probe",
      location: scopeValue<"planet">("from"),
      scale: 2.5,
    });

    expect(serialize(sink)).toBe(`create_ambient_object = {
	type = effects_test_scaled_probe
	location = from
	scale = 2.5
}
`);
  });

  it("serializes 3D placement offsets and optional ambient-object flags", () => {
    const sink: PdxEntry[] = [];
    const system = makeScope<"system">(sink);

    system.createAmbientObject({
      type: "effects_test_wreck",
      location: scopeValue<"system">("this"),
      scale: 1.5,
      use3dLocation: true,
      entityOffset: { min: -2, max: 4 },
      entityOffsetAngle: { min: 15, max: 75 },
      entityOffsetHeight: { min: -1.5, max: 3.5 },
      baseAngleTowards: scopeValue<"country">("from"),
      entityFaceObject: scopeValue<"planet">("from"),
      entityScaleToSize: true,
      scriptedScale: "effects_test_scale",
      playAnimationOnce: true,
      target: scopeValue<"country">("root"),
      duration: 30,
      isWreck: true,
    });

    expect(serialize(sink)).toBe(`create_ambient_object = {
	type = effects_test_wreck
	location = this
	scale = 1.5
	use_3d_location = yes
	entity_offset = {
		min = -2
		max = 4
	}
	entity_offset_angle = {
		min = 15
		max = 75
	}
	entity_offset_height = {
		min = -1.5
		max = 3.5
	}
	base_angle_towards = from
	entity_face_object = from
	entity_scale_to_size = yes
	scripted_scale = effects_test_scale
	play_animation_once = yes
	duration = 30
	is_wreck = yes
	target = root
}
`);
  });

  it("records an inline effect in the pushed ambient-object scope", () => {
    const sink: PdxEntry[] = [];
    const system = makeScope<"system">(sink);
    const flags = ambientObjectFlags("effects_test_ambient_flag");

    system.createAmbientObject({
      type: "effects_test_effect_probe",
      effect: (ambient) => {
        ambient.setAmbientObjectFlag(flags.effects_test_ambient_flag);
      },
    });

    expect(serialize(sink)).toBe(`create_ambient_object = {
	type = effects_test_effect_probe
	effect = {
		set_ambient_object_flag = effects_test_ambient_flag
	}
}
`);
  });

  it("serializes a structured name with repeated variables in a pushed army scope", () => {
    const sink: PdxEntry[] = [];
    const planet = makeScope<"planet">(sink);

    planet.createArmy({
      name: {
        key: "effects_test_army_name",
        variableString: ["effects_test_first", "effects_test_second"],
      },
      owner: scopeValue<"country">("root"),
      type: "effects_test_army",
      species: "random",
      effect: (army) => army.setArmyFlag(createdArmyFlags.effects_test_created_army),
    });

    expect(serialize(sink)).toBe(`create_army = {
	name = {
		key = effects_test_army_name
		variable_string = effects_test_first
		variable_string = effects_test_second
	}
	owner = root
	type = effects_test_army
	species = random
	effect = {
		set_army_flag = effects_test_created_army
	}
}
`);
  });

  it("serializes every generated spawn-megastructure field and its pushed scope", () => {
    const sink: PdxEntry[] = [];
    const system = makeScope<"system">(sink);

    system.spawnMegastructure({
      type: "effects_test_megastructure",
      planet: scopeValue<"planet">("from"),
      coordsFrom: scopeValue<"system">("this"),
      name: { key: "effects_test_megastructure_name", variableString: ["effects_test_owner"] },
      orbitAngle: { min: 45, max: 90 },
      orbitDistance: "@effects_test_distance",
      owner: scopeValue<"country">("root"),
      graphicalCulture: "effects_test_graphical_culture",
      randomPos: false,
      initEffect: (megastructure) =>
        megastructure.setMegastructureFlag(
          createdMegastructureFlags.effects_test_created_megastructure
        ),
    });

    expect(serialize(sink)).toBe(`spawn_megastructure = {
	type = effects_test_megastructure
	planet = from
	coords_from = this
	name = {
		key = effects_test_megastructure_name
		variable_string = effects_test_owner
	}
	orbit_angle = {
		min = 45
		max = 90
	}
	orbit_distance = @effects_test_distance
	owner = root
	graphical_culture = effects_test_graphical_culture
	random_pos = no
	init_effect = {
		set_megastructure_flag = effects_test_created_megastructure
	}
}
`);
  });

  it("serializes every createPopGroup ethos arm and all generated fields", () => {
    const sink: PdxEntry[] = [];
    const planet = makeScope<"planet">(sink);

    planet.createPopGroup({ species: "effects_test_species", ethos: "random" });
    planet.createPopGroup({
      species: scopeValue<"species">("root"),
      ethos: scopeValue<"pop_group">("this"),
    });
    planet.createPopGroup({
      popGroup: scopeValue<"pop_group">("from"),
      ethos: scopeValue<"country">("root"),
    });
    planet.createPopGroup({
      species: scopeValue<"species">("root"),
      popGroup: scopeValue<"pop_group">("from"),
      ethos: { ethic: { id: "ethic_materialist" } },
      category: { id: "specialist" },
      size: "local_spent_biomass",
      random: "@effects_test_variance",
      growthCategory: "GROWTH_CAT_OTHER",
      effect: (popGroup) => popGroup.setPopGroupFlag("effects_test_created"),
    });

    expect(serialize(sink)).toBe(
      "create_pop_group = {\n" +
        "\tspecies = effects_test_species\n" +
        "\tethos = random\n" +
        "}\n" +
        "\n" +
        "create_pop_group = {\n" +
        "\tspecies = root\n" +
        "\tethos = this\n" +
        "}\n" +
        "\n" +
        "create_pop_group = {\n" +
        "\tpop_group = from\n" +
        "\tethos = root\n" +
        "}\n" +
        "\n" +
        "create_pop_group = {\n" +
        "\tspecies = root\n" +
        "\tpop_group = from\n" +
        "\tethos = {\n" +
        "\t\tethic = ethic_materialist\n" +
        "\t}\n" +
        "\tcategory = specialist\n" +
        "\tsize = local_spent_biomass\n" +
        "\trandom = @effects_test_variance\n" +
        "\tgrowth_category = GROWTH_CAT_OTHER\n" +
        "\teffect = {\n" +
        "\t\tset_pop_group_flag = effects_test_created\n" +
        "\t}\n" +
        "}\n"
    );
  });

  it("identifies generated event-fire effects without inferring their legal caller scopes", () => {
    expect(isEventFireKey("observer_event")).toBe(true);
    expect(isEventFireKey("country_event")).toBe(true);
    expect(isEventFireKey("event")).toBe(false);
    expect(isEventFireKey("set_country_flag")).toBe(false);
  });

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

  it("records event-chain counter operations through the hand-written counter contract", () => {
    const sink: PdxEntry[] = [];
    const country = makeScope<"country">(sink);

    country.addEventChainCounter({
      eventChain: "effects_test_chain",
      counter: "insights",
      amount: 1,
    });
    country.resetEventChainCounter({ eventChain: "effects_test_chain", counter: "insights" });

    expect(serialize(sink)).toBe(`add_event_chain_counter = {
	event_chain = effects_test_chain
	counter = insights
	amount = 1
}

reset_event_chain_counter = {
	event_chain = effects_test_chain
	counter = insights
}
`);
  });

  it("records a one-hop scope path", () => {
    const sink: PdxEntry[] = [];
    const planet = makeScope<"planet">(sink);
    planet.owner.effects((country) => {
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

  it("records a multi-hop path with one leaf closure", () => {
    const sink = recordEffects<"planet">([], (planet) => {
      planet.owner.capitalScope.effects((colony) => colony.destroyColony());
    });

    expect(serialize(sink)).toBe(`owner = {
	capital_scope = {
		destroy_colony = yes
	}
}
`);
  });

  it("composes hiddenEffect with scope links", () => {
    const sink = recordEffects<"planet">([], (planet) => {
      planet.hiddenEffect.owner.effects((country) => {
        country.setCountryFlag(flags.effects_test_flag);
      });
    });

    expect(serialize(sink)).toBe(`hidden_effect = {
	owner = {
		set_country_flag = effects_test_flag
	}
}
`);
  });

  it("opens an intermediate block for sibling effects before continuing a path", () => {
    const sink = recordEffects<"planet">([], (planet) => {
      planet.hiddenEffect.effects((planet) => {
        planet.log("also hidden");
        planet.owner.effects((country) => {
          country.setCountryFlag(flags.effects_test_flag);
        });
      });
    });

    expect(serialize(sink)).toBe(`hidden_effect = {
	log = "also hidden"
	owner = {
		set_country_flag = effects_test_flag
	}
}
`);
  });

  it("records nothing for an unterminated path", () => {
    const sink = recordEffects<"planet">([], (planet) => {
      void planet.hiddenEffect.owner;
      planet.log("shown");
    });

    expect(serialize(sink)).toBe("log = shown\n");

    const returned = recordEffects<"planet">([], (planet) => planet.owner);
    expect(returned).toEqual([]);
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
      country.hiddenEffect.effects((country) => {
        country.log("not shown");
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

  it("throws when an effect path outlives its recording", () => {
    let escaped: EffectPathOf<"country"> | undefined;
    recordEffects<"planet">([], (planet) => {
      escaped = planet.owner;
    });

    expect(() => escaped!.effects((country) => country.log("too late"))).toThrow(
      /already returned/
    );
  });

  it("refuses an async effect-path terminal closure", async () => {
    let continued = false;
    expect(() =>
      recordEffects<"planet">([], (planet) => {
        planet.owner.effects(async (country) => {
          country.log("before the await");
          await Promise.resolve();
          continued = true;
        });
      })
    ).toThrow(/returned a promise/);

    expect(continued).toBe(false);
    await Promise.resolve();
    expect(continued).toBe(true);
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

  it("writes an effect's ScriptValue argument bare, including a scripted-variable reference (widenedLowering, SDK-47 P1 fix)", () => {
    // change_variable's `value` is effects.cwt:1218's `value_field`, lowered
    // through the generic effect Proxy dispatcher (effect-meta.ts plus
    // scalar.ts's runtime `toScalar`), not through generated per-function
    // code the way triggers are — a separate code path from
    // resourceStockpilePercent's (triggers.test.ts) and modifierEntry's
    // (below), so each needs its own proof. A number keeps working
    // unchanged; `@my_value` used to come out wrongly quoted.
    const sink: PdxEntry[] = [];
    const country = makeScope<"country">(sink);
    country.changeVariable({ which: "effects_test_var", value: 5 });
    country.changeVariable({ which: "effects_test_var", value: "@my_value" });
    expect(serialize(sink)).toBe(
      "change_variable = {\n" +
        "\twhich = effects_test_var\n" +
        "\tvalue = 5\n" +
        "}\n" +
        "\n" +
        "change_variable = {\n" +
        "\twhich = effects_test_var\n" +
        "\tvalue = @my_value\n" +
        "}\n"
    );
  });

  it("refuses an async effect closure rather than recording half of it", async () => {
    // `(scope) => void` accepts an async function, and the promise used to be
    // discarded: everything before the first await recorded, the recording
    // ended there, and everything after it was lost. The build succeeded
    // anyway, with a partial mod and no diagnostic.
    //
    // The continuation deliberately touches nothing but a local: what is being
    // proven is that it runs *after* the recording is already closed, and
    // reaching for the scope there is the separate, already-guarded mistake
    // exercised below.
    let continued = false;
    expect(() =>
      recordEffects<"country">([], async (country) => {
        country.log("before the await");
        await Promise.resolve();
        continued = true;
      })
    ).toThrow(/returned a promise/);

    // Synchronous: the throw beat the continuation, so it lands on the stack
    // of the definition being authored rather than surfacing later with no
    // author frame in it.
    expect(continued).toBe(false);
    await Promise.resolve();
    expect(continued).toBe(true);
  });

  it("lets no unhandled rejection escape the closure it refused", async () => {
    // Refusing the promise is not the same as containing it: the continuation
    // still runs, still reaches for a recorder that is now dead, and still
    // rejects. With nothing attached that is an `unhandledRejection`, which by
    // default takes the process down — so a caller who caught the build error
    // this throws would have been killed moments later by the very failure
    // they caught.
    const escaped: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      escaped.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      expect(() =>
        recordEffects<"country">([], async (country) => {
          country.log("before the await");
          await Promise.resolve();
          // Rejects: the recording this scope object belongs to is closed.
          country.log("after the await");
        })
      ).toThrow(/returned a promise/);
      // Two macrotask turns: long enough for the continuation to run, reject,
      // and for Node to have decided the rejection was unhandled.
      await new Promise((resolve) => setTimeout(resolve, 10));
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(escaped).toEqual([]);
  });

  it("still catches async work a synchronous closure spawns, at the scope object", async () => {
    // The other half: a closure that stays synchronous but starts async work
    // returns undefined, so the promise check cannot see it. Liveness is what
    // catches this one — the scope object is dead by the time the continuation
    // reaches for it — and awaiting the spawned promise here is what keeps
    // that from being an unhandled rejection in this suite.
    let spawned: Promise<void> | undefined;
    recordEffects<"country">([], (country) => {
      country.log("recorded");
      spawned = (async () => {
        await Promise.resolve();
        country.log("too late");
      })();
    });
    await expect(spawned).rejects.toThrow(/already returned/);
  });

  it("leaves a closure that merely returns a value alone", () => {
    // Only thenables are refused. Returning a value from a void-typed closure
    // is harmless and ordinary — `(c) => c.log("x")` returns whatever `log`
    // returns — so punishing a non-promise return would break real authoring.
    const sink = recordEffects<"country">([], (country) => country.log("returned"));
    expect(serialize(sink)).toBe("log = returned\n");

    const objectReturn = recordEffects<"country">([], (country) => {
      country.log("also fine");
      return { then: "not a function" } as unknown as void;
    });
    expect(serialize(objectReturn)).toBe('log = "also fine"\n');
  });

  it("leaves nested synchronous closures alone", () => {
    const sink = recordEffects<"country">([], (country) => {
      country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
        planet.destroyColony();
      });
    });
    expect(serialize(sink)).toBe(`every_owned_planet = {
	limit = {
		has_owner = yes
	}
	destroy_colony = yes
}
`);
  });

  it("writes a Modifier row's ScriptValue operand bare, including a scripted-variable reference (widenedLowering, SDK-47 P1 fix)", () => {
    // Modifier<S> (script/effects/types.ts) is hand-written, not generated — its
    // `factor`/`add`/etc. operands are modifier_rule.cwt's `value_field`
    // (SDK-47's primary cited evidence), and modifierEntry is the third and
    // last runtime chokepoint that needed the scriptValueScalar fix. The
    // arm's own `weight` stays a plain `number` (RandomListArm is
    // hand-typed, not one of the fields SDK-47 touched) — only the row's
    // operand is a ScriptValue here.
    const sink: PdxEntry[] = [];
    const country = makeScope<"country">(sink);
    country.randomList([
      { weight: 40, modifiers: [{ factor: "@my_factor", when: isAtWar() }], do: () => {} },
    ]);
    expect(serialize(sink)).toBe(
      "random_list = {\n" +
        "\t40 = {\n" +
        "\t\tmodifier = {\n" +
        "\t\t\tfactor = @my_factor\n" +
        "\t\t\tis_at_war = yes\n" +
        "\t\t}\n" +
        "\t}\n" +
        "}\n"
    );
  });

  it("lowers rule-declared yes/no literal arms to booleans", () => {
    const sink: PdxEntry[] = [];
    const country = makeScope<"country">(sink);
    const planet = makeScope<"planet">(sink);

    country.setGovernmentCooldown("no");
    country.setGovernmentCooldown("default");
    country.setGovernmentCooldown(500);
    planet.removeDeposit("yes");
    country.changeDominantSpecies({ species: "species_test", changeAll: "yes" });
    country.log("yes");

    expect(serialize(sink)).toBe(`set_government_cooldown = no

set_government_cooldown = default

set_government_cooldown = 500

remove_deposit = yes

change_dominant_species = {
	species = species_test
	change_all = yes
}

log = "yes"
`);
  });
});

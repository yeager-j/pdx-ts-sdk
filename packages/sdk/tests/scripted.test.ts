/**
 * Scripted trigger and effect bindings, at runtime.
 *
 * Package-independent on purpose: `@pdx-ts/stellaris-ids` decides what names
 * and scopes *typecheck*, and nothing here. What the two halves of the surface
 * emit is one lowering shared between them, and this is where that is pinned.
 */

import { serialize, type PdxEntry } from "@pdx-ts/pdxscript";
import { explain, fixture } from "@pdx-ts/sdk-testing";
import { describe, expect, it } from "vitest";

import { EFFECT_META } from "../src/generated/effect-meta.ts";
import {
  and,
  createMod,
  eventTarget,
  makeScope,
  render,
  scriptedEffect,
  scriptedTrigger,
  vanilla,
  type ModConfig,
} from "../src/index.ts";

const CONFIG: ModConfig = {
  name: "Scripted",
  prefix: "sc",
  version: "1.0.0",
  supportedVersion: "4.4.*",
};
const mod = createMod(CONFIG);

function recorded(body: (scope: ReturnType<typeof makeScope<"country">>) => void): string {
  const sink: PdxEntry[] = [];
  body(makeScope<"country">(sink));
  return serialize(sink);
}

describe("lowering", () => {
  it("writes a parameterless call as `= yes`", () => {
    const isFallenEmpire = scriptedTrigger("is_fallen_empire", "country");
    expect(serialize([...isFallenEmpire().entries])).toBe("is_fallen_empire = yes\n");
  });

  it("writes an explicit `false` as `= no` (SDK-43)", () => {
    // `isMachineEmpire(false)` was a compile error while `isNomadic(false)`
    // compiled beside it — 7,746 negated scripted-trigger call sites in
    // vanilla against 23,174 affirmative ones, and nothing at the call site
    // told an author which form was legal.
    const isFallenEmpire = scriptedTrigger("is_fallen_empire", "country");
    expect(serialize([...isFallenEmpire(false).entries])).toBe("is_fallen_empire = no\n");
  });

  it("writes an explicit `true` byte-identical to the default", () => {
    const isFallenEmpire = scriptedTrigger("is_fallen_empire", "country");
    expect(serialize([...isFallenEmpire(true).entries])).toBe(
      serialize([...isFallenEmpire().entries])
    );
  });

  it("accepts the boolean form through `.unchecked` too, since the arity is unknown there either way", () => {
    const binding = scriptedTrigger.unchecked("some_scripted_trigger", "any");
    expect(serialize([...binding(false).entries])).toBe("some_scripted_trigger = no\n");
    expect(serialize([...binding(true).entries])).toBe("some_scripted_trigger = yes\n");
  });

  it("writes a parameterized call as a block of its arguments", () => {
    const canColonize = scriptedTrigger("can_colonize_planet_trigger", "planet");
    expect(serialize([...canColonize({ SCOPE: "root" }).entries])).toBe(
      "can_colonize_planet_trigger = {\n\tSCOPE = root\n}\n"
    );
  });

  it("writes an empty argument object as the parameterless form", () => {
    // `hasCrisisStage({})` asks for the game's own defaults, which the game
    // applies when the keys are absent — so the emitted call has to be the bare
    // one, not an empty block.
    const binding = scriptedTrigger.unchecked("has_crisis_stage", "any");
    expect(serialize([...binding({}).entries])).toBe("has_crisis_stage = yes\n");
  });

  it("drops a parameter given as undefined", () => {
    // `exactOptionalPropertyTypes` is off, so `{ STAGE: undefined }` typechecks.
    // An optional `$X|default$` parameter takes the game's default only when
    // the key is *absent*, so dropping it is both the correct semantics and
    // what keeps `undefined` out of the serializer.
    const binding = scriptedTrigger.unchecked("has_crisis_stage", "any");
    expect(serialize([...binding({ STAGE: undefined }).entries])).toBe("has_crisis_stage = yes\n");
  });

  it("lowers a boolean parameter to yes/no", () => {
    // Vanilla substitutes parameters into boolean slots at 120 call sites
    // (`give_tech_no_error_effect = { MESSAGE = no }` and a dozen others), so
    // `true` has to mean here what it means everywhere else in the SDK rather
    // than forcing the author to spell it `"yes"` in this one position.
    const binding = scriptedTrigger.unchecked("give_tech_no_error_effect", "country");
    expect(serialize([...binding({ MESSAGE: false, LOUD: true }).entries])).toBe(
      "give_tech_no_error_effect = {\n\tLOUD = yes\n\tMESSAGE = no\n}\n"
    );
  });

  it("unwraps branded references and scope references", () => {
    const binding = scriptedTrigger.unchecked("needs_resource", "country");
    const target = eventTarget<"planet">("colony");
    expect(
      serialize([...binding({ RESOURCE: vanilla.resource("energy"), WHERE: target }).entries])
    ).toBe("needs_resource = {\n\tRESOURCE = energy\n\tWHERE = event_target:colony\n}\n");
  });

  it("emits the same bytes for a trigger and an effect of the same name", () => {
    // The two halves share one lowering because the game's call shape is the
    // same for both. If that ever stops being true, this is what says so.
    const args = { A: 1, B: "two" };
    const asTrigger = serialize([...scriptedTrigger.unchecked("x", "any")(args).entries]);
    const asEffect = recorded((scope) => {
      scope.run(scriptedEffect.unchecked("x", "any")(args));
    });
    expect(asTrigger).toBe(asEffect);
  });
});

describe("emission order", () => {
  it("does not depend on the order the arguments were written", () => {
    // Parameters are a named set, not ordered author data, so reordering an
    // object literal must not move a byte. This is the emission-order rule of
    // `AGENTS.md` applied to the one construct SDK-13 adds, and the only thing
    // pinning the sort in `scriptedEntry`.
    const binding = scriptedTrigger.unchecked("x", "any");
    const forward = serialize([...binding({ ALPHA: 1, BETA: 2, GAMMA: 3 }).entries]);
    const reversed = serialize([...binding({ GAMMA: 3, BETA: 2, ALPHA: 1 }).entries]);
    expect(forward).toBe(reversed);
    expect(forward).toBe("x = {\n\tALPHA = 1\n\tBETA = 2\n\tGAMMA = 3\n}\n");
  });
});

describe("effects", () => {
  it("records a bound effect through `run`", () => {
    const setup = scriptedEffect.unchecked("prepare_home_system_effect", "country");
    const give = scriptedEffect.unchecked("give_ascension_perk_effect", "country");
    expect(
      recorded((scope) => {
        scope.run(setup());
        scope.run(give({ PERK: "ap_mind_over_matter" }));
      })
    ).toBe(
      "prepare_home_system_effect = yes\n\n" +
        "give_ascension_perk_effect = {\n\tPERK = ap_mind_over_matter\n}\n"
    );
  });

  it("records inside a nested effect block like any other effect", () => {
    const setup = scriptedEffect.unchecked("prepare_home_system_effect", "country");
    expect(
      recorded((scope) => {
        scope.if(scriptedTrigger("is_fallen_empire", "country")(), () => {
          scope.run(setup());
        });
      })
    ).toBe(
      "if = {\n\tlimit = {\n\t\tis_fallen_empire = yes\n\t}\n\tprepare_home_system_effect = yes\n}\n"
    );
  });

  it("does not shadow a generated effect", () => {
    // The recorder consults the hand-written `STRUCTURAL` table before the
    // generated one, so a name in both would silently take the wrong path.
    // The generated ownership policy keeps codegen off the name; this notices
    // if the generated meta table ever claims it too.
    expect(EFFECT_META["run"]).toBeUndefined();
  });
});

describe("the testing interpreter", () => {
  it("refuses a scripted trigger, and says why it always will", () => {
    // Deliberate, not a gap. The identifier package carries names, parameters
    // and scopes and never bodies — a licensing constraint the generator
    // enforces — so there is nothing here to evaluate, and guessing a verdict
    // is exactly the failure the whitelist exists to prevent.
    const world = fixture({ countries: [{ name: "player" }] }, { events: [] });
    expect(() =>
      explain(scriptedTrigger("is_fallen_empire", "country")(), world.country(0))
    ).toThrow(/never reads their bodies/);
  });
});

describe("in a built mod", () => {
  it("reaches the rendered files from a content field and an event", () => {
    const isFallenEmpire = scriptedTrigger("is_fallen_empire", "country");
    const technologies = mod.feature("scripted", [
      mod.technology("probe", {
        name: "Probe",
        area: "physics",
        tier: 1,
        category: "computing",
        potential: and(isFallenEmpire(), scriptedTrigger("is_regular_empire", "country")()),
      }),
    ]);
    expect(render(mod.compile([technologies])).get("common/technology/sc_scripted.txt")).toBe(
      "sc_tech_probe = {\n" +
        "\tarea = physics\n" +
        "\ttier = 1\n" +
        "\tcategory = { computing }\n" +
        "\tpotential = {\n" +
        "\t\tis_fallen_empire = yes\n" +
        "\t\tis_regular_empire = yes\n" +
        "\t}\n" +
        "}\n"
    );
  });
});

import { describe, expect, it } from "vitest";

import { LOCALIZATION_KEY_FAMILIES } from "../src/content/localization-families.ts";
import { CRISIS_PATH_FIELDS } from "../src/generated/crisis-path.ts";
import { createMod, render, type CrisisCurrencyLocalization } from "../src/index.ts";
import { vanilla } from "../src/stellaris.ts";

function capability(prefix = "crisis_loc") {
  return createMod({ name: "Crisis currency text", prefix, supportedVersion: "4.4.*" });
}

/** Every required member, with the placeholders the measured family expects. */
const COMPLETE_TEXT = {
  name: "Resolve:",
  value: "$VAL|0$",
  currentValue: "Current Value: $VALUE|0$",
  gaining: "Complete Archive Objectives to gain more Resolve.",
  crisisObjective: "Archive Objectives",
  crisisObjectiveGained: "Resolve gained",
  crisisObjectiveProgress: "We have gained $AMOUNT$ from this Archive Objective.",
  crisisObjectiveReward: "$REWARD$",
  crisisLevelLocked: "Required to unlock this level:",
  crisisLevelUnlocked: "At $LEVEL$, you get the rewards:",
  crisisLevelUnlock: "Has $CURRENCY$ Resolve",
  crisisLevelDesc: "Accumulate Resolve to advance.",
  crisisDescriptionTitle: "Keeper of the Archive",
  crisisDescription: "Every civilization the galaxy forgets, we remember.",
  crisisHowtoTitle: "Memory and Resolve",
  crisisHowto: "Pursuing Archive Objectives generates Resolve.",
} satisfies CrisisCurrencyLocalization;

const RESOURCE_ID = "crisis_loc_resource_resolve";
const PATH_ID = "crisis_loc_crisis_path_archive";
const ENGLISH = "localisation/english/crisis_loc_archive_l_english.yml";

/**
 * Renders a path over a resource this mod defines, so the derived keys carry
 * the resource id rather than the path's. The family is checked by the
 * definition walk, which runs during `compile`.
 */
function renderPath(localization: Readonly<Record<string, unknown>>) {
  const mod = capability();
  const resource = mod.resource("resolve", {
    name: "Resolve",
    category: "other",
    aiWeight: { weight: 1 },
  });
  const level = mod.crisisLevel("first", {
    name: "First",
    requiredCrisisCurrency: 0,
    perks: [],
    onUnlock: () => {},
  });
  const objective = mod.crisisObjective("survey", { name: "Survey", reward: { base: 10 } });
  const path = mod.crisisPath("archive", {
    crisisCurrency: { resource, localization } as never,
    levels: [level],
    objectives: [objective],
  });
  return render(mod.compile([mod.feature("archive", [resource, level, objective, path])]));
}

describe("localization key family tables", () => {
  it("names every member as the mechanical camelCase of its suffix", () => {
    for (const family of LOCALIZATION_KEY_FAMILIES.values()) {
      for (const member of family.members) {
        const camelCase = member.suffix
          .replace(/^_/, "")
          .replace(/_(.)/g, (_match, letter: string) => letter.toUpperCase());

        expect(member.member).toBe(camelCase);
      }
    }
  });

  it("resolves the family every generated field names", () => {
    const currency = CRISIS_PATH_FIELDS.find((field) => field.member === "crisisCurrency");

    expect(currency).toMatchObject({ shape: "value", localizationFamily: "crisis_currency" });
    expect(LOCALIZATION_KEY_FAMILIES.has("crisis_currency")).toBe(true);
  });
});

describe("crisis-currency localization family", () => {
  it("keys every member from the referenced resource id, not the path id", () => {
    const files = renderPath(COMPLETE_TEXT);
    const english = files.get(ENGLISH) ?? "";

    expect(english).toContain(` ${RESOURCE_ID}_name:0 "Resolve:"\n`);
    expect(english).toContain(` ${RESOURCE_ID}_crisis_howto:0 `);
    expect(english).not.toContain(`${PATH_ID}_name`);
    expect(
      new TextDecoder().decode(files.file("common/crisis_paths/crisis_loc_archive.txt")?.bytes())
    ).toContain(`crisis_currency = ${RESOURCE_ID}`);
  });

  it("registers the whole family, and fans a translated member into its language file", () => {
    const files = renderPath({
      ...COMPLETE_TEXT,
      crisisDescriptionIntro: "Long ago, it was foretold.",
      crisisObjective: { english: "Archive Objectives", french: "Objectifs d'archive" },
    });
    const english = files.get(ENGLISH) ?? "";
    const suffixes = [...english.matchAll(/^ crisis_loc_resource_resolve(\S*):0 /gm)].map(
      (match) => match[1]
    );

    // The emitted file sorts its keys; the family is complete rather than ordered.
    expect(new Set(suffixes)).toEqual(
      new Set([
        // The resource's own name key, which `ResourceDef` already generates.
        "",
        "_name",
        "_value",
        "_current_value",
        "_gaining",
        "_crisis_objective",
        "_crisis_objective_gained",
        "_crisis_objective_progress",
        "_crisis_objective_reward",
        "_crisis_level_locked",
        "_crisis_level_unlocked",
        "_crisis_level_unlock",
        "_crisis_level_desc",
        "_crisis_description_title",
        "_crisis_description_intro",
        "_crisis_description",
        "_crisis_howto_title",
        "_crisis_howto",
      ])
    );
    expect(files.get("localisation/french/crisis_loc_archive_l_french.yml")).toBe(
      `﻿l_french:\n ${RESOURCE_ID}_crisis_objective:0 "Objectifs d'archive"\n`
    );
  });

  it("localizes a vanilla currency's family under the vanilla id", () => {
    const mod = capability();
    const level = mod.crisisLevel("first", {
      name: "First",
      requiredCrisisCurrency: 0,
      perks: [],
      onUnlock: () => {},
    });
    const objective = mod.crisisObjective("survey", { name: "Survey", reward: { base: 10 } });
    const path = mod.crisisPath("menace_retext", {
      crisisCurrency: { resource: vanilla.resource("menace"), localization: COMPLETE_TEXT },
      levels: [level],
      objectives: [objective],
    });
    const files = render(mod.compile([mod.feature("retext", [level, objective, path])]));

    expect(files.get("localisation/english/crisis_loc_retext_l_english.yml")).toContain(
      ' menace_crisis_howto_title:0 "Memory and Resolve"\n'
    );
  });

  it("leaves a bare reference and a raw string untouched", () => {
    const mod = capability();
    const level = mod.crisisLevel("first", {
      name: "First",
      requiredCrisisCurrency: 0,
      perks: [],
      onUnlock: () => {},
    });
    const objective = mod.crisisObjective("survey", { name: "Survey", reward: { base: 10 } });
    const branded = mod.crisisPath("branded", {
      crisisCurrency: vanilla.resource("menace"),
      levels: [level],
      objectives: [objective],
    });
    const raw = mod.crisisPath("raw", {
      crisisCurrency: "third_party_currency",
      levels: [level],
      objectives: [objective],
    });
    const files = render(mod.compile([mod.feature("bare", [level, objective, branded, raw])]));
    const emitted = new TextDecoder().decode(
      files.file("common/crisis_paths/crisis_loc_bare.txt")?.bytes()
    );

    expect(emitted).toContain("crisis_currency = menace");
    expect(emitted).toContain("crisis_currency = third_party_currency");
    expect(files.get("localisation/english/crisis_loc_bare_l_english.yml") ?? "").not.toContain(
      "menace_name"
    );
  });

  it("refuses a family missing a required member", () => {
    const { crisisHowto: _omitted, ...partial } = COMPLETE_TEXT;

    expect(() => renderPath(partial)).toThrow(
      `crisis_path.crisis_currency for "${PATH_ID}" is missing required localization ` +
        `"crisisHowto". The game reads "${RESOURCE_ID}_crisis_howto" from the resource id, ` +
        "and shows the raw key when it is absent."
    );
  });

  it("refuses a resource supplied without any family text", () => {
    expect(() => renderPath(undefined as never)).toThrow(
      `crisis_path.crisis_currency for "${PATH_ID}" supplies a resource without its ` +
        '"localization" text'
    );
  });

  it("refuses a bundle whose resource is absent", () => {
    const mod = capability();
    const level = mod.crisisLevel("first", {
      name: "First",
      requiredCrisisCurrency: 0,
      perks: [],
      onUnlock: () => {},
    });
    const objective = mod.crisisObjective("survey", { name: "Survey", reward: { base: 10 } });
    const path = mod.crisisPath("archive", {
      crisisCurrency: { resource: undefined, localization: COMPLETE_TEXT } as never,
      levels: [level],
      objectives: [objective],
    });

    expect(() => mod.compile([mod.feature("archive", [level, objective, path])])).toThrow(
      `crisis_path.crisis_currency for "${PATH_ID}" supplies a bundle whose "resource" names nothing`
    );
  });

  it("refuses a member missing a placeholder the game substitutes", () => {
    expect(() => renderPath({ ...COMPLETE_TEXT, currentValue: "Current Value: none" })).toThrow(
      `crisis_path.crisis_currency for "${PATH_ID}" "currentValue" is missing "$VALUE$" in ` +
        'english. The game substitutes "$VALUE$" into this text, and shows nothing in their ' +
        "place when they are absent."
    );
    expect(() =>
      renderPath({ ...COMPLETE_TEXT, crisisLevelUnlocked: "You get the rewards:" })
    ).toThrow('"crisisLevelUnlocked" is missing "$LEVEL$" in english');
  });

  it("checks every supplied language, not only english", () => {
    expect(() =>
      renderPath({ ...COMPLETE_TEXT, value: { english: "$VAL|0$", french: "aucune valeur" } })
    ).toThrow('"value" is missing "$VAL$" in french');
  });

  // Vanilla writes tokens of its own that no family table names —
  // `menace_crisis_description` opens with `$menace_crisis_description_intro$`
  // — so an extra token is text the author meant, not a misspelling.
  it("accepts placeholders the family does not name", () => {
    const files = renderPath({
      ...COMPLETE_TEXT,
      crisisDescription: `$${RESOURCE_ID}_crisis_description_title$ endures.`,
    });

    expect(files.get(ENGLISH)).toContain(
      ` ${RESOURCE_ID}_crisis_description:0 "$${RESOURCE_ID}_crisis_description_title$ endures."\n`
    );
  });

  it("refuses a key reference and a key pin in a family member", () => {
    const reference = capability().localization("ELSEWHERE", "Elsewhere");

    expect(() => renderPath({ ...COMPLETE_TEXT, gaining: reference })).toThrow(
      "A localization reference"
    );
    expect(() =>
      renderPath({ ...COMPLETE_TEXT, gaining: { english: "Gain more.", key: "GAINING" } })
    ).toThrow('sets "key", but its localization key is always');
  });
});

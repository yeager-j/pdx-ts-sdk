/**
 * The differential oracle: parse every vanilla common/ file with BOTH this
 * parser and jomini (Rust/WASM, battle-tested for years) and compare
 * normalized trees. Fixpoint proves self-consistency; agreement with an
 * independent implementation is what proves we read files the way the game
 * does. Runs only where the install exists.
 *
 * Both sides are mapped into a common normal form. Known representation
 * divergences, normalized deliberately (each verified by hand):
 * - jomini decodes `\"` escapes; we keep raw content → unescape ours.
 * - jomini narrows quoted numerics; numeric-looking strings compare
 *   numerically on both sides.
 * - jomini drops empty anonymous containers → filter ours before compare.
 * - jomini wraps comparison entries ({LESS_THAN: n}); headers are plain
 *   one-key objects; params are "[X]"/"[!X]" keys.
 * - jomini cannot parse top-level bare-scalar files (job_tags etc.) → those
 *   files are pinned below, not skipped silently.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { parse } from "../src/index.ts";
import { normJominiBody, normOurs, type Norm } from "./jomini-normalize.ts";

const STELLARIS_DIR = join(
  process.env["HOME"] ?? "",
  "Library/Application Support/Steam/steamapps/common/Stellaris"
);
const COMMON = join(STELLARIS_DIR, "common");

const NOT_PDXSCRIPT = new Set(["HOW_TO_MAKE_NEW_SHIPS.txt", "99_README_EDICTS.txt"]);

// Files jomini's text parser rejects but the game (and this parser) accepts.
// Each rejection was reproduced minimally and is jomini's limitation:
// top-level bare scalar lists (tag files), a top-level anonymous container
// (gamesetup), a comment-only file (starbase example), tab between key and
// `=` (`a\t= 4` errors, `a = 4` works — the two scripted_variables files
// use tab alignment), and `@\[ ... ]` escaped inline math (the seven
// scripted_effects files).
const JOMINI_CANNOT_PARSE = [
  "component_tags/00_tags.txt",
  "gamesetup_settings/gamesetup_settings.txt",
  "job_tags/00_tags.txt",
  "scripted_effects/00_scripted_effects.txt",
  "scripted_effects/archaeology_event_effects.txt",
  "scripted_effects/astral_planes_effects.txt",
  "scripted_effects/astral_rift_effects.txt",
  "scripted_effects/espionage_event_effects.txt",
  "scripted_effects/first_contact_effects.txt",
  "scripted_effects/nomads_effects.txt",
  "scripted_effects/shroud_shadows_scripted_effects.txt",
  "scripted_variables/01_scripted_variables_jobs.txt",
  "scripted_variables/05_scripted_variables_first_contact_dlc.txt",
  "starbase_modules/00_example.txt",
  "trait_tags/00_tags.txt",
];

// Files where the two parsers disagree and the divergence was traced to a
// jomini defect (each reproduced minimally; our reading is the one the game
// exhibits):
// - Comment-terminates-at-tab: jomini ends `#` comment handling at a tab
//   character, leaking the rest of the comment line as tokens
//   (`#\thello` errors; `# in\t00_planet_classes` leaks the trailing token).
//   All the planet_classes / scripted_effects / scripted_triggers /
//   starbase_modules entries below are this.
// - Tab between key and `=` mangles instead of erroring
//   (`@stage_1_research_bonus\t= 100` → a single garbage `= = 100` entry):
//   megastructures/03_think_tank.txt.
// - Mixed-container fusion: a bare scalar item followed by an entry fuses
//   into one pair (`{ OR = {..} tech_zero_point_power OR = {..} }` reads as
//   `tech_zero_point_power = OR {..}`, losing a prerequisite):
//   technology/00_megastructures.txt.
const JOMINI_MISREADS = [
  "megastructures/03_think_tank.txt",
  "planet_classes/00_planet_classes.txt",
  "planet_classes/00_planet_classes_first_contact_dlc.txt",
  "planet_classes/00_planet_classes_leviathans.txt",
  "scripted_effects/02_machine_age_effects.txt",
  "scripted_effects/federations_event_effects.txt",
  "scripted_effects/first_contact_dlc_effects.txt",
  "scripted_effects/marauder_scripted_effects.txt",
  "scripted_effects/mercenary_fleet_effects.txt",
  "scripted_effects/pirate_fleet_effects.txt",
  "scripted_effects/prethoryn_fleet_effects.txt",
  "scripted_triggers/00_scripted_triggers.txt",
  "starbase_modules/00_waystation_modules.txt",
  "technology/00_megastructures.txt",
];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (name.endsWith(".txt")) {
      files.push(path);
    }
  }
  return files;
}

describe.skipIf(!existsSync(COMMON))("jomini differential (non-gating)", () => {
  it("agrees with jomini on every vanilla common/ file", async () => {
    const { Jomini } = await import("jomini");
    const jomini = await Jomini.initialize();

    const files = walk(COMMON).filter(
      (path) => !NOT_PDXSCRIPT.has(relative(COMMON, path).split("/").pop()!)
    );
    const jominiRejected: string[] = [];
    const mismatched: string[] = [];
    let compared = 0;

    for (const path of files) {
      const name = relative(COMMON, path);
      const source = readFileSync(path, "utf8");
      const ours = normOurs(parse(source, name).items);

      let theirs: Norm[];
      try {
        const json = jomini.parseText(source, {}, (q) =>
          q.json({ duplicateKeyMode: "key-value-pairs" })
        );
        theirs = normJominiBody(JSON.parse(json) as Record<string, unknown>);
      } catch {
        jominiRejected.push(name);
        continue;
      }

      compared += 1;
      try {
        expect(ours, name).toEqual(theirs);
      } catch {
        mismatched.push(name);
      }
    }

    expect(compared).toBeGreaterThan(500);
    expect(mismatched.sort()).toEqual(JOMINI_MISREADS);
    expect(jominiRejected.sort()).toEqual(JOMINI_CANNOT_PARSE);
  });
});

/**
 * The event recipe's slice of the matrix, parameterized by visibility.
 *
 * The event recipe is the wide one — two visibilities against four kinds — so
 * its eight variants split into two test files, one per visibility, each
 * calling this. Within a file, one golden project hosts all four kinds: every
 * variant derives the same basename from the canonical name, so placing a
 * variant swaps the one content file and the harness's incremental typecheck
 * re-checks only it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATALOG } from "../../src/catalog/index.ts";
import { EVENT_KIND_CHOICES } from "../../src/catalog/recipes/event.ts";
import type { GeneratedFeatureSource } from "../../src/catalog/types.ts";
import { createGoldenProject, type GoldenProject } from "./golden-project.ts";
import {
  COMPILER_TIMEOUT,
  compileUncommented,
  describeSource,
  expectRefused,
  expectTypechecks,
  freshOut,
  MATERIALIZATION_MANIFEST,
  NAMES,
  PREFIX,
  STEM,
} from "./matrix.ts";

export type Visibility = "visible" | "hidden";

const KINDS = ["country", "planet", "ship", "fleet"] as const;

/** The script effect each kind's own flag effect has to emit. */
const FLAG_EFFECTS = {
  country: "set_country_flag",
  planet: "set_planet_flag",
  ship: "set_ship_flag",
  fleet: "set_fleet_flag",
} as const;

/** Everything a window needs, and everything a hidden event must not carry. */
const WINDOW_FIELDS = ["title", "desc", "picture", "showSound", "options"] as const;

export function describeEventMatrix(visibility: Visibility): void {
  const generateKind = (kind: (typeof KINDS)[number]): GeneratedFeatureSource =>
    CATALOG.generate({
      recipeId: "event",
      names: NAMES,
      answers: { visibility, "event-kind": kind },
    });

  describe.each(KINDS.map((kind) => [kind] as const))(
    `event, answering visibility=${visibility} event-kind=%s`,
    (kind) => {
      const generate = (): GeneratedFeatureSource => generateKind(kind);
      const generated = generate();

      describeSource(`recipes/event/${visibility}-${kind}.ts`, generate);

      it.each(WINDOW_FIELDS)("writes %s only when the event has a window", (field) => {
        // The comment form counts too. "Structurally absent" means an author
        // reading the hidden variant is never shown a window field at all, not
        // even one commented out — an example that cannot be taken up is worse
        // than no example.
        const written = new RegExp(String.raw`^\s*(?:// )?${field}:`, "m").test(generated.contents);
        expect(written).toBe(visibility === "visible");
      });
    }
  );

  describe(`event visibility=${visibility}, in one real project`, () => {
    let project: GoldenProject;

    beforeAll(() => {
      project = createGoldenProject();
    }, COMPILER_TIMEOUT);

    afterAll(() => project?.dispose());

    describe.each(KINDS.map((kind) => [kind] as const))("event-kind=%s", (kind) => {
      const generated = generateKind(kind);

      beforeAll(() => {
        freshOut(project);
        project.place(generated.basename, generated.contents);
      });

      it(
        "typechecks against the real SDK surface",
        () => {
          expectTypechecks(project);
        },
        COMPILER_TIMEOUT
      );

      it(
        "builds, and emits the kind's own event with the kind's own effect",
        () => {
          const result = project.build();
          expect(result.status, result.output).toBe(0);

          const events = `events/${PREFIX}_${STEM}.txt`;
          const localization = `localisation/english/${PREFIX}_${STEM}_l_english.yml`;
          // No window, no localized text, so no localization file at all. That
          // absence is the structural proof the window fields are gone rather
          // than merely emitted empty.
          expect(project.outFiles()).toEqual(
            visibility === "visible"
              ? [MATERIALIZATION_MANIFEST, "descriptor.mod", events, localization]
              : [MATERIALIZATION_MANIFEST, "descriptor.mod", events]
          );

          const eventsOut = project.readOut(events);
          expect(eventsOut).toContain(`namespace = ${PREFIX}_${STEM}`);
          expect(eventsOut).toContain(`${EVENT_KIND_CHOICES[kind]} = {`);
          expect(eventsOut).toContain(`id = ${PREFIX}_${STEM}.1`);
          expect(eventsOut).toContain("is_triggered_only = yes");
          // The one line that differs per kind, which is the whole point of
          // the `event-kind` question. The flag carries the mod prefix because
          // flag names are shared with every other mod the player has loaded,
          // and the prefix reaches the emitted string through `mod.config` —
          // so this also proves that interpolation survives the build.
          expect(eventsOut).toContain(`${FLAG_EFFECTS[kind]} = ${PREFIX}_${STEM}_fired`);

          if (visibility === "visible") {
            expect(eventsOut).toContain(`title = ${PREFIX}_${STEM}.1.name`);
            expect(eventsOut).toContain(`desc = ${PREFIX}_${STEM}.1.desc`);
            expect(eventsOut).toContain("picture = GFX_evt_mysterious_signal");
            expect(eventsOut).toContain("show_sound = event_alien_signal");
            expect(eventsOut).toContain("option = {");
            expect(eventsOut).not.toContain("hide_window");
            expect(project.readOut(localization)).toContain("PLACEHOLDER:");
          } else {
            expect(eventsOut).toContain("hide_window = yes");
            expect(eventsOut).toContain("immediate = {");
            expect(eventsOut).not.toContain("title");
            expect(eventsOut).not.toContain("desc");
            expect(eventsOut).not.toContain("option");
            expect(eventsOut).not.toContain("picture");
            expect(eventsOut).not.toContain("show_sound");
          }
        },
        COMPILER_TIMEOUT
      );
    });

    it.each(KINDS.map((kind) => [kind] as const))(
      "the commented examples compile as written for event-kind=%s, once their `// ` is removed",
      (kind) => {
        // A hidden event has no window, so the active media fields are absent.
        // The field gate above proves this is structural rather than accidental.
        compileUncommented(project, generateKind(kind), ["fireOnlyOnce"]);
      },
      COMPILER_TIMEOUT
    );

    if (visibility === "visible") {
      it(
        "the compiler gate fails on an effect the selected event kind does not put in scope",
        () => {
          // The direct proof that the `event-kind` answer really fixes the root
          // callback scope: `setCountryFlag` is a perfectly real effect, and it
          // is simply not one a ship can record.
          expectRefused(
            project,
            generateKind("ship"),
            "ship.setShipFlag(",
            "ship.setCountryFlag(",
            "setCountryFlag"
          );
        },
        COMPILER_TIMEOUT
      );
    }
  });
}

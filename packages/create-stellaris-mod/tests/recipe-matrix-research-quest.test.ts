/**
 * The research-quest recipe's slice of the matrix — see `recipe-matrix.test.ts`
 * for what the matrix as a whole proves and how it is split.
 *
 * One golden project hosts both variants and every compiler run: the variants
 * derive the same basename, so each placement swaps the one feature file and
 * the harness's incremental typecheck re-checks only it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATALOG } from "../src/catalog/index.ts";
import type { GeneratedFeatureSource } from "../src/catalog/types.ts";
import { createGoldenProject, type GoldenProject } from "./helpers/golden-project.ts";
import {
  COMPILER_TIMEOUT,
  compileUncommented,
  describeSource,
  expectRefused,
  expectTypechecks,
  freshOut,
  MATERIALIZATION_MANIFEST,
  NAME,
  NAMES,
  PREFIX,
  STEM,
} from "./helpers/matrix.ts";

const QUEST_VARIANTS = [["one"], ["two"]] as const;

const generateProjects = (projects: "one" | "two"): GeneratedFeatureSource =>
  CATALOG.generate({ recipeId: "research-quest", names: NAMES, answers: { projects } });

describe.each(QUEST_VARIANTS)("research-quest, answering projects=%s", (projects) => {
  describeSource(`recipes/research-quest/${projects}.ts`, () => generateProjects(projects));
});

describe("research-quest, in one real project", () => {
  let project: GoldenProject;

  beforeAll(() => {
    project = createGoldenProject();
  }, COMPILER_TIMEOUT);

  afterAll(() => project?.dispose());

  describe.each(QUEST_VARIANTS)("projects=%s", (projects) => {
    const generated = generateProjects(projects);

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
      "builds, and emits every coordinated registry file",
      () => {
        const result = project.build();
        expect(result.status, result.output).toBe(0);

        const chain = `common/event_chains/${PREFIX}_${STEM}.txt`;
        const onActions = `common/on_actions/${PREFIX}_on_actions.txt`;
        const specialProjects = `common/special_projects/${PREFIX}_${STEM}.txt`;
        const events = `events/${PREFIX}_${STEM}.txt`;
        const localization = `localisation/english/${PREFIX}_${STEM}_l_english.yml`;
        expect(project.outFiles()).toEqual([
          MATERIALIZATION_MANIFEST,
          chain,
          onActions,
          specialProjects,
          "descriptor.mod",
          events,
          localization,
        ]);

        expect(project.readOut(chain)).toContain(`${PREFIX}_event_chain_${STEM}`);

        const projectsOut = project.readOut(specialProjects);
        if (projects === "one") {
          expect(projectsOut).toContain(`key = ${PREFIX}_special_project_${STEM}\n`);
          expect(projectsOut).not.toContain("same_option_group_as");
        } else {
          expect(projectsOut).toContain(`key = ${PREFIX}_special_project_${STEM}_1`);
          expect(projectsOut).toContain(`key = ${PREFIX}_special_project_${STEM}_2`);
          expect(projectsOut).toContain(
            `same_option_group_as = { ${PREFIX}_special_project_${STEM}_1 }`
          );
        }

        const eventsOut = project.readOut(events);
        expect(eventsOut).toContain(`namespace = ${PREFIX}_${STEM}`);
        expect(eventsOut).toContain(`id = ${PREFIX}_${STEM}.1`);
        expect(eventsOut).toContain(`id = ${PREFIX}_${STEM}.2`);
        if (projects === "one") {
          expect(eventsOut).not.toContain(`id = ${PREFIX}_${STEM}.3`);
        } else {
          expect(eventsOut).toContain(`id = ${PREFIX}_${STEM}.3`);
        }
        expect(eventsOut).toContain("is_triggered_only = yes");
        expect(eventsOut.match(/picture = GFX_evt_mysterious_signal/g)).toHaveLength(
          projects === "one" ? 2 : 3
        );
        expect(eventsOut.match(/show_sound = event_alien_signal/g)).toHaveLength(
          projects === "one" ? 2 : 3
        );
        expect(eventsOut).toContain(`begin_event_chain`);
        expect(eventsOut).toContain(`end_event_chain = ${PREFIX}_event_chain_${STEM}`);

        const onActionsOut = project.readOut(onActions);
        expect(onActionsOut).toContain("on_game_start_country");
        expect(onActionsOut).toContain(`${PREFIX}_${STEM}.1`);

        const localizationOut = project.readOut(localization);
        expect(localizationOut).toContain(NAME);
        expect(localizationOut).toContain("PLACEHOLDER:");
      },
      COMPILER_TIMEOUT
    );
  });

  it.each(QUEST_VARIANTS)(
    "the commented examples compile as written for projects=%s, once their `// ` is removed",
    (projects) => {
      compileUncommented(project, generateProjects(projects), ["timelimit"]);
    },
    COMPILER_TIMEOUT
  );

  it(
    "the compiler gate fails on a generated research-quest call the SDK would refuse",
    () => {
      // The same control as the Item recipes': this file coordinates several
      // registries, so this proves the compiler sees that file too.
      expectRefused(
        project,
        generateProjects("two"),
        'eventScope: "country_event"',
        'eventScope: "cabbage_event"',
        "cabbage_event"
      );
    },
    COMPILER_TIMEOUT
  );
});

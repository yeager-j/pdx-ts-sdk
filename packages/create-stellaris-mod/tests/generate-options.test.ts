/**
 * Two-phase parsing, and the three places an answer can come from.
 *
 * Parsing is two phases because recipe flags are dynamic: `--visibility` is a
 * flag only once the recipe is known, and which recipe that is depends on a
 * positional in the same argv. So phase one takes the command's own flags and
 * keeps everything else, and phase two checks the leftovers against the
 * questions the resolved recipe actually asks.
 *
 * The technology recipe asks nothing, so the question machinery is exercised
 * here against synthetic questions — the same way `catalog.test.ts` tests the
 * catalog protocol. The transcripts cover what a real recipe reaches today.
 */

import { describe, expect, it } from "vitest";

import type { ChoiceQuestion } from "../src/catalog/types.ts";
import { resolveAnswers } from "../src/commands/generate.ts";
import { OptionsError, parseGenerateArgv, parseRecipeFlags } from "../src/options.ts";
import { capture } from "./helpers/capture.ts";
import { fakeTerminal } from "./helpers/terminal.ts";

const QUESTIONS: readonly ChoiceQuestion[] = [
  {
    key: "visibility",
    prompt: "Visible or hidden?",
    choices: [
      { value: "visible", label: "Visible", help: "A window the player answers" },
      { value: "hidden", label: "Hidden" },
    ],
    defaultValue: "visible",
    help: "Whether the event draws a window.",
  },
  {
    key: "event-kind",
    prompt: "Which scope?",
    choices: [
      { value: "country", label: "Country" },
      { value: "planet", label: "Planet" },
    ],
    defaultValue: "country",
    help: "The root scope of the event.",
  },
];

describe("phase one", () => {
  it("takes the recipe, the name, and the command's own flags", () => {
    const parsed = parseGenerateArgv([
      "technology",
      "Resonance Theory",
      "--cwd",
      "/tmp/project",
      "--yes",
      "--dry-run",
      "--allow-unsupported-sdk",
    ]);
    expect(parsed).toMatchObject({
      recipeId: "technology",
      name: "Resonance Theory",
      cwd: "/tmp/project",
      yes: true,
      dryRun: true,
      allowUnsupportedSdk: true,
      rest: [],
    });
  });

  it("keeps an unrecognized flag and the word after it, whichever order they came in", () => {
    // Phase one cannot know whether `--visibility` takes a value, so it keeps
    // the following word too — which is what makes both spellings mean the
    // same thing.
    const before = parseGenerateArgv(["event", "--visibility", "hidden", "Signal"]);
    const after = parseGenerateArgv(["event", "Signal", "--visibility", "hidden"]);
    expect(before.rest).toEqual(["--visibility", "hidden"]);
    expect(after.rest).toEqual(["--visibility", "hidden"]);
    expect(before.recipeId).toBe("event");
    expect(before.name).toBe("Signal");
    expect(after).toEqual(before);
  });

  it("does not swallow a following flag as an unknown flag's value", () => {
    expect(parseGenerateArgv(["event", "X", "--visibility", "--yes"]).rest).toEqual([
      "--visibility",
    ]);
  });

  it("takes an inline value, and the short spellings", () => {
    expect(parseGenerateArgv(["--cwd=/tmp/x"]).cwd).toBe("/tmp/x");
    expect(parseGenerateArgv(["-y"]).yes).toBe(true);
    expect(parseGenerateArgv(["-h"]).help).toBe(true);
    expect(parseGenerateArgv(["-v"]).version).toBe(true);
  });

  it("takes a name that looks like a flag after --", () => {
    const parsed = parseGenerateArgv(["technology", "--", "--yes"]);
    expect(parsed.name).toBe("--yes");
    expect(parsed.yes).toBe(false);
  });

  it.each([
    [["technology", "A", "B"], /got 3 arguments/],
    [["--yes", "--yes"], /--yes was given twice/],
    [["--cwd"], /--cwd needs a value/],
    [["--yes=false"], /--yes takes no value/],
  ])("refuses %o", (argv, pattern) => {
    expect(() => parseGenerateArgv(argv)).toThrow(OptionsError);
    expect(() => parseGenerateArgv(argv)).toThrow(pattern);
  });
});

describe("phase two", () => {
  const parse = (rest: readonly string[]) => parseRecipeFlags(rest, "event", QUESTIONS);

  it("returns only the answers that were supplied", () => {
    expect([...parse(["--visibility", "hidden"])]).toEqual([["visibility", "hidden"]]);
    expect([...parse([])]).toEqual([]);
    expect([...parse(["--event-kind=planet", "--visibility", "visible"])]).toEqual([
      ["event-kind", "planet"],
      ["visibility", "visible"],
    ]);
  });

  it.each([
    [["--area", "physics"], /has no --area flag/],
    [["--visibility"], /--visibility needs a value: visible, hidden/],
    [["--visibility", "hidden", "--visibility", "visible"], /given twice/],
    [["--visibility", "sideways"], /is not one of event's answers/],
    [["particles"], /which is neither a flag nor/],
  ])("refuses %o", (rest, pattern) => {
    expect(() => parse(rest)).toThrow(OptionsError);
    expect(() => parse(rest)).toThrow(pattern);
  });

  it("says what the recipe does take", () => {
    expect(() => parse(["--area", "physics"])).toThrow(/--visibility, --event-kind/);
    expect(() => parseRecipeFlags(["--area", "x"], "technology", [])).toThrow(
      /asks nothing, so it takes no recipe flags/
    );
  });
});

describe("resolving answers", () => {
  function harness(answers: readonly string[], interactive: boolean) {
    const { io, err } = capture("/tmp/somewhere", interactive);
    return { terminal: fakeTerminal(io, answers), err };
  }

  it("takes the Default answer when there is nobody to ask", async () => {
    const { terminal, err } = harness([], false);
    expect(
      await resolveAnswers({
        questions: QUESTIONS,
        supplied: new Map(),
        interactive: false,
        terminal,
      })
    ).toEqual({ visibility: "visible", "event-kind": "country" });
    expect(err()).toBe("");
  });

  it("prompts in the order the recipe asks", async () => {
    const { terminal, err } = harness(["hidden", "planet"], true);
    expect(
      await resolveAnswers({
        questions: QUESTIONS,
        supplied: new Map(),
        interactive: true,
        terminal,
      })
    ).toEqual({ visibility: "hidden", "event-kind": "planet" });
    expect(err().split("\n").slice(0, 2)).toEqual([
      "? Visible or hidden? › hidden",
      "? Which scope? › planet",
    ]);
  });

  it("lets a flag win, and says where the answer came from", async () => {
    // An author who passed `--visibility hidden` and then watched the command
    // not ask about visibility deserves to see why.
    const { terminal, err } = harness(["planet"], true);
    expect(
      await resolveAnswers({
        questions: QUESTIONS,
        supplied: new Map([["visibility", "hidden"]]),
        interactive: true,
        terminal,
      })
    ).toEqual({ visibility: "hidden", "event-kind": "planet" });
    expect(err()).toContain("info: visibility: hidden — from --visibility");
  });
});

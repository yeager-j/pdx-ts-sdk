/**
 * Golden transcripts: the exact bytes an author sees, frozen.
 *
 * `list` and `view` are documentation that happens to be executable, and
 * `generate` is a command that changes somebody's project, so their output is
 * reviewed the way documentation is — by reading the committed file and the
 * diff against it. The `out|`/`err|` prefixes are what make the review
 * possible: a transcript records not just what was written but *where*, and the
 * catalog's promise is that only the result goes to stdout. The lines are in
 * the order they were written, so a transcript is a session rather than two
 * streams stacked on top of each other.
 *
 * The generate transcripts run against a real copy of the golden fixture
 * project in a temporary directory, so they are evidence about a real
 * filesystem rather than about a mock of one. Only the project's own path is
 * normalized, because it is the one thing that legitimately differs between two
 * runs.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { main } from "../src/cli.ts";
import { capture, type CaptureEvent, type Channel } from "./helpers/capture.ts";
import { createTempProject, type TempProject } from "./helpers/golden-project.ts";
import { expectGolden } from "./helpers/goldens.ts";
import { CANCEL, fakeTerminal, type ScriptedAnswer } from "./helpers/terminal.ts";

const GOLDEN_SOURCE = path.resolve(import.meta.dirname, "goldens/recipes/technology/default.ts");

interface Run {
  readonly transcript: string;
  readonly code: number;
}

interface RunOptions {
  readonly cwd?: string;
  /** Present means a terminal is available and these are its answers. */
  readonly answers?: readonly ScriptedAnswer[];
  /** Replaced with `<project>` wherever it appears. */
  readonly project?: TempProject;
}

async function run(argv: readonly string[], options: RunOptions = {}): Promise<Run> {
  const { io, events } = capture(options.cwd ?? "/tmp/somewhere", options.answers !== undefined);
  const terminal = fakeTerminal(io, options.answers ?? []);
  const code = await main([...argv], io, terminal);
  terminal.expectDrained();

  const transcript = [...serialize(events()), `exit ${code}`, ""].join("\n");
  return { transcript: normalize(transcript, options.project), code };
}

/** The temporary project's two spellings, and nothing else. */
function normalize(transcript: string, project: TempProject | undefined): string {
  if (project === undefined) {
    return transcript;
  }
  return [project.realDir, project.dir]
    .sort((a, b) => b.length - a.length)
    .reduce((text, dir) => text.split(dir).join("<project>"), transcript);
}

/**
 * Every recorded write, as tagged lines in the order they happened.
 *
 * A line is emitted when its newline arrives, which is the moment it became
 * visible — so an interactive session reads the way it ran: the prompts, then
 * the confirmation, then the path on stdout. Grouping by stream instead would
 * print the result above the questions that produced it.
 *
 * A stream that ends mid-line is recorded as it is and then said out loud,
 * because a missing final newline is worth seeing rather than rounding off.
 */
function serialize(events: readonly CaptureEvent[]): string[] {
  const pending = new Map<Channel, string>();
  const lines: string[] = [];

  const tagged = (channel: Channel, line: string): string =>
    line === "" ? `${channel}|` : `${channel}| ${line}`;

  for (const { channel, text } of events) {
    const parts = `${pending.get(channel) ?? ""}${text}`.split("\n");
    pending.set(channel, parts.pop()!);
    for (const part of parts) {
      lines.push(tagged(channel, part));
    }
  }

  for (const [channel, rest] of pending) {
    if (rest !== "") {
      lines.push(tagged(channel, rest), `${channel}| (no trailing newline)`);
    }
  }
  return lines;
}

const DISCOVERY: readonly (readonly [string, readonly string[]])[] = [
  ["list", ["list"]],
  ["view-technology", ["view", "technology"]],
  ["view-unknown", ["view", "nope"]],
  ["view-without-a-recipe", ["view"]],
];

describe("catalog discovery", () => {
  it.each(DISCOVERY)("%s", async (golden, argv) => {
    expectGolden(`transcripts/${golden}.txt`, (await run(argv)).transcript);
  });

  it("writes no trailing whitespace, anywhere", async () => {
    // Aligned columns are one padEnd away from a line that ends in spaces, and
    // a terminal shows nothing while a diff shows it forever.
    for (const [, argv] of DISCOVERY) {
      const { io, out, err } = capture();
      await main([...argv], io);
      for (const text of [out(), err()]) {
        expect(text.split("\n").filter((line) => /\s$/.test(line))).toEqual([]);
      }
    }
  });
});

describe("generate", () => {
  let project: TempProject | undefined;
  let elsewhere: string | undefined;

  afterEach(() => {
    project?.dispose();
    project = undefined;
    if (elsewhere !== undefined) {
      rmSync(elsewhere, { recursive: true, force: true });
      elsewhere = undefined;
    }
  });

  function open(): TempProject {
    project = createTempProject();
    return project;
  }

  function written(target: TempProject): string {
    return readFileSync(path.join(target.dir, "src/content/resonance_theory.ts"), "utf8");
  }

  it("writes the file, and puts nothing but its path on stdout", async () => {
    const target = open();
    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes"],
      { cwd: target.dir, project: target }
    );

    expect(code).toBe(0);
    expectGolden("transcripts/generate-flags-noninteractive.txt", transcript);
    // The transcript freezes stdout's shape; this is the same promise stated
    // where a reader of the source can see it.
    expect(transcript).toContain("out| <project>/src/content/resonance_theory.ts");
    expect(written(target)).toBe(readFileSync(GOLDEN_SOURCE, "utf8"));
  });

  it("picks a recipe, asks for a name, and confirms the path", async () => {
    const target = open();
    const { transcript } = await run(["generate"], {
      cwd: target.dir,
      project: target,
      answers: ["technology", "Resonance Theory", true],
    });

    expectGolden("transcripts/generate-interactive.txt", transcript);
    expect(written(target)).toBe(readFileSync(GOLDEN_SOURCE, "utf8"));
  });

  it("re-asks a name that cannot become a file, an id and a binding", async () => {
    const target = open();
    const { transcript } = await run(["generate", "technology"], {
      cwd: target.dir,
      project: target,
      answers: ["!!!", "Resonance Theory", true],
    });

    expectGolden("transcripts/generate-name-rejected.txt", transcript);
  });

  it("prints the exact bytes a real run would write, and writes nothing", async () => {
    const target = open();
    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes", "--dry-run"],
      { cwd: target.dir, project: target }
    );

    expect(code).toBe(0);
    expectGolden("transcripts/generate-dry-run.txt", transcript);
    expect(existsSync(path.join(target.dir, "src/content/resonance_theory.ts"))).toBe(false);
  });

  it("says a real run would refuse an existing target, and still exits zero", async () => {
    const target = open();
    writeFileSync(path.join(target.dir, "src/content/resonance_theory.ts"), "// mine\n");
    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes", "--dry-run"],
      { cwd: target.dir, project: target }
    );

    expect(code).toBe(0);
    expectGolden("transcripts/generate-dry-run-existing.txt", transcript);
    expect(written(target)).toBe("// mine\n");
  });

  it("refuses to replace a file that is already the author's", async () => {
    const target = open();
    expect(
      (await run(["generate", "technology", "Resonance Theory", "--yes"], { cwd: target.dir })).code
    ).toBe(0);

    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes"],
      { cwd: target.dir, project: target }
    );
    expect(code).toBe(1);
    expectGolden("transcripts/generate-collision.txt", transcript);
    // Untouched: the first run's bytes, not a second copy of them.
    expect(written(target)).toBe(readFileSync(GOLDEN_SOURCE, "utf8"));
  });

  it("refuses a flag neither the command nor the recipe has", async () => {
    const target = open();
    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes", "--area", "physics"],
      { cwd: target.dir, project: target }
    );
    expect(code).toBe(1);
    expectGolden("transcripts/generate-invalid-flag.txt", transcript);
  });

  it("answers an unknown recipe with the ids that exist", async () => {
    const target = open();
    const { transcript, code } = await run(["generate", "nope", "Resonance Theory", "--yes"], {
      cwd: target.dir,
      project: target,
    });
    expect(code).toBe(1);
    expectGolden("transcripts/generate-unknown-recipe.txt", transcript);
  });

  it("says what it searched for when there is no project", async () => {
    elsewhere = mkdtempSync(path.join(tmpdir(), "pdx-no-project-"));
    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes"],
      {
        cwd: elsewhere,
      }
    );
    expect(code).toBe(1);
    expectGolden(
      "transcripts/generate-missing-manifest.txt",
      // Both spellings: the command reports the directory it really searched,
      // and on macOS a temporary directory is reached through a symlinked /var.
      [realpathSync(elsewhere), elsewhere]
        .sort((a, b) => b.length - a.length)
        .reduce((text, dir) => text.split(dir).join("<elsewhere>"), transcript)
    );
  });

  it("says a --cwd that does not exist is the problem", async () => {
    // Not "there is no project here": the directory the author named is the
    // fact that is wrong, and reporting the search would send them looking for
    // a manifest instead of for a typo.
    const target = open();
    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes", "--cwd", "nowhere"],
      { cwd: target.dir, project: target }
    );
    expect(code).toBe(1);
    expectGolden("transcripts/generate-missing-cwd.txt", transcript);
  });

  it("reports a manifest it cannot read rather than searching past it", async () => {
    const target = open();
    writeFileSync(
      path.join(target.dir, "stellaris-mod.json"),
      JSON.stringify({ mod: {}, contentDirectory: "src/content" }, null, 2)
    );
    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes"],
      {
        cwd: target.dir,
        project: target,
      }
    );
    expect(code).toBe(1);
    expectGolden("transcripts/generate-invalid-manifest.txt", transcript);
  });

  it("refuses an SDK range it cannot prove is inside the verified one", async () => {
    const target = open();
    declareSdk(target, ">=0.2.0");
    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes"],
      {
        cwd: target.dir,
        project: target,
      }
    );
    expect(code).toBe(1);
    expectGolden("transcripts/generate-sdk-range-not-subset.txt", transcript);
    expect(existsSync(path.join(target.dir, "src/content/resonance_theory.ts"))).toBe(false);
  });

  it("generates anyway when told to, and says so on stderr", async () => {
    const target = open();
    declareSdk(target, "file:../pdx-sdk/packages/sdk");
    const { transcript, code } = await run(
      ["generate", "technology", "Resonance Theory", "--yes", "--allow-unsupported-sdk"],
      { cwd: target.dir, project: target }
    );
    expect(code).toBe(0);
    expectGolden("transcripts/generate-allow-unsupported-sdk.txt", transcript);
    expect(written(target)).toBe(readFileSync(GOLDEN_SOURCE, "utf8"));
  });

  it("needs a recipe when there is nobody to ask", async () => {
    const target = open();
    const { transcript, code } = await run(["generate"], { cwd: target.dir, project: target });
    expect(code).toBe(1);
    expectGolden("transcripts/generate-without-a-recipe.txt", transcript);
  });

  it("needs a name when there is nobody to ask", async () => {
    const target = open();
    const { transcript, code } = await run(["generate", "technology"], {
      cwd: target.dir,
      project: target,
    });
    expect(code).toBe(1);
    expectGolden("transcripts/generate-without-a-name.txt", transcript);
  });

  const CANCELLATIONS: readonly (readonly [
    string,
    readonly string[],
    readonly ScriptedAnswer[],
  ])[] = [
    ["picker", ["generate"], [CANCEL]],
    ["name", ["generate", "technology"], [CANCEL]],
    ["confirm", ["generate", "technology", "Resonance Theory"], [false]],
  ];

  it.each(CANCELLATIONS)(
    "leaves the project alone when cancelled at the %s",
    async (where, argv, answers) => {
      const target = open();
      // The content directory is removed first, so "cancellation creates nothing"
      // is a claim about directories as well as about the file.
      rmSync(path.join(target.dir, "src/content"), { recursive: true, force: true });

      const { transcript, code } = await run(argv, {
        cwd: target.dir,
        project: target,
        answers,
      });

      expect(code).toBe(130);
      expectGolden(`transcripts/generate-cancel-at-${where}.txt`, transcript);
      expect(existsSync(path.join(target.dir, "src/content"))).toBe(false);
    }
  );
});

function declareSdk(target: TempProject, specifier: string): void {
  const file = path.join(target.dir, "package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as {
    devDependencies: Record<string, string>;
  };
  manifest.devDependencies["@pdx-ts/sdk"] = specifier;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

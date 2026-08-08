/**
 * Which command an argv means, and what each one writes where.
 *
 * `main` takes an injected `CliIo`, so these run the real router in-process and
 * read stdout and stderr apart. Dry-run is the cheap probe for the init path:
 * it exercises parsing, resolution and planning, and touches no disk.
 */

import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { main } from "../src/cli.ts";
import type { CliIo } from "../src/io.ts";
import { COMMANDS, splitCommand, type CommandName } from "../src/options.ts";
import { VERSION } from "../src/version.ts";

interface Capture {
  readonly io: CliIo;
  out(): string;
  err(): string;
}

function capture(cwd = "/tmp/somewhere"): Capture {
  const out: string[] = [];
  const err: string[] = [];
  const sink = (into: string[]): Writable =>
    new Writable({
      write(chunk: unknown, _encoding, callback) {
        into.push(String(chunk));
        callback();
      },
    });
  return {
    io: {
      cwd,
      // Not a TTY: nothing here may reach a prompt, and a test that hangs
      // waiting for one is the failure mode worth making impossible.
      stdin: Readable.from([]),
      stdout: sink(out),
      stderr: sink(err),
    },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

const RESERVED = ["list", "view", "generate"] as const satisfies readonly Exclude<
  CommandName,
  "init"
>[];

describe("splitCommand", () => {
  it("takes a reserved first argument as the command, and strips it", () => {
    expect(splitCommand(["init", "my-mod"])).toEqual({ command: "init", rest: ["my-mod"] });
    expect(splitCommand(["generate", "technology"])).toEqual({
      command: "generate",
      rest: ["technology"],
    });
  });

  it("treats anything else, including nothing, as the init shorthand", () => {
    expect(splitCommand(["my-mod"])).toEqual({ command: "init", rest: ["my-mod"] });
    expect(splitCommand([])).toEqual({ command: "init", rest: [] });
  });

  it("never mistakes a flag's value for a command", () => {
    // `--name init` is a mod called "init", not the init command. Reading the
    // *first argument* rather than the first positional is what makes that
    // decidable without first knowing which command's flag table to parse with.
    expect(splitCommand(["--name", "init", "my-mod"])).toEqual({
      command: "init",
      rest: ["--name", "init", "my-mod"],
    });
  });
});

describe("the reserved catalog commands", () => {
  it.each(RESERVED)("says %s arrives with the Recipe Catalog, and fails", async (command) => {
    const { io, out, err } = capture();
    expect(await main([command], io)).toBe(1);
    expect(err()).toContain("Recipe Catalog");
    expect(err()).toContain(command);
    expect(out()).toBe("");
  });

  it.each(RESERVED)("answers %s --help on stdout, and succeeds", async (command) => {
    const { io, out, err } = capture();
    expect(await main([command, "--help"], io)).toBe(0);
    expect(out()).toContain(`create-stellaris-mod ${command}`);
    expect(err()).toBe("");
  });
});

describe("init", () => {
  it("scaffolds the same tree whether or not the command is spelled out", async () => {
    // The compatibility shorthand and the canonical spelling are one code path,
    // so this is the thing that would notice if they stopped being.
    const bare = capture();
    const spelled = capture();
    expect(await main(["--dry-run", "--yes", "my-mod"], bare.io)).toBe(0);
    expect(await main(["init", "--dry-run", "--yes", "my-mod"], spelled.io)).toBe(0);

    expect(spelled.out()).toBe(bare.out());
    expect(bare.out()).toContain("stellaris-mod.json");
    expect(bare.out()).toContain("src/content/example.ts");
  });

  it("resolves the target directory against the injected cwd", async () => {
    const { io, out } = capture("/tmp/elsewhere");
    expect(await main(["--dry-run", "--yes", "my-mod"], io)).toBe(0);
    expect(out()).toContain("Would scaffold /tmp/elsewhere/my-mod:");
  });

  it("takes a directory named like a command when the command is spelled out", async () => {
    // The price of reserving the names: `create-stellaris-mod list` is the
    // command, so a directory called `list` needs the canonical spelling.
    const { io, out } = capture("/tmp/elsewhere");
    expect(await main(["init", "--dry-run", "--yes", "list"], io)).toBe(0);
    expect(out()).toContain("Would scaffold /tmp/elsewhere/list:");
  });

  it("prints its own help, listing every command", async () => {
    const { io, out, err } = capture();
    expect(await main(["--help"], io)).toBe(0);
    for (const command of Object.keys(COMMANDS)) {
      expect(out(), command).toContain(command);
    }
    expect(out()).toContain("--no-git");
    expect(err()).toBe("");
  });

  it("reports the version on stdout", async () => {
    const { io, out } = capture();
    expect(await main(["--version"], io)).toBe(0);
    expect(out()).toBe(`${VERSION}\n`);
  });

  it("answers an unparseable flag with the message and the help, on stderr", async () => {
    const { io, out, err } = capture();
    expect(await main(["--nonsense"], io)).toBe(1);
    expect(err()).toContain("--nonsense");
    expect(err()).toContain("Options:");
    expect(out()).toBe("");
  });
});

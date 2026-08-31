/**
 * Which command an argv means, and what each one writes where.
 *
 * `main` takes an injected `CliIo`, so these run the real router in-process and
 * read stdout and stderr apart. Dry-run is the cheap probe for the init path:
 * it exercises parsing, resolution and planning, and touches no disk.
 */

import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.ts";
import { installFailureSteps } from "../src/commands/init.ts";
import { supportedVersionFor } from "../src/detect.ts";
import {
  describeCommand,
  gitInitCommands,
  installCommand,
  run,
  teeCommandOutput,
} from "../src/exec.ts";
import { VERIFIED_STELLARIS_BUILD } from "../src/generated/verified-build.ts";
import { parseManifest } from "../src/manifest.ts";
import { COMMANDS, splitCommand, type CommandName } from "../src/options.ts";
import { supportedVersionProblem } from "../src/prompts.ts";
import { VERSION } from "../src/version.ts";
import { capture } from "./helpers/capture.ts";

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

describe("generate", () => {
  it("fails before looking for a project when there is nobody to ask", async () => {
    // Order matters here: a command that asks for a manifest first would report
    // the wrong problem to anyone running it outside a project, and a CI run
    // must never reach a prompt at all.
    const { io, out, err } = capture("/nowhere/at/all");
    expect(await main(["generate"], io)).toBe(1);
    expect(err()).toContain("a recipe id and a name");
    expect(err()).not.toContain("stellaris-mod.json");
    expect(out()).toBe("");
  });

  it("reports the version, like every other command", async () => {
    const { io, out, err } = capture();
    expect(await main(["generate", "--version"], io)).toBe(0);
    expect(out()).toBe(`${VERSION}\n`);
    expect(err()).toBe("");
  });

  it("answers an unparseable flag with the message and the help, on stderr", async () => {
    const { io, out, err } = capture();
    expect(await main(["generate", "--cwd"], io)).toBe(1);
    expect(err()).toContain("--cwd needs a value");
    expect(err()).toContain("Options:");
    expect(out()).toBe("");
  });
});

describe("--help", () => {
  it.each(Object.keys(COMMANDS) as CommandName[])(
    "answers %s --help on stdout, and succeeds",
    async (command) => {
      const { io, out, err } = capture();
      expect(await main([command, "--help"], io)).toBe(0);
      expect(out()).toContain("create-stellaris-mod");
      expect(out()).toContain(command);
      expect(err()).toBe("");
    }
  );
});

describe("list", () => {
  it("prints every recipe on stdout, and needs no project", async () => {
    const { io, out, err } = capture("/nowhere/at/all");
    expect(await main(["list"], io)).toBe(0);
    expect(out()).toContain("technology");
    expect(err()).toBe("");
  });

  it("refuses an argument rather than ignoring it", async () => {
    const { io, out, err } = capture();
    expect(await main(["list", "technology"], io)).toBe(1);
    expect(err()).toContain("takes no arguments");
    expect(out()).toBe("");
  });
});

describe("view", () => {
  it("prints one recipe's page on stdout, and needs no project", async () => {
    const { io, out, err } = capture("/nowhere/at/all");
    expect(await main(["view", "technology"], io)).toBe(0);
    expect(out()).toContain("Item recipe");
    expect(out()).toContain("npx create-stellaris-mod generate technology");
    expect(err()).toBe("");
  });

  it("answers an unknown recipe with the ids that exist, on stderr", async () => {
    const { io, out, err } = capture();
    expect(await main(["view", "nope"], io)).toBe(1);
    expect(err()).toContain('"nope"');
    expect(err()).toContain("technology");
    expect(out()).toBe("");
  });

  it("answers a missing recipe id the same way", async () => {
    const { io, out, err } = capture();
    expect(await main(["view"], io)).toBe(1);
    expect(err()).toContain("needs a recipe id");
    expect(err()).toContain("technology");
    expect(out()).toBe("");
  });

  it("refuses two recipe ids, which would silently view one", async () => {
    const { io, err } = capture();
    expect(await main(["view", "technology", "building"], io)).toBe(1);
    expect(err()).toContain("takes one recipe id");
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
    expect(bare.out()).toContain("src/inspect.ts");
    expect(bare.out()).toContain("  .agents/skills/pdx-project-startup/SKILL.md\n");
    expect(bare.out()).toContain("  .agents/skills/pdx-sdk-authoring/SKILL.md\n");
    expect(bare.out()).toContain("  CLAUDE.md -> AGENTS.md\n");
    expect(bare.out()).toContain("  .claude/skills -> ../.agents/skills\n");
    expect(bare.out()).toContain("  .codex/agents/pdx-docs-expert.toml\n");
  });

  it("omits the complete agent bundle with --no-llm and writes nothing in dry-run", async () => {
    const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-dry-")));
    try {
      const { io, out, err } = capture(root);
      expect(await main(["--dry-run", "--yes", "--no-llm", "my-mod"], io)).toBe(0);
      expect(out()).not.toMatch(/AGENTS\.md|CLAUDE\.md|\.agents\/|\.claude\/|\.codex\//);
      expect(err()).toBe("");
      expect(existsSync(path.join(root, "my-mod"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * SDK-388. The dry run used to rebuild the optional commands separately from
   * the code that ran them, and the two had already drifted: the preview
   * reported `git init` before the install, while the real path installs first
   * so the lockfile it produces is part of the initial commit. It also covered
   * the files but not the rest of the operation being previewed.
   */
  it("previews the commands it would run, in the order it would run them", async () => {
    const { io, out } = capture("/tmp/elsewhere");
    expect(await main(["--dry-run", "--yes", "my-mod"], io)).toBe(0);

    const commands = out()
      .split("\n")
      .filter((line) => line.startsWith("  $ "))
      .map((line) => line.slice(4));
    // The commit message is quoted for whichever shell this platform has, so
    // the line is compared through the same renderer the preview used rather
    // than against one platform's spelling.
    expect(commands).toEqual([
      "npm install",
      "git init",
      "git add -A",
      describeCommand({
        command: "git",
        args: ["commit", "-m", "Scaffold with create-stellaris-mod"],
      }),
    ]);
    // And it really is one argument, not four.
    expect(commands[3]).toMatch(/^git commit -m \S*Scaffold with create-stellaris-mod\S*$/);
  });

  it("says which of the previewed steps a real run may skip", async () => {
    // The preview cannot answer it: the target does not exist yet, so whether
    // it lands inside an existing repository is not a question a dry run has.
    const { io, out } = capture("/tmp/elsewhere");
    expect(await main(["--dry-run", "--yes", "my-mod"], io)).toBe(0);
    const lines = out().split("\n");
    const note = lines.findIndex((line) => line.includes("already inside a git repository"));
    expect(note).toBeGreaterThan(-1);
    expect(lines[note + 1]).toBe("  $ git init");
    // And it applies to the git group only.
    expect(lines.indexOf("  $ npm install")).toBeLessThan(note);
  });

  it("previews only the steps the answers actually ask for", async () => {
    const { io, out } = capture("/tmp/elsewhere");
    expect(await main(["--dry-run", "--yes", "--no-git", "--no-install", "my-mod"], io)).toBe(0);
    expect(out()).not.toContain("  $ ");
  });

  it("resolves the target directory against the injected cwd", async () => {
    const { io, out } = capture("/tmp/elsewhere");
    expect(await main(["--dry-run", "--yes", "my-mod"], io)).toBe(0);
    expect(out()).toContain(`Would scaffold ${path.resolve("/tmp/elsewhere/my-mod")}:`);
  });

  it("enables the agent bundle by default when stdin is not a TTY", async () => {
    const { io, out, err } = capture("/tmp/elsewhere");
    expect(await main(["--dry-run", "my-mod"], io)).toBe(0);
    expect(out()).toContain("  AGENTS.md\n");
    expect(out()).toContain("  CLAUDE.md -> AGENTS.md\n");
    expect(err()).toBe("");
  });

  it("takes a directory named like a command when the command is spelled out", async () => {
    // The price of reserving the names: `create-stellaris-mod list` is the
    // command, so a directory called `list` needs the canonical spelling.
    const { io, out } = capture("/tmp/elsewhere");
    expect(await main(["init", "--dry-run", "--yes", "list"], io)).toBe(0);
    expect(out()).toContain(`Would scaffold ${path.resolve("/tmp/elsewhere/list")}:`);
  });

  it("prints its own help, listing every command", async () => {
    const { io, out, err } = capture();
    expect(await main(["--help"], io)).toBe(0);
    for (const command of Object.keys(COMMANDS)) {
      expect(out(), command).toContain(command);
    }
    expect(out()).toContain("--no-git");
    expect(out()).toContain("--no-llm");
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

  it("rejects an explicit invalid Stellaris path before writing in non-interactive mode", async () => {
    const root = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-path-"))
    );
    try {
      const invalid = path.join(root, "typoed-stellaris");
      const { io, out, err } = capture(root);
      expect(
        await main(["--yes", "--no-git", "--no-install", "--stellaris-path", invalid, "my-mod"], io)
      ).toBe(1);
      expect(err()).toContain(`--stellaris-path ${JSON.stringify(invalid)}`);
      expect(err()).toContain("no common/technology inside it");
      expect(out()).toBe("");
      expect(existsSync(path.join(root, "my-mod"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["prefix", ["--prefix", "My-Mod"], "lowercase snake_case"],
    ["name", ["--name", "My\nMod"], "newline"],
    ["tags", ["--tags", 'Technology,Bad"Tag'], "tags[1]"],
  ] as const)("rejects an SDK-invalid %s before writing", async (_field, flags, message) => {
    const root = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-config-"))
    );
    try {
      const { io, out, err } = capture(root);
      expect(await main(["--yes", "--no-git", "--no-install", ...flags, "my-mod"], io)).toBe(1);
      expect(err()).toContain(message);
      expect(out()).toBe("");
      expect(existsSync(path.join(root, "my-mod"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects extra directories instead of silently ignoring them", async () => {
    const { io, out, err } = capture();
    expect(await main(["init", "one", "two", "--yes"], io)).toBe(1);
    expect(err()).toContain("init takes at most one directory");
    expect(out()).toBe("");
  });
});

describe("dependency install recovery", () => {
  it("uses a shell only for package-manager shims", () => {
    expect(installCommand("npm").shell).toBe(process.platform === "win32");
    expect(installCommand("custom-package-manager").shell).toBe(false);
    expect(gitInitCommands().every((command) => command.shell !== true)).toBe(true);
  });

  /**
   * The dry run prints these lines with a `$` prompt, so they have to be
   * pasteable where they are printed. `cmd.exe` does not group an argument
   * with single quotes: a POSIX-quoted commit message pasted there becomes
   * four arguments and a message of `'Scaffold`. Both spellings are checked
   * from either platform, the way `platformDefaultsFor` takes its platform.
   */
  it("quotes previewed commands for the shell of the platform printing them", () => {
    const commit = {
      command: "git",
      args: ["commit", "-m", "Scaffold with create-stellaris-mod"],
    } as const;
    expect(describeCommand(commit, "linux")).toBe(
      "git commit -m 'Scaffold with create-stellaris-mod'"
    );
    expect(describeCommand(commit, "darwin")).toBe(
      "git commit -m 'Scaffold with create-stellaris-mod'"
    );
    expect(describeCommand(commit, "win32")).toBe(
      'git commit -m "Scaffold with create-stellaris-mod"'
    );
  });

  it("leaves an argument that needs no quotes anywhere unquoted", () => {
    for (const platform of ["linux", "win32"] as const) {
      expect(describeCommand({ command: "npm", args: ["install"] }, platform)).toBe("npm install");
      expect(describeCommand({ command: "git", args: ["add", "-A"] }, platform)).toBe("git add -A");
    }
  });

  it("escapes a quote with the escape that shell understands", () => {
    const quoted = { command: "echo", args: [`say "hi" and 'bye'`] } as const;
    expect(describeCommand(quoted, "linux")).toBe(`echo 'say "hi" and '\\''bye'\\'''`);
    expect(describeCommand(quoted, "win32")).toBe(`echo "say ""hi"" and 'bye'"`);
  });

  it("retains package-manager diagnostics written to stdout", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const result = await run(
        {
          command: process.execPath,
          args: [
            "-e",
            'process.stdout.write("ETARGET: @pdx-ts/stellaris-ids has no matching version\\n"); process.exitCode = 1;',
          ],
        },
        process.cwd()
      );
      expect(result.code).toBe(1);
      expect(result.output).toContain("ETARGET: @pdx-ts/stellaris-ids has no matching version");
    } finally {
      stdout.mockRestore();
    }
  });

  it("preserves destination backpressure while retaining diagnostics", async () => {
    const source = new PassThrough();
    let releaseWrite: (() => void) | undefined;
    const destination = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        releaseWrite = callback;
      },
    });
    const observed: Buffer[] = [];
    teeCommandOutput(source, destination, (chunk) => observed.push(chunk));

    source.write(Buffer.from("diagnostic output"));
    expect(source.isPaused()).toBe(true);
    expect(releaseWrite).toBeTypeOf("function");

    const drained = once(destination, "drain");
    releaseWrite!();
    await drained;
    await vi.waitFor(() => expect(source.isPaused()).toBe(false));
    expect(Buffer.concat(observed).toString()).toBe("diagnostic output");

    source.destroy();
    destination.destroy();
  });

  it("refuses rather than offering to drop the ids package", () => {
    // The package is a hard dependency (ADR-0006): removing it leaves a
    // project that does not typecheck, so advising the author to remove it
    // would be advice to break their own scaffold.
    const steps = installFailureSteps(
      "npm",
      "4.4.7",
      "npm error code ETARGET\nnpm error notarget No matching version found for @pdx-ts/stellaris-ids@>=4.4.7-0 <4.4.7."
    ).join("\n");
    expect(steps).toContain("No @pdx-ts/stellaris-ids release matches game build 4.4.7");
    expect(steps).toContain("does not typecheck");
    expect(steps).toContain("package.json to a build that has one");
    expect(steps).not.toMatch(/remove .*@pdx-ts\/stellaris-ids/);
    expect(steps).not.toContain("run it again");
  });

  it("recognizes Yarn's missing-version diagnostic", () => {
    const steps = installFailureSteps(
      "yarn",
      "4.4.7",
      "YN0082: @pdx-ts/stellaris-ids@npm:>=4.4.7-0 <4.4.7: No candidates found"
    ).join("\n");
    expect(steps).toContain("No @pdx-ts/stellaris-ids release matches game build 4.4.7");
    expect(steps).toContain("yarn install");
    expect(steps).not.toContain("run it again");
  });

  it("keeps the ordinary retry advice for unrelated install failures", () => {
    expect(installFailureSteps("pnpm", "4.4.7", "network timeout")).toEqual([
      "  pnpm install        # the install did not complete; run it again",
    ]);
  });
});

/**
 * init's promise is that it never writes a Project Manifest `generate` cannot
 * read. SDK configuration is checked during resolution, before disk writes.
 */
describe("the launcher version init writes", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("refuses a value the launcher would silently reject, writing nothing", async () => {
    root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-version-")));
    const { io, out, err } = capture(root);

    // Deliberately not --dry-run: the point is that resolution fails before
    // the scaffold touches the filesystem at all.
    expect(
      await main(
        ["--yes", "--no-git", "--no-install", "--supported-version", "banana", "my-mod"],
        io
      )
    ).toBe(1);
    expect(err()).toContain("--supported-version");
    expect(err()).toContain('"banana"');
    expect(err()).toContain('"v4.4.*"');
    expect(out()).toBe("");
    expect(existsSync(path.join(root, "my-mod"))).toBe(false);
  });

  it("takes a legal explicit value, and puts it in the manifest", async () => {
    root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-version-")));
    const { io } = capture(root);

    expect(
      await main(["--yes", "--no-git", "--no-install", "--supported-version", "v4.*", "my-mod"], io)
    ).toBe(0);
    const manifestPath = path.join(root, "my-mod/stellaris-mod.json");
    expect(
      parseManifest(readFileSync(manifestPath, "utf8"), manifestPath).config.supportedVersion
    ).toBe("v4.*");
  });

  it("leaves the derived and fallback values alone, because they are already legal", () => {
    // The check guards what an author supplies. Detection derives `v<major>.<minor>.*`
    // and the no-install fallback is the generated verified build — if either stopped matching,
    // every ordinary scaffold would fail rather than one bad flag.
    expect(supportedVersionProblem(supportedVersionFor(VERIFIED_STELLARIS_BUILD)!)).toBeUndefined();
    expect(supportedVersionProblem("v4.4.*")).toBeUndefined();
    for (const build of ["4.4.6", "4.4.6.1", "v5.0.0"]) {
      const derived = supportedVersionFor(build);
      expect(derived === undefined || supportedVersionProblem(derived) === undefined, build).toBe(
        true
      );
    }
  });
});

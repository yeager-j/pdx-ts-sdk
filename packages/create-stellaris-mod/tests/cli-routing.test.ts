/**
 * Which command an argv means, and what each one writes where.
 *
 * `main` takes an injected `CliIo`, so these run the real router in-process and
 * read stdout and stderr apart. Dry-run is the cheap probe for the init path:
 * it exercises parsing, resolution and planning, and touches no disk.
 */

import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.ts";
import { installFailureSteps } from "../src/commands/init.ts";
import { supportedVersionFor } from "../src/detect.ts";
import { run, teeCommandOutput } from "../src/exec.ts";
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

  it("rejects an explicit invalid Stellaris path before writing in non-interactive mode", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-path-"));
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
});

describe("dependency install recovery", () => {
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
 * read. `supportedVersion` is the one field an author can hand the CLI that
 * both `parseManifest` and the SDK's `resolveConfig` would refuse, so it is
 * checked during resolution — before anything reaches the disk.
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
    root = mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-version-"));
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
    root = mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-version-"));
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

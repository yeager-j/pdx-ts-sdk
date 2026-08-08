/**
 * Which command an argv means, and what each one writes where.
 *
 * `main` takes an injected `CliIo`, so these run the real router in-process and
 * read stdout and stderr apart. Dry-run is the cheap probe for the init path:
 * it exercises parsing, resolution and planning, and touches no disk.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { main } from "../src/cli.ts";
import { supportedVersionFor } from "../src/detect.ts";
import { parseManifest } from "../src/manifest.ts";
import { COMMANDS, splitCommand, type CommandName } from "../src/options.ts";
import { FALLBACK_GAME_VERSION, supportedVersionProblem } from "../src/prompts.ts";
import { VERSION } from "../src/version.ts";
import { capture } from "./helpers/capture.ts";

/** Reserved, and still waiting on the half of the catalog that writes files. */
const PENDING = ["generate"] as const satisfies readonly Exclude<CommandName, "init">[];

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

describe("the catalog commands still waiting on their implementation", () => {
  it.each(PENDING)("says %s arrives with the Recipe Catalog, and fails", async (command) => {
    const { io, out, err } = capture();
    expect(await main([command], io)).toBe(1);
    expect(err()).toContain("Recipe Catalog");
    expect(err()).toContain(command);
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
    // and the no-install fallback is a literal — if either stopped matching, every
    // ordinary scaffold would fail rather than one bad flag.
    expect(supportedVersionProblem(supportedVersionFor(FALLBACK_GAME_VERSION)!)).toBeUndefined();
    expect(supportedVersionProblem("v4.4.*")).toBeUndefined();
    for (const build of ["4.4.6", "4.4.6.1", "v5.0.0"]) {
      const derived = supportedVersionFor(build);
      expect(derived === undefined || supportedVersionProblem(derived) === undefined, build).toBe(
        true
      );
    }
  });
});

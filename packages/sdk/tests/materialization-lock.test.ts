/**
 * One physical target has one writer, however the second writer spells it.
 *
 * The in-process queue serializes callers that share a process. It says
 * nothing about two builds started from two terminals, and that is the case
 * the lock file exists for: the second writer must fail immediately, with a
 * refusal that names the holder, rather than wait for it or stage over it.
 *
 * Spelling is the whole difficulty. A case variant and a decomposed Unicode
 * spelling are different strings that name one directory on APFS, and a
 * symlinked parent is a third. Whether those aliases exist is a property of
 * the volume, so `fs-caps` measures it and each row runs where it can be true.
 * The exact-path row runs everywhere: if that one ever failed, nothing else
 * would matter.
 */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { install } from "../src/index.ts";
import { lockPathFor } from "../src/output/layout.ts";
import { renderLauncherDescriptor } from "../src/output/render.ts";
import { renderGeneration } from "./helpers/crash-mod.ts";
import {
  caseInsensitiveDir,
  NFC_NAME,
  nfcAliasingDir,
  NFD_NAME,
  symlinksAvailable,
} from "./helpers/fs-caps.ts";
import { holdMaterialization, runMaterializeChild } from "./helpers/spawn-materialize.ts";

const MANIFEST = ".pdx-sdk-manifest.json";
/** An accented name, so one target has a case alias and a Unicode alias. */
const DIR_NAME = `${NFC_NAME}_probe`;
const CASE_ALIAS = `${NFC_NAME}_PROBE`;
const NFD_ALIAS = `${NFD_NAME}_probe`;
const genOne = renderGeneration(1);
const genTwo = renderGeneration(2);

const temps: string[] = [];

/** Physical from the start, with Windows' 8.3 spelling removed as well. */
function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "pdx-lock-")));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function manifestSha(target: string): string {
  return (JSON.parse(readFileSync(join(target, MANIFEST), "utf8")) as { sha256: string }).sha256;
}

/** Every entry in the mod directory, in one Unicode composition. */
function entries(root: string): string[] {
  return readdirSync(root)
    .map((name) => name.normalize("NFC"))
    .sort();
}

/** How a second writer reaches the target the holder is already writing. */
interface Alias {
  readonly label: string;
  readonly available: boolean;
  /** The mod directory and folder name this writer would name. */
  spell(root: string): { readonly root: string; readonly dirName: string };
}

const ALIASES: readonly Alias[] = [
  {
    label: "the same path",
    available: true,
    spell: (root) => ({ root, dirName: DIR_NAME }),
  },
  {
    label: "a case variant of the folder name",
    available: caseInsensitiveDir,
    spell: (root) => ({ root, dirName: CASE_ALIAS }),
  },
  {
    label: "a decomposed spelling of the folder name",
    available: nfcAliasingDir,
    spell: (root) => ({ root, dirName: NFD_ALIAS }),
  },
  {
    label: "a symlinked mod directory",
    available: symlinksAvailable,
    spell: (root) => {
      const link = join(realpathSync(join(root, "..")), `link-${DIR_NAME}`);
      if (!existsSync(link)) {
        symlinkSync(root, link);
      }
      return { root: link, dirName: DIR_NAME };
    },
  },
];

describe("a second process never writes a target another one holds", () => {
  for (const alias of ALIASES) {
    it.skipIf(!alias.available)(
      `refuses a writer that reaches the target through ${alias.label}`,
      { timeout: 30_000 },
      async () => {
        const parent = tempDir();
        const root = join(parent, "mods");
        const contentDir = join(root, DIR_NAME);
        const descriptorPath = join(root, `${DIR_NAME}.mod`);
        await install(genOne, { modDir: root, dirName: DIR_NAME });
        const holder = await holdMaterialization({
          command: "hold",
          mode: "install",
          root,
          dirName: DIR_NAME,
          point: "staged",
          generation: 2,
        });

        const contender = await runMaterializeChild({
          command: "attempt",
          mode: "install",
          ...alias.spell(root),
          generation: 2,
        });

        // Fail fast and say who: a writer that waited would still be waiting
        // when the holder is a person's editor rather than a build.
        expect(contender.report?.ok).toBe(false);
        expect(contender.report?.failure?.reason).toBe("busy");
        expect(contender.report?.failure?.holder).toMatchObject({
          pid: holder.pid,
          phase: "staged",
        });
        // The loser touched nothing: the target is still generation one, and
        // no second materialization was started beside it.
        expect(manifestSha(contentDir)).toBe(genOne.sha256);

        const finished = await holder.release();

        expect(finished.report).toEqual({ ok: true, status: "written" });
        expect(manifestSha(contentDir)).toBe(genTwo.sha256);
        expect(readFileSync(descriptorPath, "utf8")).toBe(
          renderLauncherDescriptor(genTwo, contentDir)
        );
        expect(entries(root)).toEqual([DIR_NAME, `${DIR_NAME}.mod`].map((n) => n.normalize("NFC")));
      }
    );
  }

  it("tells a dead holder from a live one", { timeout: 30_000 }, async () => {
    // The same collision, with the difference that decides everything: this
    // holder is not coming back, so the next writer is told to recover rather
    // than to try again later.
    const root = tempDir();
    const contentDir = join(root, DIR_NAME);
    await install(genOne, { modDir: root, dirName: DIR_NAME });

    const killed = await runMaterializeChild({
      command: "crash",
      mode: "install",
      root,
      dirName: DIR_NAME,
      point: "staged",
      generation: 2,
    });
    const contender = await runMaterializeChild({
      command: "attempt",
      mode: "install",
      root,
      dirName: DIR_NAME,
      generation: 2,
    });

    if (process.platform === "win32") {
      expect(killed.code).toBe(137);
    } else {
      expect(killed.signal).toBe("SIGKILL");
    }
    expect(contender.report?.failure?.reason).toBe("recovery-required");
    expect(contender.report?.failure?.journalPath).toBe(lockPathFor(contentDir));
    expect(manifestSha(contentDir)).toBe(genOne.sha256);
  });
});

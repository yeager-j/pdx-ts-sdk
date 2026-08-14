/**
 * What a materialization leaves behind when the writer stops existing.
 *
 * Everything else about the transaction is tested in process, where a failure
 * is a thrown error and the stack unwinds through code that was written to
 * handle it. A `SIGKILL` runs none of that: no catch, no cleanup, no final
 * journal record. So the claim "a build killed at any instant leaves a
 * recoverable target" can only be measured by killing a real process at a real
 * instant, which is what every row below does — one spawn, one signal, one
 * recovery, and then the ordinary question of whether the next build works.
 *
 * The generations differ in an owned file and in the launcher descriptor, so
 * "content and descriptor are the same generation" is a thing the tests can
 * actually read off the disk rather than assume.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  install,
  MaterializationError,
  recoverInstallation,
  recoverMaterialization,
  renderLauncherDescriptor,
  write,
  type RecoveryReport,
} from "../src/index.ts";
import { _setMaterializationTestHook } from "../src/output/test-hooks.ts";
import { lockPathFor, MATERIALIZATION_PHASES } from "../src/output/transaction.ts";
import { renderGeneration, type Generation } from "./helpers/crash-mod.ts";
import {
  JOURNAL_POINTS,
  POINT_PREFIXES,
  PRESERVE_PREFIX,
  RENAME_CONTENT_ACTIVATE,
  RENAME_CONTENT_DEACTIVATE,
  RENAME_DESCRIPTOR_ACTIVATE,
  RENAME_DESCRIPTOR_DEACTIVATE,
  RENAME_POINTS,
  TRAVERSAL_DESCEND_PREFIX,
} from "./helpers/crash-points.ts";
import { runMaterializeChild } from "./helpers/spawn-materialize.ts";

const DIR_NAME = "crash_probe";
const MANIFEST = ".pdx-sdk-manifest.json";
const genOne = renderGeneration(1);
const genTwo = renderGeneration(2);

const temps: string[] = [];

/** Physical from the start; the system temp directory is a symlink on macOS. */
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pdx-crash-")));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  _setMaterializationTestHook();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function refusal(operation: Promise<unknown>): Promise<MaterializationError> {
  const thrown = await operation.then(
    () => undefined,
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(MaterializationError);
  return thrown as MaterializationError;
}

/** Which generation an owned tree holds, by its ownership manifest's hash. */
function contentGeneration(target: string): Generation | undefined {
  const sha = (JSON.parse(readFileSync(join(target, MANIFEST), "utf8")) as { sha256: string })
    .sha256;
  return sha === genOne.sha256 ? 1 : sha === genTwo.sha256 ? 2 : undefined;
}

/** Which generation a launcher descriptor holds, by its whole contents. */
function descriptorGeneration(descriptorPath: string, contentDir: string): Generation | undefined {
  const text = readFileSync(descriptorPath, "utf8");
  if (text === renderLauncherDescriptor(genOne, contentDir)) {
    return 1;
  }
  return text === renderLauncherDescriptor(genTwo, contentDir) ? 2 : undefined;
}

function siblings(parent: string): string[] {
  return readdirSync(parent)
    .filter((name) => name.startsWith(".pdx-"))
    .sort();
}

describe("the injection points are the ones the matrix names", () => {
  /**
   * The matrix is a list of strings, and a string that no longer matches a
   * call site is a row that runs to completion and asserts the crash it never
   * caused. So the table and the production call sites are compared directly:
   * a point renamed on one side fails here instead of passing there.
   */
  const CALL_SITE = /_materializationTestPoint\(([^)]*)\)/g;
  const SOURCES = ["transaction.ts", "write.ts", "install.ts"];

  /** Point expressions that are not literals, and what each one can produce. */
  const DYNAMIC = new Map<string, readonly string[]>([["record.phase", MATERIALIZATION_PHASES]]);

  function announcedPoints(): {
    literals: Set<string>;
    prefixes: Set<string>;
    dynamic: Set<string>;
  } {
    const literals = new Set<string>();
    const prefixes = new Set<string>();
    const dynamic = new Set<string>();
    for (const name of SOURCES) {
      const source = readFileSync(
        fileURLToPath(new URL(`../src/output/${name}`, import.meta.url)),
        "utf8"
      );
      for (const [, argument] of source.matchAll(CALL_SITE)) {
        const literal = /^"([^"]*)"$/.exec(argument!.trim());
        const template = /^`([^`$]*)\$\{[^}]*\}`$/.exec(argument!.trim());
        if (literal !== null) {
          literals.add(literal[1]!);
        } else if (template !== null) {
          prefixes.add(template[1]!);
        } else {
          dynamic.add(argument!.trim());
        }
      }
    }
    return { literals, prefixes, dynamic };
  }

  it("announces exactly the fixed points the helper table declares", () => {
    const { literals, prefixes, dynamic } = announcedPoints();

    expect([...literals].sort()).toEqual([...RENAME_POINTS].sort());
    expect([...prefixes].sort()).toEqual([...POINT_PREFIXES].sort());
    expect([...dynamic].sort()).toEqual([...DYNAMIC.keys()].sort());
  });

  it("announces one journal point per phase, and the table lists them all", () => {
    expect(JOURNAL_POINTS).toEqual([...MATERIALIZATION_PHASES]);
    expect(DYNAMIC.get("record.phase")).toEqual([...MATERIALIZATION_PHASES]);
  });

  it("keeps the prefixed families the swap probes drive", () => {
    expect(POINT_PREFIXES).toContain(TRAVERSAL_DESCEND_PREFIX);
    expect(POINT_PREFIXES).toContain(PRESERVE_PREFIX);
  });
});

/** One row of the kill matrix: where the writer dies, and what survives it. */
interface KillRow {
  readonly mode: "build" | "install";
  readonly point: string;
  readonly outcome: RecoveryReport["outcome"];
  /** The generation both halves must read back as, after recovery. */
  readonly generation: Generation;
}

const KILL_MATRIX: readonly KillRow[] = [
  // A build's activation rename is its commit, so a kill after it completes
  // rather than restores.
  { mode: "build", point: "staged", outcome: "cleaned", generation: 1 },
  { mode: "build", point: "content-deactivating", outcome: "cleaned", generation: 1 },
  {
    mode: "build",
    point: RENAME_CONTENT_DEACTIVATE,
    outcome: "restored-previous",
    generation: 1,
  },
  {
    mode: "build",
    point: RENAME_CONTENT_ACTIVATE,
    outcome: "completed-activation",
    generation: 2,
  },
  { mode: "build", point: "committed", outcome: "completed-activation", generation: 2 },
  // An install is not committed until the descriptor follows the content, so
  // the same instant restores instead.
  { mode: "install", point: "staged", outcome: "cleaned", generation: 1 },
  { mode: "install", point: "content-deactivating", outcome: "cleaned", generation: 1 },
  {
    mode: "install",
    point: RENAME_CONTENT_DEACTIVATE,
    outcome: "restored-previous",
    generation: 1,
  },
  {
    mode: "install",
    point: RENAME_CONTENT_ACTIVATE,
    outcome: "restored-previous",
    generation: 1,
  },
  {
    mode: "install",
    point: RENAME_DESCRIPTOR_DEACTIVATE,
    outcome: "restored-previous",
    generation: 1,
  },
  {
    mode: "install",
    point: RENAME_DESCRIPTOR_ACTIVATE,
    outcome: "completed-activation",
    generation: 2,
  },
  { mode: "install", point: "committed", outcome: "completed-activation", generation: 2 },
];

describe("a writer killed mid-transaction leaves a recoverable target", () => {
  it("names only points the production seam announces", () => {
    const vocabulary = new Set([...JOURNAL_POINTS, ...RENAME_POINTS]);
    for (const row of KILL_MATRIX) {
      expect(vocabulary).toContain(row.point);
    }
  });

  it.each(KILL_MATRIX)(
    "$mode killed at $point recovers as $outcome, leaving generation $generation",
    { timeout: 30_000 },
    async (row) => {
      const root = tempDir();
      const contentDir = join(root, DIR_NAME);
      const descriptorPath = join(root, `${DIR_NAME}.mod`);
      const materialize = (generation: Generation) =>
        row.mode === "build"
          ? write(contentDir, renderGeneration(generation))
          : install(renderGeneration(generation), { modDir: root, dirName: DIR_NAME });
      const recover = (): Promise<RecoveryReport> =>
        row.mode === "build"
          ? recoverMaterialization(contentDir)
          : recoverInstallation({ modDir: root, dirName: DIR_NAME });
      await materialize(1);

      const killed = await runMaterializeChild({
        command: "crash",
        mode: row.mode,
        root,
        dirName: DIR_NAME,
        point: row.point,
        generation: 2,
      });

      if (process.platform === "win32") {
        expect(killed.code).toBe(137);
      } else {
        expect(killed.signal).toBe("SIGKILL");
      }
      // Before recovery the target is nobody's to write: the journal is there,
      // its writer is not, and no build may guess which half-swap it is.
      expect((await refusal(materialize(2))).reason).toBe("recovery-required");

      const report = await recover();

      expect(report.outcome).toBe(row.outcome);
      expect(contentGeneration(contentDir)).toBe(row.generation);
      if (row.mode === "install") {
        expect(descriptorGeneration(descriptorPath, contentDir)).toBe(row.generation);
      }
      expect(siblings(root)).toEqual([]);
      expect(existsSync(lockPathFor(contentDir))).toBe(false);

      // And the target is ordinary again: the next build neither refuses nor
      // needs a second recovery.
      await materialize(2);
      expect(contentGeneration(contentDir)).toBe(2);
      if (row.mode === "install") {
        expect(descriptorGeneration(descriptorPath, contentDir)).toBe(2);
      }
      expect(siblings(root)).toEqual([]);
    }
  );
});

describe("a failure that is not a kill unwinds through the catch paths", () => {
  /**
   * A kill and a throw are different code: the kill proves recovery can read a
   * transaction nobody finished, and the throw proves the writer's own cleanup
   * puts the target back without recovery ever being needed. Both matter, and
   * only the second one can reach the rollback branches at all.
   */
  function failAt(point: string, act: () => void = () => {}): void {
    _setMaterializationTestHook((reached) => {
      if (reached === point) {
        act();
        throw new Error(`injected failure at ${point}`);
      }
    });
  }

  it("releases the lock when the failure left nothing on disk", async () => {
    const root = tempDir();
    const out = join(root, DIR_NAME);
    await write(out, genOne);
    failAt("staging");

    await expect(write(out, genTwo)).rejects.toThrow("injected failure");

    _setMaterializationTestHook();
    expect(siblings(root)).toEqual([]);
    expect((await write(out, genTwo)).status).toBe("written");
    expect(contentGeneration(out)).toBe(2);
  });

  it("keeps the journal as evidence when the failure left a staging tree", async () => {
    const root = tempDir();
    const out = join(root, DIR_NAME);
    await write(out, genOne);
    failAt("staged");

    await expect(write(out, genTwo)).rejects.toThrow("injected failure");

    _setMaterializationTestHook();
    expect(existsSync(lockPathFor(out))).toBe(true);
    expect((await refusal(write(out, genTwo))).reason).toBe("recovery-required");
    expect((await recoverMaterialization(out)).outcome).toBe("cleaned");
    expect(contentGeneration(out)).toBe(1);
    expect(siblings(root)).toEqual([]);
  });

  it("rolls the content back when the descriptor half fails", async () => {
    // The install's own rollback path: the content renames landed, the
    // descriptor did not, and both halves have to go back to generation one
    // without recovery being involved at all.
    const root = tempDir();
    const contentDir = join(root, DIR_NAME);
    const descriptorPath = join(root, `${DIR_NAME}.mod`);
    await install(genOne, { modDir: root, dirName: DIR_NAME });
    failAt(RENAME_DESCRIPTOR_DEACTIVATE);

    await expect(install(genTwo, { modDir: root, dirName: DIR_NAME })).rejects.toThrow(
      "injected failure"
    );

    _setMaterializationTestHook();
    expect(contentGeneration(contentDir)).toBe(1);
    expect(descriptorGeneration(descriptorPath, contentDir)).toBe(1);
    expect(siblings(root)).toEqual([]);
    expect(existsSync(lockPathFor(contentDir))).toBe(false);
    expect(existsSync(lockPathFor(descriptorPath))).toBe(false);

    const report = await install(genTwo, { modDir: root, dirName: DIR_NAME });
    expect(report.status).toBe("written");
    expect(contentGeneration(contentDir)).toBe(2);
    expect(descriptorGeneration(descriptorPath, contentDir)).toBe(2);
  });

  it("preserves the journal when the rollback itself could not finish", async () => {
    // The one failure that leaves the target neither old nor new. The hook
    // takes the staged tree away so the activation rename fails, and puts an
    // unrelated directory where the target was so the rename back fails too —
    // standing in for the rollback that cannot happen. What matters is the
    // disposition: `rolledBack: false`, the journal kept as the only account of
    // the residue, and the next writer refused rather than let loose on it.
    const root = tempDir();
    const out = join(root, DIR_NAME);
    await write(out, genOne);
    let staging = "";
    _setMaterializationTestHook((reached) => {
      if (reached !== "content-activating") {
        return;
      }
      staging = readdirSync(root).find((name) => name.startsWith(".pdx-staging-"))!;
      rmSync(join(root, staging), { recursive: true, force: true });
      mkdirSync(out);
      writeFileSync(join(out, "in-the-way.txt"), "not ours", "utf8");
    });

    const failed = await refusal(write(out, genTwo));

    _setMaterializationTestHook();
    expect(failed.failure).toEqual({ reason: "activation", rolledBack: false });
    expect(existsSync(lockPathFor(out))).toBe(true);
    expect((await refusal(write(out, genTwo))).reason).toBe("recovery-required");
    // Recovery will not touch a target it cannot account for either, so the
    // author clears the obstruction and it puts generation one back.
    expect((await refusal(recoverMaterialization(out))).reason).toBe("recovery-required");
    rmSync(out, { recursive: true, force: true });

    expect((await recoverMaterialization(out)).outcome).toBe("restored-previous");
    expect(contentGeneration(out)).toBe(1);
    expect(siblings(root)).toEqual([]);
  });
});

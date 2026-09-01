/**
 * The generation session's lifecycle: nothing reaches the output directory
 * before the swap, the committed tree holds exactly what the session wrote plus
 * the files another generator owns, and a discarded session changes nothing.
 *
 * These run against temporary directories, so the formatting assertions pin
 * that Prettier still runs on the staged text, not the repository's own style.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GeneratedOutput } from "@pdx-ts/codegen-cwt/render/generated-file";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
let outputDirectory: string;
let stagingRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "codegen-generated-output-"));
  outputDirectory = path.join(root, "generated");
  stagingRoot = path.join(root, "staging");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function openSession(): GeneratedOutput {
  return GeneratedOutput.open({ outputDirectory, stagingRoot, preserved: ["verified-build.ts"] });
}

function seedOutputDirectory(files: Record<string, string>): void {
  mkdirSync(outputDirectory, { recursive: true });
  for (const [outputFile, contents] of Object.entries(files)) {
    writeFileSync(path.join(outputDirectory, outputFile), contents, "utf8");
  }
}

function readOutput(outputFile: string): string {
  return readFileSync(path.join(outputDirectory, outputFile), "utf8");
}

function outputFiles(): string[] {
  return readdirSync(outputDirectory).sort();
}

function stagedSessions(): string[] {
  return existsSync(stagingRoot) ? readdirSync(stagingRoot) : [];
}

describe("GeneratedOutput", () => {
  it("leaves the output directory untouched until the swap", async () => {
    seedOutputDirectory({
      "keep.ts": "export const keep = 1;\n",
      "stale.ts": "export const stale = 1;\n",
    });

    const output = openSession();
    await output.write("keep.ts", "export const keep = 2;\n");
    await output.write("new.ts", "export const fresh = 1;\n");

    expect(readOutput("keep.ts")).toBe("export const keep = 1;\n");
    expect(outputFiles()).toEqual(["keep.ts", "stale.ts"]);
  });

  it("commits exactly what the session wrote, plus the preserved files", async () => {
    seedOutputDirectory({
      "keep.ts": "export const keep = 1;\n",
      "stale.ts": "export const stale = 1;\n",
      "verified-build.ts": "export const verifiedBuild = 'untouched';\n",
    });

    const output = openSession();
    await output.write("keep.ts", "export const keep = 2;\n");
    await output.write("new.ts", "export const fresh = 1;\n");
    output.commit();

    expect(outputFiles()).toEqual(["keep.ts", "new.ts", "verified-build.ts"]);
    expect(readOutput("keep.ts")).toBe("export const keep = 2;\n");
    expect(readOutput("verified-build.ts")).toBe("export const verifiedBuild = 'untouched';\n");
    expect([...output.written]).toEqual(["keep.ts", "new.ts"]);
    expect(stagedSessions()).toEqual([]);
  });

  it("discards without changing the output directory", async () => {
    seedOutputDirectory({ "keep.ts": "export const keep = 1;\n" });

    const output = openSession();
    await output.write("keep.ts", "export const keep = 2;\n");
    await output.write("new.ts", "export const fresh = 1;\n");
    output.discard();

    expect(outputFiles()).toEqual(["keep.ts"]);
    expect(readOutput("keep.ts")).toBe("export const keep = 1;\n");
    expect(stagedSessions()).toEqual([]);
  });

  it("creates the output directory when the first generation runs", async () => {
    const output = openSession();
    await output.write("new.ts", "export const fresh = 1;\n");
    output.commit();

    expect(outputFiles()).toEqual(["new.ts"]);
  });

  it("formats staged modules with Prettier", async () => {
    const output = openSession();
    await output.write("formatted.ts", "export const label = 'quoted'");
    output.commit();

    expect(readOutput("formatted.ts")).toBe('export const label = "quoted";\n');
  });

  it("rejects a file name claimed twice", async () => {
    const output = openSession();
    await output.write("once.ts", "export const once = 1;\n");

    await expect(output.write("once.ts", "export const again = 1;\n")).rejects.toThrow(
      /written twice/
    );
  });

  it("rejects a name that is not a plain file name", async () => {
    const output = openSession();

    await expect(output.write("sub/x.ts", "export const nested = 1;\n")).rejects.toThrow(
      /plain file name/
    );
    await expect(output.write("..", "export const escape = 1;\n")).rejects.toThrow(
      /plain file name/
    );
  });

  // Directory permission bits do not carry the same meaning on Windows, where
  // `chmodSync` on a directory is close to a no-op.
  it.skipIf(process.platform === "win32")(
    "commits a directory readable by everyone the old one was",
    async () => {
      seedOutputDirectory({ "keep.ts": "export const keep = 1;\n" });
      chmodSync(outputDirectory, 0o755);

      const output = openSession();
      await output.write("keep.ts", "export const keep = 2;\n");
      output.commit();

      expect(statSync(outputDirectory).mode & 0o777).toBe(0o755);
    }
  );

  // A read-only parent stops the output directory from being renamed aside,
  // which is the swap's first move. Windows does not enforce that bit.
  it.skipIf(process.platform === "win32")(
    "cleans up the staging tree when the swap fails",
    async () => {
      const outputParent = path.join(root, "locked");
      outputDirectory = path.join(outputParent, "generated");
      seedOutputDirectory({ "keep.ts": "export const keep = 1;\n" });
      chmodSync(outputParent, 0o555);

      const output = openSession();
      await output.write("keep.ts", "export const keep = 2;\n");
      try {
        expect(() => output.commit()).toThrow();

        expect(outputFiles()).toEqual(["keep.ts"]);
        expect(readOutput("keep.ts")).toBe("export const keep = 1;\n");
        expect(stagedSessions()).toEqual([]);
      } finally {
        chmodSync(outputParent, 0o755);
      }
    }
  );

  it("refuses to reuse a session after it closes", async () => {
    const output = openSession();
    await output.write("new.ts", "export const fresh = 1;\n");
    output.commit();

    await expect(output.write("late.ts", "export const late = 1;\n")).rejects.toThrow(
      /already committed or discarded/
    );
    expect(() => output.commit()).toThrow(/already committed or discarded/);
    expect(() => output.discard()).toThrow(/already committed or discarded/);
  });
});

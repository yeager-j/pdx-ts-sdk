/**
 * The feature list, appended to and never rewritten.
 *
 * `src/features.ts` is the author's file, so the rules for touching it are
 * stricter than for publishing a new module, and each rule is proved here on a
 * real filesystem: the line follows the file's own line ending, a file with no
 * trailing newline gets one first, an empty file takes the line alone, a
 * missing or symlinked list is refused rather than created or followed, a file
 * swapped between the preflight and the append is refused by identity, and an
 * append that fails before writing removes the module `generate` had just
 * published (`feature-list-written.test.ts` holds the other side of that
 * boundary). The last test runs the real command and then the real build,
 * which is the only proof that the appended line is the one the build reads.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  appendedBytes,
  appendedLineNumber,
  featureDeclaration,
  findDeclarationConflict,
} from "../src/catalog/declaration.ts";
import { deriveNames } from "../src/catalog/names.ts";
import { main } from "../src/cli.ts";
import {
  appendFeatureDeclaration,
  DeclarationConflictError,
  FeatureListError,
  preflightFeatureList,
} from "../src/feature-list.ts";
import { capture } from "./helpers/capture.ts";
import {
  createGoldenProject,
  createTempProject,
  type GoldenProject,
  type TempProject,
} from "./helpers/golden-project.ts";
import { COMPILER_TIMEOUT, NAME, PREFIX, STEM } from "./helpers/matrix.ts";

const NAMES = deriveNames(NAME);
const LINE = featureDeclaration(NAMES);

describe("the declaration line", () => {
  it("re-exports the module's feature under the derived binding", () => {
    expect(LINE).toBe(
      'export { feature as resonanceTheory } from "./features/resonance_theory.ts";'
    );
  });

  it("finds the line that already names the module's path", () => {
    const contents = [
      "// header",
      'export { feature as other } from "./features/other.ts";',
      LINE,
      "",
    ].join("\n");
    expect(findDeclarationConflict(contents, NAMES)).toEqual({ kind: "path", line: 3 });
  });

  it("finds the line that already exports the binding, under any path", () => {
    const contents = 'export { feature as resonanceTheory } from "./features/elsewhere.ts";\n';
    expect(findDeclarationConflict(contents, NAMES)).toEqual({ kind: "binding", line: 1 });
  });

  it("skips a commented-out declaration, which the author removed", () => {
    const contents = `// ${LINE}\n * ${LINE}\n`;
    expect(findDeclarationConflict(contents, NAMES)).toBeUndefined();
  });

  it("matches the whole binding rather than a prefix of a longer one", () => {
    const contents = 'export { feature as resonanceTheoryTwo } from "./features/two.ts";\n';
    expect(findDeclarationConflict(contents, NAMES)).toBeUndefined();
  });

  it.each([
    ["an empty file", "", `${LINE}\n`],
    ["a file ending in LF", "// a\n", `${LINE}\n`],
    ["a file ending in CRLF", "// a\r\n", `${LINE}\r\n`],
    ["a file with no trailing newline", "// a", `\n${LINE}\n`],
    ["a CRLF file with no trailing newline", "// a\r\n// b", `\r\n${LINE}\r\n`],
  ])("appends to %s on its own line ending", (_case, contents, expected) => {
    expect(appendedBytes(contents, LINE)).toBe(expected);
  });

  it.each([
    ["an empty file", "", 1],
    ["a one-line file", "// a\n", 2],
    ["a file with no trailing newline", "// a", 2],
    ["a two-line CRLF file", "// a\r\n// b\r\n", 3],
  ])("counts the line the declaration lands on in %s", (_case, contents, line) => {
    // The same number an editor shows for the appended line.
    const appended = `${contents}${appendedBytes(contents, LINE)}`;
    expect(appended.split(/\r?\n/)[line - 1]).toBe(LINE);
    expect(appendedLineNumber(contents)).toBe(line);
  });
});

describe("appending to a real feature list", () => {
  let roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
    roots = [];
  });

  /** A project root holding only `src/features.ts` with the given bytes. */
  function listOf(contents: string | undefined): { root: string; list: string } {
    const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pdx-feature-list-")));
    roots.push(root);
    mkdirSync(path.join(root, "src"));
    const list = path.join(root, "src/features.ts");
    if (contents !== undefined) {
      writeFileSync(list, contents);
    }
    return { root, list };
  }

  it.each([
    ["an empty list", "", `${LINE}\n`],
    ["a list without a trailing newline", "// mine", `// mine\n${LINE}\n`],
    ["a CRLF list", "// mine\r\n", `// mine\r\n${LINE}\r\n`],
  ])("appends one line to %s", async (_case, before, after) => {
    const { root, list } = listOf(before);
    const preflight = await preflightFeatureList(root, NAMES, LINE);
    await appendFeatureDeclaration(preflight);
    expect(readFileSync(list, "utf8")).toBe(after);
  });

  it("refuses a missing list rather than creating it", async () => {
    const { root, list } = listOf(undefined);
    await expect(preflightFeatureList(root, NAMES, LINE)).rejects.toThrow(FeatureListError);
    await expect(preflightFeatureList(root, NAMES, LINE)).rejects.toThrow("does not exist");
    expect(existsSync(list)).toBe(false);
  });

  it("refuses a symlinked list rather than following it", async () => {
    const { root, list } = listOf(undefined);
    const elsewhere = path.join(root, "elsewhere.ts");
    writeFileSync(elsewhere, "// elsewhere\n");
    symlinkSync(elsewhere, list);

    await expect(preflightFeatureList(root, NAMES, LINE)).rejects.toThrow(FeatureListError);
    expect(readFileSync(elsewhere, "utf8")).toBe("// elsewhere\n");
  });

  it("reports a declaration the list already carries, and refuses to append it", async () => {
    const { root, list } = listOf(`${LINE}\n`);
    const preflight = await preflightFeatureList(root, NAMES, LINE);
    expect(preflight.conflict).toEqual({ kind: "path", line: 1 });

    // The command decides what a conflict means; the append never repeats one.
    await expect(appendFeatureDeclaration(preflight)).rejects.toThrow(DeclarationConflictError);
    await expect(appendFeatureDeclaration(preflight)).rejects.toThrow("on line 1");
    expect(readFileSync(list, "utf8")).toBe(`${LINE}\n`);
  });

  it("refuses a list swapped for another file after the preflight", async () => {
    const { root, list } = listOf("// original\n");
    const preflight = await preflightFeatureList(root, NAMES, LINE);

    const replacement = path.join(root, "src/replacement.ts");
    writeFileSync(replacement, "// replacement\n");
    renameSync(replacement, list);

    await expect(appendFeatureDeclaration(preflight)).rejects.toThrow(FeatureListError);
    await expect(appendFeatureDeclaration(preflight)).rejects.toThrow("changed identity");
    expect(readFileSync(list, "utf8")).toBe("// replacement\n");
  });

  it("re-checks through the handle, so a line that arrived meanwhile is not duplicated", async () => {
    const { root, list } = listOf("// original\n");
    const preflight = await preflightFeatureList(root, NAMES, LINE);
    // Same file, same inode, one more line: the identity check passes and the
    // conflict check is what has to refuse it.
    writeFileSync(list, `// original\n${LINE}\n`);

    await expect(appendFeatureDeclaration(preflight)).rejects.toThrow(DeclarationConflictError);
    expect(readFileSync(list, "utf8")).toBe(`// original\n${LINE}\n`);
  });
});

describe("generate, against the list", () => {
  let project: TempProject | undefined;

  afterEach(() => {
    project?.dispose();
    project = undefined;
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "removes the module again when the list cannot be appended to",
    async () => {
      project = createTempProject();
      const list = path.join(project.dir, "src/features.ts");
      const before = readFileSync(list, "utf8");
      chmodSync(list, 0o444);

      try {
        const { io, out, err } = capture(project.dir);
        const code = await main(["generate", "technology", NAME, "--yes"], io);

        expect(code).toBe(1);
        expect(out()).toBe("");
        expect(err()).toContain("EACCES");
        expect(err()).toContain("removed again and nothing changed");
        expect(existsSync(path.join(project.dir, `src/features/${STEM}.ts`))).toBe(false);
        expect(readFileSync(list, "utf8")).toBe(before);
      } finally {
        chmodSync(list, 0o644);
      }
    }
  );

  it("refuses a name the list already declares, before writing anything", async () => {
    project = createTempProject();
    const list = path.join(project.dir, "src/features.ts");
    writeFileSync(list, `${readFileSync(list, "utf8")}${LINE}\n`);

    const { io, err } = capture(project.dir);
    expect(await main(["generate", "technology", NAME, "--yes"], io)).toBe(1);
    expect(err()).toContain(`already declares "./features/${STEM}.ts"`);
    expect(existsSync(path.join(project.dir, `src/features/${STEM}.ts`))).toBe(false);
  });
});

/**
 * End to end: the real command appends the real line, and the real build reads
 * it. This is the one test that proves the declaration `generate` writes is a
 * declaration `project.build` accepts.
 */
describe("a generated feature, built", () => {
  let project: GoldenProject;
  let exitCode: number;

  beforeAll(async () => {
    project = createGoldenProject();
    const { io } = capture(project.dir);
    exitCode = await main(["generate", "technology", NAME, "--yes"], io);
  }, COMPILER_TIMEOUT);

  afterAll(() => project?.dispose());

  it("declares the module in the feature list", () => {
    expect(exitCode).toBe(0);
    expect(readFileSync(path.join(project.dir, "src/features.ts"), "utf8")).toContain(LINE);
  });

  it(
    "builds it through that declaration",
    () => {
      const result = project.build();
      expect(result.status, result.output).toBe(0);
      expect(project.outFiles()).toContain(`common/technology/${PREFIX}_${STEM}.txt`);
    },
    COMPILER_TIMEOUT
  );
});

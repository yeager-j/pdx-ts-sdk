/**
 * The append, after its bytes have reached the list.
 *
 * `appendFeatureDeclaration` writes once and then flushes. A failure before
 * the write leaves the list as it was, so `generate` removes the module it
 * had just published; a failure after it leaves the declaration in the list,
 * possibly cut short, and the module has to stay. No filesystem produces the
 * second kind on request, so `open` is wrapped here: every handle is the real
 * one, and only the one call a test names misbehaves, on the list alone.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { featureDeclaration } from "../src/catalog/declaration.ts";
import { deriveNames } from "../src/catalog/names.ts";
import { main } from "../src/cli.ts";
import {
  appendFeatureDeclaration,
  DeclarationWrittenError,
  preflightFeatureList,
} from "../src/feature-list.ts";
import { capture } from "./helpers/capture.ts";
import { createTempProject, type TempProject } from "./helpers/golden-project.ts";
import { NAME, STEM } from "./helpers/matrix.ts";

type FaultKind =
  "short-write" | "write-refused" | "sync-refused" | "close-refused" | "sync-and-close-refused";

/** The one file whose next handle misbehaves, and how. */
const fault = vi.hoisted(() => ({
  current: undefined as { readonly file: string; readonly kind: string } | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const active = fault.current;
      if (active === undefined || String(args[0]) !== active.file) {
        return handle;
      }
      return faulted(handle, active.kind as FaultKind);
    },
  };
});

/** How many bytes a short write lands before stopping. */
const SHORT = 12;

const refused = (call: string): Error =>
  Object.assign(new Error(`EIO: i/o error, ${call}`), { code: "EIO" });

/**
 * The real handle with one method replaced. Every other member is bound to
 * the real handle, so its private state stays its own.
 */
function faulted(handle: FileHandle, kind: FaultKind): FileHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === "write" && kind === "short-write") {
        return async (data: string, position: number | null, encoding: BufferEncoding) => {
          const landed = await target.write(data.slice(0, SHORT), position, encoding);
          return { ...landed, buffer: data };
        };
      }
      if (property === "write" && kind === "write-refused") {
        return () => Promise.reject(refused("write"));
      }
      if (property === "sync" && (kind === "sync-refused" || kind === "sync-and-close-refused")) {
        return () => Promise.reject(refused("fsync"));
      }
      if (property === "close" && (kind === "close-refused" || kind === "sync-and-close-refused")) {
        // The real close still runs, so the descriptor is not leaked into
        // the rest of the run; only the report of it is refused.
        return async () => {
          await target.close();
          throw refused("close");
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

const NAMES = deriveNames(NAME);
const LINE = featureDeclaration(NAMES);

afterEach(() => {
  fault.current = undefined;
});

describe("appendFeatureDeclaration, once bytes have landed", () => {
  let roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
    roots = [];
  });

  function listOf(contents: string): { root: string; list: string } {
    const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pdx-list-written-")));
    roots.push(root);
    mkdirSync(path.join(root, "src"));
    const list = path.join(root, "src/features.ts");
    writeFileSync(list, contents);
    return { root, list };
  }

  it("reports a refused flush as a written declaration, naming its line", async () => {
    const { root, list } = listOf("// mine\n");
    const preflight = await preflightFeatureList(root, NAMES, LINE);
    fault.current = { file: list, kind: "sync-refused" };

    const failure = await appendFeatureDeclaration(preflight).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeclarationWrittenError);
    expect((failure as DeclarationWrittenError).line).toBe(2);
    expect((failure as Error).message).toContain("took the declaration on line 2");
    expect((failure as Error).message).toContain("EIO");
    expect(readFileSync(list, "utf8")).toBe(`// mine\n${LINE}\n`);
  });

  it("reports a short write as a written declaration, since the line is now cut", async () => {
    const { root, list } = listOf("// mine\n");
    const preflight = await preflightFeatureList(root, NAMES, LINE);
    fault.current = { file: list, kind: "short-write" };

    const failure = await appendFeatureDeclaration(preflight).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeclarationWrittenError);
    expect((failure as DeclarationWrittenError).line).toBe(2);
    expect((failure as Error).message).toContain(
      `took ${SHORT} of the ${Buffer.byteLength(`${LINE}\n`)} bytes`
    );
    expect(readFileSync(list, "utf8")).toBe(`// mine\n${LINE.slice(0, SHORT)}`);
  });

  it("reports a refused close after the write as a written declaration", async () => {
    const { root, list } = listOf("// mine\n");
    const preflight = await preflightFeatureList(root, NAMES, LINE);
    fault.current = { file: list, kind: "close-refused" };

    const failure = await appendFeatureDeclaration(preflight).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeclarationWrittenError);
    expect((failure as DeclarationWrittenError).line).toBe(2);
    expect((failure as Error).message).toContain("closing the file failed (EIO)");
    expect(readFileSync(list, "utf8")).toBe(`// mine\n${LINE}\n`);
  });

  it("keeps the flush failure when the close fails too", async () => {
    const { root, list } = listOf("// mine\n");
    const preflight = await preflightFeatureList(root, NAMES, LINE);
    fault.current = { file: list, kind: "sync-and-close-refused" };

    const failure = await appendFeatureDeclaration(preflight).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeclarationWrittenError);
    expect((failure as Error).message).toContain("flushing it to disk failed");
    expect((failure as Error).message).not.toContain("closing the file");
  });

  it("leaves a write that never landed as an ordinary failure", async () => {
    const { root, list } = listOf("// mine\n");
    const preflight = await preflightFeatureList(root, NAMES, LINE);
    fault.current = { file: list, kind: "write-refused" };

    const failure = await appendFeatureDeclaration(preflight).catch((error: unknown) => error);

    expect(failure).not.toBeInstanceOf(DeclarationWrittenError);
    expect((failure as NodeJS.ErrnoException).code).toBe("EIO");
    expect(readFileSync(list, "utf8")).toBe("// mine\n");
  });
});

describe("generate, once bytes have landed", () => {
  let project: TempProject | undefined;

  afterEach(() => {
    project?.dispose();
    project = undefined;
  });

  function listPathOf(target: TempProject): string {
    return path.join(target.dir, "src", "features.ts");
  }

  it("keeps the module when the declaration reached the list, and names the line", async () => {
    project = createTempProject();
    const list = listPathOf(project);
    const lines = readFileSync(list, "utf8").split("\n").length;
    fault.current = { file: list, kind: "sync-refused" };

    const { io, out, err } = capture(project.dir);
    const code = await main(["generate", "technology", NAME, "--yes"], io);

    expect(code).toBe(1);
    expect(out()).toBe("");
    expect(err()).toContain("was kept");
    expect(err()).toContain("may be incomplete");
    expect(err()).toContain(`Check line ${lines} of ${list}`);
    expect(existsSync(path.join(project.dir, `src/features/${STEM}.ts`))).toBe(true);
    expect(readFileSync(list, "utf8")).toContain(LINE);
  });

  it("removes the module when no byte of the declaration reached the list", async () => {
    project = createTempProject();
    const list = listPathOf(project);
    const before = readFileSync(list, "utf8");
    fault.current = { file: list, kind: "write-refused" };

    const { io, out, err } = capture(project.dir);
    const code = await main(["generate", "technology", NAME, "--yes"], io);

    expect(code).toBe(1);
    expect(out()).toBe("");
    expect(err()).toContain("EIO");
    expect(err()).toContain("removed again and nothing changed");
    expect(existsSync(path.join(project.dir, `src/features/${STEM}.ts`))).toBe(false);
    expect(readFileSync(list, "utf8")).toBe(before);
  });
});

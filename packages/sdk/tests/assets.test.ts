import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { _assetCaptureTestHook } from "../src/authoring/assets.ts";
import {
  createMod,
  LogicalPathError,
  PathOwnershipError,
  render,
  write,
  type AssetFileItem,
} from "../src/index.ts";

const temps: string[] = [];

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "pdx-assets-"));
  temps.push(directory);
  return directory;
}

function mod(prefix = "asset_probe") {
  return createMod({ name: "Asset probe", prefix, supportedVersion: "4.4.*" });
}

function pathOwnershipError(operation: () => unknown): PathOwnershipError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PathOwnershipError);
    return error as PathOwnershipError;
  }
  throw new Error("expected a path ownership error");
}

afterEach(() => {
  _assetCaptureTestHook.current = undefined;
  for (const directory of temps.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Asset capture", () => {
  it("captures absolute paths and file URL objects without keeping source data public", () => {
    const directory = tempDir();
    const source = join(directory, "blob.dds");
    writeFileSync(source, Buffer.from([1, 2, 3]));
    const capability = mod();
    const absolute = capability.assetFile({ source, path: "gfx/absolute.dds" });
    const fromUrl = capability.assetFile({ source: pathToFileURL(source), path: "gfx/url.dds" });

    expect(absolute).toMatchObject({
      itemKind: "asset",
      path: "gfx/absolute.dds",
      byteLength: 3,
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    expect(Object.keys(absolute)).toEqual(["itemKind", "path", "byteLength", "sha256"]);
    expect(Object.isFrozen(absolute)).toBe(true);
    expect(fromUrl.sha256).toBe(absolute.sha256);
  });

  it("refuses relative and non-file sources and invalid destinations", () => {
    const capability = mod();
    expect(() => capability.assetFile({ source: "relative.dds", path: "gfx/blob.dds" })).toThrow(
      "must be absolute"
    );
    expect(() =>
      capability.assetFile({
        source: new URL("https://example.com/blob.dds"),
        path: "gfx/blob.dds",
      })
    ).toThrow("file: URL");
    expect(() => capability.assetFile({ source: "/missing", path: "" })).toThrow(LogicalPathError);
    expect(() => capability.assetTree({ source: "/missing", into: "" })).toThrow(LogicalPathError);
  });

  it("includes hidden files and arbitrary extensions while omitting empty directories", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".hidden"));
    mkdirSync(join(directory, "empty"));
    writeFileSync(join(directory, ".hidden", "blob.weird"), "hidden");
    writeFileSync(join(directory, "visible.any"), "visible");
    const capability = mod();

    const items = capability.assetTree({ source: directory, into: "assets" });

    expect(items.map((item) => item.path)).toEqual([
      "assets/.hidden/blob.weird",
      "assets/visible.any",
    ]);
  });

  it("refuses empty trees, symlinks, and special files", () => {
    const empty = tempDir();
    const capability = mod();
    expect(() => capability.assetTree({ source: empty })).toThrow("contains no regular files");

    const linked = tempDir();
    writeFileSync(join(linked, "real"), "x");
    symlinkSync(join(linked, "real"), join(linked, "link"));
    expect(() => capability.assetTree({ source: linked })).toThrow("symbolic link");

    if (process.platform !== "win32") {
      const special = tempDir();
      execFileSync("mkfifo", [join(special, "pipe")]);
      expect(() => capability.assetTree({ source: special })).toThrow("non-regular entry");
    }
  });

  it("rejects NFC destination aliases before it reads any file", () => {
    const directory = tempDir();
    writeFileSync(join(directory, "café.dds"), "composed");
    writeFileSync(join(directory, "café.dds"), "decomposed");
    if (readdirSync(directory).length < 2) {
      return;
    }
    let reads = 0;
    _assetCaptureTestHook.current = { beforeRead: () => reads++ };

    expect(() => mod().assetTree({ source: directory })).toThrow(LogicalPathError);
    expect(reads).toBe(0);
  });

  it("reads files once in canonical destination order", () => {
    const directory = tempDir();
    writeFileSync(join(directory, "z.bin"), "z");
    writeFileSync(join(directory, "a.bin"), "a");
    const reads: string[] = [];
    _assetCaptureTestHook.current = { beforeRead: (source) => reads.push(source) };

    const items = mod().assetTree({ source: directory, into: "gfx" });

    expect(items.map((item) => item.path)).toEqual(["gfx/a.bin", "gfx/z.bin"]);
    expect(reads.map((source) => source.slice(directory.length + 1))).toEqual(["a.bin", "z.bin"]);
  });

  it("fails all-or-nothing when a planned entry disappears or changes type", () => {
    const directory = tempDir();
    const first = join(directory, "a.bin");
    const second = join(directory, "b.bin");
    writeFileSync(first, "a");
    writeFileSync(second, "b");
    _assetCaptureTestHook.current = {
      afterRead: (source) => {
        if (source === first) {
          rmSync(second);
        }
      },
    };
    expect(() => mod().assetTree({ source: directory })).toThrow("unavailable");

    writeFileSync(second, "b");
    _assetCaptureTestHook.current = {
      beforeRead: (source) => {
        if (source === second) {
          rmSync(second);
          mkdirSync(second);
        }
      },
    };
    expect(() => mod().assetTree({ source: directory })).toThrow("regular filesystem entry");
  });

  it("fails when the tree root changes after planning", () => {
    const directory = tempDir();
    const source = join(directory, "blob.bin");
    writeFileSync(source, "blob");
    _assetCaptureTestHook.current = {
      afterRead: () => rmSync(directory, { recursive: true }),
    };

    expect(() => mod().assetTree({ source: directory })).toThrow("Asset source");
  });

  it("refuses unreadable and missing roots where the platform enforces permissions", () => {
    const capability = mod();
    expect(() => capability.assetFile({ source: "/definitely/missing/asset", path: "x" })).toThrow(
      "unavailable"
    );
    expect(() => capability.assetTree({ source: "/definitely/missing/assets" })).toThrow(
      "unavailable"
    );
    const fileRoot = join(tempDir(), "file-root");
    writeFileSync(fileRoot, "x");
    expect(() => capability.assetTree({ source: fileRoot })).toThrow("must be a directory");
    if (process.platform !== "win32" && process.getuid?.() !== 0) {
      const directory = tempDir();
      const source = join(directory, "private");
      writeFileSync(source, "x");
      chmodSync(source, 0);
      try {
        expect(() => capability.assetFile({ source, path: "private" })).toThrow();
      } finally {
        chmodSync(source, 0o600);
      }
      const unreadableTree = tempDir();
      writeFileSync(join(unreadableTree, "blob"), "x");
      chmodSync(unreadableTree, 0);
      try {
        expect(() => capability.assetTree({ source: unreadableTree })).toThrow();
      } finally {
        chmodSync(unreadableTree, 0o700);
      }
    }
  });

  it("refuses direct file sources that are directories or symlinks", () => {
    const directory = tempDir();
    const source = join(directory, "blob.bin");
    writeFileSync(source, "x");
    const capability = mod();

    expect(() => capability.assetFile({ source: directory, path: "gfx/directory" })).toThrow(
      "regular file"
    );
    const link = join(directory, "link.bin");
    symlinkSync(source, link);
    expect(() => capability.assetFile({ source: link, path: "gfx/link.bin" })).toThrow(
      "regular file"
    );
  });

  it("refuses direct file sources that disappear or change type after planning", () => {
    const directory = tempDir();
    const source = join(directory, "blob.bin");
    writeFileSync(source, "x");
    _assetCaptureTestHook.current = {
      beforeRead: () => rmSync(source),
    };
    expect(() => mod().assetFile({ source, path: "gfx/blob.bin" })).toThrow("unavailable");

    writeFileSync(source, "x");
    _assetCaptureTestHook.current = {
      beforeRead: () => {
        rmSync(source);
        mkdirSync(source);
      },
    };
    expect(() => mod().assetFile({ source, path: "gfx/blob.bin" })).toThrow(
      "regular filesystem entry"
    );
  });

  it("is immune to later source mutation or deletion and recaptures on a fresh declaration", () => {
    const directory = tempDir();
    const source = join(directory, "blob.bin");
    writeFileSync(source, "before");
    const capability = mod();
    const before = capability.assetFile({ source, path: "gfx/blob.bin" });
    writeFileSync(source, "after");
    const after = capability.assetFile({ source, path: "gfx/after.bin" });
    rmSync(source);

    const rendered = render(capability.compile([capability.feature("assets", [before, after])]));
    expect(Buffer.from(rendered.file("gfx/blob.bin")!.bytes()).toString()).toBe("before");
    expect(Buffer.from(rendered.file("gfx/after.bin")!.bytes()).toString()).toBe("after");
    expect(before.sha256).not.toBe(after.sha256);
  });

  it("keeps unplaced items inert and feature stems as claim provenance only", () => {
    const directory = tempDir();
    const source = join(directory, "blob.bin");
    writeFileSync(source, "x");
    const capability = mod();
    const asset = capability.assetFile({ source, path: "gfx/raw/blob.bin" });

    expect(render(capability.compile([])).has("gfx/raw/blob.bin")).toBe(false);
    const compiled = capability.compile([capability.feature("different_stem", [asset])]);
    expect(render(compiled).has("gfx/raw/blob.bin")).toBe(true);
    expect(compiled.paths.find((claim) => claim.path === asset.path)?.producer).toMatchObject({
      kind: "asset",
      stems: ["different_stem"],
    });
  });

  it("rejects forged and cross-capability Asset items", () => {
    const directory = tempDir();
    const source = join(directory, "blob.bin");
    writeFileSync(source, "x");
    const alpha = mod("asset_alpha");
    const beta = mod("asset_beta");
    const asset = alpha.assetFile({ source, path: "gfx/blob.bin" });
    const forged = { ...asset } as AssetFileItem;

    expect(() => beta.feature("assets", [asset])).toThrow("does not belong");
    expect(() => alpha.feature("assets", [forged])).toThrow("does not belong");
  });

  it("lets the Fold report Asset collision details", () => {
    const directory = tempDir();
    const source = join(directory, "blob.bin");
    writeFileSync(source, "x");
    const capability = mod();
    const duplicate = [
      capability.assetFile({ source, path: "gfx/blob.bin" }),
      capability.assetFile({ source, path: "gfx/blob.bin" }),
    ];
    expect(
      pathOwnershipError(() => capability.compile([capability.feature("assets", duplicate)]))
        .conflicts[0]
    ).toMatchObject({ reason: "duplicate" });

    const aliases = [
      capability.assetFile({ source, path: "gfx/Case.bin" }),
      capability.assetFile({ source, path: "gfx/case.bin" }),
    ];
    const alias = pathOwnershipError(() =>
      capability.compile([capability.feature("assets", aliases)])
    ).conflicts.find((conflict) => conflict.reason === "portable-alias");
    expect(alias).toBeDefined();
    expect(alias!.claimants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "asset", stems: ["assets"], role: "file" }),
      ])
    );

    const file = capability.assetFile({ source, path: "gfx/node" });
    const child = capability.assetFile({ source, path: "gfx/node/blob.bin" });
    expect(
      pathOwnershipError(() => capability.compile([capability.feature("assets", [file, child])]))
        .conflicts[0]
    ).toMatchObject({ reason: "file-directory" });

    const reserved = capability.assetFile({ source, path: "descriptor.mod" });
    expect(
      pathOwnershipError(() => capability.compile([capability.feature("assets", [reserved])]))
        .conflicts[0]
    ).toMatchObject({ reason: "reserved" });

    const vanilla = capability.assetFile({
      source,
      path: "gfx/arrows/attackarrow_frame.dds",
    });
    const vanillaConflict = pathOwnershipError(() =>
      capability.compile([capability.feature("vanilla_assets", [vanilla])])
    ).conflicts.find((conflict) => conflict.reason === "vanilla");
    expect(vanillaConflict).toBeDefined();
    expect(vanillaConflict!.claimants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "asset",
          stems: ["vanilla_assets"],
          path: "gfx/arrows/attackarrow_frame.dds",
        }),
        expect.objectContaining({ kind: "vanilla" }),
      ])
    );
  });

  it("renders Asset claims in path order and materializes their exact bytes", async () => {
    const directory = tempDir();
    writeFileSync(join(directory, "z.bin"), Buffer.from([0, 255]));
    writeFileSync(join(directory, "a.bin"), Buffer.from([1, 2]));
    const capability = mod();
    const rendered = render(
      capability.compile([
        capability.feature("assets", capability.assetTree({ source: directory })),
      ])
    );

    expect([...rendered.keys()].filter((entry) => entry.endsWith(".bin"))).toEqual([
      "a.bin",
      "z.bin",
    ]);
    expect(rendered.sha256).toMatch(/^[0-9a-f]{64}$/);
    const out = join(directory, "out");
    await write(out, rendered);
    expect(
      Buffer.from(await (await import("node:fs/promises")).readFile(join(out, "z.bin")))
    ).toEqual(Buffer.from([0, 255]));
  });
});

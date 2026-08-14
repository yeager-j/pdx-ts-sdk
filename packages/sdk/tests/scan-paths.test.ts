/**
 * The install path scanner, measured against the fixture install and against
 * archives built here byte by byte.
 *
 * The archives are built in memory rather than committed, because what needs
 * proving is mostly the *refusals* — a truncated directory, a ZIP64 marker, a
 * backslash in an entry name — and a repository is a poor place to keep five
 * deliberately broken zip files. One well-formed archive is committed inside
 * `fixtures/fake-install`, since the walk has to find a real file on disk to
 * prove that the two sources merge.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { VanillaPathInventoryError } from "../src/errors.ts";
import {
  isOsMetadataPath,
  readZipEntryNames,
  scanInstallPaths,
} from "../src/stellaris/installation/scan-paths.ts";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE = path.join(ROOT, "fixtures/fake-install");

/** Stored (uncompressed) entries with empty payloads: names and nothing else. */
function buildZip(names: readonly string[], comment = ""): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const name of names) {
    const raw = encoder.encode(name);
    const local = new Uint8Array(30 + raw.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(26, raw.length, true);
    local.set(raw, 30);
    locals.push(local);

    const central = new Uint8Array(46 + raw.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(28, raw.length, true);
    centralView.setUint32(42, offset, true);
    central.set(raw, 46);
    centrals.push(central);
    offset += local.length;
  }

  const directorySize = centrals.reduce((total, one) => total + one.length, 0);
  const commentBytes = encoder.encode(comment);
  const eocd = new Uint8Array(22 + commentBytes.length);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, names.length, true);
  eocdView.setUint16(10, names.length, true);
  eocdView.setUint32(12, directorySize, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, commentBytes.length, true);
  eocd.set(commentBytes, 22);

  return concat([...locals, ...centrals, eocd]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** Where the end-of-central-directory record starts, given the comment length. */
function eocdAt(bytes: Uint8Array, commentLength = 0): DataView {
  return new DataView(bytes.buffer, bytes.byteLength - 22 - commentLength);
}

describe("isOsMetadataPath", () => {
  it("names what the machine wrote rather than what the game ships", () => {
    for (const junk of [
      ".DS_Store",
      "gfx/.DS_Store",
      "Thumbs.db",
      "gfx/models/Thumbs.db",
      "desktop.ini",
      "._junk",
      "music/._track.ogg",
      "__MACOSX/music/track.ogg",
    ]) {
      expect(isOsMetadataPath(junk), junk).toBe(true);
    }
    for (const real of [
      "common/technology/00_tech.txt",
      "music/track.ogg",
      "gfx/models/ship.mesh",
      "flags/backgrounds/00 solid.dds",
    ]) {
      expect(isOsMetadataPath(real), real).toBe(false);
    }
  });
});

describe("scanInstallPaths", () => {
  const scan = scanInstallPaths(FIXTURE);

  it("walks the install as relative, forward-slashed, byte-sorted paths", () => {
    expect(scan.paths).toContain("common/technology/00_fake_soc_tech.txt");
    expect(scan.paths).toContain("launcher-settings.json");
    expect(scan.installFiles).toBeGreaterThan(20);
    for (const one of scan.paths) {
      expect(one.startsWith("/"), one).toBe(false);
      expect(one.includes("\\"), one).toBe(false);
    }
    expect([...scan.paths]).toEqual([...scan.paths].sort());
    expect(new Set(scan.paths).size).toBe(scan.paths.length);
  });

  it("carries what the DLC archives claim, alongside the archive file itself", () => {
    expect(scan.paths).toContain("dlc/fake_dlc01/fake_dlc01.zip");
    expect(scan.paths).toContain("music/fake_dlc_track.ogg");
    expect(scan.archives).toBe(1);
    expect(scan.archiveEntries).toBe(4);
  });

  it("excludes operating-system metadata from both sources, and counts it", () => {
    for (const junk of scan.paths.filter(isOsMetadataPath)) {
      expect.unreachable(`${junk} is metadata and should not be in the inventory`);
    }
    // `.DS_Store`, `._junk`, and the `__MACOSX/` entry inside the fixture zip.
    expect(scan.junkExcluded).toBe(3);
  });

  it("treats a root with no dlc directory as an install with no archives", () => {
    const noDlc = scanInstallPaths(path.join(FIXTURE, "common"));
    expect(noDlc.archives).toBe(0);
    expect(noDlc.archiveEntries).toBe(0);
    expect(noDlc.paths.length).toBeGreaterThan(0);
  });
});

/**
 * The scanner reads an archive through a file descriptor — its tail, then the
 * byte range its index declares — rather than loading it whole. The thirty
 * real DLC archives come to a gigabyte, and every `stellaris.load()` in PR 2
 * runs this scan, so what is proved here is that the two-read path reads a real
 * file on disk correctly and still refuses a broken one.
 */
describe("scanInstallPaths over an archive on disk", () => {
  const FIXTURE_ZIP = path.join(FIXTURE, "dlc/fake_dlc01/fake_dlc01.zip");

  function installWith(archive: Uint8Array): string {
    const root = mkdtempSync(path.join(tmpdir(), "pdx-scan-paths-"));
    mkdirSync(path.join(root, "dlc/pack"), { recursive: true });
    writeFileSync(path.join(root, "dlc/pack/pack.zip"), archive);
    return root;
  }

  it("reads the committed fixture archive from a file descriptor", () => {
    const root = installWith(readFileSync(FIXTURE_ZIP));
    try {
      const scan = scanInstallPaths(root);
      expect(scan.archives).toBe(1);
      expect(scan.archiveEntries).toBe(4);
      expect(scan.junkExcluded).toBe(3);
      expect(scan.paths).toEqual(["dlc/pack/pack.zip", "music/fake_dlc_track.ogg"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an archive whose declared directory range is past the end of the file", () => {
    // The fixture's own end record kept, everything between the start of the
    // file and it cut away: the index still says where it is, and it is no
    // longer there.
    const raw = readFileSync(FIXTURE_ZIP);
    const root = installWith(concat([raw.subarray(0, 100), raw.subarray(raw.length - 22)]));
    try {
      expect(() => scanInstallPaths(root)).toThrow(VanillaPathInventoryError);
      expect(() => scanInstallPaths(root)).toThrow(
        /^dlc\/pack\/pack\.zip: central directory runs to \d+ bytes in a 122-byte file/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readZipEntryNames", () => {
  it("reads the central directory's names, comment and all", () => {
    const bytes = buildZip(["music/track.ogg", "gfx/ship.mesh"], "packed by a tool");
    expect(readZipEntryNames(bytes, "test.zip")).toEqual(["music/track.ogg", "gfx/ship.mesh"]);
  });

  it("drops directory entries, which name a container rather than a file", () => {
    const bytes = buildZip(["music/", "music/track.ogg"]);
    expect(readZipEntryNames(bytes, "test.zip")).toEqual(["music/track.ogg"]);
  });

  it("refuses a file with no end-of-central-directory record", () => {
    const bytes = new Uint8Array(200).fill(0x41);
    expect(() => readZipEntryNames(bytes, "broken.zip")).toThrow(VanillaPathInventoryError);
    expect(() => readZipEntryNames(bytes, "broken.zip")).toThrow(
      /^broken\.zip: no zip end-of-central-directory record/
    );
  });

  it("refuses a central directory that does not fit in the file", () => {
    const bytes = buildZip(["music/track.ogg"]);
    eocdAt(bytes).setUint32(12, 4096, true);
    expect(() => readZipEntryNames(bytes, "truncated.zip")).toThrow(VanillaPathInventoryError);
    expect(() => readZipEntryNames(bytes, "truncated.zip")).toThrow(
      /^truncated\.zip: central directory runs to \d+ bytes/
    );
  });

  it("refuses an entry whose name overruns the central directory", () => {
    const bytes = buildZip(["music/track.ogg"]);
    const directoryOffset = eocdAt(bytes).getUint32(16, true);
    new DataView(bytes.buffer, directoryOffset).setUint16(28, 4096, true);
    expect(() => readZipEntryNames(bytes, "short.zip")).toThrow(
      /^short\.zip: entry name at \d+ overruns/
    );
  });

  it("refuses a record that is not a central directory record", () => {
    const bytes = buildZip(["music/track.ogg"]);
    const directoryOffset = eocdAt(bytes).getUint32(16, true);
    new DataView(bytes.buffer, directoryOffset).setUint32(0, 0x02014b51, true);
    expect(() => readZipEntryNames(bytes, "odd.zip")).toThrow(
      /^odd\.zip: no central directory record signature/
    );
  });

  it("refuses an archive whose stated entry count is not what its directory holds", () => {
    // The failure the size checks cannot see: a truncation at a record
    // boundary with the directory size rewritten to match it. Everything
    // parses, and the only surviving evidence is the count the archive states.
    const bytes = buildZip(["music/track.ogg", "gfx/ship.mesh"]);
    eocdAt(bytes).setUint32(12, 46 + "music/track.ogg".length, true);
    expect(() => readZipEntryNames(bytes, "chopped.zip")).toThrow(VanillaPathInventoryError);
    expect(() => readZipEntryNames(bytes, "chopped.zip")).toThrow(
      /^chopped\.zip: states 2 central directory records and holds 1/
    );
  });

  it("refuses an archive carrying a ZIP64 locator", () => {
    const valid = buildZip(["music/track.ogg"]);
    const locator = new Uint8Array(20);
    new DataView(locator.buffer).setUint32(0, 0x07064b50, true);
    // Spliced in immediately before the end-of-central-directory record, which
    // is where a real ZIP64 archive keeps it; the records before it are
    // untouched, so every other field stays valid.
    const bytes = concat([
      valid.subarray(0, valid.length - 22),
      locator,
      valid.subarray(valid.length - 22),
    ]);
    expect(() => readZipEntryNames(bytes, "zip64.zip")).toThrow(VanillaPathInventoryError);
    expect(() => readZipEntryNames(bytes, "zip64.zip")).toThrow(
      /^zip64\.zip: carries a ZIP64 locator/
    );
  });

  it("refuses ZIP64 rather than guessing at what it cannot read", () => {
    const bytes = buildZip(["music/track.ogg"]);
    eocdAt(bytes).setUint16(10, 0xffff, true);
    expect(() => readZipEntryNames(bytes, "big.zip")).toThrow(VanillaPathInventoryError);
    expect(() => readZipEntryNames(bytes, "big.zip")).toThrow(/^big\.zip: states a ZIP64 entry/);
  });

  it("refuses a backslash in an entry name rather than rewriting it", () => {
    const bytes = buildZip(["music\\track.ogg"]);
    expect(() => readZipEntryNames(bytes, "windows.zip")).toThrow(VanillaPathInventoryError);
    expect(() => readZipEntryNames(bytes, "windows.zip")).toThrow(
      /^windows\.zip: entry name "music\\\\track\.ogg" contains a backslash/
    );
  });

  /**
   * The archive is the one input in the inventory nobody in this repo wrote,
   * and its names reach the Fold's vanilla evidence with no gate behind them.
   * A name that escapes the game root is refused here or not at all.
   */
  it("refuses an entry name that is not a path inside the game root", () => {
    for (const [name, reason] of [
      ["/etc/passwd", /is absolute/],
      ["C:/Stellaris/x.txt", /is absolute/],
      ["../common/x.txt", /has a "\.\." component/],
      ["gfx/./ship.mesh", /has a "\." component/],
      ["gfx//ship.mesh", /empty component/],
    ] as const) {
      const bytes = buildZip([name]);
      expect(() => readZipEntryNames(bytes, "hostile.zip"), name).toThrow(
        VanillaPathInventoryError
      );
      expect(() => readZipEntryNames(bytes, "hostile.zip"), name).toThrow(reason);
    }
  });

  it("keeps a directory entry's trailing separator out of the component check", () => {
    // `music/` ends in the separator that marks a directory, which is not the
    // empty component the check above refuses.
    expect(readZipEntryNames(buildZip(["music/", "music/track.ogg"]), "ok.zip")).toEqual([
      "music/track.ogg",
    ]);
  });
});

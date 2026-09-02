/**
 * The complex-enum reader, and the file it cannot read.
 *
 * A complex enum is emitted as exact membership, so a file that will not parse
 * is not one fewer file — it is an unknown number of missing members in a union
 * the SDK rejects against. The reader used to count such a file as a parser
 * repair and move on, which put the hole behind a number that reads as "the
 * parser tidied something".
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ComplexEnum } from "@pdx-ts/codegen-cwt/cwt/rules";
import { afterAll, describe, expect, it } from "vitest";

import { readComplexEnumMembers } from "../src/read-complex-enums.ts";

/**
 * A `complex_enum` whose names are the keys of each root block.
 *
 * Its selector names no key, so no file can be ruled out: every key in one is a
 * candidate member. `complex_enum[job_tag]` is the real example.
 */
const SPEC: ComplexEnum = {
  name: "fake_enum",
  source: "fake.cwt",
  path: "game/common/fake_enums",
  extension: ".txt",
  startFromRoot: true,
  selector: { path: [], kind: "key" },
};

/**
 * The other shape: a name that only exists inside a named block, as
 * `complex_enum[scrollbar_type]` reads `scrollbarType = { name = X }`.
 */
const NESTED_SPEC: ComplexEnum = {
  ...SPEC,
  name: "fake_nested_enum",
  startFromRoot: false,
  selector: { path: ["fakeBlock"], kind: "scalar", key: "name" },
};

const temps: string[] = [];

/** An install root with `common/fake_enums/`, holding the given files. */
function installWith(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "pdx-enums-"));
  temps.push(root);
  const dir = path.join(root, "common/fake_enums");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  return root;
}

afterAll(() => {
  for (const dir of temps) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readComplexEnumMembers", () => {
  it("reads the members each file declares", () => {
    const read = readComplexEnumMembers(
      installWith({ "00_fake.txt": "first = { }\nsecond = { }\n" }),
      SPEC
    );

    expect(read.members).toEqual(["first", "second"]);
    expect(read).toMatchObject({
      files: 1,
      selectorFiles: 1,
      diagnostics: 0,
      missing: false,
      gaps: [],
    });
  });

  it("does not count a parsed extension match that never reaches the selector", () => {
    const read = readComplexEnumMembers(
      installWith({ "credits.txt": 'credits = { name = "unrelated" }\n' }),
      NESTED_SPEC
    );

    expect(read).toMatchObject({ members: [], files: 1, selectorFiles: 0, missing: false });
  });

  it("records a file it cannot parse as a gap, naming the file and the reason", () => {
    // An unterminated quoted string: the parser refuses the file outright
    // rather than repairing it, which is the one input shape that reaches the
    // reader's catch.
    const read = readComplexEnumMembers(
      installWith({ "00_fake.txt": "first = { }\n", "01_broken.txt": 'second = "oops\n' }),
      SPEC
    );

    expect(read.gaps).toEqual([
      {
        inventory: "fake_enum",
        source: "common/fake_enums/01_broken.txt",
        detail: expect.stringContaining("Unterminated quoted string"),
      },
    ]);
  });

  it("does not count an unreadable file as a parser repair", () => {
    // The distinction the gap exists to make. A repair is a file the parser
    // read whole and fixed the way the game does; this one nothing read.
    const read = readComplexEnumMembers(installWith({ "00_broken.txt": 'a = "oops\n' }), SPEC);

    expect(read.diagnostics).toBe(0);
    expect(read.gaps).toHaveLength(1);
  });

  it("does not record a gap for an unparseable file that could not hold a member", () => {
    // The `interface/credits.txt` case: the install ships prose under an
    // extension an enum searches. A member of this enum can only come from
    // inside a `fakeBlock`, and this file names none, so no parse of it could
    // have contributed one — a gap here would be a false one.
    const read = readComplexEnumMembers(
      installWith({
        "00_fine.txt": 'fake = { fakeBlock = { name = "kept" } }\n',
        "01_prose.txt": "Special thanks to our forum members. FORZA DJURGÅR'N!\n",
      }),
      NESTED_SPEC
    );

    expect(read.gaps).toEqual([]);
    expect(read.members).toEqual(["kept"]);
    expect(read.selectorFiles).toBe(1);
  });

  it("records a gap when the unparseable file does name the selector's block", () => {
    // The other side of the same proof. The identifier is there, so this file
    // could have carried a member and nobody knows whether it did.
    const read = readComplexEnumMembers(
      installWith({ "00_broken.txt": 'fakeBlock = { name = "oops\n' }),
      NESTED_SPEC
    );

    expect(read.gaps).toHaveLength(1);
  });

  it("proves nothing about a selector that names no key", () => {
    // Every top-level key is a member here, so no file can be ruled out on its
    // contents and an unreadable one is always a gap.
    const read = readComplexEnumMembers(installWith({ "00_prose.txt": 'a "oops\n' }), SPEC);

    expect(read.gaps).toHaveLength(1);
  });

  it("keeps reading the remaining files, so one run names every gap", () => {
    const read = readComplexEnumMembers(
      installWith({
        "00_broken.txt": 'a = "oops\n',
        "01_fine.txt": "kept = { }\n",
        "02_broken.txt": 'b = "oops\n',
      }),
      SPEC
    );

    expect(read.members).toEqual(["kept"]);
    expect(read.gaps.map((gap) => gap.source)).toEqual([
      "common/fake_enums/00_broken.txt",
      "common/fake_enums/02_broken.txt",
    ]);
  });
});

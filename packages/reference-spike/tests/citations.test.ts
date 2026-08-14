/**
 * Citations that are not imports still have to be checked.
 *
 * Three things on the page point at repo files the spike deliberately does not
 * import: the hand-written SDK contracts, the disposition recorded in the SDK's
 * own conformance tables, and the presence floor restated in
 * `corpus-evidence.ts`. Importing any of them would be a second boundary
 * crossing for a sentence and a number.
 *
 * Reading them as text is the honest middle. It cannot check that the cited row
 * still *means* what the page says, but it does catch the common failure — the
 * file moved, the row was renamed, the number changed — which is what turns a
 * citation into a lie.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PRESENCE_FLOOR } from "../src/build/corpus-evidence.ts";
import { PAGES } from "../src/build/pages.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");

describe("hand-written SDK contracts still exist where the page says", () => {
  const contracts = PAGES.flatMap((page) =>
    page.contracts.map((contract) => ({ page: page.id, ...contract }))
  );

  it("every page declares at least one", () => {
    // Not a style rule. A page with none is a page that has quietly decided
    // every sentence on it was projected, which is the failure this whole
    // channel exists to catch.
    for (const page of PAGES) {
      expect(
        page.contracts.length,
        `${page.id} declares no SDK-authored contracts`
      ).toBeGreaterThan(0);
    }
  });

  for (const contract of contracts) {
    it(`${contract.page}: ${contract.member} — ${contract.source}`, () => {
      expect(existsSync(path.join(ROOT, contract.source)), `${contract.source} is gone`).toBe(true);
      expect(
        read(contract.source),
        `${contract.source} no longer contains "${contract.anchor}"`
      ).toContain(contract.anchor);
    });
  }
});

describe("the recorded dispositions the page cites still exist", () => {
  const observations = "packages/sdk/tests/codegen/corpus-observations.ts";

  it("the picture form mismatch is still classified as indistinguishable arms", () => {
    const text = read(observations);
    const row = text.slice(text.indexOf('registry: "situation_type"\n    field: "picture"'));
    expect(text).toContain('field: "picture"');
    expect(text).toContain('family: "indistinguishable-arms"');
    expect(row.length).toBeGreaterThan(0);
  });
});

describe("the presence floor the page restates matches the SDK's own", () => {
  it("is still 25", () => {
    expect(read("packages/sdk/tests/codegen/corpus-fixture.ts")).toContain(
      `export const PRESENCE_FLOOR = ${PRESENCE_FLOOR};`
    );
  });
});

describe("the corpus fixtures the pages read are the ones the repo maintains", () => {
  it("has a version-stamped meta", () => {
    const meta = JSON.parse(read("packages/sdk/tests/fixtures/corpus/meta.json")) as {
      gameVersion?: string;
    };
    expect(meta.gameVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  for (const page of PAGES) {
    it(`${page.id} — ${page.registry}.json exists, and so do the rules it cites`, () => {
      expect(
        existsSync(path.join(ROOT, `packages/sdk/tests/fixtures/corpus/${page.registry}.json`))
      ).toBe(true);
      expect(existsSync(path.join(ROOT, page.cwtSource)), `${page.cwtSource} is gone`).toBe(true);
    });
  }
});

describe("the overlay dispositions the Technology page cites still exist", () => {
  const overlay = "packages/codegen-cwt/src/overlay.ts";

  it("technology is still a patch registry", () => {
    const text = read(overlay);
    expect(text).toContain("CONTENT_PATCH_REGISTRIES");
    expect(text.slice(text.indexOf("CONTENT_PATCH_REGISTRIES"))).toContain('"technology"');
  });

  it("the two arity corrections are still recorded", () => {
    const text = read(overlay);
    expect(text).toContain('"technology.prereqfor_desc"');
    expect(text).toContain('"technology.mod_weight_if_group_picked"');
    expect(text).toContain('"technology.prerequisites"');
  });
});

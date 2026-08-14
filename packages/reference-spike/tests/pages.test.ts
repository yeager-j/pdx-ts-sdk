/**
 * The two page registries have to name the same pages.
 *
 * There are two because a bundler needs literal imports: `src/build/pages.ts`
 * is the build's list and can compute paths, `src/app/pages.tsx` is the
 * browser's and has to spell every MDX module and every snapshot out. Neither
 * can be derived from the other, so the duplication is real and this is what
 * holds it — a page added to one list and forgotten in the other is a page that
 * builds a snapshot nothing renders, or a tab that renders a page the gates
 * never checked.
 *
 * The viewer's list is read as text rather than imported. Importing it would
 * pull two `.mdx` modules into a Node test that has no MDX plugin behind it,
 * and the thing being checked is which names appear — which text answers
 * exactly.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PAGES, storiesPathOf } from "../src/build/pages.ts";
import { STORY_PAGE_IDS } from "../src/example/synthesize.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const viewer = readFileSync(path.join(ROOT, "packages/reference-spike/src/app/pages.tsx"), "utf8");

describe("the build registry and the viewer registry agree", () => {
  it("names the same pages, in the same order", () => {
    const ids = [...viewer.matchAll(/^\s{4}id: "([a-z0-9-]+)",$/gm)].map((match) => match[1]);
    expect(ids).toEqual(PAGES.map((page) => page.id));
  });

  it("the viewer imports every page's MDX and snapshot", () => {
    for (const page of PAGES) {
      const mdx = page.mdxPath.replace("packages/reference-spike/", "../../");
      const snapshot = page.snapshotPath.replace("packages/reference-spike/", "../../");
      expect(viewer, `${page.id} MDX`).toContain(`"${mdx}"`);
      expect(viewer, `${page.id} snapshot`).toContain(`"${snapshot}"`);
    }
  });

  it("every page has extracted stories under its own directory", () => {
    expect([...STORY_PAGE_IDS].sort()).toEqual(PAGES.map((page) => page.id).sort());
    for (const page of PAGES) {
      expect(storiesPathOf(page)).toBe(`packages/reference-spike/src/example/generated/${page.id}`);
    }
  });
});

describe("page rows are distinct where they have to be", () => {
  it("no two pages share an id, a registry, a page file or a snapshot", () => {
    for (const key of ["id", "registry", "mdxPath", "snapshotPath"] as const) {
      const values = PAGES.map((page) => page[key]);
      expect(new Set(values).size, `two pages share a ${key}`).toBe(values.length);
    }
  });

  it("every page states where its rules and its definitions come from", () => {
    for (const page of PAGES) {
      expect(page.cwtSource, page.id).toMatch(/^vendor\/cwtools-stellaris-config\//);
      expect(page.definitionNoun.length, page.id).toBeGreaterThan(0);
      expect(
        page.aliases.length,
        `${page.id} is findable by nothing but its own prose`
      ).toBeGreaterThan(0);
    }
  });
});

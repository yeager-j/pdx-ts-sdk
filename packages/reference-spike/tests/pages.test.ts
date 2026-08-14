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
 *
 * There are three lists now, not two. `starlight/src/builds.ts` is the
 * framework viewer's, and it exists for the identical reason: Astro cannot
 * follow a path out of a data structure either. A second viewer doubles the
 * number of places a third page can be forgotten, so it is held to the same
 * check — and so is the set of derived components, which each viewer maps by
 * hand and neither can derive from the MDX.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PAGES, storiesPathOf } from "../src/build/pages.ts";
import { STORY_PAGE_IDS } from "../src/example/synthesize.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relative: string) =>
  readFileSync(path.join(ROOT, "packages/reference-spike", relative), "utf8");

const viewer = read("src/app/pages.tsx");
const starlightBuilds = read("starlight/src/builds.ts");
const starlightComponents = read("starlight/src/components/index.ts");
const starlightRemark = read("starlight/src/remark.ts");
const reactApp = read("src/app/App.tsx");

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

describe("the framework viewer's registry agrees too", () => {
  it("names every page", () => {
    for (const page of PAGES) {
      expect(starlightBuilds, `${page.id} is missing from starlight/src/builds.ts`).toContain(
        `${page.id}:`
      );
    }
  });

  it("imports every page's snapshot", () => {
    for (const page of PAGES) {
      const snapshot = page.snapshotPath.replace("packages/reference-spike/", "../../");
      expect(starlightBuilds, `${page.id} snapshot`).toContain(`"${snapshot}"`);
    }
  });

  it("does not import the pages' MDX", () => {
    // The framework loads prose through a content collection pointed at
    // `../content`, not through a literal import — which is the one place its
    // registry is *smaller* than the React viewer's. If an `.mdx` import ever
    // appears here, the collection has been bypassed and the two viewers have
    // stopped rendering the same file.
    expect(starlightBuilds).not.toMatch(/\.mdx"/);
  });
});

describe("both viewers render every derived component the pages use", () => {
  // Neither viewer can derive this: MDX resolves `<Claim>` against a map the
  // viewer hands it, so a component used in prose and missing from the map
  // renders as nothing at all. It is silent in React and silent in Astro, and
  // it is the failure a second viewer makes twice as likely.
  const used = [
    ...new Set(
      PAGES.flatMap((page) => [
        ...read(page.mdxPath.replace("packages/reference-spike/", "")).matchAll(
          /<([A-Z][A-Za-z]*)[\s/>]/g
        ),
      ]).map((match) => match[1]!)
    ),
  ].sort();

  it("finds the components the prose actually calls", () => {
    expect(used.length).toBeGreaterThan(3);
    expect(used).toContain("Claim");
    expect(used).toContain("FieldTable");
  });

  it.each(used)("the React viewer maps %s", (name) => {
    expect(reactApp).toMatch(new RegExp(`\\b${name}:`));
  });

  it.each(used)("the framework viewer maps %s", (name) => {
    expect(starlightComponents).toMatch(new RegExp(`\\b${name},`));
  });

  it.each(used)("the framework viewer gives %s its page", (name) => {
    // Every derived component resolves its data by page id, and the page id
    // arrives as an attribute the `pageOwnership` plugin writes. A component
    // missing from that set is one whose `page` prop is `undefined`, which
    // throws in `buildOf` rather than rendering wrongly — loud, but only if
    // the name is listed here.
    expect(starlightRemark).toContain(`"${name}"`);
  });
});

describe("the framework viewer keeps the highlighter out of the browser", () => {
  // The defect this exists for shipped, and only the bundle size found it.
  // `coloursOf` sat in `builds.ts`; `ReferenceSearch.tsx` is a hydrated island
  // that imports `builds.ts`; a bundler follows imports rather than intentions.
  // Shiki went with it and brought every TextMate grammar it ships — a 9.4 MB
  // client bundle for a page that renders three languages.
  //
  // The first viewer could not do this: its highlighting was behind a Vite
  // virtual module whose `load` hook runs in Node, so there was no import edge
  // to follow. Astro made the bridge unnecessary and the wall went with it, so
  // the wall is a test now.
  const starlightSources = [
    "starlight/src/builds.ts",
    "starlight/src/components/ReferenceSearch.tsx",
    "starlight/src/components/index.ts",
    "starlight/src/content.config.ts",
    "starlight/src/remark.ts",
  ];

  // Import specifiers, not any mention of the name: these modules explain in
  // prose why they must not import the highlighter, and a substring check
  // fails on the explanation.
  const importsOf = (source: string) =>
    [...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map(
      (match) => match[1]!
    );

  it.each(starlightSources)("%s does not reach the highlighter", (relative) => {
    const reached = importsOf(read(relative)).filter(
      (specifier) =>
        specifier.includes("build/highlight.ts") || specifier.includes("highlighting.ts")
    );
    expect(reached, `${relative} would pull Shiki into the client bundle`).toEqual([]);
  });

  it("only Astro components import the highlighting module", () => {
    // `.astro` frontmatter runs in Node at build time and is never bundled for
    // the client, which is what makes it the one safe importer.
    expect(read("starlight/src/components/StoryPanel.astro")).toContain("../highlighting.ts");
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

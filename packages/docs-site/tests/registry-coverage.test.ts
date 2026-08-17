/**
 * The coverage gate, on inputs the real site cannot produce.
 *
 * `astro build` already runs the gate against the real registries and the real
 * pages, and that is the gate. What it cannot do is prove the gate *fails* —
 * every failure it can reach is one the site does not have. So the cases that
 * matter here are the doctored ones: an undocumented registry, a stale skip
 * line, two pages claiming one registry. Each is a way for the reference to go
 * quietly wrong, and each is silent unless something throws.
 *
 * The folder derivation gets the same treatment. Its shape is the collapse rule
 * — when a subfolder is the parent's filing rather than a concept of its own —
 * and that rule is stated against synthetic paths where the answer is visible,
 * then checked once against the real install for the two cases the rule exists
 * to get right.
 */

import { CONTENT_REGISTRIES } from "@pdx-ts/sdk/content-registries";
import { VANILLA_PATHS } from "@pdx-ts/stellaris-ids/paths";
import { describe, expect, it } from "vitest";

import {
  buildCoverage,
  coverRegistries,
  foldersHoldingFiles,
  scriptConcepts,
  UNDOCUMENTED_REGISTRIES,
  type ReferencePage,
} from "../src/registry-coverage.ts";

const REGISTRIES = [
  { registry: "technology", folder: "common/technology" },
  { registry: "building", folder: "common/buildings" },
];

const page = (id: string, registries?: readonly string[]): ReferencePage => ({
  id,
  href: `/${id}/`,
  title: id,
  ...(registries === undefined ? {} : { registries }),
});

describe("the registry gate", () => {
  it("accepts a registry a page documents", () => {
    const rows = coverRegistries(REGISTRIES, [page("reference/technology", ["technology"])], {
      building: "SDK-201",
    });
    expect(rows.map((row) => row.page?.href)).toEqual(["/reference/technology/", undefined]);
    expect(rows[1]?.undocumented).toBe("SDK-201");
  });

  it("rejects a registry with neither a page nor a skip line", () => {
    expect(() =>
      coverRegistries(REGISTRIES, [page("reference/technology", ["technology"])], {})
    ).toThrow(/No reference page documents building/);
  });

  it("rejects a skip line for a registry that is now documented", () => {
    expect(() =>
      coverRegistries(
        REGISTRIES,
        [page("reference/technology", ["technology"]), page("reference/buildings", ["building"])],
        { building: "SDK-201" }
      )
    ).toThrow(/still excuses "building"/);
  });

  it("rejects a skip line for a registry that no longer exists", () => {
    expect(() =>
      coverRegistries(REGISTRIES, [page("reference/technology", ["technology"])], {
        building: "SDK-201",
        relic: "SDK-999",
      })
    ).toThrow(/lists "relic", which the SDK does not expose/);
  });

  it("rejects a page claiming a registry that does not exist", () => {
    expect(() =>
      coverRegistries(REGISTRIES, [page("reference/relics", ["relic"])], {
        technology: "SDK-201",
        building: "SDK-201",
      })
    ).toThrow(/does not expose/);
  });

  it("rejects two pages claiming one registry", () => {
    expect(() =>
      coverRegistries(
        REGISTRIES,
        [
          page("reference/technology", ["technology"]),
          page("reference/ship-stack", ["technology"]),
        ],
        { building: "SDK-201" }
      )
    ).toThrow(/Both "reference\/technology" and "reference\/ship-stack"/);
  });

  it("rejects a reference page that declares no registries at all", () => {
    expect(() =>
      coverRegistries(REGISTRIES, [page("reference/technology")], {
        technology: "SDK-201",
        building: "SDK-201",
      })
    ).toThrow(/declares no "registries" frontmatter/);
  });

  it("leaves pages outside reference/ alone", () => {
    expect(() =>
      coverRegistries(REGISTRIES, [page("guides/your-first-technology")], {
        technology: "SDK-201",
        building: "SDK-201",
      })
    ).not.toThrow();
  });

  // The section index is `reference`, not `reference/index`: the id has no
  // slash, so the obvious membership test misses the page most obviously in the
  // section, and it declares an empty list rather than none.
  it("counts the section index as a reference page", () => {
    const skips = { technology: "SDK-201", building: "SDK-201" };
    expect(() => coverRegistries(REGISTRIES, [page("reference")], skips)).toThrow(
      /declares no "registries" frontmatter/
    );
    expect(() => coverRegistries(REGISTRIES, [page("reference", [])], skips)).not.toThrow();
  });

  it("rejects a guide claiming a registry, rather than letting it satisfy the gate", () => {
    expect(() =>
      coverRegistries(REGISTRIES, [page("guides/triggers-and-effects", ["technology"])], {
        building: "SDK-201",
      })
    ).toThrow(/only pages under reference\/ document a registry/);
  });

  it("links a page at the route the caller gives it, not at its id", () => {
    const rows = coverRegistries(
      REGISTRIES,
      [
        {
          id: "reference/technology",
          href: "/docs/reference/tech/",
          title: "Technology",
          registries: ["technology"],
        },
      ],
      { building: "SDK-201" }
    );
    expect(rows[0]?.page?.href).toBe("/docs/reference/tech/");
  });
});

describe("the folder diff", () => {
  it("counts the folder holding a file, never the folders above it", () => {
    const folders = foldersHoldingFiles(
      ["common/governments/civics/00_civics.txt", "common/achievements.json"],
      ".txt"
    );
    expect([...folders]).toEqual(["common/governments/civics"]);
  });

  it("treats a subfolder of a script folder as that folder's filing", () => {
    const paths = [
      "common/inline_scripts/00_inline.txt",
      "common/inline_scripts/ai/00_ai.txt",
      "common/inline_scripts/ai/weights/00_weights.txt",
    ];
    expect(scriptConcepts(paths, new Set())).toEqual(["common/inline_scripts"]);
  });

  it("keeps a subfolder when the supported line runs between it and its parent", () => {
    const paths = [
      "common/technology/00_tech.txt",
      "common/technology/category/00_categories.txt",
      "common/governments/00_governments.txt",
      "common/governments/civics/00_civics.txt",
    ];
    const claimed = new Set(["common/technology", "common/governments/civics"]);
    expect(scriptConcepts(paths, claimed)).toEqual([
      "common/governments",
      "common/governments/civics",
      "common/technology",
      "common/technology/category",
    ]);
  });

  it("never collapses a top-level folder into common/ itself", () => {
    const paths = ["common/achievements.txt", "common/edicts/00_edicts.txt"];
    expect(scriptConcepts(paths, new Set())).toContain("common/edicts");
  });

  it("counts a type the game keeps in one root file, which has no folder to find", () => {
    const paths = ["common/alerts.txt", "common/edicts/00_edicts.txt", "common/notes.json"];
    expect(scriptConcepts(paths, new Set())).toEqual(["common/alerts.txt", "common/edicts"]);
  });
});

describe("the real coverage", () => {
  // A page for every registry no skip line excuses, so that these assertions
  // survive the reference milestone: as pages land, skip lines are deleted and
  // this stands in for the pages that replaced them.
  const coverage = buildCoverage(
    CONTENT_REGISTRIES.map((descriptor) => descriptor.type as string)
      .filter((registry) => UNDOCUMENTED_REGISTRIES[registry] === undefined)
      .map((registry) => page(`reference/${registry}`, [registry]))
  );

  it("has a row for every registry the SDK exposes", () => {
    expect(coverage.registries).toHaveLength(CONTENT_REGISTRIES.length);
  });

  it("reports concepts the SDK cannot author, and none it can", () => {
    const supported = new Set(coverage.registries.map((row) => row.folder));
    for (const folder of coverage.unsupported) {
      expect(supported.has(folder)).toBe(false);
    }
    // Two the collapse rule has to keep apart: technology is supported and its
    // categories are not, civics are supported and governments are not.
    expect(coverage.unsupported).toContain("common/technology/category");
    expect(coverage.unsupported).toContain("common/governments");
    expect(coverage.unsupported).not.toContain("common/governments/civics");
    // One the rule has to fold away: inline scripts are one concept, not forty.
    expect(
      coverage.unsupported.filter((folder) => folder.startsWith("common/inline_scripts"))
    ).toEqual(["common/inline_scripts"]);
  });

  it("claims the on-actions folder for the channel that writes it", () => {
    expect(coverage.unsupported).not.toContain("common/on_actions");
  });

  it("reports the types the game keeps in a root file", () => {
    expect(coverage.unsupported).toContain("common/alerts.txt");
    expect(coverage.unsupported).toContain("common/achievements.txt");
  });

  it("prints a call that exists for every registry", () => {
    const paths = foldersHoldingFiles(VANILLA_PATHS);
    for (const row of coverage.registries) {
      expect(row.method).toMatch(/^[a-z][A-Za-z]*$/);
      expect(paths.has(row.folder)).toBe(true);
    }
  });
});

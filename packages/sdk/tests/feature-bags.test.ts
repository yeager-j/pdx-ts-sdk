/**
 * Module namespaces as bags: `mod.feature(stem, import * as items)` places the
 * Item-valued exports, and `mod.compile(import * as features)` and
 * `project.build(features)` compile a declared feature list. Every fixture is
 * a real module under `fixtures/bags/`, so `tsc` sees the same namespaces the
 * runtime walks.
 */

import { describe, expect, it } from "vitest";

import { ProjectManifestError, render } from "../src/index.ts";
import * as aliasedItems from "./fixtures/bags/aliased-items.ts";
import * as cycleA from "./fixtures/bags/cycle-a.ts";
import * as emptyFeatures from "./fixtures/bags/empty-features.ts";
import * as emptyItems from "./fixtures/bags/empty-items.ts";
import * as featureInItems from "./fixtures/bags/feature-in-items.ts";
import * as featuresWithString from "./fixtures/bags/features-with-string.ts";
import * as features from "./fixtures/bags/features.ts";
import * as foreignFeatures from "./fixtures/bags/foreign-features.ts";
import * as foreignItems from "./fixtures/bags/foreign-items.ts";
import * as items from "./fixtures/bags/items.ts";
import { mod } from "./fixtures/bags/mod.ts";
import * as projectFeatures from "./fixtures/bags/project-features.ts";
import { project } from "./fixtures/bags/project.ts";

describe("mod.feature with a module namespace", () => {
  it("places the Item exports, nested namespaces included, and nothing else", () => {
    const feature = mod.feature("bag", items);

    expect(feature.items).toHaveLength(3);
    expect(feature.items).toContain(items.alpha);
    expect(feature.items).toContain(items.beta);
    expect(feature.items).toContain(items.nested.deep);
    // A plain object is the author's value, not a module: it is not walked.
    expect(feature.items).not.toContain(items.holder.hidden);

    const rendered = render(mod.compile([feature]));
    const technology = rendered.get("common/technology/feature_bags_bag.txt");
    expect(technology).toContain("feature_bags_tech_alpha");
    expect(technology).toContain("feature_bags_tech_deep");
    expect(technology).not.toContain("feature_bags_tech_hidden");
  });

  it("refuses a bag that holds no Items, naming what it does hold", () => {
    expect(() => mod.feature("empty", emptyItems)).toThrow(
      'The module passed to mod.feature("empty") exports no Items (its exports are "helper", ' +
        '"note"), so nothing would be placed. Pass the module that holds the Items, or an ' +
        "explicit array."
    );
    // An explicit empty list is a decision, not an accident.
    expect(() => mod.feature("empty", [])).not.toThrow();
  });

  it("refuses a Feature among the Items rather than dropping or double-placing it", () => {
    expect(() => mod.feature("mixed", featureInItems)).toThrow(
      'Export "placed" of the module passed to mod.feature("mixed") is a Feature (stem ' +
        '"elsewhere") - a Feature is compiled by mod.compile, never placed inside another Feature.'
    );
  });

  it("takes only an array or a module namespace", () => {
    expect(() => mod.feature("bare", items.alpha as never)).toThrow(
      'mod.feature("bare") takes an array of Items or a module namespace (import * as), and was ' +
        'given one Item (itemKind "content").'
    );
    expect(() => mod.feature("plain", { alpha: items.alpha } as never)).toThrow(
      'mod.feature("plain") takes an array of Items or a module namespace (import * as), and ' +
        "was given an object."
    );
    expect(() => mod.feature("text", "items" as never)).toThrow(
      'mod.feature("text") takes an array of Items or a module namespace (import * as), and ' +
        "was given a string."
    );
  });

  it("still checks ownership of every Item it reaches", () => {
    expect(() => mod.feature("foreign", foreignItems)).toThrow(
      /Content id "other_bags_tech_foreign" does not belong to mod prefix "feature_bags"/
    );
  });

  it("ends an export * as cycle and places each Item once", () => {
    const feature = mod.feature("cycle", cycleA);
    expect(feature.items).toHaveLength(2);
    expect(feature.items).toContain(cycleA.fromA);
    expect(feature.items).toContain(cycleA.b.fromB);
  });

  it("places one Item reached under two export names once", () => {
    const feature = mod.feature("aliased", aliasedItems);
    expect(feature.items).toEqual([aliasedItems.epsilon]);
  });
});

describe("compiling a features module", () => {
  it("compiles every exported Feature through mod.compile", () => {
    const rendered = render(mod.compile(features));
    expect(rendered.get("common/technology/feature_bags_main.txt")).toContain(
      "feature_bags_tech_alpha"
    );
    expect(rendered.get("common/technology/feature_bags_second.txt")).toContain(
      "feature_bags_tech_zeta"
    );
  });

  it("refuses an export that is not a Feature", () => {
    expect(() => mod.compile(featuresWithString as never)).toThrow(
      'Export "note" of the features module is not a Feature: every export of features.ts ' +
        'must be the "feature" of one feature module, and this one is a string.'
    );
  });

  it("refuses a features module with no exports, while an empty array stays legal", () => {
    expect(() => mod.compile(emptyFeatures)).toThrow(
      "The features module exports no Features, so the mod would have no content. Re-export " +
        'each feature module\'s feature from it: export { feature as <name> } from "./features/<name>.ts";'
    );
    expect(() => mod.compile([])).not.toThrow();
  });

  it("still refuses a Feature placed by another capability", () => {
    expect(() => mod.compile(foreignFeatures as never)).toThrow(
      'Feature does not belong to mod prefix "feature_bags"'
    );
  });
});

describe("project.build with a features module", () => {
  it("compiles the declared Features plus the Asset tree, synchronously", () => {
    const built = project.build(projectFeatures);
    expect(built).not.toBeInstanceOf(Promise);

    const rendered = render(built);
    expect(rendered.get("common/technology/bag_project_declared.txt")).toContain(
      "bag_project_tech_declared"
    );
    expect(new TextDecoder().decode(rendered.file("gfx/interface/bag-icon.txt")?.bytes())).toBe(
      "bag icon bytes"
    );
    expect(built.compileInputs.features).toEqual([
      { stem: "assets", itemCount: 1, itemIds: [] },
      { stem: "declared", itemCount: 1, itemIds: ["bag_project_tech_declared"] },
    ]);
  });

  it("cannot discover without a contentDirectory, and says what to pass instead", async () => {
    await expect(project.build()).rejects.toThrow(ProjectManifestError);
    await expect(project.build()).rejects.toThrow(
      'Project Manifest has no "contentDirectory", so build(options) cannot discover Features; ' +
        "pass the features module: project.build(features)."
    );
  });
});

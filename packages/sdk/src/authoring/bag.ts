/**
 * Module namespaces as bags of Items and of Features.
 *
 * A project declares its content the way a Rust crate declares its module
 * tree: a feature module places Items with `mod.feature(stem, import * as
 * items)`, and `src/features.ts` re-exports every feature module's `feature`
 * for `mod.compile(features)` and `project.build(features)`. This module reads
 * those namespaces. It is pure: it walks the exports it is given and either
 * returns the values that count or throws about the one that does not.
 */

import { describeValue } from "../describe-value.ts";
import { isFeature, isItem, type Feature, type ModItem } from "./feature.ts";

/**
 * A module namespace passed to `mod.feature` in place of an array: every
 * Item-valued export is placed, and every other export is ordinary module API.
 *
 * `itemKind` is withheld so that one Item, or one Feature, is refused where a
 * bag is expected: both carry it, and a bag of exports never does.
 */
export type ItemBag = {
  readonly [exportName: string]: unknown;
  readonly itemKind?: never;
};

/**
 * Whether the value is a module namespace object, as `import * as` binds.
 *
 * `Object.prototype.toString` reads the namespace's `@@toStringTag`, which the
 * language fixes at `"Module"` and which no plain object carries unless it
 * says so on purpose. That is the one observable a namespace has and an
 * object literal does not, which is what keeps a plain object holding Items
 * from being walked as if it were a module.
 */
export function isModuleNamespace(value: unknown): value is Readonly<Record<string, unknown>> {
  return Object.prototype.toString.call(value) === "[object Module]";
}

function callSite(stem: string | undefined): string {
  return `mod.feature(${stem === undefined ? "undefined" : JSON.stringify(stem)})`;
}

/** A lone Item is the likely mistake, and "an object" would not say so. */
function describeNonBag(value: unknown): string {
  return isItem(value) ? `one Item (itemKind "${value.itemKind}")` : describeValue(value);
}

/**
 * The Items a module namespace exports, for `mod.feature(stem, bag)`.
 *
 * Every Item-valued export is taken, and a nested namespace (`export * as`) is
 * walked the same way. Everything else an author exports beside their Items,
 * such as a string, a function, or a plain object, is module API and is left
 * alone; a plain object is not walked even when it holds Items, because an
 * object literal is a value the author built and a namespace is a file they
 * wrote. One Item reached under several export names is placed once, since a
 * re-export is one binding rather than a second placement.
 *
 * The order of the result follows the namespace's export order, which the
 * language sorts by name and a bundler's module shim may not. Nothing
 * downstream depends on it: the fold derives emission order from content,
 * never from position (docs/adr/0005).
 *
 * @throws Error - When `bag` is not a module namespace, when an export is a
 * Feature (ignoring it would drop content, placing its Items would place them
 * twice), or when no export is an Item, so nothing would be placed.
 */
export function itemsOfBag(stem: string | undefined, bag: ItemBag): readonly ModItem[] {
  if (!isModuleNamespace(bag)) {
    throw new Error(
      `${callSite(stem)} takes an array of Items or a module namespace (import * as), ` +
        `and was given ${describeNonBag(bag)}.`
    );
  }
  const items: ModItem[] = [];
  const placed = new Set<ModItem>();
  const walked = new Set<object>();

  const walk = (namespace: Readonly<Record<string, unknown>>, pathPrefix: string): void => {
    walked.add(namespace);
    for (const [name, value] of Object.entries(namespace)) {
      const exportPath = `${pathPrefix}${name}`;
      if (isFeature(value)) {
        throw new Error(
          `Export "${exportPath}" of the module passed to ${callSite(stem)} is a Feature ` +
            `(stem ${JSON.stringify(value.stem)}) - a Feature is compiled by mod.compile, ` +
            `never placed inside another Feature.`
        );
      }
      if (isItem(value)) {
        const item = value as ModItem;
        if (!placed.has(item)) {
          placed.add(item);
          items.push(item);
        }
        continue;
      }
      // `export * as` cycles are legal ESM; the walked set is what ends them.
      if (isModuleNamespace(value) && !walked.has(value)) {
        walk(value, `${exportPath}.`);
      }
    }
  };
  walk(bag, "");

  if (items.length === 0) {
    // Sorted here so the message reads the same under every module loader.
    const exportNames = Object.keys(bag)
      .sort()
      .map((name) => JSON.stringify(name))
      .join(", ");
    throw new Error(
      `The module passed to ${callSite(stem)} exports no Items (its exports are ` +
        `${exportNames}), so nothing would be placed. Pass the module that holds the Items, ` +
        `or an explicit array.`
    );
  }
  return Object.freeze(items);
}

/**
 * The Features a project's features module exports, for `mod.compile` and
 * `project.build`.
 *
 * Every export must be a Feature: the module is the declared list of what the
 * mod contains, so an export that is anything else is a mistake in that list
 * rather than module API to skip. One Feature reached under two names is
 * compiled once.
 *
 * @throws Error - When an export is not a Feature, or when there are no
 * exports at all, so the mod would have no content.
 */
export function featuresOfBag<F extends Feature>(
  bag: Readonly<Record<string, unknown>>
): readonly F[] {
  const exports = Object.entries(bag);
  if (exports.length === 0) {
    throw new Error(
      "The features module exports no Features, so the mod would have no content. " +
        "Re-export each feature module's feature from it: " +
        'export { feature as <name> } from "./features/<name>.ts";'
    );
  }
  const features: F[] = [];
  for (const [name, value] of exports) {
    if (!isFeature(value)) {
      throw new Error(
        `Export "${name}" of the features module is not a Feature: every export of ` +
          `features.ts must be the "feature" of one feature module, and this one is ` +
          `${describeValue(value)}.`
      );
    }
    if (!features.includes(value as F)) {
      features.push(value as F);
    }
  }
  return Object.freeze(features);
}

/**
 * The Features behind either form `mod.compile` and `project.build` accept:
 * an explicit array is taken as given, and a features module is read as a
 * bag. Kept here so the two callers agree on the one decision that matters,
 * "is this an array or a module".
 *
 * `Array.isArray` narrows to `any[]` and leaves a readonly array in its other
 * branch, so the array branch restates what the parameter type already says.
 */
export function featuresOfInput<F extends Feature>(
  input: readonly F[] | Readonly<Record<string, unknown>>
): readonly F[] {
  return Array.isArray(input)
    ? (input as readonly F[])
    : featuresOfBag<F>(input as Readonly<Record<string, unknown>>);
}

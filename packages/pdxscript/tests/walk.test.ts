/**
 * The walker's claims: what one item holds, and the order and context of a
 * pre-order walk. One-line inputs, in the per-claim style of parser.test.ts.
 */

import { describe, expect, it } from "vitest";

import {
  itemChildren,
  parse,
  skipChildren,
  stopWalk,
  walkItems,
  type PdxItem,
  type RegionPolicy,
} from "../src/index.ts";

/** One item of each kind: a kind added to the AST fails to compile here. */
const SPECIMENS = {
  str: { kind: "str", value: "a", quoted: false },
  num: { kind: "num", lexeme: "1" },
  bool: { kind: "bool", value: true },
  var: { kind: "var", name: "@dist" },
  math: { kind: "math", source: "@[ 1 + 1 ]" },
  entry: { kind: "entry", key: "k", op: "=", value: { kind: "str", value: "v", quoted: false } },
  container: { kind: "container", items: [{ kind: "num", lexeme: "1" }] },
  param: { kind: "param", name: "X", negated: false, items: [{ kind: "num", lexeme: "2" }] },
  "param-text": { kind: "param-text", name: "X", negated: false, text: "a @dist {" },
} satisfies Record<PdxItem["kind"], PdxItem>;

const SCALARS = [
  SPECIMENS.str,
  SPECIMENS.num,
  SPECIMENS.bool,
  SPECIMENS.var,
  SPECIMENS.math,
] as const;

/** Enough of an item to read a visit order. */
function describeItem(item: PdxItem): string {
  if (item.kind === "entry") {
    return `entry ${item.key}`;
  }
  if (item.kind === "str") {
    return `str ${item.value}`;
  }
  if (item.kind === "num") {
    return `num ${item.lexeme}`;
  }
  if (item.kind === "var") {
    return `var ${item.name}`;
  }
  return item.kind;
}

/** Every item a walk of `source` visits, in visit order. */
function trace(source: string, regions: RegionPolicy): string[] {
  const visited: string[] = [];
  walkItems(
    parse(source, "walk.txt").items,
    undefined,
    (item) => {
      visited.push(describeItem(item));
      return undefined;
    },
    regions
  );
  return visited;
}

describe("itemChildren", () => {
  it("gives an entry its value", () => {
    expect(itemChildren(SPECIMENS.entry, "skip")).toEqual([SPECIMENS.entry.value]);
  });

  it("gives a container and a param block the tree's own items array", () => {
    expect(itemChildren(SPECIMENS.container, "skip")).toBe(SPECIMENS.container.items);
    expect(itemChildren(SPECIMENS.param, "skip")).toBe(SPECIMENS.param.items);
  });

  it("gives every scalar kind no children", () => {
    for (const scalar of SCALARS) {
      expect(itemChildren(scalar, "skip")).toEqual([]);
    }
  });

  it("reads a region's body flat, and only under a reading policy", () => {
    expect(itemChildren(SPECIMENS["param-text"], "skip")).toEqual([]);
    expect(itemChildren(SPECIMENS["param-text"], { read: true })).toEqual([
      { kind: "str", value: "a", quoted: false },
      { kind: "var", name: "@dist" },
    ]);
  });

  it("answers for every item kind", () => {
    for (const item of Object.values(SPECIMENS)) {
      expect(itemChildren(item, { read: true })).toBeInstanceOf(Array);
    }
  });
});

describe("walkItems", () => {
  it("visits a parent before its children, and siblings in source order", () => {
    expect(trace("a = { b = 1 c }\nd = 2", "skip")).toEqual([
      "entry a",
      "container",
      "entry b",
      "num 1",
      "str c",
      "entry d",
      "num 2",
    ]);
  });

  it("visits an entry's value but never a key or a container header", () => {
    expect(trace("color = hsv { 0.1 }", "skip")).toEqual(["entry color", "container", "num 0.1"]);
  });

  it("enters a region with no tree only under a reading policy", () => {
    const source = "e = { [[X] a = { ] }";
    expect(trace(source, "skip")).toEqual(["entry e", "container", "param-text"]);
    expect(trace(source, { read: true })).toEqual(["entry e", "container", "param-text", "str a"]);
  });

  it("names the file of a region body that does not lex", () => {
    const region: PdxItem = { kind: "param-text", name: "X", negated: false, text: "a ?= 1" };
    expect(() => walkItems([region], undefined, () => undefined, { read: true })).toThrow(
      /<region>:1/
    );
    expect(() =>
      walkItems([region], undefined, () => undefined, { read: true, fileName: "probe.txt" })
    ).toThrow(/probe\.txt:1/);
  });

  it("leaves the children of an item unvisited when the visit returns skipChildren", () => {
    const visited: string[] = [];
    walkItems(
      parse("a = { b = 1 }\nc = 2", "walk.txt").items,
      undefined,
      (item) => {
        visited.push(describeItem(item));
        return item.kind === "entry" && item.key === "a" ? skipChildren : undefined;
      },
      "skip"
    );
    expect(visited).toEqual(["entry a", "entry c", "num 2"]);
  });

  it("ends the walk at every level when a visit returns stopWalk", () => {
    const visited: string[] = [];
    const stopped = walkItems(
      parse("a = { b = { c } d = 2 }\ne = 3", "walk.txt").items,
      undefined,
      (item) => {
        visited.push(describeItem(item));
        return item.kind === "str" && item.value === "c" ? stopWalk : undefined;
      },
      "skip"
    );
    expect(visited).toEqual(["entry a", "container", "entry b", "container", "str c"]);
    expect(stopped).toBe(true);
  });

  it("reports a walk that nothing stopped", () => {
    const stopped = walkItems(
      parse("a = { b = 1 }", "walk.txt").items,
      undefined,
      () => skipChildren,
      "skip"
    );
    expect(stopped).toBe(false);
  });

  it("passes the context a visit returns to that item's children, not to its siblings", () => {
    const depths: string[] = [];
    walkItems(
      parse("a = { b = 1 }\nc = 2", "walk.txt").items,
      0,
      (item, depth) => {
        depths.push(`${describeItem(item)} @${depth}`);
        return depth + 1;
      },
      "skip"
    );
    expect(depths).toEqual([
      "entry a @0",
      "container @1",
      "entry b @2",
      "num 1 @3",
      "entry c @0",
      "num 2 @1",
    ]);
  });
});

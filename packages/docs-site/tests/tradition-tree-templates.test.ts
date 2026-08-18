import { describe, expect, it } from "vitest";

import {
  describeTraditionTreeTemplate,
  TRADITION_TREE_TEMPLATES,
  type TraditionTreeSlot,
  type TraditionTreeTemplate,
} from "../src/tradition-tree-templates.ts";

const EXPECTED_NAMES = [
  "tree_21_11",
  "tree_12_11",
  "tree_11_12",
  "tree_12_12",
  "tree_21_21",
  "tree_11_111",
  "tree_111_11",
  "tree_21_12",
  "tree_12_11_11",
  "tree_11_11_21",
  "tree_11_12_21",
];

const hasCycle = (template: TraditionTreeTemplate): boolean => {
  const targets = new Map<TraditionTreeSlot, TraditionTreeSlot[]>();
  for (const edge of template.edges) {
    targets.set(edge.from, [...(targets.get(edge.from) ?? []), edge.to]);
  }

  const visiting = new Set<TraditionTreeSlot>();
  const visited = new Set<TraditionTreeSlot>();
  const visit = (slot: TraditionTreeSlot): boolean => {
    if (visiting.has(slot)) return true;
    if (visited.has(slot)) return false;
    visiting.add(slot);
    if ((targets.get(slot) ?? []).some(visit)) return true;
    visiting.delete(slot);
    visited.add(slot);
    return false;
  };

  return template.nodes.some(({ slot }) => visit(slot));
};

describe("tradition tree templates", () => {
  it("projects every template defined by the Stellaris 4.4.6 interface", () => {
    expect(TRADITION_TREE_TEMPLATES.map(({ name }) => name)).toEqual(EXPECTED_NAMES);
  });

  it.each(TRADITION_TREE_TEMPLATES)("keeps $name a valid five-slot tree", (template) => {
    const slots = template.nodes.map(({ slot }) => slot);
    const positions = template.nodes.map(({ column, row }) => `${column}:${row}`);
    const edges = template.edges.map(({ from, to }) => `${from}:${to}`);

    expect(slots.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(positions).size).toBe(5);
    expect(new Set(edges).size).toBe(edges.length);
    expect(
      template.nodes.every(({ column, row }) => column >= 0 && column <= 2 && row >= 0 && row <= 2)
    ).toBe(true);
    expect(template.edges.every(({ from, to }) => slots.includes(from) && slots.includes(to))).toBe(
      true
    );
    expect(hasCycle(template)).toBe(false);
  });

  it("pins the tree used by the complete documentation example", () => {
    const template = TRADITION_TREE_TEMPLATES.find(({ name }) => name === "tree_12_11")!;
    expect(template.edges).toEqual([
      { from: 1, to: 3 },
      { from: 1, to: 4 },
      { from: 2, to: 5 },
    ]);
    expect(describeTraditionTreeTemplate(template)).toBe(
      "slot 1 leads to slots 3 and 4; slot 2 leads to slot 5"
    );
  });
});

export type TraditionTreeSlot = 1 | 2 | 3 | 4 | 5;

export interface TraditionTreeNode {
  readonly slot: TraditionTreeSlot;
  readonly column: number;
  readonly row: number;
}

export interface TraditionTreeEdge {
  readonly from: TraditionTreeSlot;
  readonly to: TraditionTreeSlot;
}

export interface TraditionTreeTemplate {
  readonly name: `tree_${string}`;
  readonly nodes: readonly TraditionTreeNode[];
  readonly edges: readonly TraditionTreeEdge[];
}

const node = (slot: TraditionTreeSlot, column: number, row: number): TraditionTreeNode => ({
  slot,
  column,
  row,
});

const edge = (from: TraditionTreeSlot, to: TraditionTreeSlot): TraditionTreeEdge => ({
  from,
  to,
});

// Projected from Stellaris 4.4.6 interface/topbar_traditions_view.gui.
// The game install is not available in CI, so this small audited table is the
// build-time authority for the docs visualization.
export const TRADITION_TREE_TEMPLATES = [
  {
    name: "tree_21_11",
    nodes: [node(1, 0, 0), node(2, 1, 0), node(3, 2, 0), node(4, 0.5, 1), node(5, 2, 1)],
    edges: [edge(1, 4), edge(2, 4), edge(3, 5)],
  },
  {
    name: "tree_12_11",
    nodes: [node(1, 0.5, 0), node(2, 2, 0), node(3, 0, 1), node(4, 1, 1), node(5, 2, 1)],
    edges: [edge(1, 3), edge(1, 4), edge(2, 5)],
  },
  {
    name: "tree_11_12",
    nodes: [node(1, 0, 0), node(2, 0, 1), node(3, 1.5, 0), node(4, 1, 1), node(5, 2, 1)],
    edges: [edge(1, 2), edge(3, 4), edge(3, 5)],
  },
  {
    name: "tree_12_12",
    nodes: [node(1, 0.5, 0), node(2, 1.5, 0), node(3, 0, 1), node(4, 1, 1), node(5, 2, 1)],
    edges: [edge(1, 3), edge(1, 4), edge(2, 4), edge(2, 5)],
  },
  {
    name: "tree_21_21",
    nodes: [node(1, 0, 0), node(2, 1, 0), node(3, 2, 0), node(4, 0.5, 1), node(5, 1.5, 1)],
    edges: [edge(1, 4), edge(2, 4), edge(2, 5), edge(3, 5)],
  },
  {
    name: "tree_11_111",
    nodes: [node(1, 0.5, 0), node(2, 0.5, 1), node(3, 1.5, 0), node(4, 1.5, 1), node(5, 1.5, 2)],
    edges: [edge(1, 2), edge(3, 4), edge(4, 5)],
  },
  {
    name: "tree_111_11",
    nodes: [node(1, 0.5, 0), node(2, 0.5, 1), node(3, 0.5, 2), node(4, 1.5, 0), node(5, 1.5, 1)],
    edges: [edge(1, 2), edge(2, 3), edge(4, 5)],
  },
  {
    name: "tree_21_12",
    nodes: [node(1, 0.5, 0), node(2, 1.5, 0), node(3, 1, 1), node(4, 0.5, 2), node(5, 1.5, 2)],
    edges: [edge(1, 3), edge(2, 3), edge(3, 4), edge(3, 5)],
  },
  {
    name: "tree_12_11_11",
    nodes: [node(1, 1, 0), node(2, 0.5, 1), node(3, 1.5, 1), node(4, 0.5, 2), node(5, 1.5, 2)],
    edges: [edge(1, 2), edge(1, 3), edge(2, 4), edge(3, 5)],
  },
  {
    name: "tree_11_11_21",
    nodes: [node(1, 0.5, 0), node(2, 1.5, 0), node(3, 0.5, 1), node(4, 1.5, 1), node(5, 1, 2)],
    edges: [edge(1, 3), edge(2, 4), edge(3, 5), edge(4, 5)],
  },
  {
    name: "tree_11_12_21",
    nodes: [node(1, 1, 0), node(2, 1, 1), node(3, 0, 1), node(4, 2, 1), node(5, 1, 2)],
    edges: [edge(1, 2), edge(2, 3), edge(2, 4), edge(3, 5), edge(4, 5)],
  },
] as const satisfies readonly TraditionTreeTemplate[];

export function describeTraditionTreeTemplate(template: TraditionTreeTemplate): string {
  const targetsBySource = new Map<TraditionTreeSlot, TraditionTreeSlot[]>();

  for (const { from, to } of template.edges) {
    const targets = targetsBySource.get(from) ?? [];
    targets.push(to);
    targetsBySource.set(from, targets);
  }

  return [...targetsBySource]
    .sort(([left], [right]) => left - right)
    .map(([from, targets]) => {
      const destinations = targets.sort((left, right) => left - right).join(" and ");
      return `slot ${from} leads to ${targets.length === 1 ? "slot" : "slots"} ${destinations}`;
    })
    .join("; ");
}

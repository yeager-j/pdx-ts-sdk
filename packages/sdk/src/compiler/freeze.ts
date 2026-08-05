import type { PdxItem } from "@pdx-ts/pdxscript";

/** Deep-freezes an emitted entry tree, preserving shared nodes. */
export function freezeItems(items: readonly PdxItem[]): void {
  Object.freeze(items);
  for (const item of items) {
    freezeNode(item);
  }
}

function freezeNode(node: PdxItem): void {
  if (Object.isFrozen(node)) {
    return;
  }
  Object.freeze(node);
  switch (node.kind) {
    case "entry":
      freezeNode(node.value);
      break;
    case "container":
    case "param":
      freezeItems(node.items);
      break;
    default:
      break;
  }
}

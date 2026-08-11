import type { PdxItem } from "@pdx-ts/pdxscript";

class ImmutableSet<T> implements ReadonlySet<T> {
  readonly #values: Set<T>;

  constructor(values: Iterable<T>) {
    this.#values = new Set(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: T): boolean {
    return this.#values.has(value);
  }

  entries(): SetIterator<[T, T]> {
    return this.#values.entries();
  }

  keys(): SetIterator<T> {
    return this.#values.keys();
  }

  values(): SetIterator<T> {
    return this.#values.values();
  }

  forEach(callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    for (const value of this.#values) {
      callback.call(thisArg, value, value, this);
    }
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }

  get [Symbol.toStringTag](): string {
    return "Set";
  }
}

export function immutableSet<T>(values: Iterable<T>): ReadonlySet<T> {
  return new ImmutableSet(values);
}

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

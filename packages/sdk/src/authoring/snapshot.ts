/**
 * Making authored data immutable: a copy where the caller still holds the
 * original (SDK-325), and a freeze in place where the SDK owns it (SDK-327).
 */

/**
 * Returns a deeply frozen copy of one authored value, so mutating the value
 * the caller still holds cannot change what a later build reads.
 *
 * Arrays and plain objects are copied and frozen recursively, over their own
 * enumerable string keys. Every other value is shared as it stands and left
 * unfrozen: a `Trigger`, an `Effect` callback, a reference, and a class
 * instance are all SDK-owned values whose identity and behavior callers depend
 * on, and none of them is a container an author can mutate.
 *
 * An Item is shared for the same reason even though it is a plain object. A
 * definition may name another definition by its Item, and an Item carries its
 * own definition and lowered payload, so copying one would clone that payload
 * and hand back a value the SDK no longer recognizes as the one it minted.
 *
 * @throws Error - When the value contains a cycle. Authored definitions are
 * tree-shaped data, and a cycle is input the SDK could never serialize.
 */
export function snapshotAuthoredValue<T>(value: T): T {
  return snapshotValue(value, new WeakSet<object>()) as T;
}

/**
 * Freezes one tree of plain data in place, leaving every object in it the
 * object it was, and returns that same value.
 *
 * Use this where the SDK already owns the tree — what rewriting a snapshot
 * produces — and where {@link snapshotAuthoredValue} would defeat the point:
 * the SDK records localization keys against the very modifier rows it walked,
 * so a copy taken afterwards would carry rows nothing had registered. Values
 * that are not plain data are left alone, exactly as a snapshot leaves them.
 *
 * A container that is already frozen is left unvisited, which is what ends a
 * cycle and what keeps a shared subtree from being walked twice.
 */
export function freezeAuthoredData<T>(value: T): T {
  freezeValue(value);
  return value;
}

/**
 * `enclosing` holds the containers on the path down to `value`, so a cycle is
 * reported rather than recursed into until the stack overflows.
 */
function snapshotValue(value: unknown, enclosing: WeakSet<object>): unknown {
  if (!isPlainData(value)) {
    return value;
  }
  if (enclosing.has(value)) {
    throw new Error(
      "An authored value refers back to itself. Write definitions as plain tree-shaped data."
    );
  }
  enclosing.add(value);
  const copied = Array.isArray(value)
    ? value.map((element) => snapshotValue(element, enclosing))
    : Object.fromEntries(
        Object.entries(value).map(([key, member]) => [key, snapshotValue(member, enclosing)])
      );
  enclosing.delete(value);
  return isAlreadyTheSnapshot(value, copied) ? value : Object.freeze(copied);
}

/**
 * Whether the copy can be dropped in favor of the original: the original is
 * frozen, so no caller can mutate it, and nothing inside it had to be copied.
 *
 * Returning the original is what lets a value the SDK identifies by object
 * identity — a captured Asset file written into a definition field — reach the
 * build as the object that was recorded.
 */
function isAlreadyTheSnapshot(value: object, copied: object): boolean {
  const original = value as Record<string, unknown>;
  return (
    Object.isFrozen(value) &&
    Object.entries(copied).every(([key, member]) => member === original[key])
  );
}

function freezeValue(value: unknown): void {
  if (!isPlainData(value) || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const member of Object.values(value)) {
    freezeValue(member);
  }
}

/** Whether the value is a container these functions own: an array, or an object with no class behind it. */
function isPlainData(value: unknown): value is object {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  if (isItem(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether the value is an Item — content, event, patch, Asset file, or any
 * other value an authoring method returns.
 *
 * `itemKind` is the discriminant every Item carries and nothing else does, so
 * it settles this without naming one kind. An author can of course write
 * `{ itemKind: "…" }` by hand; the cost of believing them is that their own
 * object is shared rather than copied, which is what an Item wants anyway.
 */
function isItem(value: object): boolean {
  return typeof (value as { readonly itemKind?: unknown }).itemKind === "string";
}

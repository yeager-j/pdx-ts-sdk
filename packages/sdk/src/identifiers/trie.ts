/**
 * Shared runtime behind every oversized `vanilla.*` export
 * (`vanilla.sprite`, `vanilla.sound`, `vanilla.soundEffect`,
 * `vanilla.staticModifier`): one Proxy over a function, both callable and
 * navigable, built once here rather than once per registry in
 * `src/generated/vanilla-refs.ts`.
 *
 * - Called with an id (`vanilla.sprite("GFX_ship_combat_1")`) it returns
 *   `{ id }` unchanged — the checked-string-call form, for an id copied
 *   straight out of a game file. `CheckedVanillaId` does the actual checking,
 *   at compile time; this function performs none of it at runtime.
 * - Read as a property it descends, extending the path by one segment per
 *   access. Reading `.id` returns the *last* segment alone
 *   (`vanilla.staticModifier.deficit.food_deficit` → `food_deficit`,
 *   `vanilla.soundEffect.toxoids.ships.tox_ships_moves.tox_ship_move_confirm`
 *   → `tox_ship_move_confirm`). The earlier segments name the vanilla file the
 *   id is defined in — a bucket that exists to keep the menus small and carries
 *   no part of the id.
 *
 * That is the whole contract, for every registry: the generator spells each
 * leaf key with the complete id, so the last segment *is* the id and nothing
 * has to be reassembled.
 *
 * This proxy holds no id data at all; the generated `VanillaTries` node
 * interfaces are the only thing keeping a completion honest, exactly as the
 * scoped-modifier recorder's path proxy does for modifier keys
 * (`src/content/types.ts`).
 */

// `registry` is not read below — it documents which registry a call site
// built, for a future diagnostic (e.g. an error naming the registry a bad
// path came from), not because the proxy needs it to function today.
export function makeIdTrie(registry: string): any {
  void registry;
  const node = (path: readonly string[]): unknown =>
    new Proxy(() => undefined, {
      get(_target, prop) {
        if (typeof prop !== "string") {
          return undefined;
        }
        return prop === "id" ? (path[path.length - 1] ?? "") : node([...path, prop]);
      },
      // `toScalar` (`src/script/scalar.ts`) probes `"id" in value` before
      // reading it, and every `get`-served string prop below answers `true` to
      // an `in` check on a plain object — so the trap has to say the same
      // thing, or a proxy read only through `in` (never a direct `.prop`
      // access) would look empty. `id` is always servable (the empty string at
      // the root, same as `get` returns); anything else names another
      // navigation step, which `get` always serves too.
      has(_target, prop) {
        return typeof prop === "string";
      },
      apply(_target, _thisArg, args: unknown[]) {
        return { id: args[0] };
      },
    });
  return node([]);
}

/** Runtime path builder for the install-typed `vanilla.event` namespace. */
export function makeEventTrie(): any {
  const eventId = (path: readonly string[]): string => {
    if (path.length !== 2) {
      return path.join(".");
    }
    const [namespace, navigationKey] = path as readonly [string, string];
    // The generated type surface adds this otherwise-illegal event-id character
    // only to numeric local ids, keeping the proxy data-free and reversible.
    const localId = /^\$\d+$/.test(navigationKey) ? navigationKey.slice(1) : navigationKey;
    return `${namespace}.${localId}`;
  };
  const node = (path: readonly string[]): unknown =>
    new Proxy(() => undefined, {
      get(_target, prop) {
        if (typeof prop !== "string") {
          return undefined;
        }
        if (prop === "id") {
          return eventId(path);
        }
        if (prop === "kind") {
          return "event-ref";
        }
        return node([...path, prop]);
      },
      // Same reasoning as `makeIdTrie`'s `has` trap: `toScalar` and `refId`
      // both probe `"id" in value` before reading it, and this trie's `get`
      // additionally serves `kind` (its `event-ref` discriminant) and any
      // other string as a deeper navigation step — so `has` answers `true`
      // for every string prop, matching `get` exactly.
      has(_target, prop) {
        return typeof prop === "string";
      },
    });
  return node([]);
}

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
 *   access. Reading `.id` at that point reconstructs the id — and *how* is the
 *   one thing that differs between the two trie shapes the generator emits:
 *
 *   - `"path"`: the id is every segment gathered so far, joined with `_`
 *     (`vanilla.sprite.GFX.evt.ship.in_orbit` → `GFX_evt_ship_in_orbit`).
 *     Correct only because the generator built that tree by splitting each
 *     real id on `_` in the first place, which makes the join bijective by
 *     construction rather than by anything verified here.
 *   - `"leaf"`: the id is the last segment alone
 *     (`vanilla.staticModifier.deficit.food_deficit` → `food_deficit`). The
 *     earlier segments name the vanilla file the id is defined in — a bucket
 *     that exists to keep the menus small and carries no part of the id.
 *
 * Either way this proxy holds no id data at all; the generated `VanillaTries`
 * node interfaces are the only thing keeping a completion honest, exactly as
 * the scoped-modifier recorder's path proxy does for modifier keys
 * (`src/content.ts`).
 */

/** How `.id` is reconstructed from a navigated path. See the module doc. */
export type TrieIdSource = "path" | "leaf";

// `registry` is not read below — it documents which registry a call site
// built, for a future diagnostic (e.g. an error naming the registry a bad
// path came from), not because the proxy needs it to function today.
export function makeIdTrie(registry: string, idFrom: TrieIdSource): any {
  void registry;
  const idOf = (path: readonly string[]): string =>
    idFrom === "path" ? path.join("_") : (path[path.length - 1] ?? "");
  const node = (path: readonly string[]): unknown =>
    new Proxy(() => undefined, {
      get(_target, prop) {
        if (typeof prop !== "string") {
          return undefined;
        }
        return prop === "id" ? idOf(path) : node([...path, prop]);
      },
      apply(_target, _thisArg, args: unknown[]) {
        return { id: args[0] };
      },
    });
  return node([]);
}

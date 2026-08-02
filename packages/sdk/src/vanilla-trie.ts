/**
 * Shared runtime behind every oversized `vanilla.*` export
 * (`vanilla.sprite`, `vanilla.sound`, `vanilla.soundEffect`): one Proxy over a
 * function, both callable and navigable, built once here rather than once per
 * registry in `src/generated/vanilla-refs.ts`.
 *
 * - Called with an id (`vanilla.sprite("GFX_ship_combat_1")`) it returns
 *   `{ id }` unchanged — the checked-string-call form, for an id copied
 *   straight out of a game file. `CheckedVanillaId` does the actual checking,
 *   at compile time; this function performs none of it at runtime.
 * - Read as a property (`vanilla.sprite.ship.combat_1`) it descends, extending
 *   the path by one segment per access; reading `.id` at that point
 *   reconstructs the full id by joining every segment gathered so far with
 *   `_`.
 *
 * Reconstruction is correct only because the generator built the tree by
 * splitting each real id on `_` in the first place — joining the same
 * segments back with `_` is bijective by that construction, never verified
 * here. This proxy carries no id data at all; the generated `VanillaTries`
 * node interfaces are the only thing keeping a completion honest, exactly as
 * the scoped-modifier recorder's path proxy does for modifier keys
 * (`src/content.ts`).
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
        return prop === "id" ? path.join("_") : node([...path, prop]);
      },
      apply(_target, _thisArg, args: unknown[]) {
        return { id: args[0] };
      },
    });
  return node([]);
}

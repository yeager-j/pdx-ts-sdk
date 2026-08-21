/**
 * Staleness gates for the overlay tables in `overlay.ts` and
 * `trigger-policy.ts` whose rows are read through a plain `.get()`/`.has()`
 * lookup rather than through a loop the emitter itself drives.
 *
 * A row naming a key nothing matches is not a type error: the lookup just
 * returns `undefined`, and the emitter silently falls back to its mechanical
 * reading, exactly as if the row had never been written. `emit/effects.ts`
 * already closes this gap for its own tables (`EFFECT_FIELD_TYPE_OVERRIDES`
 * and its siblings, `emit/effects.ts:636-657`); this module gives every other
 * overlay table the same treatment.
 *
 * Two shapes of check live here:
 *
 * - A table keyed directly by a registry name, or whose key states its own
 *   registry, is checkable against a known universe with no help from the
 *   emitter — the pure functions below.
 * - A table consulted deep inside field lowering (`CONTENT_FIELD_OVERRIDES`,
 *   `REQUIRED_LOCALISATION`, …) can only be judged "applied" at its
 *   consumption site, which is what {@link OverlayAudit} tracks.
 */

import type { HandWrittenTriggerExport } from "./trigger-policy.ts";

/** One table to check, so a single call can cover several at once. */
export interface RegistryKeyedOverlayTable {
  readonly tableId: string;
  readonly keys: Iterable<string>;
}

/**
 * Fails when a registry-keyed overlay table names a key that is not one of
 * the pipeline's resolved registry names.
 *
 * Covers `MINT_SHAPE_OVERLAYS`, `EXACT_NAME_MINTS`, `FILE_STEM_OVERLAYS`,
 * `HAND_WRITTEN_CONTENT_DEFINERS`, `CONTENT_CONTRIBUTION_SINKS`,
 * `CONTENT_SUBTYPE_REFERENCE_REFINEMENTS`, `CONTENT_PATCH_REGISTRIES`, and
 * `CONTENT_SCOPE_PARAMETERS` — every overlay table keyed directly by a
 * registry name, as opposed to a `<registry>.<field>` path.
 */
export function assertOverlayRegistriesKnown(
  tables: readonly RegistryKeyedOverlayTable[],
  registryNames: ReadonlySet<string>
): void {
  for (const table of tables) {
    for (const key of table.keys) {
      if (!registryNames.has(key)) {
        throw new Error(
          `${table.tableId} names "${key}", which is not a known registry — ` +
            "retire the row or fix the key"
        );
      }
    }
  }
}

/**
 * `PATCH_WIDENINGS` is keyed `<registry>.<member>` like the path-keyed tables
 * `OverlayAudit` tracks, but its registry half is checkable on its own: a
 * widening only ever reaches a reader inside `emitPatchType`
 * (`emit/content-type.ts`'s `patchMembers`/`PATCH_WIDENINGS` loop, around
 * line 804-822), which runs only for a registry `CONTENT_PATCH_REGISTRIES`
 * already admits. A row naming any other registry — one that was never
 * patchable, or lost patchability upstream — is never read by that loop at
 * all, so `OverlayAudit` can never see it applied; this checks the registry
 * half directly instead.
 */
export function assertPatchWideningsTargetPatchableRegistries(
  tableId: string,
  keys: Iterable<string>,
  patchableRegistries: ReadonlySet<string>
): void {
  for (const key of keys) {
    const segments = key.split(".");
    // A member name never contains a dot, so a widening key is always exactly
    // one registry segment and one member segment. The consumption site
    // (`emit/content-type.ts`'s `patchTypes`) reads this table with an exact
    // `${type.name}.${entry.member}` lookup — a three-segment key like
    // `technology.prerequisites.extra` would resolve a registry correctly
    // here while never matching that lookup, leaving the row silently dead.
    if (segments.length !== 2 || segments[0] === "" || segments[1] === "") {
      throw new Error(
        `${tableId} names "${key}", which is not a "<registry>.<member>" path — ` +
          "retire the row or fix the key"
      );
    }
    const registry = segments[0]!;
    if (!patchableRegistries.has(registry)) {
      throw new Error(
        `${tableId} widens "${key}", whose registry "${registry}" is not in ` +
          "CONTENT_PATCH_REGISTRIES — retire the row or fix the key"
      );
    }
  }
}

/**
 * Validates `SCRIPTED_MODIFIER_CATEGORY_MAP` against the two vendored
 * sources its own doc comment says it joins.
 *
 * Each key must be a member of `enum[scripted_modifier_category]`
 * (`enums.cwt`) — the map is deliberately not exhaustive over that enum,
 * since `none`/`component`/`pop_job` have no supported mapping, so this
 * checks every declared key is real rather than checking every enum member
 * is covered. Each label a key maps to must be a real `modifier_categories.cwt`
 * category, i.e. a key `rules.modifierCategories` actually carries.
 *
 * The enum's own `## modifier_categories` comment metadata is deliberately
 * not this check's source for labels: `RuleSet` does not parse that option
 * (see `overlay.ts`'s doc comment on the table), and it is already known to
 * disagree with `modifier_categories.cwt` for `pop_group` — the enum's
 * comment says "Pop Group", the categories file says "Pops", and the table
 * intentionally follows the latter.
 */
export function assertScriptedModifierCategoryMapValid(
  map: Readonly<Record<string, readonly string[]>>,
  scriptedModifierCategoryEnumMembers: ReadonlySet<string>,
  modifierCategoryLabels: ReadonlySet<string>
): void {
  for (const [key, labels] of Object.entries(map)) {
    if (!scriptedModifierCategoryEnumMembers.has(key)) {
      throw new Error(
        `SCRIPTED_MODIFIER_CATEGORY_MAP names "${key}", which is not a member of ` +
          "enum[scripted_modifier_category] — retire the row or fix the key"
      );
    }
    for (const label of labels) {
      if (!modifierCategoryLabels.has(label)) {
        throw new Error(
          `SCRIPTED_MODIFIER_CATEGORY_MAP maps "${key}" to "${label}", which ` +
            "modifier_categories.cwt does not declare — retire the row or fix the label"
        );
      }
    }
  }
}

/**
 * Validates `HAND_WRITTEN_TRIGGER_EXPORTS`: every row whose `expectedInRules`
 * is `true` must have a `ruleKey` matching a key the rules actually loaded,
 * checked case-insensitively to match `emit/triggers.ts`'s own lookup
 * (`HAND_WRITTEN_TRIGGER_RULES_BY_KEY.get(key.toLowerCase())`).
 *
 * A row with no `ruleKey` (the bare constructor/link exports) or with
 * `expectedInRules: false` (the structural combinators and `hidden_trigger`,
 * all declared only in the unloaded `scope_links.cwt`) is not checked here —
 * that is exactly what `expectedInRules: false` states.
 */
export function assertHandWrittenTriggerExportsMatchRules(
  exports: readonly HandWrittenTriggerExport[],
  loadedTriggerRuleKeys: ReadonlySet<string>
): void {
  for (const entry of exports) {
    if (!entry.expectedInRules) {
      continue;
    }
    // Narrowed to the `expectedInRules: true` arm here, so `ruleKey` is a
    // required `string` — the union in trigger-policy.ts makes the
    // `expectedInRules: true`-with-no-`ruleKey` combination a compile error
    // rather than something this check has to guard against at runtime.
    if (!loadedTriggerRuleKeys.has(entry.ruleKey.toLowerCase())) {
      throw new Error(
        `HAND_WRITTEN_TRIGGER_EXPORTS names ruleKey "${entry.ruleKey}" for export ` +
          `"${entry.exportName}", which no loaded trigger rule matches — retire the row or fix the key`
      );
    }
  }
}

/**
 * Tracks which rows of a path-keyed overlay table (`CONTENT_FIELD_OVERRIDES`,
 * `REQUIRED_LOCALISATION`, `SYNTHETIC_LOCALISATION`, …) were actually read at
 * their consumption site, so a row nothing matches can be caught the same way
 * `EFFECT_FIELD_TYPE_OVERRIDES` and its siblings already are in
 * `emit/effects.ts` — a `.get()`/`.has()` lookup alone cannot tell a matched
 * row from a stale one, since both return the same "nothing here" shape.
 *
 * One instance per pipeline run, owned by the `Emitter` that is already
 * threaded to every site that would call {@link applied}. This deliberately
 * is not module-level mutable state: `emit/fields.ts`'s `appliedAssetPaths`
 * module-level `Set` is the pattern this replaces going forward, not one to
 * extend — it has no owner, so nothing scopes it to one run or lets two
 * pipeline runs in the same process (as several test files perform) avoid
 * leaking applied-state into each other.
 */
export class OverlayAudit {
  private readonly appliedKeys = new Map<string, Set<string>>();

  /** Records that `tableId`'s row `key` was read and used at a consumption site. */
  applied(tableId: string, key: string): void {
    let keys = this.appliedKeys.get(tableId);
    if (keys === undefined) {
      keys = new Set();
      this.appliedKeys.set(tableId, keys);
    }
    keys.add(key);
  }

  /** Fails naming the first declared row of `tableId` that {@link applied} never recorded. */
  assertAllApplied(tableId: string, tableKeys: Iterable<string>): void {
    const applied = this.appliedKeys.get(tableId);
    for (const key of tableKeys) {
      if (!applied?.has(key)) {
        throw new Error(
          `${tableId} names "${key}", which no consumption site applied — ` +
            "retire the row or fix the key"
        );
      }
    }
  }
}

/**
 * Staleness gates for the tables exported from `overlay/index.ts` and
 * `policy/triggers.ts` whose rows are read through a plain `.get()`/`.has()`
 * lookup rather than through a loop the emitter itself drives.
 *
 * A row naming a key nothing matches is not a type error: the lookup just
 * returns `undefined`, and the emitter silently falls back to its mechanical
 * reading, exactly as if the row had never been written. `emit/script/effects.ts`
 * already closes this gap for its own tables (`EFFECT_VALUE_TYPE_OVERRIDES`
 * and its siblings); this module gives every other
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

import type { HandWrittenTriggerExport } from "../policy/triggers.ts";
import type { ContentWitness } from "./index.ts";

/** One table to check, so a single call can cover several at once. */
export interface RegistryKeyedOverlayTable {
  /** Stable table name used in failures. */
  readonly tableId: string;
  /** Registry names declared as keys by the table. */
  readonly keys: Iterable<string>;
}

/**
 * Fails when a registry-keyed overlay table names a key that is not one of
 * the pipeline's resolved registry names.
 *
 * Covers `MINT_SHAPE_OVERLAYS`, `EXACT_NAME_MINTS`, `FILE_STEM_OVERLAYS`,
 * `HAND_WRITTEN_CONTENT_DEFINERS`, `CONTENT_CONTRIBUTION_SINKS`,
 * `CONTENT_PATCH_REGISTRIES`, `CONTENT_SCOPE_PARAMETERS`, and
 * `CONTENT_WITNESSES` — every overlay table keyed directly by a
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

interface PatchRegistryRule {
  readonly repeat: { readonly state: "verified" | "assumed" | "refused" };
  readonly replacement: { readonly state: "verified" | "assumed" | "refused" };
}

/**
 * Fails when a patch permission lacks either SDK prerequisite: a parsed
 * registry row or a rule row whose repeat and replacement cells are usable.
 * Both `verified` and `assumed` cells are usable; only `refused` carries no
 * rule for the resolver to act on.
 */
export function assertPatchRegistryPrerequisites(
  patchRegistryNames: Iterable<string>,
  parsedRegistryNames: ReadonlySet<string>,
  registryRules: ReadonlyMap<string, PatchRegistryRule>
): void {
  for (const registry of patchRegistryNames) {
    if (!parsedRegistryNames.has(registry)) {
      throw new Error(
        `CONTENT_PATCH_REGISTRIES names "${registry}", which has no PARSED_REGISTRIES row — ` +
          "retire the row or fix the key"
      );
    }

    const rule = registryRules.get(registry);
    if (rule === undefined) {
      throw new Error(
        `CONTENT_PATCH_REGISTRIES names "${registry}", which has no REGISTRY_RULES row — ` +
          "retire the row or fix the key"
      );
    }

    for (const [cellName, cell] of [
      ["repeat", rule.repeat],
      ["replacement", rule.replacement],
    ] as const) {
      if (cell.state === "refused") {
        throw new Error(
          `CONTENT_PATCH_REGISTRIES names "${registry}", whose REGISTRY_RULES row has a ` +
            `refused ${cellName} cell — retire the row or fix the key`
        );
      }
    }
  }
}

/**
 * Fails when a complex-enum reference overlay cannot widen the loaded enum's
 * empty, install-derived member shape.
 *
 * Complex enum reference overlays add an SDK-owned item type to enums whose
 * values the CWT rules intentionally leave empty for vanilla extraction. A
 * stale key is otherwise a silent `.get()` miss; a populated enum would make
 * that widening change a closed CWT union instead of its install-derived form.
 */
export function assertComplexEnumReferenceOverlaysValid(
  tableId: string,
  keys: Iterable<string>,
  complexEnums: ReadonlyMap<string, unknown>,
  enums: ReadonlyMap<string, readonly string[]>
): void {
  for (const key of keys) {
    if (!complexEnums.has(key)) {
      throw new Error(
        `${tableId} names "${key}", which is not a loaded complex enum — ` +
          "retire the row or fix the key"
      );
    }
    const members = enums.get(key);
    if (members === undefined || members.length !== 0) {
      throw new Error(
        `${tableId} names "${key}", whose enum has declared members — ` +
          "item widening requires a valueless install-derived enum"
      );
    }
  }
}

/**
 * Fails when a `CONTENT_WITNESSES` row names a def member its own registry's
 * emission did not actually produce, or repeats a member within one row's
 * `omit` list.
 *
 * `assertOverlayRegistriesKnown` above only proves the row's registry key is
 * real; it says nothing about the member names written by hand inside the
 * row. A CWT rename that moves or drops that property leaves `Omit<Def,
 * "goneMember">` and the `wraps` intersection both legal TypeScript — the
 * property silently disappears from the emitted `Def` while the witness
 * keeps promising it, and `EconomicWitnessOf` resolves the vanished member to
 * `undefined` with every other gate green. This is that same staleness
 * principle one level deeper, so `planRegistryDefiner`
 * (`emit/content/definer-plan.ts`) calls it once
 * per content it finds a row for, with the member names *that content's own
 * emission* actually produced.
 *
 * `inferAs` is checked only for non-emptiness: reuse across members (two
 * `omit` entries sharing a letter) is legitimate, because each member's own
 * `D extends { ... } ? infer X : undefined` conditional scopes its `infer`
 * to itself.
 */
export function assertContentWitnessMembersKnown(
  registry: string,
  contentWitness: ContentWitness,
  emittedMembers: ReadonlySet<string>
): void {
  const assertKnown = (member: string): void => {
    if (!emittedMembers.has(member)) {
      throw new Error(
        `CONTENT_WITNESSES's "${registry}" row names member "${member}", which ${registry}'s ` +
          "emission does not produce — retire the row or fix the member"
      );
    }
  };
  if (contentWitness.mode === "wraps") {
    assertKnown(contentWitness.member);
    return;
  }
  const seen = new Set<string>();
  for (const entry of contentWitness.omit) {
    if (seen.has(entry.member)) {
      throw new Error(
        `CONTENT_WITNESSES's "${registry}" row names member "${entry.member}" twice in one omit ` +
          "list — retire the duplicate or fix the member"
      );
    }
    seen.add(entry.member);
    assertKnown(entry.member);
    if (entry.inferAs.length === 0) {
      throw new Error(
        `CONTENT_WITNESSES's "${registry}" row's "${entry.member}" omit entry has an empty ` +
          "inferAs — fix the row"
      );
    }
  }
}

/**
 * `PATCH_WIDENINGS` is keyed `<registry>.<member>` like the path-keyed tables
 * `OverlayAudit` tracks, but its registry half is checkable on its own: a
 * widening only ever reaches a reader inside `emitPatchType`
 * (`emit/content/content-type.ts`'s `patchMembers`/`PATCH_WIDENINGS` loop),
 * which runs only for a registry `CONTENT_PATCH_REGISTRIES`
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
    // (`emit/content/content-type.ts`'s `patchTypes`) reads this table with an exact
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
 * (see `script.ts`'s doc comment on the table), and it is already known to
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
 * checked case-insensitively to match `emit/script/triggers.ts`'s own lookup
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
    // required `string` — the union in policy/triggers.ts makes the
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
 * `EFFECT_VALUE_TYPE_OVERRIDES` and its siblings already are in
 * `emit/script/effects.ts` — a `.get()`/`.has()` lookup alone cannot tell a matched
 * row from a stale one, since both return the same "nothing here" shape.
 *
 * One instance per pipeline run, owned by the `Emitter` that is already
 * threaded to every site that would call {@link applied}. This deliberately
 * is not module-level mutable state: before SDK-256, asset-field lowering used
 * a module-level `appliedAssetPaths` `Set`; `emit/content/field-assertions.ts` now
 * records `ASSET_PATH_FIELDS` through this class. The old shape had no owner,
 * so nothing scoped it to one run or let two pipeline runs in the same process
 * (as several test files perform) avoid leaking applied-state into each other.
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

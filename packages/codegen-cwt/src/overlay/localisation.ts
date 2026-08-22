/**
 * Localisation overlay rows: the slots the SDK always writes and therefore
 * requires, and the slots it synthesizes where the rules declare none.
 *
 * See `./index.ts` for what this directory is and how a row here earns its
 * place.
 */

/**
 * Localisation slots the SDK always writes, and therefore requires.
 *
 * Slot *names* come straight from the rules — `name` and `desc` — which also
 * matches how the rest of the script surface reads, since `desc` is the key
 * events use for their description. Only the requiredness is ours: definitions
 * need a display name even where the rules do not mark the slot required.
 *
 * Description/flavor/effects slots stay optional. Missing tooltip text is a
 * lint to grow, not a reason to block generated placeholder content.
 */
export const REQUIRED_LOCALISATION = new Set([
  "technology.name",
  "building.name",
  "tradition.name",
  "tradition_category.name",
  "ascension_perk.name",
  "agenda.name",
  "edict.name",
  "councilor.name",
  "decision.name",
  "job.name",
  "opinion_modifier.name",
  // All 3096 shipped static modifiers carry a localised name: the game shows
  // it wherever the modifier is applied, so an unnamed one is a visible bug.
  "static_modifier.name",
  "casus_belli.name",
  "war_goal.name",
  "agreement_preset.name",
  "bombardment_stance.name",
  "archaeological_site_type.name",
  // All 164 shipped megastructures carry a localised name, and the game shows
  // it in the construction menu and the outliner, so an unnamed one is a
  // visible bug the same way an unnamed static modifier is.
  "megastructure.name",
]);

export interface SyntheticLocalisation {
  /** The `$`-bearing pattern to synthesize, e.g. `"$_desc"`. */
  readonly pattern: string;
  readonly reason: string;
}

/**
 * A localisation slot the rules never declare at all, added because the
 * registry needs the same real, auto-keyed authoring path a sibling registry
 * gets for free from the rules.
 *
 * `archaeological_site_type` is the case this exists for (SDK-50).
 * `type[archaeological_site_type].localisation` (archaeology.cwt:5-8) declares
 * only `name = "$"` and `desc = desc` — a bare pointer with no `$`, meaning
 * `planLocalisation` excludes it outright (same rule SDK-44's `name = name`
 * fix relies on) and the registry ends up with *no* slot where an author can
 * write real flavor text and get a generated key. The body's own `desc` field
 * (`archaeology.cwt:44`, dual with the `triggered_desc_clause` block form,
 * which `emit/content-type.ts` renames to `conditionalDesc` because the slot
 * this row adds takes the `desc` member) is `conversion: "identity"` either
 * way its dual resolves — a raw key, never auto-generated — so writing
 * English into it is accepted and
 * silently wrong: no warning, no error, the game shows the literal string.
 * `situation_type`, by contrast, needs no such row: situations.cwt:17 already
 * declares `desc = "$_desc"` *alongside* the same bare `desc = desc` pointer
 * (:18), so the real slot already exists there and the pointer simply loses
 * the member-name collision — evidence this is a genuine asymmetry in the
 * vendored rules, not a design position the SDK is second-guessing.
 *
 * A row here does not claim the game reads a `<id>_desc` key today — it adds
 * one, matching the convention every other `desc`-bearing registry in
 * {@link REQUIRED_LOCALISATION}'s neighborhood already follows, and gives
 * `conditionalDesc`'s raw-key arms (the top-level scalar and
 * `ArchaeologicalSiteTypeDesc.text`) a genuine optional escape hatch instead
 * of being the only route.
 *
 * A generated key is only half the fix: `type[archaeological_site_type]`
 * reads that text through the body's own `desc` pointer, so a definition that
 * sets only the synthetic `desc` member and never touches `conditionalDesc`
 * would populate the `.yml` with real text and emit no `desc = <id>_desc`
 * anywhere in its own body — reachable nowhere in game, the identical silent
 * failure this table exists to close, one step removed. The emitted
 * `pointerMember` closes that: `ContentAuthoring.define` defaults it to the
 * synthesized key whenever the text member is set and the author has not
 * written the pointer themselves. It is not stated here — the collision this
 * row manufactures is what renames the body field, so `emit/content-type.ts`
 * records the pointer from that rename rather than repeating its spelling.
 */
export const SYNTHETIC_LOCALISATION = new Map<string, SyntheticLocalisation>([
  [
    "archaeological_site_type.desc",
    {
      pattern: "$_desc",
      reason:
        "archaeology.cwt declares no `$`-bearing pattern for desc at all (only the excluded " +
        'bare pointer `desc = desc`), unlike situation_type\'s `desc = "$_desc"` sitting beside ' +
        "its own identical pointer — so archaeological_site_type has no real flavor-text slot " +
        "without this row. See SDK-50.",
    },
  ],
]);

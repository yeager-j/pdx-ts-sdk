/**
 * Localisation overlay rows: the slots the SDK always writes and therefore
 * requires, and the slots it synthesizes where the rules declare none.
 *
 * See `./index.ts` for what this directory is and how a row here earns its
 * place.
 */

/**
 * Localisation slots the SDK requires of an authored definition, each with the
 * shipped evidence for requiring it.
 *
 * Slot *names* come from the rules — `name` and `desc` — which also matches how
 * the rest of the script surface reads, since `desc` is the key events use for
 * their description. Only the requiredness is ours.
 *
 * Every row is a `name` slot, and that is the whole policy: a definition the
 * game shows needs something to show. Description, flavor and effects slots stay
 * optional, because missing tooltip text is a lint to grow rather than a reason
 * to block a definition that is otherwise complete.
 *
 * Each row states how many definitions the game ships, how many resolve the
 * slot's key pattern, and what any gap turns out to be. The figures are measured
 * against Stellaris 4.4.6, the repository's `VERIFIED_STELLARIS_BUILD`, by
 * reading each registry directory from its CWT `type[...]` path and resolving
 * the `name` pattern against the install's English localisation keys. They are
 * reproducible, and a row whose gap grows on a later build is a row to review.
 */
export const REQUIRED_LOCALISATION = new Map<string, string>([
  [
    "technology.name",
    "692 of 692 resolve `$`. The raw directory holds 698 entries, but the six in " +
      "`common/technology/00_tier.txt` are tier definitions rather than technologies.",
  ],
  ["building.name", "498 of 498 resolve `$`."],
  ["tradition.name", "234 of 234 resolve `$`."],
  [
    "tradition_category.name",
    "32 of 33 resolve `$`. The one gap, `tradition_dummy` in `02_flexible_dummy.txt`, is a " +
      "placeholder rather than a category the game shows.",
  ],
  ["ascension_perk.name", "49 of 49 resolve `$`."],
  ["agenda.name", "90 of 90 resolve `council_agenda_$_name`."],
  ["edict.name", "171 of 171 resolve `edict_$`."],
  ["councilor.name", "179 of 179 resolve `$`."],
  ["decision.name", "111 of 111 resolve `$`."],
  ["job.name", "365 of 365 resolve `job_$`."],
  ["opinion_modifier.name", "490 of 490 resolve `$`."],
  [
    "static_modifier.name",
    "3081 of 3081 resolve `$`. The game shows the name wherever the modifier applies, so an " +
      "unnamed one is a visible bug.",
  ],
  ["casus_belli.name", "45 of 45 resolve `casus_belli_$`."],
  ["war_goal.name", "87 of 87 resolve `war_goal_$`."],
  [
    "agreement_preset.name",
    "52 of 56 resolve `$`. All four gaps — `preset_release_sector` and the three " +
      "`preset_payback_subsidiary_*` presets — carry `hidden = yes`, so every preset the " +
      "diplomacy UI shows has a name. An author pays this requirement only for a hidden preset.",
  ],
  ["bombardment_stance.name", "13 of 13 resolve `bombardment_$`."],
  ["archaeological_site_type.name", "124 of 124 resolve `$`."],
  [
    "megastructure.name",
    "164 of 164 resolve `$`. The game shows the name in the construction menu and the " +
      "outliner, so an unnamed one is a visible bug the same way an unnamed static modifier is.",
  ],
]);

/** Describes a generated localisation slot that the vendored type metadata omits. */
export interface SyntheticLocalisation {
  /** The `$`-bearing pattern to synthesize, e.g. `"$_desc"`. */
  readonly pattern: string;
  /** Audited evidence that the registry needs the generated slot. */
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
 * which `emit/content/content-type.ts` renames to `conditionalDesc` because the
 * slot this row adds takes the `desc` member) is `conversion: "identity"` either
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
 * row manufactures is what renames the body field, so `emit/content/content-type.ts`
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

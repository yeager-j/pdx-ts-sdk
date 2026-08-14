/**
 * Contracts the SDK asserts by hand, where no rule states anything.
 *
 * These cannot be probed, by construction: a hand-written contract exists
 * precisely because the rules are silent, so there is nothing in the
 * post-overlay model to project. Presenting one as though codegen had derived
 * it would be the single most misleading thing this page could do —
 * `targetScope` looks exactly like a field, sits in the same object literal as
 * the fields, and emits nothing.
 *
 * So they are declared, and each declaration carries the source file that
 * implements it plus a string that must still appear in it.
 * `tests/citations.test.ts` reads those files as text and fails when an anchor
 * goes missing, which is the cheapest honest substitute for deriving them.
 *
 * The second page widened what "no rule states anything" covers. Situations'
 * three are all SDK source. Technology's are decisions the *overlay* records —
 * that a technology must carry a display name, and what a whole-object patch is
 * allowed to assume about the game's own override rules. Neither is in the
 * rules, both are reviewed rows in one committed table, and citing that table
 * by anchor is the same trade for the same reason.
 */

import type { SdkAuthoredContract } from "../facts.ts";

export const SITUATION_CONTRACTS: readonly SdkAuthoredContract[] = [
  {
    member: "targetScope",
    statement:
      "`targetScope` declares which scope this situation's target is, once, on the definition. " +
      "It is not a game field: nothing is written for it, and no rule mentions it. Every " +
      "`startSituation` call site naming this definition is then checked against the " +
      "declaration, so passing a planet to a country-targeted situation is a compile error " +
      "instead of a situation that silently does nothing in game.",
    source: "packages/sdk/src/content/situations.ts",
    anchor: "`targetScope` is authored and emits nothing",
    whyNotDerived:
      "`links.cwt` gives the situation `target` link `output_scope = any` — a situation's " +
      "target is whatever `start_situation` passed it, and the rules declare the contract " +
      "nowhere. What the corpus shows is that each vanilla situation type is consistent about " +
      "its target kind across all of its start sites, which is a reason to let an author " +
      "declare the contract, not evidence of what the contract is.",
    serialized: false,
  },
  {
    member: "startSituation",
    statement:
      "`startSituation({ type, target })` takes the situation type's declared `targetScope` as " +
      "proof of the target it is handed, and types the effect body's `target(...)` from the " +
      "same declaration. A situation type that declares no `targetScope` — and any vanilla or " +
      "third-party id — still goes through the generated signature unchecked.",
    source: "packages/sdk/src/script/effects/situations.ts",
    anchor: "interface StartSituationEffectsExtension",
    whyNotDerived:
      "The overload is hand-written on top of the generated one, and the overlay refuses a " +
      "`targetScope`-bearing ref in the generated signature so a declared contract can only " +
      "ever be accepted by the checked overload.",
    serialized: true,
  },
  {
    member: "approach / stages record keys",
    statement:
      "The record keys an author writes under `approach` and `stages` are nested content ids: " +
      "the capability asserts the mod prefix on each one, and the same keys are what " +
      "`currentSituationApproach`, `currentStage` and `canSetSituationApproach` are checked " +
      "against when written directly into `approach.allow`, `approach.potential`, " +
      "`stages.potential`, or `abortTrigger`.",
    source: "packages/sdk/src/content/situations.ts",
    anchor: "assertNestedId(id)",
    whyNotDerived:
      "The rules type the identity value and say nothing about prefixes or about which " +
      "trigger positions can carry the identity through to a compile-time check.",
    serialized: true,
  },
];

export const TECHNOLOGY_CONTRACTS: readonly SdkAuthoredContract[] = [
  {
    member: "name",
    statement:
      "Every technology must be given a `name`. The rules declare the localization slot but " +
      "never mark it required — the SDK does, because a technology with no display name is a " +
      "blank card in the research view rather than a lint to fix later. `desc` stays optional " +
      "for the mirror reason: missing tooltip text is a thing to grow into.",
    source: "packages/codegen-cwt/src/overlay.ts",
    anchor: '"technology.name"',
    whyNotDerived:
      '`technologies_consolidated.cwt` declares `localisation = { name = "$" desc = "$_desc" }` ' +
      "and says nothing about which of the two a definition owes. Requiredness is the overlay's " +
      "judgment, recorded in one reviewed table beside every other registry that made the same " +
      "call, so the surface can refuse a nameless technology at compile time.",
    serialized: true,
  },
  {
    member: "mod.patchTechnology",
    statement:
      "A patch of a vanilla technology is whole-object replacement: the build re-emits the " +
      "complete definition, into a file whose name is computed to sort after every competing " +
      "file, and fields the transform does not touch are carried through byte-faithfully. " +
      "Technology's own override rule is `verified` rather than assumed — last-wins, " +
      "whole-object, from four captured oracle runs — which is why it has a `patchX` at all.",
    source: "packages/sdk/src/stellaris/vanilla/override-rules.ts",
    anchor: 'registry: "technology",',
    whyNotDerived:
      "No rule file describes what the game does when two files define the same technology. The " +
      "answer came from running the game with colliding files and reading the result, and each " +
      "cell of the table cites the run that established it. A projection of the rules could " +
      "never produce this, and a page that guessed it would be guessing about data loss.",
    serialized: true,
  },
];

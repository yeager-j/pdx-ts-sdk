/**
 * Hand-written exports sharing the generated trigger/link namespace.
 *
 * A row decides both whether trigger generation skips a CWT key and whether
 * scope-link generation reserves the public TypeScript export. Keeping those
 * two projections together prevents a hand-written overload from colliding
 * with a generated export merely because its rule key lives elsewhere.
 */
export interface HandWrittenTriggerExport {
  readonly exportName: string;
  readonly ruleKey?: string;
  readonly kind:
    "trigger-constructor" | "structural-trigger" | "typed-leaf-trigger" | "polymorphic-scope-link";
  /**
   * Whether `ruleKey` must match a key the rules actually loaded
   * (`overlay-audit.ts`'s `assertHandWrittenTriggerExportsMatchRules`).
   *
   * `false` for a row with no `ruleKey` at all (nothing to check) and for
   * `and`/`or`/`not`/`nand`/`nor`/`hidden_trigger`: all six are declared only
   * as `alias[trigger:AND]` and kin in `scope_links.cwt`
   * (vendor/cwtools-stellaris-config/config/scope_links.cwt:5-16), which this
   * generator does not load — see `overlay.ts`'s doc comment on
   * `HandWrittenDefiner`/`hidden_trigger` for why. The `ruleKey` still names
   * what `emit/triggers.ts` skips generating; `expectedInRules: false` only
   * says the loaded rules will never actually declare it, not that the row is
   * unused.
   */
  readonly expectedInRules: boolean;
  readonly reason: string;
}

export const HAND_WRITTEN_TRIGGER_EXPORTS: readonly HandWrittenTriggerExport[] = [
  {
    exportName: "trigger",
    kind: "trigger-constructor",
    expectedInRules: false,
    reason: "the core constructor turns recorded entries into a Trigger value",
  },
  ...["and", "or", "not", "nand", "nor"].map((name): HandWrittenTriggerExport => ({
    exportName: name,
    ruleKey: name,
    kind: "structural-trigger",
    expectedInRules: false,
    reason: "the SDK models condition-tree structure with scope-aware combinators",
  })),
  {
    exportName: "hiddenTrigger",
    ruleKey: "hidden_trigger",
    kind: "structural-trigger",
    expectedInRules: false,
    reason: "the SDK models the flat hidden_trigger splice beside the other combinators",
  },
  ...[
    ["currentSituationApproach", "current_situation_approach"],
    ["currentStage", "current_stage"],
    ["canSetSituationApproach", "can_set_situation_approach"],
    ["hasCompletedEventChainCounter", "has_completed_event_chain_counter"],
  ].map(([exportName, ruleKey]): HandWrittenTriggerExport => ({
    exportName: exportName!,
    ruleKey: ruleKey!,
    kind: "typed-leaf-trigger",
    expectedInRules: true,
    reason: "the hand-written signature carries a content-defined literal-key contract",
  })),
  {
    exportName: "target",
    kind: "polymorphic-scope-link",
    expectedInRules: false,
    reason: "the SDK supplies trigger and value overloads for the polymorphic target link",
  },
];

export const HAND_WRITTEN_TRIGGER_RULES_BY_KEY = new Map(
  HAND_WRITTEN_TRIGGER_EXPORTS.flatMap((entry) =>
    entry.ruleKey === undefined ? [] : [[entry.ruleKey, entry] as const]
  )
);

export const RESERVED_TRIGGER_EXPORT_NAMES = new Set(
  HAND_WRITTEN_TRIGGER_EXPORTS.map((entry) => entry.exportName)
);

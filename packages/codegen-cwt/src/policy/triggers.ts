/**
 * Hand-written exports sharing the generated trigger/link namespace.
 *
 * A row decides both whether trigger generation skips a CWT key and whether
 * scope-link generation reserves the public TypeScript export. Keeping those
 * two projections together prevents a hand-written overload from colliding
 * with a generated export merely because its rule key lives elsewhere.
 */
interface HandWrittenTriggerExportBase {
  /** The exported SDK symbol reserved from generated triggers and scope links. */
  readonly exportName: string;
  /** The hand-written capability that supplies the export. */
  readonly kind:
    "trigger-constructor" | "structural-trigger" | "typed-leaf-trigger" | "polymorphic-scope-link";
  /** Why generated code must yield ownership to the hand-written capability. */
  readonly reason: string;
}

/**
 * A trigger or scope-link export supplied by hand-written SDK code.
 * The discriminator requires loaded CWT rules to have a key while permitting unloaded aliases and
 * name-only reservations.
 */
export type HandWrittenTriggerExport =
  | (HandWrittenTriggerExportBase & {
      /** Requires the audit to find this export's rule key in the loaded CWT rules. */
      readonly expectedInRules: true;
      /** Loaded CWT trigger key that normal generation must yield to the hand-written export. */
      readonly ruleKey: string;
    })
  | (HandWrittenTriggerExportBase & {
      /** Indicates that this export has no key in the loaded CWT rule table. */
      readonly expectedInRules: false;
      /** Optional unloaded alias key that normal generation must reserve. */
      readonly ruleKey?: string;
    });

/** The complete ownership table for hand-written trigger and scope-link exports. */
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
  ...(
    [
      ["currentSituationApproach", "current_situation_approach"],
      ["currentStage", "current_stage"],
      ["canSetSituationApproach", "can_set_situation_approach"],
      ["hasCompletedEventChainCounter", "has_completed_event_chain_counter"],
    ] as const
  ).map(([exportName, ruleKey]): HandWrittenTriggerExport => ({
    exportName,
    ruleKey,
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

/** Indexes hand-written exports by normalized CWT rule key, omitting name-only reservations. */
export function handWrittenTriggerRulesByKey(
  entries: readonly HandWrittenTriggerExport[]
): ReadonlyMap<string, HandWrittenTriggerExport> {
  return new Map(
    entries.flatMap((entry) =>
      entry.ruleKey === undefined ? [] : [[entry.ruleKey.toLowerCase(), entry] as const]
    )
  );
}

/** Hand-written trigger ownership indexed by lowercase CWT rule key. */
export const HAND_WRITTEN_TRIGGER_RULES_BY_KEY = handWrittenTriggerRulesByKey(
  HAND_WRITTEN_TRIGGER_EXPORTS
);

/** Public TypeScript names that scope-link generation must not emit. */
export const RESERVED_TRIGGER_EXPORT_NAMES = new Set(
  HAND_WRITTEN_TRIGGER_EXPORTS.map((entry) => entry.exportName)
);

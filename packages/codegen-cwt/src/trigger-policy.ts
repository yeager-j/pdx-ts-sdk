/**
 * Hand-written exports sharing the generated trigger/link namespace.
 *
 * A row decides both whether trigger generation skips a CWT key and whether
 * scope-link generation reserves the public TypeScript export. Keeping those
 * two projections together prevents a hand-written overload from colliding
 * with a generated export merely because its rule key lives elsewhere.
 */
interface HandWrittenTriggerExportBase {
  readonly exportName: string;
  readonly kind:
    "trigger-constructor" | "structural-trigger" | "typed-leaf-trigger" | "polymorphic-scope-link";
  readonly reason: string;
}

/**
 * A row decides both whether trigger generation skips a CWT key and whether
 * scope-link generation reserves the public TypeScript export.
 *
 * `expectedInRules` and `ruleKey` are a discriminated pair rather than two
 * independent optional fields: `expectedInRules: true` with no `ruleKey`
 * would reserve the export name while never entering
 * `HAND_WRITTEN_TRIGGER_RULES_BY_KEY`, so `emit/triggers.ts` would generate
 * the trigger from the rules AND the hand-written export would shadow it —
 * a silent collision no runtime check would catch, so the union makes the
 * combination impossible to write instead.
 *
 * `expectedInRules: true` says `ruleKey` must match a key the rules actually
 * loaded (`overlay-audit.ts`'s `assertHandWrittenTriggerExportsMatchRules`).
 * `expectedInRules: false` covers a row with no `ruleKey` at all (nothing to
 * check) and `and`/`or`/`not`/`nand`/`nor`/`hidden_trigger`: all six are
 * declared only as `alias[trigger:AND]` and kin in `scope_links.cwt`
 * (vendor/cwtools-stellaris-config/config/scope_links.cwt:5-16), which this
 * generator does not load — see `overlay.ts`'s doc comment on
 * `HandWrittenDefiner`/`hidden_trigger` for why. Their `ruleKey` still names
 * what `emit/triggers.ts` skips generating; `expectedInRules: false` only
 * says the loaded rules will never actually declare it, not that the row is
 * unused.
 */
export type HandWrittenTriggerExport =
  | (HandWrittenTriggerExportBase & { readonly expectedInRules: true; readonly ruleKey: string })
  | (HandWrittenTriggerExportBase & { readonly expectedInRules: false; readonly ruleKey?: string });

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

/**
 * Keyed lowercase, matching the only consumption site's own lookup
 * (`emit/triggers.ts`'s `.get(key.toLowerCase())`) — normalized once here
 * rather than trusting every `ruleKey` in the table above to already be
 * lowercase, so a row spelled with different casing still resolves. A
 * standalone function, not just the constant below, so a test can prove this
 * directly against a synthetic mixed-case row instead of re-deriving the
 * same expression.
 */
export function handWrittenTriggerRulesByKey(
  exports: readonly HandWrittenTriggerExport[]
): ReadonlyMap<string, HandWrittenTriggerExport> {
  return new Map(
    exports.flatMap((entry) =>
      entry.ruleKey === undefined ? [] : [[entry.ruleKey.toLowerCase(), entry] as const]
    )
  );
}

export const HAND_WRITTEN_TRIGGER_RULES_BY_KEY = handWrittenTriggerRulesByKey(
  HAND_WRITTEN_TRIGGER_EXPORTS
);

export const RESERVED_TRIGGER_EXPORT_NAMES = new Set(
  HAND_WRITTEN_TRIGGER_EXPORTS.map((entry) => entry.exportName)
);

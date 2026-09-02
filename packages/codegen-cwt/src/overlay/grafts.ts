/**
 * Graft overlay rows: places where a hand-written module supplies what the
 * generator would otherwise emit — hand-written definers, hand-written
 * `vanilla.*` references — and the contribution sinks that graft a shared,
 * non-id-keyed surface onto a registry's collection factory.
 *
 * See `./index.ts` for what this directory is and how a row here earns its
 * place.
 */

/** Describes a content definer supplied by a hand-written SDK module instead of codegen. */
export interface HandWrittenDefiner {
  /** Audited contract that requires the hand-written definer. */
  readonly reason: string;
  /** Module exporting the definition-side lowering primitive. */
  readonly module: string;
  /** Exported lowering function name. */
  readonly definer: string;
  /**
   * The declared contract the hand-written definer returns beside the def,
   * where it returns one: the property and the type it is parameterised by.
   *
   * Codegen still owns the registry's item type, so it has to be told — an
   * item type that dropped the property would be a supertype an author reaches
   * by annotating, leaving the effect that consumes the definition nothing to
   * check (SDK-181). The generated definers learn the same thing from
   * `ContentScopeParameter.declaredFrom`.
   */
  readonly witness?: {
    /** Item property that carries the returned contract. */
    readonly member: string;
    /** TypeScript type of the returned contract property. */
    readonly type: string;
    /**
     * `KNOWN_SYMBOLS` names {@link HandWrittenDefiner.witness}'s `type` spells,
     * so `packages/sdk/src/generated/content-definers.ts` imports them. Stated
     * by the row for the same reason {@link FieldWidening.symbols} is: the type
     * is free-form TypeScript this table writes and the emitter only splices.
     */
    readonly symbols?: readonly string[];
  };
}

/**
 * Registries whose `defineX` is re-exported from
 * `packages/sdk/src/content/situations.ts` instead of being the mechanical one
 * the emitter would write.
 *
 * The hand-written trigger-export policy arrangement, one level up: codegen skips the
 * member and the hand-written module supplies it, so there is exactly one
 * definition of the graft and it is the reviewed one. A row here is expensive —
 * it removes a definer from generator ownership — and needs a contract the rules
 * cannot express, not merely a nicer signature.
 */
export const HAND_WRITTEN_CONTENT_DEFINERS = new Map<string, HandWrittenDefiner>([
  [
    "situation_type",
    {
      reason:
        "`targetScope` is authored, emits nothing, and is carried on the returned item as the " +
        "situation target contract every `startSituation` call site is checked against " +
        "(packages/sdk/src/script/effects/situations.ts). The rules declare that contract " +
        "nowhere, so no mechanical definer can produce it.",
      module: "../content/situations.ts",
      definer: "defineSituationType",
      witness: { member: "targetScope", type: "ScopeName | undefined", symbols: ["ScopeName"] },
    },
  ],
  [
    "event_chain",
    {
      reason:
        "Counter keys are declared by one event chain and consumed by three script operations; " +
        "the returned item carries that literal key union so those consumers can reject a typo.",
      module: "../content/event-chains.ts",
      definer: "defineEventChain",
    },
  ],
]);

/** Identifies a `vanilla.*` reference surface supplied by hand-written SDK code. */
export interface HandWrittenVanillaRef {
  /** Registry whose vanilla reference surface is hand-written. */
  readonly registry: string;
  /** Audited reason the mechanical reference emitter cannot represent this registry. */
  readonly reason: string;
}

/**
 * `vanilla.*` registries whose reference is hand-written rather than the
 * mechanical checked-id/trie pair in `emit/content/vanilla-refs.ts`, whose
 * `emitRow` builds it from a `CONTENT_MANIFEST` or `VANILLA_REF_EXTRAS` row —
 * the same species of departure `HAND_WRITTEN_CONTENT_DEFINERS` above records
 * for `defineX`.
 *
 * `event` is the only one: an event id is two-part (namespace plus local id),
 * which the ordinary flat-id trie every other oversized registry gets does
 * not model. `makeEventTrie` (`packages/sdk/src/identifiers/trie.ts`) is a
 * distinct hand-written constructor for that shape, not a parameterisation of
 * `makeIdTrie` — so it needs a row here rather than a `VanillaRefRow` this
 * generator could derive a call to `makeIdTrie`/`makeVanillaRef` from.
 */
export const HAND_WRITTEN_VANILLA_REFS: readonly HandWrittenVanillaRef[] = [
  {
    registry: "event",
    reason:
      "Event ids navigate by namespace and local id, not a flat id set; makeEventTrie() is a " +
      "distinct hand-written constructor for that shape.",
  },
];

/** Describes a registry's additive contribution to a shared, non-id-keyed output block. */
export interface ContributionSink {
  /** The contribution method on the collection factory. */
  readonly method: string;
  /** The `ContributionItem` registry tag the fold merges under. */
  readonly sink: string;
  /** The ref registry whose ids the contribution lists. */
  readonly refRegistry: string;
  /** Audited evidence that the registry contributes to this sink. */
  readonly reason: string;
}

/**
 * Registries that additionally contribute to a shared, non-id-keyed sink.
 *
 * A contribution has no id this mod owns and no author-named file: it is folded
 * into one additive `default = { ... }` block at a fixed path. Nothing in the
 * rules marks a registry as having one, so each is a reviewed row.
 */
export const CONTENT_CONTRIBUTION_SINKS = new Map<string, ContributionSink>([
  [
    "country_ship_of_size_limit",
    {
      method: "addShipOfSizeLimits",
      sink: "ship_of_size_limits",
      refRegistry: "country_ship_of_size_limit",
      reason:
        "`country_limits` reads one shared additive `default = { ship_of_size_limits = { ... } }`; " +
        "the listed limits are ids, not definitions this file owns.",
    },
  ],
]);

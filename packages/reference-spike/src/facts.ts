/**
 * The spike's own vocabulary for one registry's authoring model.
 *
 * Nothing here is a CWT Codegen type. `probe/codegen-probe.ts` reads that
 * context's internals once and refines what it finds into these values
 * immediately, so every other module in the spike — the claim builders, the
 * fingerprinter, the viewer — depends on this file and never on codegen.
 * Deleting the spike deletes both halves.
 *
 * The shape is deliberately narrower than `ContentEmission`. A reference page
 * needs to say what an author may write, where the game reads it, what the
 * rules declared, and what the lowering did with each declaration; it does not
 * need the emitter's TypeScript strings, its ref bookkeeping, or its corpus
 * descent tree.
 */

/** A canonical scope set, `"any"` when nothing pinned one, `null` when the field has no clause. */
export type FactScope =
  readonly string[] | "any" | { readonly parameter: readonly string[] } | null;

/** One `## cardinality` window, `max: null` for `inf`. */
export interface Cardinality {
  readonly min: number;
  readonly max: number | null;
}

/**
 * One CWT declaration of a key.
 *
 * A key declared more than once has more than one arm — `title` has a scalar
 * arm and a block arm, `picture` has a sprite arm and a trigger-gated block
 * arm. Keeping the arms rather than collapsing them is what lets
 * {@link RegistryFacts.partialLowerings} be derived instead of asserted.
 */
export interface DeclaredArm {
  readonly line: number;
  readonly cardinality: Cardinality;
  /** The rule type, rendered in CWT's own spelling: `<sprite>`, `int_value_field`, `block`. */
  readonly declaredType: string;
  /** `###` prose the rules attach to this declaration, verbatim. */
  readonly docs: readonly string[];
}

/** Every arm of one declared key, at its dotted path below the registry. */
export interface DeclaredKey {
  readonly key: string;
  /** The `subtype[...]` this declaration sits inside, `null` at the body's top level. */
  readonly subtype: string | null;
  readonly arms: readonly DeclaredArm[];
}

/** One key the authoring surface lowered, and what it admits. */
export interface LoweredMember {
  /** The game's key, dotted below the registry: `stages.color`. */
  readonly key: string;
  /** The authored member path: `["stages", "color"]`. */
  readonly memberPath: readonly string[];
  /** The runtime shape token the field metadata carries. */
  readonly shape: string;
  readonly repeated: boolean;
  /** A struct whose repetition is nested inside its key, so its block holds bare blocks. */
  readonly wrapped: boolean;
  /** Every scalar the member admits, when the lowering closed the set. */
  readonly literals: readonly string[] | null;
  readonly scope: FactScope;
  readonly clause: "trigger" | "effect" | null;
  /** Whether the key is written at the definition's top level or inside another key's block. */
  readonly level: "top" | "nested";
  /**
   * Where the declaration this member lowered from is written.
   *
   * `"body"` means this registry's own rule body declares the key, so
   * {@link RegistryFacts.declared} carries its arms. `"alias-clause"` means
   * the key arrived by expanding a shared clause — `modifier_rule`'s
   * `potential`, a weight block's `modifier` — and its declaration belongs to
   * that alias category rather than to situations. Saying so is the honest
   * alternative to showing "no declaration found" for a key the rules very
   * much declare, somewhere else.
   */
  readonly declaredIn: "body" | "alias-clause";
}

/**
 * A key the rules declare more than once where the lowering kept fewer arms.
 *
 * Derived by comparing {@link RegistryFacts.declared} against
 * {@link RegistryFacts.lowered}, which is the whole reason the arms are kept
 * apart. A dual lowering (`title`) keeps both arms in one member and reports
 * nothing here; a key whose second arm the emitter could not tell apart from
 * the first (`picture`) reports the arms it dropped.
 */
export interface PartialLowering {
  readonly key: string;
  /** The declarations the surface did not keep, in the rules' own spelling. */
  readonly droppedArms: readonly string[];
  /** The declaration the surviving member kept. */
  readonly keptArm: string;
  /** The shape the surviving member lowered to, or `null` when nothing lowered. */
  readonly loweredShape: string | null;
}

/**
 * A keyed collection of nested definitions, and the layout it emits.
 *
 * The two spellings are the reason Situation is the spike's stress test.
 * `container` writes one block holding named entries — `stages = { early = {
 * … } late = { … } }` — so the record key is the entry's identity. `siblings`
 * writes the key once per entry — `approach = { name = calm … } approach = {
 * name = brace … }` — so the identity is a body field inside each block, and
 * the authoring record key is lifted into it. Same authoring shape, different
 * PDXScript.
 *
 * Both halves are derived: the emitter marks a siblings-keyed struct as
 * repeating at the sibling level, and the identity field is the one key the
 * rules declare inside the struct that the surface lowers to no member,
 * because the record key already supplies it.
 */
export interface RepeatedStruct {
  readonly key: string;
  readonly keying: "container" | "siblings";
  readonly identityKey: string | null;
}

/** One `<id>`-keyed localization slot the registry declares. */
export interface LocalisationSlot {
  readonly member: string;
  readonly pattern: string;
  readonly required: boolean;
  /** Where the slot is declared: the registry itself, or a repeated struct inside it. */
  readonly owner: string;
}

/**
 * A `subtype[...]`, and which body keys it gates.
 *
 * The discriminator itself — the `total_progress = {}` that selects
 * `dynamic_progress` — is written in the `type[...]` declaration, and the
 * codegen model keeps only the one discriminator shape it can state
 * (`absentUnless`). Everything else about the selector is dropped before the
 * spike can see it, which is a fact the page has to report rather than paper
 * over: the surface gates fields by subtype without being able to say what
 * puts a definition in one.
 */
export interface Subtype {
  readonly name: string;
  /** Body keys the rules declare only for definitions in this subtype. */
  readonly gatedKeys: readonly string[];
  /** Body keys the rules declare for every subtype except this one. */
  readonly excludedKeys: readonly string[];
  /** The field whose absence selects the subtype, where codegen models it. */
  readonly absentUnless: string | null;
}

/**
 * One registry's post-overlay authoring model, as the spike sees it.
 *
 * Every field is a projection of what CWT Codegen decided, never a restatement
 * of it: a claim built from this value is wrong exactly when codegen changed,
 * which is what the parity gate measures.
 */
export interface RegistryFacts {
  readonly registry: string;
  /** The emitted TypeScript type's stem, `SituationType`. */
  readonly typeName: string;
  /** Where the game reads these definitions, `game/common/situations`. */
  readonly definitionPath: string;
  readonly subtypes: readonly Subtype[];
  readonly declared: readonly DeclaredKey[];
  readonly lowered: readonly LoweredMember[];
  readonly repeatedStructs: readonly RepeatedStruct[];
  readonly partialLowerings: readonly PartialLowering[];
  readonly localisation: readonly LocalisationSlot[];
  /** Declared localization slots the emitter excluded, each with its reason. */
  readonly localisationExclusions: readonly string[];
  /** Body fields renamed because their mechanical member name was already a slot. */
  readonly localisationRenames: readonly string[];
  /** Refused outright by the overlay's declined-field table, each with its reason. */
  readonly declined: readonly string[];
  /** Declared but not expressible: blocked on emitter machinery, each with what stopped it. */
  readonly unsupported: readonly string[];
  /** Alias categories spliced unkeyed at the top level. */
  readonly inlineSplices: readonly string[];
  /**
   * The localization slots a whole-object patch of a vanilla definition may
   * rewrite, each with the vanilla key its text replaces.
   *
   * Empty is the honest signal that this registry has no `patchX` surface at
   * all: the emitter derives these from the registry's own declared slots only
   * once the overlay has admitted it as a patch registry, so a registry nobody
   * has verified override rules for produces none. That makes "is this
   * patchable" a projection rather than a sentence somebody keeps in step.
   */
  readonly patchLocalisation: readonly string[];
  /** Extra input forms a patch member admits over the definition's own, each with its reason. */
  readonly patchWidenings: readonly string[];
  /** Emitted members a patch cannot carry, each with the mechanical reason. */
  readonly patchExclusions: readonly string[];
}

/**
 * A contract the SDK asserts by hand where no rule states it.
 *
 * Not derivable from codegen by construction: the whole reason a hand-written
 * contract exists is that the rules are silent. The probe cannot produce these,
 * so they are declared in `build/sdk-contracts.ts` and carry the source file
 * they live in, and a gate reads that file to check the anchor still exists.
 */
export interface SdkAuthoredContract {
  readonly member: string;
  readonly statement: string;
  /** Repo-relative source file that implements the contract. */
  readonly source: string;
  /** A string that must still appear in {@link source} for the citation to hold. */
  readonly anchor: string;
  /** Why the rules cannot state it. */
  readonly whyNotDerived: string;
  /** Whether the member reaches the emitted PDXScript at all. */
  readonly serialized: boolean;
}

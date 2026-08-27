/**
 * The permanently hand-written half of internal lowering.
 *
 * The 33 mechanical content definers and `namespace(ns)`'s event definers are
 * generated — `src/generated/content-definers.ts` and
 * `src/generated/event-definers.ts` — from the same rules that generate the
 * registries themselves. What stays here is what codegen cannot write:
 * `defineSituationType`, whose `targetScope` is the situation target contract
 * rather than anything the rules describe, and `on`, which has no registry
 * behind it at all.
 *
 * The situation definer is skip-listed in the codegen overlay
 * (`HAND_WRITTEN_CONTENT_DEFINERS`), the same arrangement the generator-owned
 * trigger policy uses one level up, so `content-definers.ts` re-exports the definition below
 * instead of emitting a mechanical one beside it. The raw constructors remain
 * available to package internals; public authors use mod capability methods.
 */

import type {
  ContentIdMinter,
  IdProfile,
  MintedContentId,
} from "../generated/content-capability.ts";
import type { ScopeName } from "../generated/scopes.ts";
import {
  SITUATION_TYPE_LOCALISATION,
  type SituationApproachFields,
  type SituationStageFields,
  type SituationTypeDef,
} from "../generated/situation-type.ts";
import type { ComplexTriggerModifierWithLoc, ModifierWithLoc } from "../script/effects/types.ts";
import type { TypedRef } from "../script/scalar.ts";
import type { SituationTrigger } from "../script/triggers.ts";
import { contentLocalizationRefs } from "./authoring.ts";
import { createContentHandle, type ContentHandleBase } from "./handle.ts";
import type { ContentItem, WeightBlockRow, WeightBlockWithLocOperations } from "./types.ts";

/** An approach defined inside one authored situation type. */
export interface SituationApproach<
  ParentId extends string,
  Name extends string,
> extends TypedRef<"situation_approach"> {
  /** Distinguishes an approach from other nested situation definitions. */
  readonly nestedKind: "situation-approach";
  /** The situation type that owns this approach. */
  readonly parentId: ParentId;
  /** The full approach id minted from its parent and logical name. */
  readonly id: `${ParentId}_approach_${Name}`;
  /** The approach body lowered beneath its minted id. */
  readonly def: SituationApproachFields;
}

/** A stage defined inside one authored situation type. */
export interface SituationStage<
  ParentId extends string,
  Name extends string,
> extends TypedRef<"situation_stage"> {
  /** Distinguishes a stage from other nested situation definitions. */
  readonly nestedKind: "situation-stage";
  /** The situation type that owns this stage. */
  readonly parentId: ParentId;
  /** The full stage id minted from its parent and logical name. */
  readonly id: `${ParentId}_stage_${Name}`;
  /** The stage body lowered beneath its minted id. */
  readonly def: SituationStageFields;
}

type ContextApproachFields<ParentId extends string> = Omit<
  SituationApproachFields,
  "allow" | "potential"
> & {
  readonly allow?: SituationTrigger<
    `${ParentId}_approach_${string}`,
    `${ParentId}_stage_${string}`
  >;
  readonly potential?: SituationTrigger<
    `${ParentId}_approach_${string}`,
    `${ParentId}_stage_${string}`
  >;
};

type ContextStageFields<ParentId extends string> = Omit<SituationStageFields, "potential"> & {
  readonly potential?: SituationTrigger<
    `${ParentId}_approach_${string}`,
    `${ParentId}_stage_${string}`
  >;
};

/**
 * Parent-bound functions for declaring referenceable situation approaches and stages.
 *
 * @example
 * ```ts
 * mod.situationType("bloom", (situation) => {
 *   const observe = situation.approach("observe", {
 *     name: "Observe",
 *     icon: "GFX_situation_approach_research",
 *     iconBackground: "GFX_situation_approach_bg_green",
 *   });
 *   return {
 *     name: "Bloom",
 *     approach: [observe],
 *     monthlyProgress: {
 *       base: 1,
 *       modifiers: [{ add: 1, desc: "Observing", when: currentSituationApproach(observe) }],
 *     },
 *   };
 * });
 * ```
 */
export interface SituationDefinitionContext<ParentId extends string> {
  /** Defines an approach whose returned value is also accepted as an approach reference. */
  approach<const Name extends string>(
    name: Name,
    def: ContextApproachFields<ParentId>
  ): SituationApproach<ParentId, Name>;
  /** Defines a stage whose returned value is also accepted as a stage reference. */
  stage<const Name extends string>(
    name: Name,
    def: ContextStageFields<ParentId>
  ): SituationStage<ParentId, Name>;
}

/**
 * `approach`'s and `stages`' own trigger fields, narrowed from
 * `Trigger<"situation">` to `SituationTrigger<NoInfer<Approach>,
 * NoInfer<Stage>>` (SDK-52). `Approach`/`Stage` are otherwise inferred solely
 * from `approach`'s/`stages`' own record keys below — every occurrence here is
 * `NoInfer`d so these fields are *checked* against that inference rather than
 * contributing candidates to it. Getting that backwards (letting these sites
 * also infer) reopens the failure mode SDK-33 names: whichever call the
 * compiler resolves first can hijack the inferred key set and reject
 * unrelated, correctly-spelled sibling keys instead of the typo.
 */
type CheckedApproachFields<Approach extends string, Stage extends string> = Omit<
  SituationApproachFields,
  "allow" | "potential"
> & {
  readonly allow?: SituationTrigger<NoInfer<Approach>, NoInfer<Stage>>;
  readonly potential?: SituationTrigger<NoInfer<Approach>, NoInfer<Stage>>;
};

type CheckedStageFields<Approach extends string, Stage extends string> = Omit<
  SituationStageFields,
  "potential"
> & {
  readonly potential?: SituationTrigger<NoInfer<Approach>, NoInfer<Stage>>;
};

type CheckedSituationModifier<Approach extends string, Stage extends string> = Omit<
  ModifierWithLoc<"situation">,
  "when"
> & {
  readonly when?: SituationTrigger<NoInfer<Approach>, NoInfer<Stage>>;
};

type CheckedComplexSituationModifier<Approach extends string, Stage extends string> = Omit<
  ComplexTriggerModifierWithLoc<"situation">,
  "potential"
> & {
  readonly potential?: SituationTrigger<NoInfer<Approach>, NoInfer<Stage>>;
};

type CheckedMonthlyProgress<
  Approach extends string,
  Stage extends string,
> = WeightBlockWithLocOperations<"situation"> & {
  readonly base?: number;
  readonly modifiers?: readonly WeightBlockRow<
    "situation",
    CheckedSituationModifier<Approach, Stage>,
    CheckedComplexSituationModifier<Approach, Stage>
  >[];
};

/**
 * Internal situation-type lowering primitive.
 *
 * One object, doing three jobs: it is the item the capability places,
 * the `targetScope`-carrying ref `startSituation` call sites are checked
 * against (see src/script/effects/situations.ts), and — `Approach`/`Stage` inferred from this
 * same call's own `approach`/`stages` record keys — the boundary
 * `currentSituationApproach`/`currentStage`/`canSetSituationApproach` are
 * checked against (SDK-52, see `SituationTrigger` in `triggers.ts`).
 *
 * That boundary is narrower than every `current_situation_approach`/
 * `current_stage` a mod might write: it only reaches a value assigned
 * straight to `approach.allow`, `approach.potential`, `stages.potential`, or
 * `abortTrigger`. The parent-bound callback form below also checks
 * `monthlyProgress` modifier gates against the nested values it returns.
 * Vanilla also writes these inside a
 * combinator (`and`/`or`/`not`/`customTooltipFail`) or inside an effect
 * closure's `scope.if(...)` (`on_start`, `on_progress_complete`, ...), neither
 * of which can thread a phantom brand through arbitrary composition — the
 * checked positions above are the direct-value boundaries that can. Composed or
 * closure-nested values still type-check (`SituationTrigger`'s brands are
 * optional), degrading to unchecked the same as an id whose situation
 * identity genuinely is not known.
 *
 * `Approach`/`Stage` default to `never`, not `string`: a definition that
 * omits `approach` or `stages` entirely declares an empty set, and `never`
 * is the type for which nothing is a member, so a direct literal reference
 * into the missing side is rejected rather than silently accepted. Plain and
 * combinator-produced values still flow through the same optional brands as
 * above, so this narrows only the direct-literal path, not the boundary.
 *
 * `links.cwt` gives the situation `target` link `output_scope = any`, so no
 * reading of the rules could produce the `targetScope` signature either.
 * `targetScope` is authored and emits nothing — it is stripped out of `def`,
 * and what the emitter lowers is the rest — riding on the item itself, where
 * nothing reads it but the type system.
 */
export type SituationTypeCapabilityDef<
  Id extends string,
  T extends ScopeName | undefined = undefined,
  Approach extends string = never,
  Stage extends string = never,
> = Omit<SituationTypeDef<Id>, "approach" | "stages" | "abortTrigger"> & {
  readonly targetScope?: T;
  readonly approach?: Readonly<Record<Approach, CheckedApproachFields<Approach, Stage>>>;
  readonly stages?: Readonly<Record<Stage, CheckedStageFields<Approach, Stage>>>;
  readonly abortTrigger?: SituationTrigger<NoInfer<Approach>, NoInfer<Stage>>;
};

/** A situation definition authored with parent-scoped nested definition values. */
export type SituationTypeContextDef<
  Id extends string,
  T extends ScopeName | undefined = undefined,
  Approach extends SituationApproach<Id, string> = never,
  Stage extends SituationStage<Id, string> = never,
> = Omit<
  SituationTypeCapabilityDef<Id, T, NoInfer<Approach["id"]>, NoInfer<Stage["id"]>>,
  "id" | "approach" | "stages" | "monthlyProgress"
> & {
  /** Monthly progress whose direct nested references belong to this situation. */
  readonly monthlyProgress: CheckedMonthlyProgress<Approach["id"], Stage["id"]>;
  /** Approaches declared through this definition's parent-bound context. */
  readonly approach?: readonly Approach[];
  /** Stages declared through this definition's parent-bound context. */
  readonly stages?: readonly Stage[];
};

/** Builds one situation definition from its already-minted parent identity. */
export type SituationTypeDefinition<
  Id extends string,
  T extends ScopeName | undefined = undefined,
  Approach extends SituationApproach<Id, string> = never,
  Stage extends SituationStage<Id, string> = never,
> = (situation: SituationDefinitionContext<Id>) => SituationTypeContextDef<Id, T, Approach, Stage>;

type AnySituationApproach<ParentId extends string> = SituationApproach<ParentId, string>;
type AnySituationStage<ParentId extends string> = SituationStage<ParentId, string>;
interface SituationDefinitionSession<ParentId extends string> {
  readonly context: SituationDefinitionContext<ParentId>;
  readonly approaches: readonly AnySituationApproach<ParentId>[];
  readonly stages: readonly AnySituationStage<ParentId>[];
}
type SituationTypeInput<Id extends string> =
  | Omit<SituationTypeCapabilityDef<Id, ScopeName | undefined, string, string>, "id">
  | SituationTypeDefinition<
      Id,
      ScopeName | undefined,
      AnySituationApproach<Id>,
      AnySituationStage<Id>
    >;

function nestedDefinitionRecord<
  ParentId extends string,
  Definition extends AnySituationApproach<ParentId> | AnySituationStage<ParentId>,
>(
  parentId: ParentId,
  nestedKind: Definition["nestedKind"],
  definitions: readonly Definition[],
  declarations: readonly Definition[],
  label: "approach" | "stage",
  member: "approach" | "stages"
): Readonly<Record<string, Definition["def"]>> {
  const record: Record<string, Definition["def"]> = {};
  const declared = new Set(declarations);
  const returned = new Set<Definition>();
  for (const definition of definitions) {
    if (definition.nestedKind !== nestedKind || definition.parentId !== parentId) {
      throw new Error(
        `Nested situation definition "${definition.id}" does not belong to "${parentId}"`
      );
    }
    if (!declared.has(definition)) {
      throw new Error(
        `Nested situation ${label} "${definition.id}" was not declared by this definition callback`
      );
    }
    if (definition.id in record) {
      throw new Error(`Duplicate nested situation definition id "${definition.id}"`);
    }
    record[definition.id] = definition.def;
    returned.add(definition);
  }
  for (const declaration of declarations) {
    if (!returned.has(declaration)) {
      throw new Error(
        `Nested situation ${label} "${declaration.id}" was declared but omitted from the returned "${member}" array`
      );
    }
  }
  return record;
}

function normalizeContextDefinition<
  Id extends string,
  T extends ScopeName | undefined,
  Approach extends AnySituationApproach<Id>,
  Stage extends AnySituationStage<Id>,
>(
  id: Id,
  def: SituationTypeContextDef<Id, T, Approach, Stage>,
  declarations: Pick<SituationDefinitionSession<Id>, "approaches" | "stages">
): SituationTypeCapabilityDef<Id, T, Approach["id"], Stage["id"]> {
  const { approach, stages, ...fields } = def;
  return {
    ...fields,
    ...(approach === undefined && declarations.approaches.length === 0
      ? {}
      : {
          approach: nestedDefinitionRecord(
            id,
            "situation-approach",
            approach ?? [],
            declarations.approaches,
            "approach",
            "approach"
          ),
        }),
    ...(stages === undefined && declarations.stages.length === 0
      ? {}
      : {
          stages: nestedDefinitionRecord(
            id,
            "situation-stage",
            stages ?? [],
            declarations.stages,
            "stage",
            "stages"
          ),
        }),
  } as SituationTypeCapabilityDef<Id, T, Approach["id"], Stage["id"]>;
}

function createSituationDefinitionSession<Id extends string>(
  parentId: Id,
  assertName: (name: string) => void,
  assertNestedId: (id: string) => void
): SituationDefinitionSession<Id> {
  const approaches: AnySituationApproach<Id>[] = [];
  const stages: AnySituationStage<Id>[] = [];
  const context: SituationDefinitionContext<Id> = Object.freeze({
    approach<const Name extends string>(
      name: Name,
      def: ContextApproachFields<Id>
    ): SituationApproach<Id, Name> {
      assertName(name);
      const id = `${parentId}_approach_${name}` as const;
      assertNestedId(id);
      const approach = Object.freeze({
        nestedKind: "situation-approach",
        parentId,
        id,
        def,
      }) as SituationApproach<Id, Name>;
      approaches.push(approach);
      return approach;
    },
    stage<const Name extends string>(
      name: Name,
      def: ContextStageFields<Id>
    ): SituationStage<Id, Name> {
      assertName(name);
      const id = `${parentId}_stage_${name}` as const;
      assertNestedId(id);
      const stage = Object.freeze({
        nestedKind: "situation-stage",
        parentId,
        id,
        def,
      }) as SituationStage<Id, Name>;
      stages.push(stage);
      return stage;
    },
  });
  return { context, approaches, stages };
}

export function defineSituationType<
  const Id extends string,
  T extends ScopeName | undefined = undefined,
  const Approach extends string = never,
  const Stage extends string = never,
>(
  def: SituationTypeCapabilityDef<Id, T, Approach, Stage>
): ContentItem<"situation_type", SituationTypeDef<Id>> & { readonly targetScope: T } {
  const { targetScope, ...rest } = def;
  return {
    itemKind: "content",
    type: "situation_type",
    id: def.id,
    def: rest as SituationTypeDef<Id>,
    loc: contentLocalizationRefs(def.id, SITUATION_TYPE_LOCALISATION),
    targetScope: targetScope as T,
  };
}

/** Situation-type authoring methods bound to one mod capability. */
export interface SituationTypeCapabilityMethods<P extends string, I extends IdProfile> {
  /**
   * Defines a situation type from either a plain body or a parent-bound definition callback.
   * The callback form mints referenceable approaches and stages from logical names.
   */
  situationType<
    const Name extends string,
    T extends ScopeName | undefined = undefined,
    const Approach extends string = never,
    const Stage extends string = never,
    const NestedApproach extends SituationApproach<
      MintedContentId<P, I, "situationType", Name>,
      string
    > = never,
    const NestedStage extends SituationStage<MintedContentId<P, I, "situationType", Name>, string> =
      never,
  >(
    name: Name,
    def:
      | Omit<
          SituationTypeCapabilityDef<
            MintedContentId<P, I, "situationType", Name>,
            T,
            Approach,
            Stage
          >,
          "id"
        >
      | SituationTypeDefinition<
          MintedContentId<P, I, "situationType", Name>,
          T,
          NestedApproach,
          NestedStage
        >
  ): ContentItem<
    "situation_type",
    SituationTypeDef<MintedContentId<P, I, "situationType", Name>>
  > & {
    readonly targetScope: T;
  };
  /**
   * Mints a situation type id without its definition.
   * Define it later with its `define(...)` method when a cycle needs the id first.
   * The handle is a reference, not content: place the item `define(...)` returns.
   *
   * The target scope, approach keys, and stage keys are all read off the
   * definition, so they live on `define` rather than on the mint — there is no
   * def to infer them from when the id is minted.
   */
  situationTypeHandle<const Name extends string>(
    name: Name
  ): ContentHandleBase<"situation_type", MintedContentId<P, I, "situationType", Name>> & {
    define<
      T extends ScopeName | undefined = undefined,
      const Approach extends string = never,
      const Stage extends string = never,
      const NestedApproach extends SituationApproach<
        MintedContentId<P, I, "situationType", Name>,
        string
      > = never,
      const NestedStage extends SituationStage<
        MintedContentId<P, I, "situationType", Name>,
        string
      > = never,
    >(
      def:
        | Omit<
            SituationTypeCapabilityDef<
              MintedContentId<P, I, "situationType", Name>,
              T,
              Approach,
              Stage
            >,
            "id"
          >
        | SituationTypeDefinition<
            MintedContentId<P, I, "situationType", Name>,
            T,
            NestedApproach,
            NestedStage
          >
    ): ContentItem<
      "situation_type",
      SituationTypeDef<MintedContentId<P, I, "situationType", Name>>
    > & {
      readonly targetScope: T;
    };
  };
}

/** Binds the situation-type capability method to one content-id minter. */
export function situationTypeCapabilityMethods<P extends string, I extends IdProfile>(
  mint: ContentIdMinter<P, I>,
  assertNestedId: (id: string) => void,
  assertName: (name: string) => void
): SituationTypeCapabilityMethods<P, I> {
  const handle = <const Name extends string>(name: Name) => {
    const id = mint("situationType", name);
    const base = createContentHandle(
      "situation_type",
      id,
      (def: SituationTypeCapabilityDef<MintedContentId<P, I, "situationType", Name>>) => {
        for (const id of [...Object.keys(def.approach ?? {}), ...Object.keys(def.stages ?? {})]) {
          assertNestedId(id);
        }
        return defineSituationType(def);
      }
    );
    return Object.freeze({
      ...base,
      define: (input: SituationTypeInput<MintedContentId<P, I, "situationType", Name>>) => {
        const def = (() => {
          if (typeof input !== "function") {
            return input;
          }
          const session = createSituationDefinitionSession(id, assertName, assertNestedId);
          return normalizeContextDefinition(id, input(session.context), session);
        })();
        return base.define(
          def as unknown as Omit<
            SituationTypeCapabilityDef<MintedContentId<P, I, "situationType", Name>>,
            "id"
          >
        );
      },
    });
  };
  const situationType = <const Name extends string>(
    name: Name,
    def: SituationTypeInput<MintedContentId<P, I, "situationType", Name>>
  ) => handle(name).define(def);
  return {
    situationTypeHandle: handle,
    // The eager method is sugar for `handle(name).define(def)`, so the mint and
    // the nested-id assertion happen in one place, as they do for every
    // generated registry.
    situationType,
  } as SituationTypeCapabilityMethods<P, I>;
}

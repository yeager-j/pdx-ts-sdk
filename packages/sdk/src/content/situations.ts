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
 * (`HAND_WRITTEN_CONTENT_DEFINERS`), the same arrangement `HAND_WRITTEN_TRIGGERS`
 * uses one level up, so `content-definers.ts` re-exports the definition below
 * instead of emitting a mechanical one beside it. The raw constructors remain
 * available to package internals; public authors use mod capability methods.
 */

import type {
  ContentIdMinter,
  IdProfile,
  MintedContentId,
} from "../generated/content-capability.ts";
import type { ScopeName } from "../generated/scopes.ts";
import type {
  SituationApproachFields,
  SituationStageFields,
  SituationTypeDef,
} from "../generated/situation-type.ts";
import type { SituationTrigger } from "../script/triggers.ts";
import type { ContentItem } from "./types.ts";

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
 * `abortTrigger`. Vanilla overwhelmingly writes these nested inside a
 * combinator (`and`/`or`/`not`/`customTooltipFail`) or inside an effect
 * closure's `scope.if(...)` (`on_start`, `on_progress_complete`, ...), neither
 * of which can thread a phantom brand through arbitrary composition — the
 * checked positions above are exactly the ones that can. Composed or
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
    targetScope: targetScope as T,
  };
}

/** Situation-type authoring methods bound to one mod capability. */
export interface SituationTypeCapabilityMethods<P extends string, I extends IdProfile> {
  situationType<
    const Name extends string,
    T extends ScopeName | undefined = undefined,
    const Approach extends string = never,
    const Stage extends string = never,
  >(
    name: Name,
    def: Omit<
      SituationTypeCapabilityDef<MintedContentId<P, I, "situationType", Name>, T, Approach, Stage>,
      "id"
    >
  ): ContentItem<
    "situation_type",
    SituationTypeDef<MintedContentId<P, I, "situationType", Name>>
  > & {
    readonly targetScope: T;
  };
}

/** Binds the situation-type capability method to one content-id minter. */
export function situationTypeCapabilityMethods<P extends string, I extends IdProfile>(
  mint: ContentIdMinter<P, I>,
  assertNestedId: (id: string) => void
): SituationTypeCapabilityMethods<P, I> {
  return {
    situationType: (name, def) => {
      for (const id of [...Object.keys(def.approach ?? {}), ...Object.keys(def.stages ?? {})]) {
        assertNestedId(id);
      }
      return defineSituationType({
        ...def,
        id: mint("situationType", name),
      } as SituationTypeCapabilityDef<MintedContentId<P, I, "situationType", typeof name>>);
    },
  } as SituationTypeCapabilityMethods<P, I>;
}

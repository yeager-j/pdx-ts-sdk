/**
 * Mission subtype authoring contracts.
 *
 * Contract categories carry the qualified reference emitted from
 * `isContract: true`. This module uses that witness to require `eventChain`
 * and admit contract-only fields without exposing them on ordinary missions.
 */

import type {
  ContentIdMinter,
  IdProfile,
  MintedContentId,
} from "../generated/content-capability.ts";
import {
  MISSION_LOCALISATION,
  type MissionDef,
  type MissionFields,
  type MissionLocationScope,
} from "../generated/mission.ts";
import type {
  EventChainRef,
  MissionCategoryContractRef,
  MissionCategoryRef,
} from "../generated/refs.ts";
import { contentLocalizationRefs } from "./authoring.ts";
import { createContentHandle, type ContentHandleBase } from "./handle.ts";
import type { ContentItem } from "./types.ts";

type MissionContractMember =
  | "potentialIssuer"
  | "possibleIssuer"
  | "potentialOperator"
  | "possibleOperator"
  | "smallPicture"
  | "timeToAccept"
  | "timeToComplete"
  | "aiBehaviour"
  | "onIssue"
  | "onAccept"
  | "aiWeight";

type MissionCategoryInput = MissionCategoryRef | string | undefined;

type AuthoredContractCategory = MissionCategoryContractRef & {
  readonly def: { readonly isContract: true };
};

type MissionCommonDef<Id extends string, L extends MissionLocationScope | undefined> = Omit<
  MissionDef<Id, "country", L>,
  "id" | "category" | "eventChain" | MissionContractMember
>;

type MissionContractDef<
  Id extends string,
  Category extends MissionCategoryContractRef,
  L extends MissionLocationScope | undefined,
> = MissionCommonDef<Id, L> &
  Pick<MissionFields<"country", L>, MissionContractMember> & {
    readonly category: Category;
    readonly eventChain: EventChainRef | string;
  };

type MissionOrdinaryDef<
  Id extends string,
  Category extends MissionCategoryInput,
> = MissionCommonDef<Id, undefined> & {
  readonly category?: Category;
  readonly eventChain?: EventChainRef | string;
} & { readonly [Member in MissionContractMember]?: never };

/** A mission body selected by its category reference. */
export type MissionCapabilityDef<
  Id extends string,
  Category extends MissionCategoryInput = undefined,
  L extends MissionLocationScope | undefined = undefined,
> = Category extends AuthoredContractCategory
  ? MissionContractDef<Id, Category, L>
  : MissionOrdinaryDef<Id, Category>;

/** A defined mission carrying its declared contract-location scope. */
type DefinedMissionItem<
  Id extends string = string,
  L extends MissionLocationScope | undefined = MissionLocationScope | undefined,
> = ContentItem<"mission", MissionDef<Id, never>> & { readonly locationScope: L };

/** Internal mission lowering primitive. */
export function defineMission<
  const Id extends string,
  L extends MissionLocationScope | undefined = undefined,
>(def: MissionDef<Id, "country", L>): DefinedMissionItem<Id, L> {
  const { locationScope, ...stored } = def;
  return {
    itemKind: "content",
    type: "mission",
    id: def.id,
    def: stored as MissionDef<Id, never>,
    loc: contentLocalizationRefs(def.id, MISSION_LOCALISATION),
    locationScope: locationScope as L,
  };
}

/** Mission authoring methods bound to one mod capability. */
export interface MissionCapabilityMethods<P extends string, I extends IdProfile> {
  /**
   * Defines a mission whose category controls its contract-only surface.
   *
   * @example
   * ```ts
   * const ordinaryCategory = mod.missionCategory("survey", {
   *   isContract: false,
   *   mapIcon: "GFX_nomad_contract_icon",
   *   logIcon: "gfx/interface/icons/contracts/contract_icon_log.dds",
   * });
   * mod.mission("survey", {
   *   category: ordinaryCategory,
   *   picture: "GFX_event_pictures_ancient_ruins",
   * });
   *
   * const contractCategory = mod.missionCategory("contracts", {
   *   isContract: true,
   *   mapIcon: "GFX_nomad_contract_icon",
   *   logIcon: "gfx/interface/icons/contracts/contract_icon_log.dds",
   * });
   * const contractChain = mod.eventChain("contract", {});
   * mod.mission("recovery_contract", {
   *   category: contractCategory,
   *   eventChain: contractChain,
   *   picture: "GFX_event_pictures_ancient_ruins",
   *   locationScope: "planet",
   * });
   * ```
   */
  mission<
    const Name extends string,
    const Category extends MissionCategoryInput = undefined,
    L extends MissionLocationScope | undefined = undefined,
  >(
    name: Name,
    def: MissionCapabilityDef<MintedContentId<P, I, "mission", Name>, Category, L>
  ): DefinedMissionItem<MintedContentId<P, I, "mission", Name>, L>;
  /** Mints a mission id before its category and definition are known. */
  missionHandle<const Name extends string>(
    name: Name
  ): ContentHandleBase<"mission", MintedContentId<P, I, "mission", Name>> & {
    define<
      const Category extends MissionCategoryInput = undefined,
      L extends MissionLocationScope | undefined = undefined,
    >(
      def: MissionCapabilityDef<MintedContentId<P, I, "mission", Name>, Category, L>
    ): DefinedMissionItem<MintedContentId<P, I, "mission", Name>, L>;
  };
}

/** Binds the mission capability methods to one content-id minter. */
export function missionCapabilityMethods<P extends string, I extends IdProfile>(
  mint: ContentIdMinter<P, I>
): MissionCapabilityMethods<P, I> {
  const handle = <const Name extends string>(name: Name) =>
    createContentHandle(
      "mission",
      mint("mission", name),
      (def: MissionDef<MintedContentId<P, I, "mission", Name>>) => defineMission(def)
    );
  return {
    missionHandle: handle,
    mission: (name, def) =>
      handle(name).define(
        def as unknown as Omit<MissionDef<MintedContentId<P, I, "mission", typeof name>>, "id">
      ),
  } as MissionCapabilityMethods<P, I>;
}

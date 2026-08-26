/**
 * The declared half of the contract-mission location contract.
 *
 * A contract mission can declare the spatial-object scope that its callbacks
 * receive from the `location` passed to `enable_mission` or `issue_contract`.
 * The generated mission item retains that declaration, and these overloads
 * require a matching location whenever the declaration is present.
 */

import type { EnableMissionArgs, IssueContractArgs } from "../../generated/effects.ts";
import type { MissionLocationScope } from "../../generated/mission.ts";
import type { TypedRef } from "../scalar.ts";
import type { Unambiguous } from "./contracts.ts";
import type { ScopeValue } from "./types.ts";

/** A defined mission carrying its author-declared contract-location scope. */
export interface MissionLocationContract<
  L extends MissionLocationScope = MissionLocationScope,
> extends TypedRef<"mission"> {
  readonly locationScope: L;
}

declare module "../../generated/effects.ts" {
  interface EnableMissionEffectsExtension {
    /**
     * Enables a mission at the spatial object declared by its
     * `locationScope`. A mission without a declaration uses the generated
     * unchecked overload for vanilla and third-party compatibility.
     */
    enableMission<L extends MissionLocationScope>(
      args: Omit<EnableMissionArgs, "name" | "location"> & {
        name: Unambiguous<L, MissionLocationContract<L>>;
        location: ScopeValue<NoInfer<L>>;
      }
    ): void;
  }

  interface IssueContractEffectsExtension {
    /**
     * Issues a contract mission at the spatial object declared by its
     * `locationScope`. A mission without a declaration uses the generated
     * unchecked overload for vanilla and third-party compatibility.
     */
    issueContract<L extends MissionLocationScope>(
      args: Omit<IssueContractArgs, "contract" | "location"> & {
        contract: Unambiguous<L, MissionLocationContract<L>>;
        location: ScopeValue<NoInfer<L>>;
      }
    ): void;
  }
}

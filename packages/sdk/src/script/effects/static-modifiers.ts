import type {
  AddModifierArgs,
  AddStageModifierArgs,
  ExportModifierDurationToVariableArgs,
} from "../../generated/effects.ts";
import type { StaticModifierRef } from "../../generated/refs.ts";
import type { StaticModifierScope } from "../../generated/static-modifier.ts";
import type { Unambiguous } from "./contracts.ts";

/** An SDK-authored static modifier carrying the one scope whose objects may hold it. */
export interface StaticModifierHostContract<
  S extends StaticModifierScope = StaticModifierScope,
> extends StaticModifierRef {
  /** The one scope whose objects may hold the modifier. */
  readonly hostScope: S;
}

declare module "../../generated/effects.ts" {
  interface AddModifierEffectsExtension<S extends StaticModifierScope> {
    /** Applies an authored modifier only to an object of its declared host scope. */
    addModifier(
      args: Omit<AddModifierArgs, "modifier"> & {
        modifier: Unambiguous<S, StaticModifierHostContract<S>>;
      }
    ): void;
  }

  interface RemoveModifierEffectsExtension<S extends StaticModifierScope> {
    /** Removes an authored modifier only from an object of its declared host scope. */
    removeModifier(value: Unambiguous<S, StaticModifierHostContract<S>>): void;
  }

  interface AddStageModifierEffectsExtension<S extends StaticModifierScope> {
    /** Adds an authored stage modifier only to its declared host scope. */
    addStageModifier(
      args: Omit<AddStageModifierArgs, "modifier"> & {
        modifier: Unambiguous<S, StaticModifierHostContract<S>>;
      }
    ): void;
  }

  interface RemoveStageModifierEffectsExtension<S extends StaticModifierScope> {
    /** Removes an authored stage modifier only from its declared host scope. */
    removeStageModifier(value: Unambiguous<S, StaticModifierHostContract<S>>): void;
  }

  interface ExportModifierDurationToVariableEffectsExtension<S extends StaticModifierScope> {
    /** Reads an authored modifier's duration only from its declared host scope. */
    exportModifierDurationToVariable(
      args: Omit<ExportModifierDurationToVariableArgs, "modifier"> & {
        modifier: Unambiguous<S, StaticModifierHostContract<S>>;
      }
    ): void;
  }
}

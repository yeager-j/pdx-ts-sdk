/** Typed event-chain counter effects. */

import type {
  EventChainCounterOf,
  EventChainItem,
  ExternalEventChainRef,
} from "../../content/event-chains.ts";
import type { EffectsInCountry } from "../../generated/effects.ts";
import type { ScriptValue } from "../trigger-core.ts";

type DefinedCounterArgs<Chain extends EventChainItem> = {
  eventChain: Chain;
  counter: EventChainCounterOf<Chain>;
};

type ExternalCounterArgs = {
  eventChain: ExternalEventChainRef;
  counter: string;
};

declare module "../../generated/effects.ts" {
  interface EffectsInCountry {
    addEventChainCounter<Chain extends EventChainItem>(
      args: DefinedCounterArgs<Chain> & { amount: ScriptValue }
    ): void;
    addEventChainCounter(args: ExternalCounterArgs & { amount: ScriptValue }): void;
    resetEventChainCounter<Chain extends EventChainItem>(args: DefinedCounterArgs<Chain>): void;
    resetEventChainCounter(args: ExternalCounterArgs): void;
  }
}

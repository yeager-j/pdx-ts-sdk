/**
 * Event-chain counter contracts.
 *
 * Counter names are local to one event chain. The rules describe the declaration
 * and each consumer independently, so this module carries the literal key union
 * on the defined item and lets the script boundary enforce their relationship.
 */

import type {
  ContentIdMinter,
  IdProfile,
  MintedContentId,
} from "../generated/content-capability.ts";
import type { EventChainCounterDefinition, EventChainDef } from "../generated/event-chain.ts";
import type { EventChainRef } from "../generated/refs.ts";
import type { ContentItem } from "./types.ts";

declare const eventChainCounters: unique symbol;

/** A defined event chain whose declared counter names remain available to script calls. */
export type EventChainItem<
  Id extends string = string,
  Counter extends string = string,
> = ContentItem<"event_chain", EventChainDef<Id>> & {
  readonly [eventChainCounters]?: Counter;
};

/** The counter-name union declared by an SDK-defined event chain. */
export type EventChainCounterOf<Chain> =
  Chain extends EventChainItem<string, infer Counter> ? Counter : never;

/** A vanilla or third-party event chain, whose counter declarations are outside this SDK build. */
export type ExternalEventChainRef = string | (EventChainRef & { readonly itemKind?: never });

/** Event-chain input that infers its counter names from the declaration map. */
export type EventChainCapabilityDef<Id extends string, Counter extends string = never> = Omit<
  EventChainDef<Id>,
  "counter"
> & {
  readonly counter?: Readonly<Record<Counter, EventChainCounterDefinition>>;
};

/** Internal event-chain lowering primitive. */
export function defineEventChain<const Id extends string, const Counter extends string = never>(
  def: EventChainCapabilityDef<Id, Counter>
): EventChainItem<Id, Counter> {
  return {
    itemKind: "content",
    type: "event_chain",
    id: def.id,
    def: def as EventChainDef<Id>,
  };
}

/** Event-chain authoring methods bound to one mod capability. */
export interface EventChainCapabilityMethods<P extends string, I extends IdProfile> {
  eventChain<const Name extends string, const Counter extends string = never>(
    name: Name,
    def: Omit<EventChainCapabilityDef<MintedContentId<P, I, "eventChain", Name>, Counter>, "id">
  ): EventChainItem<MintedContentId<P, I, "eventChain", Name>, Counter>;
}

/** Binds the event-chain capability method to one content-id minter. */
export function eventChainCapabilityMethods<P extends string, I extends IdProfile>(
  mint: ContentIdMinter<P, I>
): EventChainCapabilityMethods<P, I> {
  return {
    eventChain: (name, def) =>
      defineEventChain({
        ...def,
        id: mint("eventChain", name),
      } as EventChainCapabilityDef<MintedContentId<P, I, "eventChain", typeof name>>),
  };
}

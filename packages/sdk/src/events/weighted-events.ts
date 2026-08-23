import { block, kv, type PdxEntry, type PdxScalar } from "@pdx-ts/pdxscript";

/** One weighted event choice; omitting the event emits the no-op arm. */
export interface WeightedEventRow<Event> {
  readonly weight: number;
  readonly event?: Event;
}

/** Lowers weighted event choices while preserving authored row order and duplicate weights. */
export function weightedEventBlock<Event>(
  key: string,
  rows: readonly WeightedEventRow<Event>[],
  lowerEvent: (event: Event) => PdxScalar
): PdxEntry {
  return block(
    key,
    rows.map((row) => kv(String(row.weight), row.event === undefined ? 0 : lowerEvent(row.event)))
  );
}

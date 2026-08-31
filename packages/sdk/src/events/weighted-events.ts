import { block, kv, type PdxEntry, type PdxScalar } from "@pdx-ts/pdxscript";

/** One weighted event choice; omitting the event emits the no-op arm. */
export interface WeightedEventRow<Event> {
  /**
   * Relative selection weight, as a whole number. Duplicate weights are
   * preserved as separate rows, and `0` is a row the game ships itself.
   */
  readonly weight: number;
  /** Event selected by this row. Omit it to emit the literal `0` no-op arm. */
  readonly event?: Event;
}

/**
 * The key one row writes, refused unless the rules can carry it.
 *
 * A weight becomes the arm's key verbatim, and `random_events` keys its arms
 * by an `int` (`common/on_actions.cwt`). `number` is wider than that in three
 * ways an author can reach by accident — a fraction out of arithmetic, `NaN`
 * out of a missing operand, `Infinity` out of a division — and each has a
 * JavaScript spelling that would be written out as though it named a share.
 *
 * The check stops at what the rule says, because narrowing it further was
 * measured wrong: vanilla's own `common/on_actions/00_on_actions.txt` writes
 * `0 = crime.1` and `0 = shroud.3`, so a zero-weight arm is a shape the game
 * ships rather than an authoring mistake. Across the 40 shipped files holding
 * a `random_events` block there is no negative and no fractional key either,
 * which is the evidence for `int` and the whole of it — nothing there
 * supports a narrower rule than the one the rules state.
 *
 * This is the one place a weight is turned into a key, so it is the one place
 * the invariant has to hold: both the on-action hook and the content
 * `weightedEvents` field reach the game through it.
 *
 * @param owner - Names the block holding the row, for the diagnostic.
 * @throws Error when the weight is not a whole number.
 */
function weightKey(weight: number, owner: string): string {
  if (!Number.isInteger(weight)) {
    throw new Error(
      `${owner} was given the weighted event weight ${String(weight)}. A row's weight becomes ` +
        "the arm's key verbatim, and `random_events` keys its arms by an integer " +
        "(common/on_actions.cwt), so a weight must be a whole number."
    );
  }
  return String(weight);
}

/**
 * Lowers weighted event choices while preserving authored row order and
 * duplicate weights.
 *
 * @param owner - Names this block in the diagnostic a refused weight throws.
 */
export function weightedEventBlock<Event>(
  key: string,
  rows: readonly WeightedEventRow<Event>[],
  lowerEvent: (event: Event) => PdxScalar,
  owner: string
): PdxEntry {
  return block(
    key,
    rows.map((row) =>
      kv(weightKey(row.weight, owner), row.event === undefined ? 0 : lowerEvent(row.event))
    )
  );
}

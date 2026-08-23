/** Runtime lowering for the structural effects shared by every scope. */

import { block, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ScopeName } from "../../generated/scopes.ts";
import type { ContentRefUse } from "../../references.ts";
import type { Trigger } from "../trigger-core.ts";

export interface RecordingState {
  live: boolean;
}

export type RecordEffects = (
  refs: ContentRefUse[],
  body: (scope: unknown) => void,
  into?: PdxEntry[]
) => PdxEntry[];

export type AssertLive = (recording: RecordingState | undefined, member: string) => void;

export function conditionalBlock(
  key: string,
  condition: Trigger<ScopeName>,
  body: (scope: unknown) => void,
  refs: ContentRefUse[],
  recordEffects: RecordEffects
): PdxEntry {
  const child: PdxEntry[] = [block("limit", [...condition.entries])];
  refs.push(...condition.refs);
  recordEffects(refs, body, child);
  return block(key, child);
}

/** Keeps an in-game if/else chain adjacent in the emitted effect block. */
export class IfChainRecorder {
  private readonly sink: PdxEntry[];
  private readonly refs: ContentRefUse[];
  private readonly recording: RecordingState | undefined;
  private readonly recordEffects: RecordEffects;
  private readonly assertLive: AssertLive;
  private readonly outerSink: readonly PdxEntry[] | undefined;
  private readonly outerMark: number | undefined;
  private mark: number;
  private closed = false;

  constructor(
    sink: PdxEntry[],
    refs: ContentRefUse[],
    recording: RecordingState | undefined,
    recordEffects: RecordEffects,
    assertLive: AssertLive,
    outerSink?: readonly PdxEntry[],
    outerMark?: number
  ) {
    this.sink = sink;
    this.refs = refs;
    this.recording = recording;
    this.recordEffects = recordEffects;
    this.assertLive = assertLive;
    this.outerSink = outerSink;
    this.outerMark = outerMark;
    this.mark = sink.length;
  }

  private guard(link: string): void {
    this.assertLive(this.recording, link);
    if (this.closed) {
      throw new Error(
        `'${link}' was called after this if() chain's 'else', which ends the chain. The game ` +
          `attaches 'else_if' and 'else' to the preceding 'if' by position, so a link written ` +
          `after 'else' would be attached to nothing. Start a new if() for further branches.`
      );
    }
    const localSequenceChanged = this.sink.length !== this.mark;
    const outerSequenceChanged =
      this.outerSink !== undefined && this.outerSink.length !== this.outerMark;
    if (localSequenceChanged || outerSequenceChanged) {
      throw new Error(
        `Effects were recorded between an if() chain's links; the game associates ` +
          `'${link}' with the preceding 'if' by position, so this would silently detach it. ` +
          `Finish the chain before recording more effects.`
      );
    }
  }

  elseIf(condition: Trigger<ScopeName>, body: (scope: unknown) => void): IfChainRecorder {
    this.guard("else_if");
    this.sink.push(conditionalBlock("else_if", condition, body, this.refs, this.recordEffects));
    this.mark = this.sink.length;
    return this;
  }

  else(body: (scope: unknown) => void): void {
    this.guard("else");
    this.sink.push(block("else", this.recordEffects(this.refs, body)));
    this.closed = true;
  }
}

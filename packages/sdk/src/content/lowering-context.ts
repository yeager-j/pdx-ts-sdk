/**
 * The context a content lowering carries down its walk, and the four policies
 * that read it: how a child level is derived, how a diagnostic path is
 * joined, which identity a localisation key hangs off, and how the references
 * a nested closure recorded are re-rooted.
 *
 * One module owns all four because two lowerings share them. `lower.ts`
 * interprets generated field metadata; `blocks.ts` encodes the block shapes
 * that metadata names, and is handed the same context to descend. Held apart,
 * each had its own copy of the context type and its own copies of these
 * functions, so a change to where diagnostics point or to what an owner token
 * is would have had to be made twice, in two modules, neither of which was
 * the authority (SDK-336).
 */

import type { ScriptLocalizationSink } from "../authoring/deferred-localization.ts";
import {
  underField,
  type AssetPathSink,
  type RecordedRefUse,
  type RefUseSink,
} from "../references.ts";

export interface LoweringContext {
  readonly collect?: RefUseSink;
  readonly collectPath?: AssetPathSink;
  readonly path: string;
  /** The top-level id written to PDXScript, when lowering a definition or patch. */
  readonly definitionId?: string;
  readonly ownerId: string;
  /**
   * Where inline text a spliced trigger or effect recorded is registered.
   *
   * Recorded script carries `deferLocalization` markers rather than keys,
   * because the recorder has no owner to key them against. This is the owner:
   * it travels with `ownerId`, so a nested repeated-struct entry keys the
   * script inside it under its own id, exactly as the definition walk mints
   * that entry's other localisation under it.
   */
  readonly localization?: ScriptLocalizationSink;
  /**
   * Set by a caller that lowers content fields without a definition walk in
   * front of them — the effect recorder, splicing a whole alias category into
   * a block it is recording.
   *
   * A definition resolves every `locKey` member to the key its body emits
   * before anything lowers, so by the time `fieldEntries` sees one it is a
   * plain string. There is no such pass here: the values arrive as the author
   * wrote them, and there is no owner yet to key display text against, so they
   * defer exactly as a recorded trigger argument does.
   */
  readonly unresolvedKeys?: true;
}

/**
 * The context one level down: the same context, the path extended by
 * `segment`, and the owning identity rebound only where a level mints one of
 * its own.
 *
 * Derived by spreading rather than by listing the members, because listing
 * them is the bug this module exists to fix. The copy in `blocks.ts` rebuilt
 * only the members it read and dropped three sinks on the way down; a
 * hand-written projection here would do the same to the next member added,
 * silently, and TypeScript would not object because every one of them is
 * optional. Overriding two keys cannot forget a third.
 */
export function childContext(
  ctx: LoweringContext,
  segment: string,
  ownerId?: string
): LoweringContext {
  return { ...ctx, path: joinPath(ctx.path, segment), ownerId: ownerId ?? ctx.ownerId };
}

/** Extends a dotted diagnostic path, treating an empty segment as no step. */
export function joinPath(path: string, segment: string): string {
  if (segment === "") {
    return path;
  }
  return path === "" ? segment : `${path}.${segment}`;
}

/**
 * The token a `WeightBlock` field's desc-bearing rows register and resolve
 * their localisation key under: the nearest enclosing identity plus the
 * field's own key, so a row shared across two definitions — or across two
 * `WeightBlock` fields of one definition — resolves its own occurrence's key
 * rather than whichever registration happened to run last (PR #16 review
 * finding 3).
 */
export function descOwnerKey(ctx: LoweringContext, key: string): string {
  return `${ctx.ownerId}::${key}`;
}

/**
 * Reports references a spliced trigger or effect closure recorded, re-rooted
 * under the field that holds them so the diagnostic names the whole path.
 */
export function collectRefs(
  ctx: LoweringContext,
  refs: readonly RecordedRefUse[],
  segment: string
): void {
  if (ctx.collect === undefined) {
    return;
  }
  for (const use of underField(refs, joinPath(ctx.path, segment))) {
    ctx.collect(use);
  }
}

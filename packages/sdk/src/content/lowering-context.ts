/** The context content lowering threads down a definition, and the helpers that read it. */
import {
  underField,
  type AssetPathSink,
  type ContentRefSink,
  type ContentRefUse,
} from "../references.ts";

/**
 * Accumulates the reference sinks, the dotted path to the current level (for
 * ref diagnostics), and the nearest enclosing identity (for desc-key
 * disambiguation — see {@link descOwnerKey}).
 *
 * `collect` is the part that is genuinely optional — a caller not collecting
 * dangling references simply skips it — but `ownerId` is not: `def.id` is
 * always known at `toEntry`, so the context itself is always constructed,
 * and desc-key resolution (unlike ref collection) is not an optional
 * diagnostic a caller can decline. `ownerId` starts as the top-level
 * definition's own id and rebinds to a repeated-struct entry's own id on the
 * way down, mirroring `ContentAuthoring.collectRepeatedStructs`'s identical
 * rebind for the same reason: a nested entry (a tradition swap, a situation
 * stage) is itself a stable identity a `WeightBlock` inside it can key desc
 * localisation against.
 */
export interface LoweringContext {
  readonly collect?: ContentRefSink;
  readonly collectPath?: AssetPathSink;
  readonly path: string;
  readonly ownerId: string;
}

/**
 * The context one level down, under `segment`. Pass `ownerId` where the level
 * is itself an identity nested content can key localisation against.
 */
export function childContext(
  ctx: LoweringContext,
  segment: string,
  ownerId?: string
): LoweringContext {
  return {
    collect: ctx.collect,
    collectPath: ctx.collectPath,
    path: joinPath(ctx.path, segment),
    ownerId: ownerId ?? ctx.ownerId,
  };
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

/** Extends a dotted field path by one segment, skipping empty segments. */
export function joinPath(path: string, segment: string): string {
  if (segment === "") {
    return path;
  }
  return path === "" ? segment : `${path}.${segment}`;
}

/** Reports references a spliced trigger or effect closure recorded, re-rooted
 * under the field that holds them so the diagnostic names the whole path. */
export function collectRefs(
  ctx: LoweringContext,
  refs: readonly ContentRefUse[],
  segment: string
): void {
  if (ctx.collect === undefined) {
    return;
  }
  for (const use of underField(refs, joinPath(ctx.path, segment))) {
    ctx.collect(use);
  }
}

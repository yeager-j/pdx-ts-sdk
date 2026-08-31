/**
 * What a reader could not read, and the rule that stops it being published.
 *
 * Some of this package's outputs are *exact membership*: `VanillaComponentTagMember`
 * is the set of component tags, `VANILLA_LOCALIZATION_KEYS` is the set of keys
 * that resolve, and the SDK rejects anything outside them. That contract makes
 * a short inventory worse than a failed build. A missing key is not a missing
 * completion — it is `vanilla.localization()` refusing a key the game really
 * defines, in a published package, with nothing at the call site to suggest the
 * package is the thing that is wrong.
 *
 * So a reader that cannot read all of its source records an {@link
 * ExtractionGap} rather than returning a shorter list, and
 * {@link assertExtractionComplete} refuses to emit while any gap is open. The
 * refusal lives in emission rather than in each reader because the rule is
 * about what may be *published*: one statement, covering every inventory this
 * package claims to state exactly, including the ones added later.
 *
 * A gap is not a parser repair. Repairs are shipped files the parser fixed the
 * way the game does, they are counted per registry, and the read still saw the
 * whole file. A gap is a file, or part of one, that nothing read.
 */

/** One part of an exactly-stated inventory that could not be read. */
export interface ExtractionGap {
  /** The inventory left short — a complex enum's name, or `localization`. */
  readonly inventory: string;
  /** Where it happened, as the reader spells its own sources. */
  readonly source: string;
  /** What stopped the read, in terms a maintainer can act on. */
  readonly detail: string;
}

/**
 * Refuses to continue while any inventory is known to be short.
 *
 * @param gaps - Every gap the readers recorded, across every inventory.
 * @throws Error If `gaps` is not empty, naming each one. All of them, not the
 * first: after a game patch the useful question is what shape of input the
 * readers stopped recognising, and one example rarely shows it.
 */
export function assertExtractionComplete(gaps: readonly ExtractionGap[]): void {
  if (gaps.length === 0) {
    return;
  }
  const lines = gaps.map((gap) => `  ${gap.inventory} (${gap.source}): ${gap.detail}`);
  throw new Error(
    `refusing to emit: ${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"} in inventories this ` +
      `package publishes as exact.\n${lines.join("\n")}\n` +
      "These inventories are membership the SDK rejects against, so a short one would ship as a " +
      "wrong answer rather than a missing completion. Fix the reader or the install, then " +
      "regenerate."
  );
}

/**
 * The per-registry override rule table: this slice's overlay. One audited
 * file, every cell citing the oracle run that established it, in the three
 * states the handoff names — `verified` (cites an oracle run), `assumed` (a
 * recorded judgment call, pending an observable), and `refused` (genuinely
 * undetermined; win-assertions against it fail the build).
 *
 * The empirical spine is external: stellaris-docs
 * `docs/spikes/resolver-evaluation.md`, pinned to Stellaris Pegasus v4.4.6.
 * Run ids (`r0`–`r19`) below cite its captured-records table. The structural
 * model — same-path collisions first, then one global enumeration by
 * normalized path bytes and definition ordinal, then the registry's own
 * repeat rule — has no layer precedence: `r10` put one mod's `!!!_` file
 * first in enumeration and its event *won* while its technology *lost*, the
 * exact inversion of any "mod beats vanilla" reading.
 *
 * A game update invalidates every row until re-verified: rows pin
 * `verifiedAgainst`, and the install's build is checked before any
 * win-assertion. Adding or upgrading a cell should feel expensive — an
 * `assumed` cell needs a named judgment with a paper trail, a `verified`
 * cell needs a run id.
 */

import { UnverifiedRegistryError } from "../../errors.ts";
import { CONTENT_REGISTRIES, type ContentTypeName } from "../../generated/content-registry.ts";

/** The build every verdict below was captured against (Pegasus). */
export const SUPPORTED_STELLARIS_BUILD = "4.4.6";

export type RepeatRule = "last-wins" | "first-wins";

/**
 * One cell of the table. `verified` and `assumed` both carry a rule the
 * engine may act on — the difference is evidentiary, and it survives into
 * every WinAssertion and emitted file header so "probably wins" can never
 * masquerade as "wins". `refused` carries no rule at all.
 */
export type RuleCell<T> =
  | { readonly state: "verified"; readonly rule: T; readonly runs: readonly string[] }
  | {
      readonly state: "assumed";
      readonly rule: T;
      readonly runs: readonly string[];
      /** Who decided, when, and on what basis — the paper trail. */
      readonly judgment: string;
    }
  | { readonly state: "refused"; readonly reason: string; readonly settledBy: string };

/** The cells and build pin every row carries, however its directory is settled. */
interface RegistryRowBase {
  /** What happens on a repeat registration of one key. */
  readonly repeat: RuleCell<RepeatRule>;
  /** What the winning definition contributes: whole-object, no inheritance. */
  readonly replacement: RuleCell<"whole-object">;
  readonly verifiedAgainst: typeof SUPPORTED_STELLARIS_BUILD;
}

/**
 * A row for a registry the content manifest already describes. It is spelled
 * the way the manifest and the generated descriptors spell it — one name per
 * registry across the SDK — and it stores no directory: `outputDir` on the
 * descriptor is the derived answer, and `dir?: never` makes a second,
 * hand-written one unrepresentable rather than merely discouraged.
 */
export interface ManifestRegistryRow extends RegistryRowBase {
  readonly registry: ContentTypeName;
  readonly dir?: never;
}

/**
 * The registries with no generated descriptor to derive a directory from —
 * script and localization surfaces the content manifest does not model, plus
 * `ship-components`, which is deliberately standalone: it stands for three
 * `component_template` descriptors at once, so no single `outputDir` is its
 * answer, and its repeat cell is refused anyway.
 */
export type StandaloneRegistry =
  | "scripted-triggers"
  | "scripted-effects"
  | "events"
  | "scripted-constants"
  | "ship-components"
  | "localization";

export interface StandaloneRegistryRow extends RegistryRowBase {
  readonly registry: StandaloneRegistry;
  /** The logical directory the registry's files live under. */
  readonly dir: string;
}

export type RegistryRow = ManifestRegistryRow | StandaloneRegistryRow;

/** A row with its directory settled — derived for manifest rows, stored otherwise. */
export interface ResolvedRegistryRow extends RegistryRowBase {
  readonly registry: string;
  /** The logical directory the registry's files live under. */
  readonly dir: string;
}

export const REGISTRY_RULES: readonly RegistryRow[] = [
  /**
   * Technologies: the fully verified row. `r0`/`r1` established last-wins
   * against vanilla, `r4` proved the order is positional (byte-identical
   * files with swapped names flipped the winners), `r10` proved there is no
   * layer (a `!!!_` mod file lost to `00_synthetic_dawn_tech.txt`). A
   * redefinition omitting a field loses the field — whole-object, no
   * inheritance.
   */
  {
    registry: "technology",
    repeat: { state: "verified", rule: "last-wins", runs: ["r0", "r1", "r4", "r10"] },
    replacement: { state: "verified", rule: "whole-object", runs: ["r1", "r10"] },
    verifiedAgainst: SUPPORTED_STELLARIS_BUILD,
  },
  /**
   * Buildings: `r8` confirmed both directions with matching diagnostics — a
   * redefinition omitting `building_sets` is diagnosed exactly like a new
   * key omitting it, which is only possible under whole-object replacement.
   */
  {
    registry: "building",
    repeat: { state: "verified", rule: "last-wins", runs: ["r8"] },
    replacement: { state: "verified", rule: "whole-object", runs: ["r8"] },
    verifiedAgainst: SUPPORTED_STELLARIS_BUILD,
  },
  /**
   * Scripted triggers and effects: last-wins (`r1` collided them alongside
   * technologies in one run; `r4` covered the positional control). Parameter
   * (`$X$` / `[[X]`) behavior under override is a named open question — it
   * does not affect whether an override wins, only what the winner means, so
   * the cells stay verified and the caveat lives here.
   */
  {
    registry: "scripted-triggers",
    dir: "common/scripted_triggers",
    repeat: { state: "verified", rule: "last-wins", runs: ["r1", "r4"] },
    replacement: { state: "verified", rule: "whole-object", runs: ["r1"] },
    verifiedAgainst: SUPPORTED_STELLARIS_BUILD,
  },
  {
    registry: "scripted-effects",
    dir: "common/scripted_effects",
    repeat: { state: "verified", rule: "last-wins", runs: ["r1", "r4"] },
    replacement: { state: "verified", rule: "whole-object", runs: ["r1"] },
    verifiedAgainst: SUPPORTED_STELLARIS_BUILD,
  },
  /**
   * Events: first-wins — the later registration is rejected outright ("an
   * event with id [X] already exists!"), so to win a mod's file must sort
   * *before* the first surviving definition. `r9` (runtime evaluation,
   * console-fired), `r10` (the inversion run: the `!!!_` event won).
   * Rejection is wholesale, so the winner's definition is trivially whole.
   */
  {
    registry: "events",
    dir: "events",
    repeat: { state: "verified", rule: "first-wins", runs: ["r8", "r9", "r10"] },
    replacement: { state: "verified", rule: "whole-object", runs: ["r9"] },
    verifiedAgainst: SUPPORTED_STELLARIS_BUILD,
  },
  /**
   * Scripted constants: first-wins, and the cross-source cell is settled by
   * `r19`'s matched pair — a mod declaration sorting before vanilla won,
   * after vanilla lost. A constant is a single value, so replacement is
   * trivially whole.
   */
  {
    registry: "scripted-constants",
    dir: "common/scripted_variables",
    repeat: { state: "verified", rule: "first-wins", runs: ["r1", "r19"] },
    replacement: { state: "verified", rule: "whole-object", runs: ["r1", "r19"] },
    verifiedAgainst: SUPPORTED_STELLARIS_BUILD,
  },
  /**
   * Megastructures: last-wins is verified (`r8`), but the merge-vs-replace
   * observable could not discriminate — the registry's diagnostics report
   * missing localization and sprites, which vanilla supplies regardless.
   * The replacement cell is therefore an *assumption*, not a finding, and
   * every win asserted through it carries `confidence: "assumed"` — a patch
   * file emitted for this registry states the judgment in its own header.
   *
   * The row is manifest-backed now that `megastructure` is a content registry,
   * so its directory is the descriptor's `outputDir` rather than a second
   * hand-written spelling of `common/megastructures`.
   */
  {
    registry: "megastructure",
    repeat: { state: "verified", rule: "last-wins", runs: ["r8"] },
    replacement: {
      state: "assumed",
      rule: "whole-object",
      runs: ["r8"],
      judgment:
        "Jackson, 2026-07-31: megastructures behave like technologies (whole-object) until " +
        "an observable proves otherwise — based on the r8 spike run plus modding experience. " +
        "Graduates to verified via a runtime observable on a redefinition's omitted field.",
    },
    verifiedAgainst: SUPPORTED_STELLARIS_BUILD,
  },
  /**
   * Ship components: keyed by the inner `key` field, not the block name, and
   * the duplicate diagnostic ("key used multiple times") names no winner —
   * the repeat cell is genuinely undetermined, so win-assertions refuse.
   * Field behavior *is* resolved (`r8`: a redefinition omitting `icon` is
   * diagnosed exactly like a new key omitting it — whole-object), which is
   * why only the repeat cell blocks.
   */
  {
    registry: "ship-components",
    dir: "common/component_templates",
    repeat: {
      state: "refused",
      reason: 'the duplicate diagnostic ("key used multiple times") names no winner',
      settledBy:
        "a runtime observable for a repeated component key " +
        "(resolver-evaluation.md, ship-components row)",
    },
    replacement: { state: "verified", rule: "whole-object", runs: ["r8"] },
    verifiedAgainst: SUPPORTED_STELLARIS_BUILD,
  },
  /**
   * Localization: the one measured exception — a layered stream (vanilla →
   * mods in enabled order → `replace/`) where filename order is irrelevant
   * (`r13`–`r16`: an early-sorting `00_` mod file still beat vanilla). Both
   * cells refuse so an accidental filename-order win-assertion fails; the
   * SDK's `replace/` emission policy is the correct mechanism instead.
   */
  {
    registry: "localization",
    dir: "localisation",
    repeat: {
      state: "refused",
      reason:
        "localization is layer-ordered (r13-r16): filename order does not decide the winner, " +
        "so a filename-computed win cannot exist; overrides belong in replace/",
      settledBy: "nothing — this is a different mechanism, not an open cell",
    },
    replacement: {
      state: "refused",
      reason: "localization merges per key across the layered stream, not per object",
      settledBy: "nothing — this is a different mechanism, not an open cell",
    },
    verifiedAgainst: SUPPORTED_STELLARIS_BUILD,
  },
];

/**
 * Looks up a row and settles its directory; an unknown registry is a caller
 * bug, named loudly. A manifest row's dir comes from the generated descriptor
 * rather than from the table, so the two can never drift apart.
 */
export function registryRule(registry: string): ResolvedRegistryRow {
  const row = REGISTRY_RULES.find((candidate) => candidate.registry === registry);
  if (row === undefined) {
    const known = REGISTRY_RULES.map((candidate) => candidate.registry).join(", ");
    throw new UnverifiedRegistryError(
      `Unknown registry \`${registry}\`; the rule table covers: ${known}`
    );
  }
  return { ...row, dir: registryDir(row) };
}

function registryDir(row: RegistryRow): string {
  if (row.dir !== undefined) {
    return row.dir;
  }
  const descriptor = CONTENT_REGISTRIES.find((candidate) => candidate.type === row.registry);
  if (descriptor === undefined) {
    throw new Error(
      `rule table row \`${row.registry}\` is manifest-backed but no generated content registry ` +
        `descriptor has that type; the row names a registry the manifest does not define`
    );
  }
  return descriptor.outputDir;
}

/**
 * The refusal an engine raises when a needed cell is `refused` — the message
 * format follows the stellaris-docs resolver: name the registry, the cell,
 * the reason, what would settle it, and the build pin.
 */
export function unverifiedCellError(
  row: ResolvedRegistryRow,
  cell: "repeat" | "replacement"
): UnverifiedRegistryError {
  const refused = row[cell];
  if (refused.state !== "refused") {
    throw new Error(`unverifiedCellError called on a ${refused.state} cell`);
  }
  const cellName = cell === "repeat" ? "duplicate-winner" : "field-replacement";
  return new UnverifiedRegistryError(
    `registry \`${row.registry}\` has no verified ${cellName} rule: ${refused.reason}. ` +
      `Settled by: ${refused.settledBy}. ` +
      `(rule table pinned to Stellaris ${row.verifiedAgainst})`
  );
}

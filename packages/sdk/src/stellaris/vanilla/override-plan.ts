/**
 * The win engine: given the patched objects and the parsed enumeration of a
 * registry's surviving files, compute a filename that provably wins — or
 * refuse with the reason. Pure functions, no IO.
 *
 * The scheme for a last-wins registry is stem-append off the byte-max
 * definer: `stem(L) + "_" + prefix + "_patch.txt"` byte-sorts strictly after
 * `L` because the two agree through the stem and then `L` continues with `.`
 * (0x2E) while the candidate continues with `_` (0x5F). That is a
 * construction, not a proof — the final step re-verifies the computed name
 * against every definer with the real comparator, so a wrong lemma fails
 * loudly instead of shipping.
 *
 * Scope, stated everywhere it matters: the enumeration is vanilla plus this
 * mod. A win asserted here says nothing about third-party mods; upgrading
 * that claim needs playset enumeration, not a bigger filename.
 */

import { kv, serialize, type PdxEntry, type PdxItem } from "@pdx-ts/pdxscript";

import { NoWinningFilenameError, PdxSdkError, VanillaPathCollisionError } from "../../errors.ts";
import { compareLogicalPaths, normalizeLogicalPath, type LogicalPath } from "../../ordering.ts";
import { registryRule, unverifiedCellError, type RepeatRule } from "./override-rules.ts";
import type { VanillaFile } from "./view.ts";

export interface PatchInput {
  readonly key: string;
  /** The file whose definition this patch transforms. */
  readonly sourceFile: LogicalPath;
  /** sha256 (hex) of that file's bytes when the patch was built. */
  readonly sourceSha256: string;
  /** The complete patched object. */
  readonly entry: PdxEntry;
  /**
   * File-local `@variables` the entry references, with their values. The
   * game scopes top-of-file variables to their file, so the patch file must
   * re-declare every one it carries — a missing declaration is not an error
   * in-game, it is silent corruption (spike run r7).
   */
  readonly locals: ReadonlyMap<string, number>;
}

/** Every `@name` reference anywhere in the item tree. */
export function collectVarRefs(item: PdxItem): string[] {
  switch (item.kind) {
    case "var":
      return [item.name];
    case "entry":
      return collectVarRefs(item.value);
    case "container":
    case "param":
      return item.items.flatMap(collectVarRefs);
    default:
      return [];
  }
}

/** True when the item tree contains an `@[ ... ]` inline-math scalar. */
export function containsInlineMath(item: PdxItem): boolean {
  switch (item.kind) {
    case "math":
      return true;
    case "entry":
      return containsInlineMath(item.value);
    case "container":
    case "param":
      return item.items.some(containsInlineMath);
    default:
      return false;
  }
}

/** One provable claim: this emission beats every named file for this key. */
export interface WinAssertion {
  readonly registry: string;
  readonly key: string;
  readonly rule: RepeatRule;
  /** `assumed` when any rule cell it rests on is a judgment, never silently upgraded. */
  readonly confidence: "verified" | "assumed";
  /** Every surviving file defining the key, in enumeration order — all beaten. */
  readonly beats: readonly LogicalPath[];
  readonly verifiedAgainst: string;
}

export interface PatchPlan {
  /** Where the patch file goes, relative to the mod root. */
  readonly relPath: LogicalPath;
  /** The complete file: provenance header plus the serialized objects. */
  readonly content: string;
  readonly assertions: readonly WinAssertion[];
}

const MAX_BASENAME_BYTES = 200;
const MAX_COLLISION_ESCALATIONS = 5;

export function planPatchEmission(args: {
  readonly registry: string;
  readonly patches: readonly PatchInput[];
  /** The registry dir's surviving files, vanilla + this mod, enumeration-ordered. */
  readonly enumeration: readonly VanillaFile[];
  /** Paths this mod already emits (relative to the mod root). */
  readonly reservedPaths: readonly string[];
  readonly prefix: string;
}): PatchPlan {
  const { registry, patches, enumeration, reservedPaths, prefix } = args;
  if (patches.length === 0) {
    throw new Error(`planPatchEmission(${registry}) called with no patches`);
  }

  const row = registryRule(registry);
  if (row.repeat.state === "refused") {
    throw unverifiedCellError(row, "repeat");
  }
  if (row.replacement.state === "refused") {
    throw unverifiedCellError(row, "replacement");
  }
  if (row.repeat.rule !== "last-wins") {
    throw new PdxSdkError(
      `registry \`${registry}\` is ${row.repeat.rule}: winning means sorting *before* the ` +
        `first definer, and before-first emission is not implemented in this slice`
    );
  }
  const confidence: WinAssertion["confidence"] =
    row.repeat.state === "assumed" || row.replacement.state === "assumed" ? "assumed" : "verified";

  // File-local declarations the patch file must carry, merged across
  // patches. Two source files declaring the same name with different values
  // cannot share one emission file — refuse rather than pick.
  const localDeclarations = new Map<string, { value: number; from: LogicalPath }>();
  for (const patch of patches) {
    if (containsInlineMath(patch.entry)) {
      throw new PdxSdkError(
        `patch for "${patch.key}" carries an @[ ... ] inline-math expression; its variable ` +
          `dependencies are textually invisible, so re-declaring them in the emitted file ` +
          `cannot be proven complete — patching this definition is refused`
      );
    }
    for (const [name, value] of patch.locals) {
      const existing = localDeclarations.get(name);
      if (existing !== undefined && existing.value !== value) {
        throw new PdxSdkError(
          `patches from ${existing.from} and ${patch.sourceFile} both need file-local ` +
            `${name} but with different values (${existing.value} vs ${value}); one patch ` +
            `file cannot declare both — patch them from one source file or bake the values`
        );
      }
      localDeclarations.set(name, { value, from: patch.sourceFile });
    }
  }

  const definersByKey = new Map<string, LogicalPath[]>();
  for (const patch of patches) {
    const definers = enumeration
      .filter((file) => file.keys.includes(patch.key))
      .map((file) => file.path);
    if (definers.length === 0) {
      throw new Error(
        `planPatchEmission(${registry}): no surviving file defines "${patch.key}" — ` +
          `a patch can only target a parsed definition`
      );
    }
    definersByKey.set(patch.key, definers);
  }

  const allDefiners = [...new Set([...definersByKey.values()].flat())].sort(compareLogicalPaths);
  const bar = allDefiners[allDefiners.length - 1]!;
  const relPath = winningPath({ bar, enumeration, reservedPaths, prefix, dir: row.dir });
  // The assertion that backs "computed from parsed reality": the emitted path
  // beats every definer of every patched key under the real comparator.
  for (const definer of allDefiners) {
    if (compareLogicalPaths(relPath, definer) <= 0) {
      throw new NoWinningFilenameError(
        `computed filename ${relPath} does not byte-sort after ${definer} — the stem-append ` +
          `lemma failed for registry \`${registry}\`; this is a bug worth reporting`
      );
    }
  }

  const assertions: WinAssertion[] = patches.map((patch) => ({
    registry,
    key: patch.key,
    rule: "last-wins",
    confidence,
    beats: definersByKey.get(patch.key)!,
    verifiedAgainst: row.verifiedAgainst,
  }));

  const header = [
    `# Generated by @pdx-ts/sdk -- do not edit.`,
    `# Overrides verified against Stellaris ${row.verifiedAgainst}. Registry \`${registry}\` is ` +
      `last-wins: this file byte-sorts after every file defining each key below.`,
    `# Unverified against third-party mods (vanilla + this mod only).`,
    ...(row.repeat.state === "assumed"
      ? [`# ASSUMED duplicate-winner rule: ${row.repeat.judgment}`]
      : []),
    ...(row.replacement.state === "assumed"
      ? [`# ASSUMED field-replacement rule: ${row.replacement.judgment}`]
      : []),
    ...patches.map(
      (patch) =>
        `#   ${patch.key}  beats ${definersByKey.get(patch.key)!.join(", ")}  ` +
        `source sha256 ${patch.sourceSha256.slice(0, 12)}`
    ),
  ];
  // File-local variables re-declared first: the game scopes them per file.
  const declarationEntries = [...localDeclarations.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, declaration]) => kv(name, declaration.value));
  const content =
    header.join("\n") +
    "\n\n" +
    serialize([...declarationEntries, ...patches.map((patch) => patch.entry)]);

  return { relPath, content, assertions };
}

function winningPath(args: {
  readonly bar: LogicalPath;
  readonly enumeration: readonly VanillaFile[];
  readonly reservedPaths: readonly string[];
  readonly prefix: string;
  readonly dir: string;
}): LogicalPath {
  const { bar, enumeration, reservedPaths, prefix, dir } = args;
  const basename = bar.split("/").pop()!;
  if (!basename.endsWith(".txt")) {
    throw new NoWinningFilenameError(
      `last definer ${bar} does not end in .txt; the stem-append scheme is only stated for .txt files`
    );
  }
  const stem = basename.slice(0, -".txt".length);
  if (!isAscii(stem)) {
    throw new NoWinningFilenameError(
      `last definer ${bar} has a non-ASCII name; emitted filenames are ASCII-only by policy ` +
        `(the byte comparator is verified on ASCII discriminators only), so no winning name ` +
        `is constructed past it`
    );
  }

  const taken = new Set<string>(enumeration.map((file) => file.path as string));
  const reserved = new Set(reservedPaths.map((raw) => normalizeLogicalPath(raw) as string));

  let candidateStem = `${stem}_${prefix}_patch`;
  for (let attempt = 0; ; attempt++) {
    const candidateName = `${candidateStem}.txt`;
    if (byteLength(candidateName) > MAX_BASENAME_BYTES) {
      throw new NoWinningFilenameError(
        `computed filename ${candidateName} is ${byteLength(candidateName)} bytes ` +
          `(cap ${MAX_BASENAME_BYTES}); the last definer of this key (${bar}) leaves no ` +
          `winning name within the filesystem limit`
      );
    }
    const candidate = normalizeLogicalPath(`${dir}/${candidateName}`);
    if (taken.has(candidate)) {
      // Never emit at a path vanilla occupies: a same-path collision replaces
      // the whole vanilla file (spike run r6 killed two techs that way).
      if (attempt >= MAX_COLLISION_ESCALATIONS) {
        throw new VanillaPathCollisionError(
          `computed filename ${candidate} collides with an enumerated file even after ` +
            `${MAX_COLLISION_ESCALATIONS} escalations`
        );
      }
      candidateStem += "_p";
      continue;
    }
    if (reserved.has(candidate)) {
      if (attempt >= MAX_COLLISION_ESCALATIONS) {
        throw new NoWinningFilenameError(
          `computed filename ${candidate} collides with this mod's own files even after ` +
            `${MAX_COLLISION_ESCALATIONS} escalations`
        );
      }
      candidateStem += "_p";
      continue;
    }
    return candidate;
  }
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      return false;
    }
  }
  return true;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

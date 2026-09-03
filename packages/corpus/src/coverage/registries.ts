/**
 * Sites of one content registry: every field path the emitter lowered,
 * omitted, or the corpus observed.
 *
 * A registry is the one surface that can carry a used-but-undeclared site: a
 * corpus path nothing emitted and no omission row explains (`inline_script`)
 * is a gap, tracked when `ACKNOWLEDGED_GAPS` has a row for it.
 *
 * An alias category spliced unkeyed into the body is one site,
 * `alias_name[<category>]`. Corpus keys the category admits by name (the
 * modifier names of a `modifier` splice) are not sites of the registry: they
 * count on their own surface, and here they fold into the splice's `used`.
 *
 * Omission rows reach this module already rerooted onto corpus spelling
 * ({@link rerootPath}). `collapsed` rows add no site: the field they describe
 * is still emitted, or is a localisation slot rather than a field.
 */

import type { FieldOmissionRow } from "@pdx-ts/codegen-cwt/emit/content/field-rows";
import { compareUtf8 } from "@pdx-ts/sdk/internals";

import type { AcknowledgedGap } from "../gaps.ts";
import type { AcknowledgedMismatch } from "../observations.ts";
import type { CoverageSite, CoverageSurfaceId } from "./model.ts";

/** One prefix an omission row may carry, and what the corpus spells it as. */
export interface PathRoot {
  /** The prefix as the emitter writes it, with its trailing dot. */
  readonly prefix: string;
  /** What replaces the prefix; empty for the registry's own top level. */
  readonly replacement: string;
}

/**
 * Rewrites one omission path onto corpus spelling: the first matching root's
 * prefix is replaced. A path no root matches (a bare field name, an
 * `alias_name[...]` splice row) is returned unchanged.
 */
export function rerootPath(path: string, roots: readonly PathRoot[]): string {
  const root = roots.find((candidate) => path.startsWith(candidate.prefix));
  return root === undefined ? path : `${root.replacement}${path.slice(root.prefix.length)}`;
}

/** Everything one registry's sites are built from. */
export interface RegistryCoverageInput {
  readonly registry: string;
  /** Corpus-spelled paths of every lowered field, own, nested, and spliced. */
  readonly emitted: readonly string[];
  /** The emission's omission rows, rerooted onto corpus spelling. */
  readonly omissions: readonly FieldOmissionRow[];
  /**
   * Alias category spliced unkeyed at the top level, to the corpus keys the
   * category admits by name. Empty when its members are emitted fields.
   */
  readonly splices: ReadonlyMap<string, ReadonlySet<string>>;
  /** Corpus path to the number of shipped definitions writing it. */
  readonly corpus: ReadonlyMap<string, number>;
  /** `ACKNOWLEDGED_GAPS` rows of this registry. */
  readonly acknowledged: readonly AcknowledgedGap[];
  /** `ACKNOWLEDGED_MISMATCHES` rows of this registry with `kind: "form"`. */
  readonly formMismatches: readonly AcknowledgedMismatch[];
}

function contradictions(input: RegistryCoverageInput): string[] {
  const emitted = new Set(input.emitted);
  const declined = input.omissions.filter((row) => row.kind === "declined").map((row) => row.path);
  const unsupported = input.omissions
    .filter((row) => row.kind === "unsupported")
    .map((row) => row.path);
  const unsupportedSet = new Set(unsupported);
  return [
    ...declined.filter((path) => emitted.has(path)).map((path) => `${path}: emitted and declined`),
    ...unsupported
      .filter((path) => emitted.has(path))
      .map((path) => `${path}: emitted and unsupported`),
    ...declined
      .filter((path) => unsupportedSet.has(path))
      .map((path) => `${path}: declined and unsupported`),
  ]
    .sort(compareUtf8)
    .map((line) => `${input.registry} ${line}`);
}

/**
 * Builds one registry's sites, sorted by key.
 *
 * @throws {Error} When a path is both emitted and omitted, when an
 *   acknowledged gap names no gap site, or when a form mismatch names no
 *   emitted site.
 */
export function sitesOfRegistry(input: RegistryCoverageInput): CoverageSite[] {
  const problems = contradictions(input);
  if (problems.length > 0) {
    throw new Error(`registry sites contradict the emission:\n  ${problems.join("\n  ")}`);
  }
  const surface: CoverageSurfaceId = `registry:${input.registry}`;
  const usedOf = (path: string): number => input.corpus.get(path) ?? 0;
  const acknowledged = new Map(input.acknowledged.map((row) => [row.field, row]));
  const forms = new Map(input.formMismatches.map((row) => [row.field, row]));
  const sites = new Map<string, CoverageSite>();
  const site = (key: string, fields: Omit<CoverageSite, "surface" | "key" | "used">): void => {
    sites.set(key, { surface, key, ...fields, used: usedOf(key) });
  };
  const gap = (key: string, untrackedReason: string): void => {
    const row = acknowledged.get(key);
    site(
      key,
      row === undefined
        ? { class: "gap", reason: untrackedReason }
        : { class: "gap", reason: row.reason, issue: row.issue }
    );
  };

  for (const path of input.emitted) {
    const form = forms.get(path);
    site(
      path,
      form === undefined
        ? { class: "authorable", reason: "generated from the rules" }
        : { class: "partial", reason: `${form.family}: ${form.rationale}` }
    );
  }
  for (const row of input.omissions) {
    if (row.kind === "declined") {
      site(row.path, { class: "declined", reason: row.reason });
    } else if (row.kind === "unsupported") {
      gap(row.path, row.reason);
    }
  }
  const spliced = new Set([...input.splices.values()].flatMap((keys) => [...keys]));
  for (const [category, keys] of input.splices) {
    const key = `alias_name[${category}]`;
    const used = [...input.corpus]
      .filter(([path]) => keys.has(path))
      .reduce((total, [, definitions]) => total + definitions, 0);
    sites.set(key, {
      surface,
      key,
      class: "authorable",
      reason: "alias category spliced unkeyed at the top level",
      used,
    });
  }
  for (const path of input.corpus.keys()) {
    if (!sites.has(path) && !spliced.has(path)) {
      gap(path, "observed in vanilla with no lowered declaration");
    }
  }

  const dead = [
    ...input.acknowledged
      .filter((row) => sites.get(row.field)?.class !== "gap")
      .map((row) => `${input.registry}.${row.field}: acknowledged gap names no gap site`),
    ...input.formMismatches
      .filter((row) => sites.get(row.field)?.class !== "partial")
      .map((row) => `${input.registry}.${row.field}: form mismatch names no emitted site`),
  ];
  if (dead.length > 0) {
    throw new Error(`ledger rows match no site:\n  ${dead.join("\n  ")}`);
  }
  return [...sites.values()].sort((a, b) => compareUtf8(a.key, b.key));
}

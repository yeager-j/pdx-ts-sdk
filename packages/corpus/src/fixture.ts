/**
 * The corpus evidence loop's shared half: what the SDK emits per registry, and
 * how the install-derived observations serialize into the committed fixture.
 *
 * Split out of the conformance test so one measurement drives both sides of
 * the loop. The ASSERTER (`tests/conformance.test.ts`) is hermetic: it loads
 * the fixture committed under `fixtures/` and never needs the
 * game, so it runs in plain `npm test` and therefore CI. The EXTRACTOR
 * (`extract.ts`, `npm run corpus:extract`) and the drift gate
 * (`check.ts`, `npm run corpus:check`) are the install-gated,
 * maintainer-local half, mirroring `codegen:vanilla` / `codegen:vanilla:check`:
 * an install is a machine-local artifact, so the loop that reads one never
 * runs in CI, and its output is committed and reviewed instead.
 *
 * Licensing boundary, the same class of derived data as
 * `packages/codegen-cwt/src/drift-baseline.json`: the fixture carries
 * observations only — field names, forms, counts, ids, content hashes — never
 * script bodies and never localized text. `FieldObservation.values` is the
 * closest call and stays inside it: a capped sample of bare scalar tokens
 * (`yes`, `large`, a referenced id), kept to check closed unions. The script
 * usage fixture (`script-usage.json`, see `script-usage.ts`) carries counts of
 * key text only, filtered to the names the rules declare.
 *
 * Tooling-side machinery on purpose: this package is private, the SDK never
 * imports it, and nothing here belongs in the published runtime surface.
 * Everything in this module reads the repo (vendored rules, committed
 * fixture); only {@link extractCorpus} and {@link versionCanary}'s default
 * seams touch the machine outside it.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  conformance,
  readRegistryCorpus,
  spliceMembersOf,
  type ConformanceReport,
  type DescentNode,
  type FieldObservation,
  type RegistryCorpus,
  type RuleScopes,
  type SpliceMember,
  type UnexpressedField,
} from "@pdx-ts/codegen-cwt/corpus";
import { relativeRegistryPath, walkRegistryFiles } from "@pdx-ts/codegen-cwt/corpus/registry-files";
import {
  emitAliasSplice,
  type AliasSpliceEmission,
} from "@pdx-ts/codegen-cwt/emit/content/alias-splice";
import { emitContentType } from "@pdx-ts/codegen-cwt/emit/content/content-type";
import type { FieldOmissionRow } from "@pdx-ts/codegen-cwt/emit/content/field-rows";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/typescript";
import type { EmittedField } from "@pdx-ts/codegen-cwt/lower/content-model";
import { canonicalScopeSet } from "@pdx-ts/codegen-cwt/lower/script-shape";
import {
  CONTENT_MANIFEST,
  registryNameOf,
  type ContentManifestEntry,
} from "@pdx-ts/codegen-cwt/policy/manifest";
import { loadBaseline } from "@pdx-ts/codegen-cwt/reconcile/baseline";
import {
  resolveRuleScopes,
  scopeAuthorityOf,
  type RuleScopeDecision,
} from "@pdx-ts/codegen-cwt/reconcile/scope-authority";
import { SPECIAL_SCOPE_PATHS } from "@pdx-ts/codegen-cwt/special-scope-paths";
import { parse, PdxSyntaxError, scalarText, type PdxItem, type PdxValue } from "@pdx-ts/pdxscript";
import { InstallNotFoundError } from "@pdx-ts/sdk";
import { locateInstall, readGameVersion } from "@pdx-ts/sdk/installation";
import { compareUtf8 } from "@pdx-ts/sdk/internals";

import { rerootPath, type PathRoot } from "./coverage/registries.ts";
import {
  DECLARED_TYPES,
  MODIFIER_JOIN,
  RULES,
  SCOPE_INDEX,
  SCRIPT_VOCABULARY,
  SOURCES,
  UNEXPOSED_TYPES,
  type DeclaredType,
} from "./generator-sources.ts";
import { readScriptUsage, type ScriptUsage, type ScriptVocabulary } from "./script-usage.ts";

/**
 * Anchored to the module rather than the process, the same way
 * `codegen-vanilla`'s entry anchors itself: the fixture this reads and writes
 * is the one in the repo this file lives in, whatever directory npm or vitest
 * was invoked from.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Repo-relative, for messages; {@link FIXTURE_DIR} is what the reads use. */
export const FIXTURE_PATH = "packages/corpus/fixtures";
export const FIXTURE_DIR = path.join(ROOT, FIXTURE_PATH);
export const META_FILE = "meta.json";
/** The script usage fixture, see `script-usage.ts`. */
export const SCRIPT_USAGE_FILE = "script-usage.json";
/** The install directories the script usage fixture counts, in fixture order. */
export const SCRIPT_USAGE_ROOTS: readonly string[] = ["common", "events"];
/** The fixture of CWT types the manifest does not expose, see `extractUnexposedTypes`. */
export const UNEXPOSED_TYPES_FILE = "unexposed-types.json";
/** Fixture files that are not a registry's observations. */
export const RESERVED_FIXTURE_FILES: ReadonlySet<string> = new Set([
  META_FILE,
  SCRIPT_USAGE_FILE,
  UNEXPOSED_TYPES_FILE,
]);

/**
 * The presence floor: once the vanilla fixture observes a field in at least
 * this many definitions, the hermetic ratchet requires it to be authorable or
 * explicitly acknowledged.
 *
 * 25 is an initial, deliberately conservative floor — high enough that every
 * field over it is unarguably load-bearing game surface, low enough to have
 * caught both realized escapes (`building.triggered_planet_modifier`, 672
 * occurrences, and its six siblings). Ratchet it down as emitter machinery
 * lands; the near-floor report below exists to show what each step would cost.
 */
export const PRESENCE_FLOOR = 25;

/**
 * Fields between here and {@link PRESENCE_FLOOR} are reported, not failed —
 * the information a future ratchet of the floor is based on.
 */
export const NEAR_FLOOR = 5;

const rules = RULES;
const emitter = new Emitter(rules);
const scopes = SCOPE_INDEX;

/**
 * Every modifier name the SDK's generated surface knows, from the same join
 * `emitModifiers` runs. A registry that splices `alias_name[modifier]` unkeyed
 * into its body admits all of them as top-level keys, so coverage has to
 * resolve the category rather than read a field list.
 */
const SCOPED_MODIFIER_NAMES: ReadonlySet<string> = new Set([
  ...MODIFIER_JOIN.universal,
  ...[...MODIFIER_JOIN.groups.values()].flat(),
]);

/**
 * Which scopes each trigger and effect is legal in, resolved exactly the way
 * the trigger and effect emitters resolve it — the committed drift baseline's
 * reviewed decision over the rules' own `## scopes` and the game's dump. A key
 * no decision covers and no rule annotates resolves to `null`, which the shape
 * gate skips: vanilla's ~1449 scripted triggers and every scope link land there,
 * and they are the vanilla-surface backlog rather than evidence about the field
 * holding them.
 */
const RULE_SCOPES = (() => {
  const dump = SOURCES.docs;
  const authority = scopeAuthorityOf(loadBaseline(), scopes);
  const resolve = (
    table: typeof rules.triggers,
    docs: typeof dump.triggers,
    decisions: ReadonlyMap<string, RuleScopeDecision>
  ): Map<string, RuleScopes> => {
    const out = new Map<string, RuleScopes>();
    for (const [key, declarations] of table) {
      const supported = resolveRuleScopes(declarations, docs.get(key), decisions.get(key));
      const set = supported.length === 0 ? null : canonicalScopeSet(supported, scopes);
      if (set !== null) {
        out.set(key.toLowerCase(), set);
      }
    }
    return out;
  };
  return {
    trigger: resolve(rules.triggers, dump.triggers, authority.triggers),
    effect: resolve(rules.effects, dump.effects, authority.effects),
  };
})();

/** The `scopesOf` resolver `shapeConformance` takes, over {@link RULE_SCOPES}. */
export function ruleScopesOf(clause: "trigger" | "effect", key: string): RuleScopes | null {
  return RULE_SCOPES[clause].get(key.toLowerCase()) ?? null;
}

/**
 * Every key a trigger clause admits by name, lowercased: the rules' trigger
 * declarations, their scope links, the ambient scope paths, and the structural
 * combinators cwtools implements in its own machinery instead of declaring.
 */
const RULE_TRIGGER_KEYS = new Set([
  ...[...rules.triggers.keys()].map((key) => key.toLowerCase()),
  // `!fromData` the way `reconcile.ts` and the link classifier filter: a
  // data-driven link is a prefix rather than a key the game takes literally,
  // and `pop_faction_parameter` is only ever written `parameter:x`.
  ...[...rules.links.values()]
    .filter((link) => link.type === "scope" && !link.fromData)
    .map((link) => link.name.toLowerCase()),
  ...SPECIAL_SCOPE_PATHS,
  "not",
  "and",
  "or",
  "nor",
  "nand",
  "hidden_trigger",
]);

/**
 * Whether the vendored rules make `key` one a trigger clause admits.
 *
 * A chained or optional scope path — `owner.capital_scope`, `starbase?` — is
 * read by its head: the rest of the chain is several hops away, so the first
 * hop is the whole decision.
 *
 * Half of the `isTriggerKey` the corpus reader takes: the other half is
 * vanilla's scripted triggers, which cwtools resolves from the game files
 * rather than declaring, so {@link extractCorpus} adds them from the install.
 */
export function isRuleTriggerKey(key: string): boolean {
  // The reading codegen-vanilla's `infer-scopes.ts` already gives a scope path:
  // lowercase, first hop, optional marker dropped. A `prefix:name` head —
  // `event_target:x`, `value:y` — is navigation whatever name follows it.
  const head = key.toLowerCase().split(".")[0]!.replace(/\?$/, "");
  return head.includes(":") || RULE_TRIGGER_KEYS.has(head);
}

/**
 * One emission per structural alias category, memoized.
 *
 * Memoized because a category is reached once per registry that splices it and
 * once per recursion through the splice tree, and re-emitting would re-enter
 * `emitter.usedRefs` each time. Both the corpus descent and the emitted-field
 * list come from this, so the two cannot disagree about what was lowered.
 */
const spliceEmissions = new Map<string, ReturnType<typeof emitAliasSplice>>();
function spliceEmission(category: string): ReturnType<typeof emitAliasSplice> {
  if (!spliceEmissions.has(category)) {
    emitter.beginFile();
    spliceEmissions.set(category, emitAliasSplice(emitter, category));
    emitter.endFile();
  }
  return spliceEmissions.get(category)!;
}

/**
 * Every splice emission a registry reaches, transitively, each once, paired
 * with its category: the categories it splices directly, then the ones those
 * splice in turn. A category with no authoring member (`modifier`) is absent.
 */
function spliceEmissionsOf(
  categories: readonly string[]
): readonly (readonly [string, AliasSpliceEmission])[] {
  const seen = new Set<string>();
  const collect = (list: readonly string[]): (readonly [string, AliasSpliceEmission])[] =>
    list.flatMap((category) => {
      if (seen.has(category)) {
        return [];
      }
      seen.add(category);
      const emission = spliceEmission(category);
      return emission === null
        ? []
        : [[category, emission] as const, ...collect(emission.spliceCategories)];
    });
  return collect(categories);
}

/**
 * How an emission's omission paths are spelled versus how the corpus spells
 * them. The emitter keys rows by CWT type name at the top level
 * (`solar_system_initializer.change_orbit`) and by alias *category* inside a
 * splice (`planet_initializer.change_orbit`), while the corpus reports the
 * bare field (`change_orbit`) and the *member key* (`planet.change_orbit`).
 * {@link rerootPath} applies these; a row no root matches is already spelled
 * the corpus way.
 */
function pathRootsOf(
  typeName: string,
  registry: string,
  splices: readonly (readonly [string, AliasSpliceEmission])[]
): PathRoot[] {
  return [
    { prefix: `${typeName}.`, replacement: "" },
    ...(registry === typeName ? [] : [{ prefix: `${registry}.`, replacement: "" }]),
    ...splices.map(([category, emission]) => ({
      prefix: `${category}.`,
      replacement: `${emission.memberKey}.`,
    })),
  ];
}

/**
 * One manifested registry's hermetic side: everything the conformance gate and
 * the extractor need that comes from the vendored rules rather than from an
 * install.
 */
export interface RegistryMeasurement {
  /** Generated registry name (`registryNameOf`) — also the fixture file stem. */
  readonly registry: string;
  /** Directory under the install root the corpus reads, e.g. `common/technology`. */
  readonly registryPath: string;
  readonly keyword: string | null;
  readonly nameField: string | null;
  readonly excludedKey: string | null;
  /** `path_extension`, dotted and resolved — which files in the directory count. */
  readonly pathExtension: string;
  /** `path_strict`: the registry's subdirectories belong to other CWT types. */
  readonly pathStrict: boolean;
  /** `skip_root_key`: the root blocks the definitions sit one level inside. */
  readonly skipRootKeys: readonly string[];
  /** Which block-valued fields the corpus reader must descend into, from the emission. */
  readonly descents: readonly DescentNode[];
  /** Which spliced blocks the corpus reader must descend into. */
  readonly spliceMembers: readonly SpliceMember[];
  /** Every lowered field: own, spliced, and nested with the registry prefix stripped. */
  readonly emitted: readonly EmittedField[];
  /**
   * Alias categories spliced unkeyed at the top level, each to the corpus
   * keys it admits by name rather than through emitted fields: every scoped
   * modifier name for `modifier`, nothing for a category whose members are
   * emitted fields.
   */
  readonly splices: ReadonlyMap<string, ReadonlySet<string>>;
  /** Every key of every {@link RegistryMeasurement.splices} entry, for the conformance gate. */
  readonly splicedKeys: ReadonlySet<string>;
  /**
   * Every declined, unsupported, and collapsed row of the registry's own
   * emission and of every splice it reaches, rerooted onto corpus spelling.
   */
  readonly omissions: readonly FieldOmissionRow[];
  /** Corpus paths `CONTENT_DECLINED_FIELDS` keeps out of the authoring surface. */
  readonly declinedPaths: ReadonlySet<string>;
}

export const MEASUREMENTS: readonly RegistryMeasurement[] = CONTENT_MANIFEST.map((manifest) => {
  const entry: ContentManifestEntry = manifest;
  const registry = registryNameOf(entry);
  const type = rules.contentTypes.get(entry.type);
  const registryPath = type?.path?.replace(/^game\//, "") ?? "";
  const body = rules.bodies.get(entry.type);
  emitter.beginFile();
  const emission =
    type === undefined || body === undefined
      ? null
      : emitContentType(emitter, type, body, registry, entry.as);
  emitter.endFile();
  // Nested paths come back prefixed with the registry (`situation_type.stages.icon`,
  // matching the dotted paths CONTENT_DECLINED_FIELDS/CONTENT_FIELD_OVERRIDES use)
  // — strip that prefix so they line up with the corpus's own unprefixed dotted
  // paths (`stages.icon`).
  const inlineSplices = emission?.inlineSplices ?? [];
  const splices = spliceEmissionsOf(inlineSplices);
  const emitted = [
    ...(emission?.emittedFields ?? []),
    ...splices.flatMap(([, splice]) => splice.emittedFields),
    ...(emission?.nestedEmittedFields ?? []).map((field) => ({
      ...field,
      field: field.field.slice(registry.length + 1),
    })),
  ];
  const roots = pathRootsOf(entry.type, registry, splices);
  const omissions = [
    ...(emission?.omissions ?? []),
    ...splices.flatMap(([, splice]) => splice.omissions),
  ].map((row) => ({ ...row, path: rerootPath(row.path, roots) }));
  const admittedByName = new Map(
    inlineSplices.map((category): [string, ReadonlySet<string>] => [
      category,
      category === "modifier" ? SCOPED_MODIFIER_NAMES : new Set(),
    ])
  );
  return {
    registry,
    registryPath,
    keyword: entry.keyword ?? null,
    nameField: type?.nameField ?? null,
    excludedKey: type?.keyFilter?.negated === true ? type.keyFilter.key : null,
    pathExtension: type?.pathExtension ?? ".txt",
    pathStrict: type?.pathStrict ?? false,
    skipRootKeys: type?.skipRootKeys ?? [],
    descents: emission?.corpusDescents ?? [],
    // Which blocks the reader must descend into is the emitter's answer: a
    // registry splicing `planet_initializer` writes `planet = { ... }` trees
    // whose contents are otherwise invisible behind one top-level key.
    spliceMembers: spliceMembersOf(emission?.inlineSplices ?? [], (category) =>
      spliceEmission(category)
    ),
    emitted,
    splices: admittedByName,
    splicedKeys: new Set([...admittedByName.values()].flatMap((keys) => [...keys])),
    omissions,
    declinedPaths: new Set(
      omissions.filter((row) => row.kind === "declined").map((row) => row.path)
    ),
  };
});

/** {@link FieldObservation} with its sets flattened to sorted arrays. */
export interface SerializedObservation {
  readonly definitions: number;
  readonly repeated: number;
  readonly scalars: number;
  readonly blocks: number;
  readonly bareValues: number;
  readonly bareBlocks: number;
  readonly emptyBlocks: number;
  readonly values: readonly string[];
  readonly keys: readonly string[];
  readonly keysByDefinition: readonly (readonly string[])[];
}

/** One registry's committed observations: `<registry>.json` in the fixture. */
export interface RegistryFixture {
  readonly registry: string;
  readonly definitions: number;
  readonly files: number;
  /**
   * sha256 over the registry directory's sorted `name:sha256(bytes)` lines, so
   * a content change is mechanically detectable without committing content.
   */
  readonly fingerprint: string;
  readonly fields: Readonly<Record<string, SerializedObservation>>;
  readonly scalarTuples?: readonly SerializedScalarTuple[];
}

/** One reviewed scalar co-occurrence, counted after resolving global scripted variables. */
export interface SerializedScalarTuple {
  readonly fields: readonly string[];
  readonly values: readonly string[];
  readonly definitions: number;
}

export interface CorpusMeta {
  /** The install's build the fixture was extracted from, `v`-less (`4.4.6`). */
  readonly gameVersion: string;
  /** ISO date of the extraction. Volatile: excluded from drift comparison. */
  readonly extractedAt: string;
  /** sha256 over the per-registry fingerprints and the script usage fingerprint. */
  readonly fingerprint: string;
}

/** The committed `script-usage.json`: {@link ScriptUsage} filtered to the vocabulary. */
export interface ScriptUsageFixture {
  readonly roots: readonly string[];
  readonly files: number;
  readonly failedFiles: readonly string[];
  readonly fingerprint: string;
  /** The vocabulary the counts were filtered to, so a stale filter is detectable. */
  readonly vocabulary: {
    readonly size: number;
    readonly fingerprint: string;
  };
  /** Per root, vocabulary key to occurrence count, keys sorted; zero counts absent. */
  readonly counts: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** One unexposed CWT type's shipped definitions: top-level field counts only. */
export interface UnexposedTypeFixture {
  /** The type's path relative to the game root. */
  readonly path: string;
  /** Shipped definitions; 0 when the install has no such directory. */
  readonly definitions: number;
  readonly files: number;
  /** As a registry's; `missing` when the install has no such directory. */
  readonly fingerprint: string;
  /** Top-level field to the number of definitions writing it, keys sorted. */
  readonly fields: Readonly<Record<string, number>>;
}

/** One install folder no CWT type claims. */
export interface FolderFixture {
  /** Top-level block definitions in the folder's own files. */
  readonly definitions: number;
  readonly files: number;
}

/** The committed `unexposed-types.json`: counts only, the same licensing boundary. */
export interface UnexposedTypesFixture {
  /** Keyed by CWT type name, sorted. */
  readonly types: Readonly<Record<string, UnexposedTypeFixture>>;
  /** Every `common/` folder no CWT type claims that holds files, keyed by path, sorted. */
  readonly folders: Readonly<Record<string, FolderFixture>>;
  /** sha256 over every type fingerprint and folder count. */
  readonly fingerprint: string;
}

export interface ExtractedCorpus {
  readonly meta: CorpusMeta;
  readonly registries: readonly RegistryFixture[];
  readonly scriptUsage: ScriptUsageFixture;
  readonly unexposedTypes: UnexposedTypesFixture;
}

/**
 * Every ordering in the committed fixture uses the repo's one canonical
 * byte-order comparator. Neither default here is safe for a file that must be
 * byte-identical across maintainer machines: `Array.sort()`'s UTF-16 order
 * disagrees with UTF-8 byte order beyond ASCII, and locale collation is not
 * even stable between two ICU builds.
 */
const sorted = (values: Iterable<string>): string[] => [...values].sort(compareUtf8);

function serializeCorpus(
  registry: string,
  corpus: RegistryCorpus,
  fingerprint: string,
  scalarTuples: readonly SerializedScalarTuple[] = []
): RegistryFixture {
  const fields: Record<string, SerializedObservation> = {};
  for (const key of sorted(corpus.occurrences.keys())) {
    const observation = corpus.occurrences.get(key)!;
    fields[key] = {
      definitions: observation.definitions,
      repeated: observation.repeated,
      scalars: observation.scalars,
      blocks: observation.blocks,
      bareValues: observation.bareValues,
      bareBlocks: observation.bareBlocks,
      emptyBlocks: observation.emptyBlocks,
      values: sorted(observation.values),
      keys: sorted(observation.keys),
      // Inner and outer order are both meaningless to the checks, so both are
      // sorted for a byte-stable fixture. The outer sort compares element-wise
      // rather than joining: a join needs a delimiter no key can contain, and
      // the comparison needs no delimiter at all.
      keysByDefinition: observation.keysByDefinition
        .map((keys) => sorted(keys))
        .sort((a, b) => {
          const shared = Math.min(a.length, b.length);
          for (let i = 0; i < shared; i++) {
            const delta = compareUtf8(a[i]!, b[i]!);
            if (delta !== 0) {
              return delta;
            }
          }
          return a.length - b.length;
        }),
    };
  }
  return {
    registry,
    definitions: corpus.definitions,
    files: corpus.files,
    fingerprint,
    fields,
    ...(scalarTuples.length === 0 ? {} : { scalarTuples }),
  };
}

/** Filters the counts to `vocabulary` and sorts every key, for a byte-stable fixture. */
export function serializeScriptUsage(
  usage: ScriptUsage,
  vocabulary: ScriptVocabulary
): ScriptUsageFixture {
  const counts: Record<string, Record<string, number>> = {};
  for (const root of usage.roots) {
    const rootCounts = usage.counts.get(root) ?? new Map<string, number>();
    counts[root] = Object.fromEntries(
      sorted(rootCounts.keys())
        .filter((key) => vocabulary.keys.has(key))
        .map((key) => [key, rootCounts.get(key)!])
    );
  }
  return {
    roots: usage.roots,
    files: usage.files,
    failedFiles: usage.failedFiles,
    fingerprint: usage.fingerprint,
    vocabulary: { size: vocabulary.keys.size, fingerprint: vocabulary.fingerprint },
    counts,
  };
}

const SCALAR_TUPLE_QUERIES: Readonly<
  Record<
    string,
    readonly { readonly fields: readonly string[]; readonly values: readonly string[] }[]
  >
> = {
  technology: [{ fields: ["tier", "cost"], values: ["2", "2000"] }],
};

function globalVariables(installPath: string): ReadonlyMap<string, PdxValue> {
  const variables = new Map<string, PdxValue>();
  const dir = path.join(installPath, "common/scripted_variables");
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith(".txt"))
    .sort(compareUtf8)) {
    for (const item of parse(readFileSync(path.join(dir, name), "utf8")).items) {
      if (item.kind === "entry" && item.key.startsWith("@") && item.value.kind !== "container") {
        variables.set(item.key, item.value);
      }
    }
  }
  return variables;
}

/**
 * The install's own scripted trigger names, lowercased. cwtools resolves these
 * from the game files rather than declaring them, so the install is their only
 * authority — the reason {@link globalVariables} reads the install too.
 */
function scriptedTriggerNames(installPath: string): ReadonlySet<string> {
  const names = new Set<string>();
  // Recursive, because the game loads the directory that way and so does
  // `readScriptedDefinitions`, codegen-vanilla's reader for the same files.
  const files = walkRegistryFiles(path.join(installPath, "common/scripted_triggers"), ".txt", true);
  for (const file of files) {
    for (const item of parse(readFileSync(file, "utf8")).items) {
      if (item.kind === "entry") {
        names.add(item.key.toLowerCase());
      }
    }
  }
  return names;
}

function resolvedScalar(
  value: PdxValue,
  variables: ReadonlyMap<string, PdxValue>,
  resolving: ReadonlySet<string> = new Set()
): string | null {
  if (value.kind === "container" || value.kind === "math") {
    return null;
  }
  if (value.kind !== "var") {
    return scalarText(value);
  }
  if (resolving.has(value.name)) {
    return null;
  }
  const resolved = variables.get(value.name);
  return resolved === undefined
    ? null
    : resolvedScalar(resolved, variables, new Set([...resolving, value.name]));
}

function scalarTuples(
  installPath: string,
  measurement: RegistryMeasurement,
  variables: ReadonlyMap<string, PdxValue>
): SerializedScalarTuple[] {
  const queries = SCALAR_TUPLE_QUERIES[measurement.registry] ?? [];
  if (queries.length === 0) {
    return [];
  }
  const counts = queries.map(() => 0);
  const dir = path.join(installPath, measurement.registryPath);
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith(".txt"))
    .sort(compareUtf8)) {
    for (const item of parse(readFileSync(path.join(dir, name), "utf8")).items) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      if (measurement.keyword !== null && item.key !== measurement.keyword) {
        continue;
      }
      if (item.key === measurement.excludedKey) {
        continue;
      }
      const values = new Map<string, string>();
      for (const field of item.value.items) {
        if (field.kind !== "entry" || field.key === measurement.nameField) {
          continue;
        }
        const value = resolvedScalar(field.value, variables);
        if (value !== null) {
          values.set(field.key, value);
        }
      }
      for (const [index, query] of queries.entries()) {
        if (
          query.fields.every((field, fieldIndex) => values.get(field) === query.values[fieldIndex])
        ) {
          counts[index]! += 1;
        }
      }
    }
  }
  return queries.map((query, index) => ({ ...query, definitions: counts[index]! }));
}

/** The fixture read back into the shape `conformance`/`shapeConformance` take. */
export function corpusOfFixture(fixture: RegistryFixture): RegistryCorpus {
  const occurrences = new Map<string, FieldObservation>();
  for (const [key, observation] of Object.entries(fixture.fields)) {
    occurrences.set(key, {
      definitions: observation.definitions,
      repeated: observation.repeated,
      scalars: observation.scalars,
      blocks: observation.blocks,
      bareValues: observation.bareValues,
      bareBlocks: observation.bareBlocks,
      emptyBlocks: observation.emptyBlocks,
      values: new Set(observation.values),
      keys: new Set(observation.keys),
      keysByDefinition: observation.keysByDefinition.map((keys) => new Set(keys)),
    });
  }
  return { definitions: fixture.definitions, files: fixture.files, occurrences };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * A drift-detectable statement of the registry directory's content: sorted
 * `path:sha256(bytes)` lines, hashed. The bytes reach nothing but the hash.
 *
 * The path is relative to the registry's own directory and `/`-separated, so a
 * registry whose files sit directly in it keeps the bare name it always
 * fingerprinted — only the registries whose files nest see their fingerprint
 * move, and those had no fingerprint worth the name before, since the walk did
 * not reach the nested files at all.
 */
function fingerprintRegistryDir(
  dir: string,
  extension: string,
  pathStrict: boolean,
  fileName?: string
): string {
  const files = walkRegistryFiles(dir, extension, !pathStrict).filter(
    (file) => fileName === undefined || path.basename(file) === fileName
  );
  if (files.length === 0) {
    return "missing";
  }
  const lines = files
    .map(
      (file) =>
        `${relativeRegistryPath(dir, file)}:${createHash("sha256")
          .update(readFileSync(file))
          .digest("hex")}`
    )
    .sort(compareUtf8);
  return sha256(lines.join("\n"));
}

/** Top-level field counts of one unexposed type: no descents, no splices, no values. */
function readUnexposedType(installPath: string, declared: DeclaredType): UnexposedTypeFixture {
  const type = declared.type;
  const keyFilter = type.keyFilter;
  const layout = {
    extension: type.pathExtension ?? ".txt",
    pathStrict: type.pathStrict ?? false,
    skipRootKeys: type.skipRootKeys ?? [],
    ...(type.pathFile === null || type.pathFile === undefined ? {} : { fileName: type.pathFile }),
  };
  const corpus = readRegistryCorpus(installPath, {
    registry: type.name,
    registryPath: declared.path,
    keyword: keyFilter !== null && !keyFilter.negated ? keyFilter.key : null,
    nameField: type.nameField,
    isTriggerKey: () => false,
    descents: [],
    spliceMembers: [],
    excludedKey: keyFilter !== null && keyFilter.negated ? keyFilter.key : null,
    layout,
  });
  const fields: Record<string, number> = {};
  for (const key of sorted(corpus.occurrences.keys())) {
    fields[key] = corpus.occurrences.get(key)!.definitions;
  }
  return {
    path: declared.path,
    definitions: corpus.definitions,
    files: corpus.files,
    fingerprint: fingerprintRegistryDir(
      path.join(installPath, declared.path),
      layout.extension,
      layout.pathStrict,
      layout.fileName
    ),
    fields,
  };
}

/** Every directory under `root`, recursively, relative and `/`-separated, sorted. */
function directoriesUnder(root: string, relative = ""): string[] {
  const directory = path.join(root, relative);
  let names: string[];
  try {
    names = readdirSync(directory).sort(compareUtf8);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (!statSync(path.join(directory, name)).isDirectory()) {
      return [];
    }
    const child = relative === "" ? name : `${relative}/${name}`;
    return [child, ...directoriesUnder(root, child)];
  });
}

/** Top-level block definitions in one directory's own `.txt` files; a file the parser rejects counts no definitions. */
function folderDefinitions(directory: string): FolderFixture {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".txt") && statSync(path.join(directory, name)).isFile())
    .sort(compareUtf8);
  let definitions = 0;
  for (const name of files) {
    let items: readonly PdxItem[];
    try {
      items = parse(readFileSync(path.join(directory, name), "utf8")).items;
    } catch (error) {
      if (error instanceof PdxSyntaxError) {
        continue;
      }
      throw error;
    }
    definitions += items.filter(
      (item) => item.kind === "entry" && item.value.kind === "container"
    ).length;
  }
  return { definitions, files: files.length };
}

/**
 * Every `common/` folder that holds files and that no CWT type with a path
 * claims. A type claims its own directory and, unless `path_strict`, every
 * directory under it; a `path_file` type claims one file, never a directory.
 */
function foldersWithoutType(installPath: string): Record<string, FolderFixture> {
  const claims = DECLARED_TYPES.filter(
    (declared) => declared.type.pathFile === null || declared.type.pathFile === undefined
  ).map((declared) => ({ path: declared.path, strict: declared.type.pathStrict ?? false }));
  const claimed = (directory: string): boolean =>
    claims.some(
      (claim) =>
        directory === claim.path || (!claim.strict && directory.startsWith(`${claim.path}/`))
    );
  const folders: Record<string, FolderFixture> = {};
  for (const relative of directoriesUnder(path.join(installPath, "common"))) {
    const directory = `common/${relative}`;
    if (claimed(directory)) {
      continue;
    }
    const counts = folderDefinitions(path.join(installPath, directory));
    if (counts.files > 0) {
      folders[directory] = counts;
    }
  }
  return folders;
}

/** Reads every unexposed CWT type and every unclaimed `common/` folder out of an install. */
export function extractUnexposedTypes(installPath: string): UnexposedTypesFixture {
  const types: Record<string, UnexposedTypeFixture> = {};
  for (const declared of [...UNEXPOSED_TYPES].sort((a, b) =>
    compareUtf8(a.type.name, b.type.name)
  )) {
    types[declared.type.name] = readUnexposedType(installPath, declared);
  }
  const folders = foldersWithoutType(installPath);
  const lines = [
    ...Object.entries(types).map(([name, type]) => `${name}:${type.fingerprint}`),
    ...Object.entries(folders).map(
      ([folder, counts]) => `folder ${folder}:${counts.definitions}/${counts.files}`
    ),
  ];
  return { types, folders, fingerprint: sha256(lines.join("\n")) };
}

/**
 * Reads every manifested registry out of a real install. The one function in
 * this module that requires a game; everything downstream of its return value
 * is data.
 */
export function extractCorpus(installPath: string): ExtractedCorpus {
  const gameVersion = readGameVersion(installPath);
  if (gameVersion === undefined) {
    throw new Error(
      `${installPath} states no readable version in launcher-settings.json, so the fixture ` +
        "cannot record which build its observations describe — and the version canary in " +
        "conformance.test.ts would have nothing to compare. Fix the install before " +
        "extracting."
    );
  }
  const variables = globalVariables(installPath);
  const scriptedTriggers = scriptedTriggerNames(installPath);
  const isTriggerKey = (key: string): boolean =>
    isRuleTriggerKey(key) || scriptedTriggers.has(key.toLowerCase());
  const registries = MEASUREMENTS.map((measurement) =>
    serializeCorpus(
      measurement.registry,
      readRegistryCorpus(installPath, {
        registry: measurement.registry,
        registryPath: measurement.registryPath,
        keyword: measurement.keyword,
        nameField: measurement.nameField,
        isTriggerKey,
        descents: measurement.descents,
        spliceMembers: measurement.spliceMembers,
        excludedKey: measurement.excludedKey,
        layout: {
          extension: measurement.pathExtension,
          pathStrict: measurement.pathStrict,
          skipRootKeys: measurement.skipRootKeys,
        },
      }),
      fingerprintRegistryDir(
        path.join(installPath, measurement.registryPath),
        measurement.pathExtension,
        measurement.pathStrict
      ),
      scalarTuples(installPath, measurement, variables)
    )
  );
  const scriptUsage = serializeScriptUsage(
    readScriptUsage(installPath, SCRIPT_USAGE_ROOTS),
    SCRIPT_VOCABULARY
  );
  const unexposedTypes = extractUnexposedTypes(installPath);
  return {
    meta: {
      gameVersion,
      extractedAt: new Date().toISOString(),
      fingerprint: sha256(
        [
          ...registries.map((registry) => `${registry.registry}:${registry.fingerprint}`),
          `script-usage:${scriptUsage.fingerprint}`,
          `unexposed-types:${unexposedTypes.fingerprint}`,
        ].join("\n")
      ),
    },
    registries,
    scriptUsage,
    unexposedTypes,
  };
}

/** Writes a fixture directory, pruning `<registry>.json` files no longer manifested. */
export function writeFixtures(dir: string, extracted: ExtractedCorpus): void {
  mkdirSync(dir, { recursive: true });
  const expected = new Set([
    ...RESERVED_FIXTURE_FILES,
    ...extracted.registries.map((registry) => `${registry.registry}.json`),
  ]);
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json") && !expected.has(name)) {
      rmSync(path.join(dir, name));
    }
  }
  for (const registry of extracted.registries) {
    writeFileSync(
      path.join(dir, `${registry.registry}.json`),
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8"
    );
  }
  writeFileSync(
    path.join(dir, SCRIPT_USAGE_FILE),
    `${JSON.stringify(extracted.scriptUsage, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    path.join(dir, UNEXPOSED_TYPES_FILE),
    `${JSON.stringify(extracted.unexposedTypes, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(path.join(dir, META_FILE), `${JSON.stringify(extracted.meta, null, 2)}\n`, "utf8");
}

function readJson<T>(file: string): T | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  return JSON.parse(raw) as T;
}

/** The committed fixture's metadata, or `null` before a fixture exists. */
export function loadMeta(dir: string = FIXTURE_DIR): CorpusMeta | null {
  return readJson<CorpusMeta>(path.join(dir, META_FILE));
}

/** The committed script usage counts, or `null` when never extracted. */
export function loadScriptUsage(dir: string = FIXTURE_DIR): ScriptUsageFixture | null {
  return readJson<ScriptUsageFixture>(path.join(dir, SCRIPT_USAGE_FILE));
}

/** The committed unexposed-type counts, or `null` when never extracted. */
export function loadUnexposedTypes(dir: string = FIXTURE_DIR): UnexposedTypesFixture | null {
  return readJson<UnexposedTypesFixture>(path.join(dir, UNEXPOSED_TYPES_FILE));
}

/** One registry's committed observations, or `null` when never extracted. */
export function loadRegistryFixture(
  registry: string,
  dir: string = FIXTURE_DIR
): RegistryFixture | null {
  return readJson<RegistryFixture>(path.join(dir, `${registry}.json`));
}

/** Every `<registry>.json` stem present in a fixture directory. */
export function fixtureStems(dir: string = FIXTURE_DIR): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json") && !RESERVED_FIXTURE_FILES.has(name))
    .map((name) => name.slice(0, -".json".length))
    .sort(compareUtf8);
}

/**
 * One registry measured against its fixture: the conformance report plus the
 * split of its unexpressed fields into the declined and the unauthorable.
 */
export interface RegistryReport extends ConformanceReport {
  readonly measurement: RegistryMeasurement;
  readonly fixture: RegistryFixture;
  /** Unexpressed fields `CONTENT_DECLINED_FIELDS` keeps out on purpose. */
  readonly declined: readonly UnexpressedField[];
  /** Unexpressed fields nothing can author: the presence floor's input. */
  readonly unauthorable: readonly UnexpressedField[];
}

/** Measures one registry's emission against one fixture. */
export function registryReport(
  measurement: RegistryMeasurement,
  fixture: RegistryFixture
): RegistryReport {
  const report = conformance(
    measurement.registry,
    corpusOfFixture(fixture),
    measurement.emitted.map((field) => field.field),
    measurement.splicedKeys
  );
  return {
    measurement,
    fixture,
    ...report,
    declined: report.unexpressed.filter((entry) => measurement.declinedPaths.has(entry.field)),
    unauthorable: report.unexpressed.filter((entry) => !measurement.declinedPaths.has(entry.field)),
  };
}

/**
 * Every manifested registry with a committed fixture in `dir`, in manifest
 * order. A registry with no fixture is absent; the conformance gate reports
 * those by name.
 */
export function committedRegistryReports(dir: string = FIXTURE_DIR): RegistryReport[] {
  return MEASUREMENTS.flatMap((measurement) => {
    const fixture = loadRegistryFixture(measurement.registry, dir);
    return fixture === null ? [] : [registryReport(measurement, fixture)];
  });
}

export type CanaryVerdict =
  | { readonly kind: "no-install" }
  | { readonly kind: "match"; readonly version: string }
  | { readonly kind: "mismatch"; readonly installed: string; readonly fixture: string };

/**
 * Whether the committed fixture still describes the locally installed game.
 *
 * A warning, never a failure, in both directions the design cares about: CI
 * has no install, so `InstallNotFoundError` in any form — including the loud
 * one a bad `STELLARIS_PATH` earns — reads as "no install here" and the
 * asserter stays silent and hermetic; a maintainer whose game has patched past
 * the fixture gets a verdict the test file turns into a banner and a skipped
 * test they cannot miss. An install that states no readable version is a
 * mismatch too: currency cannot be verified, and silence would look like it
 * had been.
 *
 * `locate` and `readVersion` are seams in the `platformDefaultsFor` tradition:
 * injected fakes are the only way all three verdicts are testable on one
 * machine without mutating global state.
 */
export function versionCanary(
  fixtureVersion: string,
  locate: () => string = locateInstall,
  readVersion: (installPath: string) => string | undefined = readGameVersion
): CanaryVerdict {
  let installPath: string;
  try {
    installPath = locate();
  } catch (error) {
    if (error instanceof InstallNotFoundError) {
      return { kind: "no-install" };
    }
    throw error;
  }
  const installed = readVersion(installPath);
  if (installed === undefined) {
    return {
      kind: "mismatch",
      installed: "unknown (launcher-settings.json states no version)",
      fixture: fixtureVersion,
    };
  }
  return installed === fixtureVersion
    ? { kind: "match", version: installed }
    : { kind: "mismatch", installed, fixture: fixtureVersion };
}

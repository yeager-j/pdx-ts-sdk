/**
 * The corpus evidence loop's shared half: what the SDK emits per registry, and
 * how the install-derived observations serialize into the committed fixture.
 *
 * Split out of the conformance test so one measurement drives both sides of
 * the loop. The ASSERTER (`corpus-conformance.test.ts`) is hermetic: it loads
 * the fixture committed under `tests/fixtures/corpus/` and never needs the
 * game, so it runs in plain `npm test` and therefore CI. The EXTRACTOR
 * (`corpus-extract.ts`, `npm run corpus:extract`) and the drift gate
 * (`corpus-check.ts`, `npm run corpus:check`) are the install-gated,
 * maintainer-local half, mirroring `codegen:vanilla` / `codegen:vanilla:check`:
 * an install is a machine-local artifact, so the loop that reads one never
 * runs in CI, and its output is committed and reviewed instead.
 *
 * Licensing boundary, the same class of derived data as
 * `packages/codegen-cwt/src/drift-baseline.json`: the fixture carries
 * observations only — field names, forms, counts, ids, content hashes — never
 * script bodies and never localized text. `FieldObservation.values` is the
 * closest call and stays inside it: a capped sample of bare scalar tokens
 * (`yes`, `large`, a referenced id), kept to check closed unions.
 *
 * Test/tooling-side machinery on purpose: nothing here is exported from the
 * SDK's `src/`, and nothing here belongs in the published runtime surface.
 * Everything in this module reads the repo (vendored rules, committed
 * fixture); only {@link extractCorpus} and {@link versionCanary}'s default
 * seams touch the machine outside it.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_MANIFEST } from "@pdx-ts/codegen-cwt/content-manifest";
import {
  readRegistryCorpus,
  spliceMembersOf,
  type DescentNode,
  type FieldObservation,
  type RegistryCorpus,
  type RuleScopes,
  type SpliceMember,
} from "@pdx-ts/codegen-cwt/corpus";
import { loadRules, scopeIndex } from "@pdx-ts/codegen-cwt/cwt/rules";
import { emitAliasSplice } from "@pdx-ts/codegen-cwt/emit/alias-splice";
import { emitContentType } from "@pdx-ts/codegen-cwt/emit/content-type";
import type { EmittedField } from "@pdx-ts/codegen-cwt/emit/fields";
import { joinModifierScopes } from "@pdx-ts/codegen-cwt/emit/modifiers";
import { canonicalScopeSet, declaredScopes } from "@pdx-ts/codegen-cwt/emit/shape";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";
import { parseModifierDocs } from "@pdx-ts/codegen-cwt/logs/modifier-docs";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import { CONTENT_DECLINED_FIELDS } from "@pdx-ts/codegen-cwt/overlay";

import { InstallNotFoundError } from "../../src/errors.ts";
import { compareUtf8 } from "../../src/ordering.ts";
import { locateInstall } from "../../src/stellaris/installation/locate.ts";
import { readGameVersion } from "../../src/stellaris/installation/version.ts";

/**
 * Anchored to the module rather than the process, the same way
 * `codegen-vanilla`'s entry anchors itself: the fixture this reads and writes
 * is the one in the repo this file lives in, whatever directory npm or vitest
 * was invoked from.
 */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const SCRIPT_DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1");

/** Repo-relative, for messages; {@link FIXTURE_DIR} is what the reads use. */
export const FIXTURE_PATH = "packages/sdk/tests/fixtures/corpus";
export const FIXTURE_DIR = path.join(ROOT, FIXTURE_PATH);
export const META_FILE = "meta.json";

/**
 * The presence floor: a field the game writes in at least this many
 * definitions must be authorable, or the hermetic gate fails naming it.
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

const rules = loadRules(CONFIG);
const emitter = new Emitter(rules);
const scopes = scopeIndex(rules);

/**
 * Every modifier name the SDK's generated surface knows, from the same join
 * `emitModifiers` runs. A registry that splices `alias_name[modifier]` unkeyed
 * into its body admits all of them as top-level keys, so coverage has to
 * resolve the category rather than read a field list.
 */
const MODIFIER_NAMES = (() => {
  const join = joinModifierScopes(
    rules,
    parseModifierDocs(readFileSync(path.join(SCRIPT_DOCS, "modifiers.log"), "utf8")),
    (token) => emitter.canonicalScope(token)
  );
  return new Set([...join.universal, ...[...join.groups.values()].flat()]);
})();

/**
 * Which scopes each trigger and effect is legal in, resolved exactly the way
 * the trigger and effect emitters resolve it — the rules' own `## scopes`, with
 * the game's dump as fallback. A key neither source knows resolves to `null`,
 * which the shape gate skips: vanilla's ~1449 scripted triggers and every scope
 * link land there, and they are the vanilla-surface backlog rather than
 * evidence about the field holding them.
 */
const RULE_SCOPES = (() => {
  const dump = parseTriggerDocs(
    readFileSync(path.join(SCRIPT_DOCS, "triggers.log"), "utf8"),
    readFileSync(path.join(SCRIPT_DOCS, "effects.log"), "utf8")
  );
  const resolve = (
    table: typeof rules.triggers,
    docs: typeof dump.triggers
  ): Map<string, RuleScopes> => {
    const out = new Map<string, RuleScopes>();
    for (const [key, declarations] of table) {
      const supported = declaredScopes(declarations, docs.get(key));
      const set = supported.length === 0 ? null : canonicalScopeSet(supported, scopes);
      if (set !== null) {
        out.set(key.toLowerCase(), set);
      }
    }
    return out;
  };
  return {
    trigger: resolve(rules.triggers, dump.triggers),
    effect: resolve(rules.effects, dump.effects),
  };
})();

/** The `scopesOf` resolver `shapeConformance` takes, over {@link RULE_SCOPES}. */
export function ruleScopesOf(clause: "trigger" | "effect", key: string): RuleScopes | null {
  return RULE_SCOPES[clause].get(key.toLowerCase()) ?? null;
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

/** Every field lowered into the categories a registry splices, `planet.class` and friends. */
function spliceFieldsOf(categories: readonly string[]): EmittedField[] {
  const seen = new Set<string>();
  const collect = (list: readonly string[]): EmittedField[] =>
    list.flatMap((category) => {
      if (seen.has(category)) {
        return [];
      }
      seen.add(category);
      const emission = spliceEmission(category);
      return emission === null
        ? []
        : [...emission.emittedFields, ...collect(emission.spliceCategories)];
    });
  return collect(categories);
}

/**
 * `CONTENT_DECLINED_FIELDS` rows that land in this registry's corpus, mapped
 * to the dotted paths the corpus reports them under. The overlay keys rows by
 * CWT type name at the top level and by alias *category* inside a splice
 * (`planet_initializer.change_orbit`), while the corpus reports the *member
 * key* (`planet.change_orbit`) — this is where the two spellings meet, so the
 * presence floor can honor a declined field without a second table.
 */
function declinedPathsOf(
  typeName: string,
  registry: string,
  inlineSplices: readonly string[]
): ReadonlySet<string> {
  const paths = new Set<string>();
  const collect = (prefix: string, map: (suffix: string) => string): void => {
    for (const key of CONTENT_DECLINED_FIELDS.keys()) {
      if (key.startsWith(prefix)) {
        paths.add(map(key.slice(prefix.length)));
      }
    }
  };
  collect(`${typeName}.`, (suffix) => suffix);
  if (registry !== typeName) {
    collect(`${registry}.`, (suffix) => suffix);
  }
  const seen = new Set<string>();
  const queue = [...inlineSplices];
  while (queue.length > 0) {
    const category = queue.pop()!;
    if (seen.has(category)) {
      continue;
    }
    seen.add(category);
    const emission = spliceEmission(category);
    if (emission === null) {
      continue;
    }
    collect(`${category}.`, (suffix) => `${emission.memberKey}.${suffix}`);
    queue.push(...emission.spliceCategories);
  }
  return paths;
}

/**
 * One manifested registry's hermetic side: everything the conformance gate and
 * the extractor need that comes from the vendored rules rather than from an
 * install.
 */
export interface RegistryMeasurement {
  /** Generated registry name, `as ?? type` — also the fixture file stem. */
  readonly registry: string;
  /** Directory under the install root the corpus reads, e.g. `common/technology`. */
  readonly registryPath: string;
  readonly keyword: string | null;
  readonly nameField: string | null;
  readonly excludedKey: string | null;
  /** Which block-valued fields the corpus reader must descend into, from the emission. */
  readonly descents: readonly DescentNode[];
  /** Which spliced blocks the corpus reader must descend into. */
  readonly spliceMembers: readonly SpliceMember[];
  /** Every lowered field: own, spliced, and nested with the registry prefix stripped. */
  readonly emitted: readonly EmittedField[];
  /** Keys the interface admits without enumerating them (spliced modifier names). */
  readonly splicedKeys: ReadonlySet<string>;
  /** Corpus paths `CONTENT_DECLINED_FIELDS` keeps out of the authoring surface. */
  readonly declinedPaths: ReadonlySet<string>;
}

export const MEASUREMENTS: readonly RegistryMeasurement[] = CONTENT_MANIFEST.map((manifest) => {
  const entry = manifest as { type: string; keyword?: string; as?: string };
  const registry = entry.as ?? entry.type;
  const type = rules.contentTypes.get(entry.type);
  const registryPath = type?.path?.replace(/^game\//, "") ?? "";
  const body = rules.bodies.get(entry.type);
  emitter.beginFile();
  const emission =
    type === undefined || body === undefined
      ? null
      : emitContentType(emitter, type, body, registry);
  emitter.endFile();
  // Nested paths come back prefixed with the registry (`situation_type.stages.icon`,
  // matching the dotted paths CONTENT_DECLINED_FIELDS/CONTENT_FIELD_OVERRIDES use)
  // — strip that prefix so they line up with the corpus's own unprefixed dotted
  // paths (`stages.icon`).
  const emitted = [
    ...(emission?.emittedFields ?? []),
    ...spliceFieldsOf(emission?.inlineSplices ?? []),
    ...(emission?.nestedEmittedFields ?? []).map((field) => ({
      ...field,
      field: field.field.slice(registry.length + 1),
    })),
  ];
  return {
    registry,
    registryPath,
    keyword: entry.keyword ?? null,
    nameField: type?.nameField ?? null,
    excludedKey: type?.keyFilter?.negated === true ? type.keyFilter.key : null,
    descents: emission?.corpusDescents ?? [],
    // Which blocks the reader must descend into is the emitter's answer: a
    // registry splicing `planet_initializer` writes `planet = { ... }` trees
    // whose contents are otherwise invisible behind one top-level key.
    spliceMembers: spliceMembersOf(emission?.inlineSplices ?? [], (category) =>
      spliceEmission(category)
    ),
    emitted,
    splicedKeys: (emission?.inlineSplices ?? []).includes("modifier")
      ? MODIFIER_NAMES
      : new Set<string>(),
    declinedPaths: declinedPathsOf(entry.type, registry, emission?.inlineSplices ?? []),
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
}

export interface CorpusMeta {
  /** The install's build the fixture was extracted from, `v`-less (`4.4.6`). */
  readonly gameVersion: string;
  /** ISO date of the extraction. Volatile: excluded from drift comparison. */
  readonly extractedAt: string;
  /** sha256 over the sorted per-registry fingerprints. */
  readonly fingerprint: string;
}

export interface ExtractedCorpus {
  readonly meta: CorpusMeta;
  readonly registries: readonly RegistryFixture[];
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
  fingerprint: string
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
  return { registry, definitions: corpus.definitions, files: corpus.files, fingerprint, fields };
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
 * `name:sha256(bytes)` lines, hashed. The bytes reach nothing but the hash.
 */
function fingerprintRegistryDir(dir: string): string {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(".txt"))
      .sort(compareUtf8);
  } catch {
    return "missing";
  }
  const lines = names.map(
    (name) =>
      `${name}:${createHash("sha256")
        .update(readFileSync(path.join(dir, name)))
        .digest("hex")}`
  );
  return sha256(lines.join("\n"));
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
        "corpus-conformance.test.ts would have nothing to compare. Fix the install before " +
        "extracting."
    );
  }
  const registries = MEASUREMENTS.map((measurement) =>
    serializeCorpus(
      measurement.registry,
      readRegistryCorpus(
        installPath,
        measurement.registryPath,
        measurement.keyword,
        measurement.nameField,
        measurement.descents,
        measurement.spliceMembers,
        measurement.excludedKey
      ),
      fingerprintRegistryDir(path.join(installPath, measurement.registryPath))
    )
  );
  return {
    meta: {
      gameVersion,
      extractedAt: new Date().toISOString(),
      fingerprint: sha256(
        registries.map((registry) => `${registry.registry}:${registry.fingerprint}`).join("\n")
      ),
    },
    registries,
  };
}

/** Writes a fixture directory, pruning `<registry>.json` files no longer manifested. */
export function writeFixtures(dir: string, extracted: ExtractedCorpus): void {
  mkdirSync(dir, { recursive: true });
  const expected = new Set([
    META_FILE,
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
    .filter((name) => name.endsWith(".json") && name !== META_FILE)
    .map((name) => name.slice(0, -".json".length))
    .sort(compareUtf8);
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

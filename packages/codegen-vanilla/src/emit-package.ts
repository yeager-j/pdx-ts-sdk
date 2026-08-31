/**
 * The pure core: parsed facts in, a set of files and a report out.
 *
 * The only thing this module imports from the filesystem is `node:path`'s
 * string arithmetic, and that is the property worth having. Reading an install
 * is `read-facts.ts`; everything here is a function of the
 * {@link VanillaBuildFacts} that reader returned, so calling it twice with one
 * value gives one answer and a policy — which registries need a runtime id set,
 * which get a trie, what an empty registry emits — can be exercised against
 * facts assembled in memory rather than against a fixture install on disk.
 *
 * That also keeps SDK-14's door open: pointing this generator at a *user's*
 * install at build time is a matter of supplying the facts, and no step past
 * this one needs to know where they came from.
 */

import { basename } from "node:path";
import type { RuleScopes } from "@pdx-ts/codegen-cwt/lower/scope-facts";
import { pascalCase } from "@pdx-ts/codegen-cwt/naming";

import { emitEventTrie } from "./emit-events.ts";
import {
  bindingsFile,
  compareIdentifiers,
  createChokepoint,
  emitEnumUnion,
  emitIdUnion,
  emitIndex,
  emitScriptedBindings,
  emitScriptedParams,
  emitTables,
  emitTrie,
  emitVanillaEnumMembers,
  emitVanillaGfxIds,
  emitVanillaLocalizationKeys,
  emitVanillaPaths,
  enumFile,
  enumTypeName,
  idTypeName,
  registryFile,
  scriptedFile,
  scriptedTypeName,
  trieIndexFile,
  type TablesPlan,
} from "./emit.ts";
import type { InferredScope, ScriptedKind } from "./infer-scopes.ts";
import {
  RUNTIME_ENUM_SET_NAMES,
  RUNTIME_ID_SET_REGISTRIES,
  VANILLA_MANIFEST,
  type VanillaScriptedRow,
} from "./manifest.ts";
import type { VanillaBuildFacts } from "./read-facts.ts";
import { buildTrie, countLeaves, DEFAULT_TRIE_THRESHOLD } from "./trie.ts";

/** What emission decides that the facts do not already state. */
export interface EmitOptions {
  /**
   * How many ids a registry needs before it gets a trie. Overridable so a
   * fixture can exercise the trie without shipping 2,000 fake sprites.
   */
  readonly trieThreshold?: number;
}

export interface TrieReport {
  readonly buckets: number;
  readonly largestBucket: number;
  /**
   * Top-level entries that are ids rather than buckets — files with no subject
   * in their name put their ids here. Counted separately because they are part
   * of `buckets` and would otherwise read as categories.
   */
  readonly rootLeaves: number;
  /**
   * Ids the flat union carries and the trie does not reach. Measured by
   * counting the trie's leaves back, so a lowering that quietly dropped an id
   * shows up as a number rather than as a missing completion.
   */
  readonly flatOnly: number;
}

export interface RegistryReport {
  readonly registry: string;
  readonly ids: number;
  readonly files: number;
  readonly diagnostics: number;
  readonly missing: boolean;
  readonly trie: TrieReport | null;
}

export interface ComplexEnumReport {
  readonly name: string;
  readonly members: number;
  readonly files: number;
  readonly diagnostics: number;
  readonly missing: boolean;
}

export interface ScriptedReport {
  readonly registry: string;
  readonly definitions: number;
  readonly parameterized: number;
  readonly files: number;
  readonly diagnostics: number;
  readonly missing: boolean;
  /**
   * How many bindings landed on each scope-set size, `0` being unconstrained.
   * This is the number to read after a game patch: a collapse toward 0 means
   * vanilla started writing something the rules do not cover, and the emitted
   * bindings quietly got weaker rather than wrong.
   */
  readonly scopeSizes: ReadonlyMap<number, number>;
  /**
   * Body keys the CWT rules do not cover, and how many definitions each cost a
   * narrowing, most expensive first. This is what makes `scopeSizes` actionable:
   * the share says coverage moved, and this says which key moved it. A game
   * patch that introduces a new keyword shows up here as one name at the top.
   */
  readonly unknownKeys: readonly (readonly [string, number])[];
  /**
   * Definitions whose scope intersection went empty and fell back to
   * unconstrained. Each is either a genuinely multi-scope definition — one that
   * branches on `is_scope_type` at runtime — or a shape the analysis mishandles,
   * and the fallback hides which, so they are named rather than counted.
   */
  readonly emptied: readonly string[];
  /** Definitions whose camelCased name collided and took a numbered suffix. */
  readonly renamed: readonly string[];
}

export interface EventReport {
  readonly definitions: number;
  readonly scoped: number;
  readonly scopeless: number;
  readonly namespaces: number;
  readonly files: number;
  readonly diagnostics: number;
  readonly missing: boolean;
  readonly byKind: ReadonlyMap<string, number>;
}

export interface VanillaReport {
  readonly gameVersion: string;
  readonly registries: readonly RegistryReport[];
  readonly complexEnums: readonly ComplexEnumReport[];
  readonly events: EventReport;
  readonly scripted: readonly ScriptedReport[];
  /**
   * The path inventory: how many paths shipped, and what they were read from.
   * `total` is below `installFiles + archiveEntries - junkExcluded` whenever a
   * DLC archive carries a path a loose file already claims.
   */
  readonly paths: {
    readonly total: number;
    readonly installFiles: number;
    readonly archives: number;
    readonly archiveEntries: number;
    readonly junkExcluded: number;
  };
  /** The localization key inventory: how many keys shipped, from how many files. */
  readonly localization: {
    readonly keys: number;
    readonly files: number;
    readonly unparsedLines: number;
    readonly missing: boolean;
  };
  readonly emittedFiles: number;
  /** Parser repairs across every file read. Reported, never fatal. */
  readonly diagnostics: number;
  /** Strings the licensing gate inspected on their way into emitted text. */
  readonly identifiersChecked: number;
  /** Always zero: a rejection throws and there is no output to report on. */
  readonly rejections: number;
}

/** How many definitions to name in the report before the tail is noise. */
const REPORTED_UNKNOWN_KEYS = 25;

/**
 * Turns the inference's per-definition diagnostics into the two aggregates the
 * report needs.
 *
 * Without these, a regeneration can show that inferred-scope coverage collapsed
 * and give no way to find out why — which is the opposite of what `AGENTS.md`
 * asks of this report. A widening is never a wrong binding, so it is not a
 * build failure; it is exactly the kind of quiet weakening that needs a name
 * attached to be actionable.
 */
function attribute(inferred: readonly InferredScope[]): {
  unknownKeys: readonly (readonly [string, number])[];
  emptied: readonly string[];
} {
  const unknown = new Map<string, number>();
  const emptied: string[] = [];
  for (const one of inferred) {
    // Per definition, not per occurrence: the question is how many bindings a
    // key cost, and one body naming it ten times still lost one binding.
    const keys = new Set<string>();
    for (const diagnostic of one.diagnostics) {
      if (diagnostic.kind === "unknown-key") {
        keys.add(diagnostic.detail);
      }
      if (diagnostic.kind === "emptied" && diagnostic.detail === one.name) {
        emptied.push(one.name);
      }
    }
    for (const key of keys) {
      unknown.set(key, (unknown.get(key) ?? 0) + 1);
    }
  }
  return {
    unknownKeys: [...unknown]
      .sort((left, right) => right[1] - left[1] || compareIdentifiers(left[0], right[0]))
      .slice(0, REPORTED_UNKNOWN_KEYS),
    emptied: [...new Set(emptied)].sort(compareIdentifiers),
  };
}

/**
 * Emits the whole package from one build's facts.
 *
 * @param facts - Everything `readVanillaFacts` read out of the install. The
 * game version is taken from here rather than passed alongside, so the stamp on
 * every emitted header names the build the facts actually came from.
 * @param options - Emission policy the facts do not state.
 * @returns The emitted files, keyed by their path inside the package, and the
 * report a maintainer reads before committing them.
 * @throws Error If a string bound for emitted text fails the licensing gate, or
 * if the facts do not carry a registry or enum the SDK requires a runtime set
 * for.
 */
export function emitVanillaPackage(
  facts: VanillaBuildFacts,
  options: EmitOptions = {}
): {
  files: ReadonlyMap<string, string>;
  report: VanillaReport;
} {
  const threshold = options.trieThreshold ?? DEFAULT_TRIE_THRESHOLD;
  const { gameVersion } = facts;
  const scriptedRows = VANILLA_MANIFEST.filter(
    (row): row is VanillaScriptedRow => row.kind === "scripted"
  );

  const gate = createChokepoint();
  const files = new Map<string, string>();
  const exports: { name: string; file: string }[] = [];
  const registries: RegistryReport[] = [];
  const plan: {
    ids: { registry: string; file: string }[];
    tries: { registry: string; file: string }[];
    enums: { name: string; file: string }[];
    scripted: { target: string; registry: string; file: string }[];
  } = { ids: [], tries: [], enums: [], scripted: [] };

  const eventRead = facts.events;
  const eventTrie = emitEventTrie(eventRead.definitions, gate, gameVersion);
  for (const [file, contents] of eventTrie.files) {
    files.set(file, contents);
  }
  exports.push(eventTrie.export);
  plan.tries.push({ registry: "event", file: eventTrie.export.file });

  for (const { spec, read } of facts.registries) {
    const file = registryFile(spec.registry);
    files.set(file, emitIdUnion(spec.registry, read.ids, gate, gameVersion));
    exports.push({ name: idTypeName(spec.registry), file });
    plan.ids.push({ registry: spec.registry, file });

    let trieReport: TrieReport | null = null;
    if (read.ids.length > threshold || spec.oversized === true) {
      const buckets = buildTrie(read.ids, read.sourcePaths, spec.bucket, basename(spec.path));
      const emission = emitTrie(spec.registry, spec.referenceName, buckets, gate, gameVersion);
      for (const [path, text] of emission.files) {
        files.set(path, text);
      }
      exports.push(...emission.exports);
      plan.tries.push({ registry: spec.registry, file: trieIndexFile(spec.registry) });
      const nodes = [...buckets.values()];
      trieReport = {
        buckets: buckets.size,
        largestBucket: Math.max(0, ...nodes.map(countLeaves)),
        rootLeaves: nodes.filter((node) => node.id !== null).length,
        flatOnly: read.ids.length - nodes.reduce((total, node) => total + countLeaves(node), 0),
      };
    }
    registries.push({
      registry: spec.registry,
      ids: read.ids.length,
      files: read.files,
      diagnostics: read.diagnostics,
      missing: read.missing,
      trie: trieReport,
    });
    for (const projection of read.subtypeProjections) {
      const projectionFile = registryFile(projection.registry);
      files.set(
        projectionFile,
        emitIdUnion(projection.registry, projection.ids, gate, gameVersion)
      );
      exports.push({ name: idTypeName(projection.registry), file: projectionFile });
      plan.ids.push({ registry: projection.registry, file: projectionFile });
      registries.push({
        registry: projection.registry,
        ids: projection.ids.length,
        files: read.files,
        diagnostics: 0,
        missing: read.missing,
        trie: null,
      });
    }
  }

  const complexEnums: ComplexEnumReport[] = [];
  for (const complex of facts.complexEnums) {
    const file = enumFile(complex.name);
    files.set(file, emitEnumUnion(complex.name, complex.members, gate, gameVersion));
    exports.push({ name: enumTypeName(complex.name), file });
    plan.enums.push({ name: complex.name, file });
    complexEnums.push({
      name: complex.name,
      members: complex.members.length,
      files: complex.files,
      diagnostics: complex.diagnostics,
      missing: complex.missing,
    });
  }

  const scripted: ScriptedReport[] = [];
  for (const row of scriptedRows) {
    const kind: ScriptedKind = row.registry === "scripted_trigger" ? "trigger" : "effect";
    const read = facts.scripted[kind];
    const file = scriptedFile(row.registry);
    files.set(file, emitScriptedParams(row.registry, read.definitions, gate, gameVersion));
    exports.push({ name: scriptedTypeName(row.registry), file });
    plan.scripted.push({
      // `scripted_trigger` defines many scripted triggers; the SDK reads the
      // table, so the table name is the plural.
      target: `Vanilla${pascalCase(row.registry)}s`,
      registry: row.registry,
      file,
    });

    const scopes = new Map<string, RuleScopes>(
      facts.inferredScopes[kind].map((one) => [one.name.toLowerCase(), one.scopes])
    );
    const bindings = emitScriptedBindings(
      row.registry,
      read.definitions,
      scopes,
      gate,
      gameVersion
    );
    files.set(bindingsFile(row.registry), bindings.code);

    scripted.push({
      registry: row.registry,
      definitions: read.definitions.length,
      parameterized: read.definitions.filter((one) => one.params.length > 0).length,
      files: read.files,
      diagnostics: read.diagnostics,
      missing: read.missing,
      scopeSizes: bindings.bySize,
      ...attribute(facts.inferredScopes[kind]),
      renamed: bindings.renamed,
    });
  }

  files.set("tables.ts", emitTables(plan satisfies TablesPlan, gate, gameVersion));
  // Not re-exported from the barrel. The inventory is tens of thousands of
  // strings behind its own `./paths` subpath, and the root must stay something
  // a project can import without loading it.
  files.set(
    "paths.ts",
    emitVanillaPaths(facts.paths.paths, facts.evidence.install.sha256, gate, gameVersion)
  );
  // The third of the same kind, and the largest: 149,217 keys is far past what
  // a union can carry, so `vanilla.localization` checks membership at build
  // time (SDK-307). Its own `./localization-keys` subpath, for the same reason.
  files.set(
    "localization-keys.ts",
    emitVanillaLocalizationKeys(facts.localization.keys, gate, gameVersion)
  );
  // The same reasoning, and the same shape: a runtime lookup the SDK performs
  // per build, behind its own subpath so the root loads none of it.
  files.set(
    "gfx-ids.ts",
    emitVanillaGfxIds(
      RUNTIME_ID_SET_REGISTRIES.map((registry) => {
        const read = facts.registries.find((one) => one.spec.registry === registry);
        if (read === undefined) {
          // An empty set here would not fail — it would silently stop refusing
          // collisions for that registry, which is the one thing the set exists
          // to do.
          throw new Error(
            `"${registry}" needs a runtime id set but no registry of that name was read`
          );
        }
        return { registry, ids: read.read.ids };
      }),
      gate,
      gameVersion
    )
  );
  files.set(
    "enum-members.ts",
    emitVanillaEnumMembers(
      RUNTIME_ENUM_SET_NAMES.map((name) => {
        const read = facts.complexEnums.find((one) => one.name === name);
        if (read === undefined) {
          throw new Error(`"${name}" needs a runtime enum set but no enum of that name was read`);
        }
        return { name, members: read.members };
      }),
      gate,
      gameVersion
    )
  );
  files.set("index.ts", emitIndex(exports, gameVersion));

  const eventKinds = new Map<string, number>();
  for (const definition of eventRead.definitions) {
    eventKinds.set(definition.key, (eventKinds.get(definition.key) ?? 0) + 1);
  }
  const eventNamespaces = new Set(eventRead.definitions.map((definition) => definition.namespace));
  const scopelessEvents = eventRead.definitions.filter(
    (definition) => definition.scope === null
  ).length;

  return {
    files,
    report: {
      gameVersion,
      registries,
      complexEnums,
      events: {
        definitions: eventRead.definitions.length,
        scoped: eventRead.definitions.length - scopelessEvents,
        scopeless: scopelessEvents,
        namespaces: eventNamespaces.size,
        files: eventRead.files,
        diagnostics: eventRead.diagnostics,
        missing: eventRead.missing,
        byKind: new Map([...eventKinds].sort(([left], [right]) => compareIdentifiers(left, right))),
      },
      scripted,
      paths: {
        total: facts.paths.paths.length,
        installFiles: facts.paths.installFiles,
        archives: facts.paths.archives,
        archiveEntries: facts.paths.archiveEntries,
        junkExcluded: facts.paths.junkExcluded,
      },
      localization: {
        keys: facts.localization.keys.length,
        files: facts.localization.files,
        unparsedLines: facts.localization.unparsedLines,
        missing: facts.localization.missing,
      },
      emittedFiles: files.size,
      diagnostics:
        registries.reduce((total, one) => total + one.diagnostics, 0) +
        complexEnums.reduce((total, one) => total + one.diagnostics, 0) +
        eventRead.diagnostics +
        scripted.reduce((total, one) => total + one.diagnostics, 0),
      identifiersChecked: gate.checked(),
      rejections: 0,
    },
  };
}

/**
 * The pure core: an install and a rule set in, a set of files out.
 *
 * Nothing here writes, locates, or stamps anything — the whole generator is a
 * function of `(installRoot, configRoot, gameVersion)`. That is not tidiness
 * for its own sake: SDK-14's open question is whether this same generator can
 * be pointed at a *user's* install at build time, and the only thing standing
 * between here and there is the shell in `index.ts`. Keeping the core pure
 * keeps that door open and makes the whole generator testable against a fixture
 * install with no filesystem writes at all.
 */

import { basename } from "node:path";
import { pascalCase } from "@pdx-ts/codegen-cwt/naming";
import type { RuleScopes } from "@pdx-ts/codegen-cwt/scope-facts";

import { buildVanillaFacts, type VanillaBuildFactsOptions } from "./build-facts.ts";
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
  emitVanillaGfxIds,
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
  RUNTIME_ID_SET_REGISTRIES,
  VANILLA_MANIFEST,
  type VanillaScriptedRow,
} from "./manifest.ts";
import { buildTrie, countLeaves, DEFAULT_TRIE_THRESHOLD } from "./trie.ts";

export interface GenerateOptions extends VanillaBuildFactsOptions {
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

export function generateVanillaPackage(options: GenerateOptions): {
  files: ReadonlyMap<string, string>;
  report: VanillaReport;
} {
  const threshold = options.trieThreshold ?? DEFAULT_TRIE_THRESHOLD;
  const { gameVersion } = options;
  const facts = buildVanillaFacts(options);
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
  files.set("paths.ts", emitVanillaPaths(facts.paths.paths, gate, gameVersion));
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

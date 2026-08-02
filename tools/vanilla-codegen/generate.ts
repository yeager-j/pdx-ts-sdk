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

import { pascalCase } from "../codegen/naming.ts";
import {
  createChokepoint,
  emitAugment,
  emitIdUnion,
  emitIndex,
  emitScriptedParams,
  emitTrie,
  idTypeName,
  registryFile,
  scriptedFile,
  scriptedTypeName,
  trieIndexFile,
  type AugmentPlan,
} from "./emit.ts";
import { VANILLA_MANIFEST, type VanillaIdRow, type VanillaScriptedRow } from "./manifest.ts";
import { readRegistryIds } from "./read-ids.ts";
import { readScriptedDefinitions } from "./read-scripted.ts";
import { resolveRegistries } from "./resolve.ts";
import { buildIdTrie, DEFAULT_TRIE_SHAPE, type TrieNode, type TrieShape } from "./trie.ts";

export interface GenerateOptions {
  /** Stellaris game root. */
  readonly installRoot: string;
  /** `major.minor.patch`, stamped into every generated header. */
  readonly gameVersion: string;
  /** The vendored cwtools config root. */
  readonly configRoot: string;
  /**
   * When a registry is big enough to need a trie, and how small a bucket has to
   * get before it stops splitting. Overridable so a fixture can exercise the
   * trie without shipping 2,000 fake sprites.
   */
  readonly trie?: TrieShape;
}

export interface TrieReport {
  readonly buckets: number;
  readonly largestBucket: number;
  /** Ids the trie cannot navigate to; the flat union still carries them. */
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

export interface ScriptedReport {
  readonly registry: string;
  readonly definitions: number;
  readonly parameterized: number;
  readonly files: number;
  readonly diagnostics: number;
  readonly missing: boolean;
}

export interface VanillaReport {
  readonly gameVersion: string;
  readonly registries: readonly RegistryReport[];
  readonly scripted: readonly ScriptedReport[];
  readonly emittedFiles: number;
  /** Parser repairs across every file read. Reported, never fatal. */
  readonly diagnostics: number;
  /** Strings the licensing gate inspected on their way into emitted text. */
  readonly identifiersChecked: number;
  /** Always zero: a rejection throws and there is no output to report on. */
  readonly rejections: number;
}

export function generateVanillaPackage(options: GenerateOptions): {
  files: ReadonlyMap<string, string>;
  report: VanillaReport;
} {
  const shape = options.trie ?? DEFAULT_TRIE_SHAPE;
  const { gameVersion } = options;
  const idRows = VANILLA_MANIFEST.filter((row): row is VanillaIdRow => row.kind === "ids");
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
    scripted: { target: string; registry: string; file: string }[];
  } = { ids: [], tries: [], scripted: [] };

  for (const spec of resolveRegistries(options.configRoot, idRows)) {
    const read = readRegistryIds(options.installRoot, spec);
    const file = registryFile(spec.registry);
    files.set(file, emitIdUnion(spec.registry, read.ids, gate, gameVersion));
    exports.push({ name: idTypeName(spec.registry), file });
    plan.ids.push({ registry: spec.registry, file });

    let trieReport: TrieReport | null = null;
    if (read.ids.length > shape.threshold) {
      const trie = buildIdTrie(read.ids, shape);
      const emission = emitTrie(spec.registry, trie.buckets, shape.leafSize, gate, gameVersion);
      for (const [path, text] of emission.files) {
        files.set(path, text);
      }
      exports.push(...emission.exports);
      plan.tries.push({ registry: spec.registry, file: trieIndexFile(spec.registry) });
      trieReport = {
        buckets: trie.buckets.size,
        largestBucket: Math.max(0, ...[...trie.buckets.values()].map(countLeaves)),
        flatOnly: trie.excluded.length,
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

  const scripted: ScriptedReport[] = [];
  for (const row of scriptedRows) {
    const read = readScriptedDefinitions(options.installRoot, row.registry, row.dir);
    const file = scriptedFile(row.registry);
    files.set(file, emitScriptedParams(row.registry, read.definitions, gate, gameVersion));
    exports.push({ name: scriptedTypeName(row.registry), file });
    plan.scripted.push({
      // `scripted_trigger` defines many scripted triggers; the SDK's merge
      // target is the table, so the target name is the plural.
      target: `Vanilla${pascalCase(row.registry)}s`,
      registry: row.registry,
      file,
    });
    scripted.push({
      registry: row.registry,
      definitions: read.definitions.length,
      parameterized: read.definitions.filter((one) => one.params.length > 0).length,
      files: read.files,
      diagnostics: read.diagnostics,
      missing: read.missing,
    });
  }

  files.set("augment.ts", emitAugment(plan satisfies AugmentPlan, gate, gameVersion));
  files.set("index.ts", emitIndex(exports, gameVersion));

  return {
    files,
    report: {
      gameVersion,
      registries,
      scripted,
      emittedFiles: files.size,
      diagnostics:
        registries.reduce((total, one) => total + one.diagnostics, 0) +
        scripted.reduce((total, one) => total + one.diagnostics, 0),
      identifiersChecked: gate.checked(),
      rejections: 0,
    },
  };
}

function countLeaves(node: TrieNode): number {
  let total = node.id === null ? 0 : 1;
  for (const child of node.children.values()) {
    total += countLeaves(child);
  }
  return total;
}

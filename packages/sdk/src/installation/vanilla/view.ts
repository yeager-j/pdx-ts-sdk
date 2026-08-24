/**
 * The queryable view over one load of vanilla files: the definition index per
 * registry, the swap index that refuses a patch aimed at a nested block, the
 * file list the win engine computes filenames against, and the manifest key
 * version-drift detection hashes.
 *
 * Parsing and `@variable` resolution happen in `parse.ts` before any index is
 * built; the models the index holds live in `parsed-definitions.ts`. This
 * module only arranges the results for lookup.
 */

import type { PdxContainer, PdxEntry, PdxItem } from "@pdx-ts/pdxscript";

import { parsedSwapDeclarations, type ParsedSwapDeclaration } from "../../content/swaps.ts";
import { SwapPatchError } from "../../errors.ts";
import { normalizeLogicalPath, type LogicalPath } from "../../ordering.ts";
import {
  normalizeSources,
  parseStrict,
  readDefinition,
  registryOfPath,
  sha256Hex,
  variableTables,
  type NormalizedSource,
  type ParsedSource,
  type VarTable,
} from "./parse.ts";
import type {
  ParsedDefinition,
  ParsedRegistries,
  ParsedRegistryName,
  VanillaFile,
} from "./parsed-definitions.ts";

interface SwapRecord {
  readonly parent: string;
  /** The PDXScript key of the block declaring the swap, for the diagnostic. */
  readonly key: string;
  readonly file: LogicalPath;
}

export interface ViewOptions {
  readonly installPath?: string;
  /** The install's game build (from launcher-settings.json), when known. */
  readonly gameVersion?: string;
  /** Set by the loader when the parse was skipped via the content cache. */
  readonly fromCache?: boolean;
  /**
   * Every path the loaded install occupies (loose files and DLC archive
   * entries), from {@link scanInstallPaths}. Optional, live evidence on top of
   * the packaged vanilla path inventory the Fold always checks (ADR-0006): a
   * hermetic view built from `viewFromFiles` carries none.
   */
  readonly pathInventory?: readonly string[];
}

export class VanillaView {
  /** Every parsed file, in enumeration order — the win engine's input. */
  readonly files: readonly VanillaFile[];
  readonly installPath?: string;
  readonly gameVersion?: string;
  /** True when this view was rebuilt from cached parse results. */
  readonly fromCache: boolean;
  /**
   * Every path the install that produced this view occupies, when a live
   * install was scanned — optional evidence on top of the packaged vanilla
   * path inventory the Fold always checks. `undefined` for a hermetic view.
   */
  readonly pathInventory?: readonly string[];
  /**
   * sha256 over the (path, sha256) manifest: two views over byte-identical
   * inputs share it, so a build can tell "same vanilla" from "different loads".
   */
  readonly manifestKey: string;
  private readonly parsed: ReadonlyMap<string, ReadonlyMap<string, ParsedDefinition>>;
  private readonly swaps: ReadonlyMap<string, ReadonlyMap<string, SwapRecord>>;
  private readonly globalVars: ReadonlyMap<string, number>;
  private readonly localVars: ReadonlyMap<string, ReadonlyMap<string, number>>;

  constructor(sources: readonly ParsedSource[], options: ViewOptions = {}) {
    this.installPath = options.installPath;
    this.gameVersion = options.gameVersion;
    this.fromCache = options.fromCache ?? false;
    this.pathInventory =
      options.pathInventory === undefined ? undefined : Object.freeze([...options.pathInventory]);

    const normalized = normalizeSources(sources);
    const { global, locals, vars } = variableTables(normalized);
    this.globalVars = global;
    this.localVars = locals;

    const indexes = buildIndexes(normalized, this, vars);
    this.files = indexes.files;
    this.parsed = indexes.parsed;
    this.swaps = indexes.swaps;
    this.manifestKey = manifestKeyOf(indexes.files);
  }

  /**
   * The `@variables` declared at the top of one file — file-scoped in the
   * game, unlike `common/scripted_variables` definitions. An emission that
   * carries a reference to one of these into a *different* file must
   * re-declare it there, or the game corrupts the definition silently.
   */
  localVariables(file: string): ReadonlyMap<string, number> {
    return this.localVars.get(normalizeLogicalPath(file)) ?? new Map();
  }

  /** True when the name is a cross-file `common/scripted_variables` constant. */
  isGlobalVariable(name: string): boolean {
    return this.globalVars.has(name);
  }

  /** Every parsed definition of one registry, in enumeration-then-file order. */
  definitions<R extends ParsedRegistryName>(registry: R): readonly ParsedRegistries[R][] {
    return [...(this.parsed.get(registry)?.values() ?? [])] as ParsedRegistries[R][];
  }

  /** One parsed definition, or a loud error naming what the view does have. */
  definition<R extends ParsedRegistryName>(registry: R, id: string): ParsedRegistries[R] {
    const definitions = this.parsed.get(registry);
    const found = definitions?.get(id);
    if (found !== undefined) {
      return found as ParsedRegistries[R];
    }
    const swap = this.swaps.get(registry)?.get(id);
    if (swap !== undefined) {
      throw new SwapPatchError(
        `"${id}" is a ${swap.key} inside ${swap.parent} (${swap.file}): patching into a ` +
          `swap is refused — swap override semantics have no oracle evidence ` +
          `Patch ${swap.parent} instead; its swaps ` +
          `ride through unchanged.`
      );
    }
    const near = [...(definitions?.keys() ?? [])].filter((key) => key.includes(id)).slice(0, 5);
    const hint = near.length > 0 ? ` (did you mean: ${near.join(", ")}?)` : "";
    throw new Error(
      `Unknown ${registry} "${id}"; the parsed files define ${definitions?.size ?? 0} ` +
        `definitions of \`${registry}\`${hint}`
    );
  }
}

/**
 * Parses a set of vanilla sources keyed by game-relative path. Eager by
 * design: every definition is built — areas validated, every `@variable`
 * resolved — before the view returns, so bad input fails at the parse, not
 * at first use. Strict: a parser repair diagnostic is an error here.
 */
export function viewFromFiles(
  files: Readonly<Record<string, string>>,
  options: ViewOptions = {}
): VanillaView {
  const sources = Object.entries(files).map(([path, source]) => parseStrict(path, source));
  return new VanillaView(sources, options);
}

/** Everything {@link VanillaView} looks a query up in, built in one pass. */
interface ViewIndexes {
  readonly parsed: ReadonlyMap<string, ReadonlyMap<string, ParsedDefinition>>;
  readonly swaps: ReadonlyMap<string, ReadonlyMap<string, SwapRecord>>;
  readonly files: readonly VanillaFile[];
}

/**
 * Reads every source in order and indexes what it declares. `origin` is the
 * view under construction: each definition records the view it came from.
 */
function buildIndexes(
  sources: readonly NormalizedSource[],
  origin: VanillaView,
  vars: VarTable
): ViewIndexes {
  const parsed = new Map<string, Map<string, ParsedDefinition>>();
  const swaps = new Map<string, Map<string, SwapRecord>>();
  const files: VanillaFile[] = [];
  for (const source of sources) {
    const keys: string[] = [];
    const row = registryOfPath(source.path);
    for (const item of source.items) {
      if (item.kind !== "entry") {
        throw new Error(
          `${source.path}: unexpected top-level ${item.kind}; expected only key = value entries`
        );
      }
      if (item.key.startsWith("@")) {
        continue;
      }
      keys.push(item.key);
      if (row === undefined) {
        continue;
      }
      const definitions = parsed.get(row.registry) ?? new Map<string, ParsedDefinition>();
      definitions.set(item.key, readDefinition(item, source, row, origin, vars));
      parsed.set(row.registry, definitions);
      const declared = swaps.get(row.registry) ?? new Map<string, SwapRecord>();
      registerSwaps(item, row.registry, source.path, declared);
      swaps.set(row.registry, declared);
    }
    files.push({ path: source.path, sha256: source.sha256, keys });
  }
  return { parsed, swaps, files };
}

function manifestKeyOf(files: readonly VanillaFile[]): string {
  const manifest = files.map((file) => `${file.path}\t${file.sha256}`).join("\n");
  return sha256Hex(manifest);
}

/** Resolved once per registry: the walk below runs for every definition. */
const swapDeclarations = new Map<string, readonly ParsedSwapDeclaration[]>();

function declarationsFor(registry: string): readonly ParsedSwapDeclaration[] {
  const cached = swapDeclarations.get(registry);
  if (cached !== undefined) {
    return cached;
  }
  const resolved = parsedSwapDeclarations(registry);
  swapDeclarations.set(registry, resolved);
  return resolved;
}

/**
 * Records every id this definition declares as a swap of itself, so naming one
 * as a patch target refuses with the parent to patch instead. Which nested
 * blocks those are is `SWAP_IDENTITIES` data resolved against the registry's
 * own field descriptors — a registry declaring no swaps records nothing, at no
 * cost and with no branch.
 */
function registerSwaps(
  entry: PdxEntry,
  registry: string,
  file: LogicalPath,
  into: Map<string, SwapRecord>
): void {
  for (const declaration of declarationsFor(registry)) {
    const key = declaration.keys[declaration.keys.length - 1]!;
    for (const swap of blocksAt(entry.value, declaration.keys)) {
      for (const name of swapNames(swap, declaration.nameKey)) {
        into.set(name, { parent: entry.key, key, file });
      }
    }
  }
}

/** Every container reached by following the nested keys from a value. */
function blocksAt(value: PdxItem, keys: readonly string[]): PdxContainer[] {
  if (value.kind !== "container") {
    return [];
  }
  const [head, ...rest] = keys;
  const matched = value.items.flatMap((item) =>
    item.kind === "entry" && item.key === head && item.value.kind === "container"
      ? [item.value]
      : []
  );
  return rest.length === 0 ? matched : matched.flatMap((inner) => blocksAt(inner, rest));
}

function swapNames(swap: PdxContainer, nameKey: string | null): string[] {
  return swap.items.flatMap((item) => {
    if (item.kind !== "entry") {
      return [];
    }
    if (nameKey === null) {
      return [item.key];
    }
    return item.key === nameKey && item.value.kind === "str" ? [item.value.value] : [];
  });
}

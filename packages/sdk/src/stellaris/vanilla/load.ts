/**
 * `stellaris.load()`: locate the install, hash and parse the files this
 * slice models (`common/scripted_variables` plus every parsed registry), and
 * hand back the typed view. Synchronous by design — the workload is ~65 files —
 * and eager like everything downstream of it.
 *
 * Reads are non-recursive by evidence: the resolver-evaluation spike
 * measured `common/technology` flat, so a subdirectory appearing there is a
 * loud error, not a silent widen. The game build is read from
 * `launcher-settings.json` (see `version.ts`) and carried on the view; the
 * rule-table staleness check happens where win-assertions are made, not here —
 * parsing is version-agnostic, which is why this side takes the lenient reader.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { locateInstall } from "../installation/locate.ts";
import { readGameVersion } from "../installation/version.ts";
import { cacheKey, readCache, writeCache } from "./cache.ts";
import {
  PARSED_REGISTRIES,
  parsedRegistryDir,
  parseStrict,
  sha256Hex,
  VanillaView,
  VARIABLES_DIR,
  type ParsedSource,
} from "./view.ts";

export interface LoadOptions {
  /** Game root; wins over STELLARIS_PATH and the platform defaults. */
  readonly installPath?: string;
  /**
   * Parse-cache directory, or `false` to disable. Default:
   * `node_modules/.cache/pdx-ts-sdk` under the working directory.
   */
  readonly cache?: string | false;
}

/**
 * The directories this slice reads, each read flat: the `@variable`
 * provenance directory plus one row per parsed registry.
 *
 * Nothing here is spelled by hand. The directory comes from the registry's own
 * rule-table row (which derives it from the generated content descriptor), and
 * the subdirectories a registry legitimately has are its
 * {@link PARSED_REGISTRIES} row's data — so adding a registry to the parse
 * layer adds nothing to the loader.
 */
const PARSED_DIRS: readonly { readonly dir: string; readonly knownSubdirs: ReadonlySet<string> }[] =
  [
    { dir: VARIABLES_DIR, knownSubdirs: new Set<string>() },
    ...PARSED_REGISTRIES.map((row) => ({
      dir: parsedRegistryDir(row.registry),
      knownSubdirs: row.knownSubdirs,
    })),
  ];

export function load(options: LoadOptions = {}): VanillaView {
  const installPath = locateInstall(options.installPath);
  const gameVersion = readGameVersion(installPath);

  const manifest: { path: string; sha256: string; source: string }[] = [];
  for (const { dir, knownSubdirs } of PARSED_DIRS) {
    const absolute = join(installPath, dir);
    for (const name of readdirSync(absolute).sort()) {
      const filePath = join(absolute, name);
      if (statSync(filePath).isDirectory()) {
        if (knownSubdirs.has(name)) {
          continue;
        }
        throw new Error(
          `${dir}/${name} is a directory this slice does not know; ${dir} is read flat ` +
            `(the measured stream shape) with only [${[...knownSubdirs].join(", ")}] pinned ` +
            `as other registries — an unknown subdirectory means vanilla changed shape`
        );
      }
      if (!name.endsWith(".txt")) {
        continue;
      }
      const bytes = readFileSync(filePath);
      manifest.push({
        path: `${dir}/${name}`,
        sha256: sha256Hex(bytes),
        source: bytes.toString("utf8"),
      });
    }
  }

  const cacheDir =
    options.cache === false
      ? undefined
      : (options.cache ?? join(process.cwd(), "node_modules/.cache/pdx-ts-sdk"));
  const key = cacheKey(manifest);

  if (cacheDir !== undefined) {
    const cached = readCache(cacheDir, key);
    if (cached !== undefined) {
      return new VanillaView(cached, { installPath, gameVersion, fromCache: true });
    }
  }

  const sources: ParsedSource[] = manifest.map((file) =>
    parseStrict(file.path, file.source, file.sha256)
  );
  if (cacheDir !== undefined) {
    writeCache(cacheDir, key, sources);
  }
  return new VanillaView(sources, { installPath, gameVersion });
}

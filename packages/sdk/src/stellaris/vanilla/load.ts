/**
 * `stellaris.load()`: locate the install, hash and parse the files this
 * slice models (`common/scripted_variables`, `common/technology`), and hand
 * back the typed view. Synchronous by design — the workload is ~35 files —
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
import { parseStrict, sha256Hex, VanillaView, type ParsedSource } from "./view.ts";

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
 * The directories this slice parses, each read flat. Subdirectories that
 * exist in the real install are pinned by name — they hold *different*
 * registries (technology categories and tiers), out of this slice's scope
 * and outside the technology enumeration (the registry was measured flat).
 * An unknown subdirectory appearing is vanilla changing shape under us:
 * a loud error, never a silent widen or a silent skip.
 */
const PARSED_DIRS = [
  { dir: "common/scripted_variables", knownSubdirs: new Set<string>() },
  { dir: "common/technology", knownSubdirs: new Set(["category", "tier"]) },
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

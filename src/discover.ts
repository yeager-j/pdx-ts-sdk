/**
 * `discoverContent(dir)`: the filesystem half of the authoring API (SDK-23).
 *
 * The SDK is a compiler, so source layout and output layout are decoupled: the
 * game demands one file per registry, but nothing demands that an author
 * organize *source* that way. `discoverContent` walks a directory of ordinary
 * modules, imports each one, and turns its exports into a `collection` named
 * after the file. Export is registration — a definer's return value that is
 * exported lands in the mod, and one that is not, does not.
 *
 * Like `write`, this is impure shell around the pure core: it reads a
 * directory and executes modules, then hands `buildMod` the same `Collection[]`
 * a hand-written pack would. Everything the fold does with them — canonical
 * emission order, duplicate ids, the one-namespace-per-file bijection — is
 * unchanged, which is why discovery needs no cooperation from `buildMod`.
 *
 * What the walk does:
 * - Recurses the directory; files ending `.ts` are modules, everything else
 *   (assets, `.md` notes, `.json` data the modules read) is silently ignored.
 * - Imports in logical-path order, so a build is a pure function of the tree
 *   and not of `readdir`'s arbitrary directory order.
 * - Names each collection with the module's basename minus `.ts`, so
 *   `content/economy/technology.ts` and `content/military/technology.ts` both
 *   emit into `<prefix>_technology.txt` — grouping by feature in source,
 *   grouping by registry in output.
 *
 * Order caveat: emission order is a pure function of content (SDK-23), so
 * neither export order nor file order can change the emitted bytes. The one
 * order that is author data is a hook's event list, and that order is written
 * inside a single `on(hook, [first, second, third])` call — never by which
 * module or which export a binding happens to come from.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { collection, type Collection, type ModItem } from "./items.ts";
import { compareLogicalPaths, normalizeLogicalPath } from "./resolver/path-order.ts";

const ITEM_KINDS = new Set<string>(["content", "event", "on-action", "patch", "contribution"]);

const DEFINER_LIST =
  "defineTechnology, namespace(...).defineCountryEvent, on, patchTechnology, addShipOfSizeLimits, ...";

export async function discoverContent(dir: string | URL): Promise<Collection[]> {
  const root = dir instanceof URL ? fileURLToPath(dir) : dir;
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const modules = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => {
      const absolute = path.join(entry.parentPath, entry.name);
      // `normalizeLogicalPath` speaks the game's `/`-separated dialect, so the
      // platform separator is translated before it is ever shown one.
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      return { absolute, relative: normalizeLogicalPath(relative) };
    })
    .sort((a, b) => compareLogicalPaths(a.relative, b.relative));

  const collections: Collection[] = [];
  for (const module of modules) {
    const exports = (await import(pathToFileURL(module.absolute).href)) as Record<string, unknown>;
    collections.push(
      collectModule(module.relative, path.basename(module.absolute, ".ts"), exports)
    );
  }
  return collections;
}

/**
 * One module's exports as a collection. Arrays flatten (a loop that builds
 * fifty variants exports one array), and the same item exported twice — as
 * itself and inside a list — is collected once. Deduplication is by identity
 * and stops at the module, because the same item reachable from two *modules*
 * is a re-export, which is two placements of one definition and stays the
 * duplicate-id error `buildMod` already raises.
 */
function collectModule(
  relPath: string,
  stem: string,
  exports: Record<string, unknown>
): Collection {
  const items = new Set<ModItem>();
  for (const [name, value] of Object.entries(exports)) {
    collect(relPath, name, value, items);
  }
  if (items.size === 0) {
    throw new Error(
      `The discovered module ${relPath} exports nothing the SDK recognizes, so it would emit an ` +
        `empty file. Export what its definers (${DEFINER_LIST}) returned, or move the module out ` +
        `of the discovered directory.`
    );
  }
  try {
    return collection(stem, [...items]);
  } catch (error) {
    throw new Error(
      `The discovered module ${relPath} names the file it emits, so its basename is the file ` +
        `stem: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function collect(relPath: string, name: string, value: unknown, items: Set<ModItem>): void {
  if (Array.isArray(value)) {
    for (const element of value) {
      collect(relPath, name, element, items);
    }
    return;
  }
  if (isItem(value)) {
    items.add(value);
    return;
  }
  if (isNamespaceHandle(value)) {
    throw new Error(
      `The discovered module ${relPath} exports "${name}", the namespace handle for events in ` +
        `"${value.namespace}". Export the events it defined, not the namespace handle: the handle ` +
        `records nothing, and the events its definers returned are what land in the file.`
    );
  }
  throw new Error(
    `The discovered module ${relPath} exports "${name}", which is not something a definer ` +
      `returned. In a discovered module export is registration, so every export must be an item — ` +
      `or an array of items — from ${DEFINER_LIST}. Values a module only uses (flags, shared ` +
      `triggers, constants) belong in a module outside the discovered directory: importing a ` +
      `value is not exporting it.`
  );
}

function isItem(value: unknown): value is ModItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemKind" in value &&
    typeof value.itemKind === "string" &&
    ITEM_KINDS.has(value.itemKind)
  );
}

function isNamespaceHandle(value: unknown): value is { readonly namespace: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "event-namespace"
  );
}

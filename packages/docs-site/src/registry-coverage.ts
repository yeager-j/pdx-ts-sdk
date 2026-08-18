import { createMod, SUPPORTED_STELLARIS_BUILD } from "@pdx-ts/sdk";
import { CONTENT_REGISTRIES } from "@pdx-ts/sdk/content-registries";
import { VANILLA_PATH_GAME_VERSION, VANILLA_PATHS } from "@pdx-ts/stellaris-ids/paths";

/**
 * What the site covers, derived rather than written down — and the gate that
 * keeps it that way.
 *
 * Two questions, one derivation. "Is every registry documented?" is the gate:
 * a registry the SDK exposes must be claimed by a reference page or listed in
 * {@link UNDOCUMENTED_REGISTRIES}, and `buildCoverage` throws otherwise, which
 * fails `astro build`. Adding a registry therefore breaks the docs build until
 * somebody writes its page or says in one line why not. "Can the SDK do X yet?"
 * is the coverage page, which is the same three lists rendered.
 *
 * Nothing here is a hand-kept mirror of anything. The registries come from the
 * SDK's generated descriptor table, the folders they write to come from the
 * same rows, the pages come from the content collection, and the concepts the
 * SDK does *not* cover come from diffing that against the install's own folder
 * list ({@link VANILLA_PATHS}, committed by `@pdx-ts/stellaris-ids`). The only
 * written-down lists are the skip notes and the channel table, and both are
 * things no derivation could know.
 */

/** A page of the site, as the gate needs to see it. */
export interface ReferencePage {
  /** The collection id — what the gate reasons about and names in its errors. */
  readonly id: string;
  /**
   * Where the page is served. Supplied by the caller rather than built from
   * {@link id}, because how a collection id becomes a URL is Starlight's rule
   * and it moves — a base path, a locale prefix — and this module has no
   * business knowing it.
   */
  readonly href: string;
  readonly title: string;
  /**
   * The registries this page documents. Present on every `reference/` page,
   * empty for the ones that document none (the section index, this page), so
   * that a page cannot join the section without answering the gate's question.
   */
  readonly registries?: readonly string[];
}

/** One row of the supported-registry table. */
export interface RegistryCoverageRow {
  readonly registry: string;
  /** The authoring call, `mod.technology`, checked against a real mod below. */
  readonly method: string;
  /** The game folder the registry writes into. */
  readonly folder: string;
  /** The page documenting it, when one exists. */
  readonly page?: { readonly href: string; readonly title: string };
  /** Why no page documents it yet, when none does. */
  readonly undocumented?: string;
}

/** One row of the channel table. */
export interface ChannelRow {
  readonly concept: string;
  readonly methods: readonly string[];
  /** Game folders the channel writes into; empty when the author chooses. */
  readonly folders: readonly string[];
  readonly summary: string;
}

export interface Coverage {
  readonly gameVersion: string;
  readonly registries: readonly RegistryCoverageRow[];
  readonly channels: readonly ChannelRow[];
  /** Game folders under `common/` that no registry or channel writes to. */
  readonly unsupported: readonly string[];
}

/**
 * Registries the SDK exposes and the site does not document yet, each with the
 * ticket that will write the page.
 *
 * This is the gate's escape hatch and it is meant to drain: an entry is deleted
 * when its page lands, and the gate fails if an entry names a registry that is
 * already documented, so a stale line cannot sit here unnoticed. It starts full
 * because the reference milestone has not started — the gate's value today is
 * that a *new* registry cannot slip in silently.
 */
export const UNDOCUMENTED_REGISTRIES: Readonly<Record<string, string>> = {
  ascension_perk: "SDK-201 — progression and economy",
  economic_category: "SDK-201 — progression and economy",
  static_modifier: "SDK-201 — progression and economy",
  scripted_modifier: "SDK-201 — progression and economy",
  agenda: "SDK-202 — government and politics",
  edict: "SDK-202 — government and politics",
  decision: "SDK-202 — government and politics",
  councilor: "SDK-202 — government and politics",
  civic_or_origin: "SDK-202 — government and politics",
  casus_belli: "SDK-203 — diplomacy and war",
  war_goal: "SDK-203 — diplomacy and war",
  agreement_preset: "SDK-203 — diplomacy and war",
  bombardment_stance: "SDK-203 — diplomacy and war",
  opinion_modifier: "SDK-203 — diplomacy and war",
  ambient_object: "SDK-204 — world and flavor",
  graphical_culture: "SDK-204 — world and flavor",
  species_class: "SDK-204 — world and flavor",
  scripted_loc: "SDK-204 — world and flavor",
  spriteType: "SDK-205 — GFX registries",
  pdxmesh: "SDK-205 — GFX registries",
  pdxparticle: "SDK-205 — GFX registries",
  event_chain: "SDK-212 — event chains and special projects",
  special_project: "SDK-212 — event chains and special projects",
};

/**
 * The authoring surfaces that are not registries.
 *
 * A registry mints ids into one game folder and is generated from a CWT type; a
 * channel is none of that — events are numbered inside a namespace, on-actions
 * hook points the game already defines, localization is text keyed by language,
 * and assets are bytes copied through. They are listed separately because the
 * coverage question is the same ("can the SDK do X yet?") but the answer's shape
 * is not, and because folding them into the registry table would make the
 * derived table a hand-edited one.
 *
 * The folders are load-bearing beyond display: `common/on_actions` is claimed
 * here, so it does not turn up in the not-supported diff below.
 */
export const CHANNELS: readonly ChannelRow[] = [
  {
    concept: "Events",
    methods: ["mod.namespace"],
    folders: ["events"],
    summary: "Event definitions, numbered inside a namespace the mod owns.",
  },
  {
    concept: "On-actions",
    methods: ["mod.on"],
    folders: ["common/on_actions"],
    summary: "Hooks onto the points the game fires, rather than firing an event yourself.",
  },
  {
    concept: "Localization",
    methods: ["mod.localization", "mod.replaceLocalization"],
    folders: ["localisation"],
    summary: "Display text per language, plus the keys content definitions generate.",
  },
  {
    concept: "Assets",
    methods: ["mod.assetFile", "mod.assetTree"],
    folders: [],
    summary: "Files mirrored byte for byte into the mod, at a path the author chooses.",
  },
];

/**
 * A mod, built once, only to be asked whether a method exists.
 *
 * The method name is derived from the registry name, and a derivation that
 * nobody checks is a guess: a renamed capability would leave this page
 * confidently printing a call that does not exist. Asking a real mod costs one
 * object and turns the guess into a fact.
 */
const PROBE = createMod({
  name: "coverage probe",
  prefix: "coverage_probe",
  supportedVersion: `v${SUPPORTED_STELLARIS_BUILD}`,
}) as unknown as Record<string, unknown>;

function methodFor(registry: string): string {
  const method = registry.replace(/_(.)/g, (_match, letter: string) => letter.toUpperCase());
  if (typeof PROBE[method] !== "function") {
    throw new Error(
      `The coverage page would print "mod.${method}" for the ${registry} registry, but a mod ` +
        `has no such method. Either the capability was renamed, or the registry name no longer ` +
        `camel-cases to its call.`
    );
  }
  return method;
}

/** `common/`, the game's script-content root, with the trailing separator. */
const SCRIPT_ROOT = "common/";

/** Script content is `.txt`; the stray `.csv`/`.json`/`.ods` under `common/` is data, not script. */
const SCRIPT_EXTENSION = ".txt";

function parentOf(folder: string): string {
  return folder.slice(0, folder.lastIndexOf("/"));
}

/**
 * The reference section, by collection id.
 *
 * The section index is `reference`, not `reference/index` — Astro's loader
 * strips the file name — so a bare `startsWith("reference/")` misses the one
 * page that most obviously belongs to the section.
 */
function isReferencePage(id: string): boolean {
  return id === "reference" || id.startsWith("reference/");
}

/** Every folder that directly holds a file, from a flat list of file paths. */
export function foldersHoldingFiles(
  paths: readonly string[],
  extension?: string
): ReadonlySet<string> {
  const folders = new Set<string>();
  for (const path of paths) {
    if (extension !== undefined && !path.endsWith(extension)) continue;
    const cut = path.lastIndexOf("/");
    if (cut > 0) folders.add(path.slice(0, cut));
  }
  return folders;
}

/**
 * The game concepts under `common/`, one location each.
 *
 * Usually a location is a folder: a folder holding script files is a concept,
 * except when its parent holds script files too, in which case the child is the
 * parent's own file layout rather than a separate thing
 * (`common/inline_scripts/ai` is inline scripts, filed; `common/random_names/base`
 * is random names, filed). The exception to the exception is where the supported
 * line runs between the two: `common/technology/category` is not technology and
 * `common/governments/civics` is not governments, and those are exactly the
 * distinctions this page reports.
 *
 * Some are a single file at the root instead. The game keeps a few types in one
 * file rather than a folder — the rules declare `alert` and `achievement` with a
 * `path_file` under `game/common` — and a folder-only walk would fold those into
 * `common/` and drop them, leaving real unsupported concepts off a page whose
 * whole job is to list them. So a `.txt` sitting directly in `common/` is its
 * own row. Two of the four are the game's own notes to modders rather than
 * content, and they show; naming them to filter them would be exactly the
 * hand-kept list this derivation exists to avoid, and a reader loses nothing by
 * seeing that the SDK cannot author a readme.
 *
 * `common/` itself is the scope, never a concept, so nothing collapses into it.
 */
export function scriptConcepts(
  paths: readonly string[],
  claimed: ReadonlySet<string>
): readonly string[] {
  const folders = foldersHoldingFiles(paths, SCRIPT_EXTENSION);
  const concepts: string[] = [];
  for (const folder of folders) {
    if (!folder.startsWith(SCRIPT_ROOT)) continue;
    const parent = parentOf(folder);
    const collapses =
      parent !== "common" && folders.has(parent) && !claimed.has(folder) && !claimed.has(parent);
    if (!collapses) concepts.push(folder);
  }
  for (const path of paths) {
    if (!path.startsWith(SCRIPT_ROOT) || !path.endsWith(SCRIPT_EXTENSION)) continue;
    if (!path.slice(SCRIPT_ROOT.length).includes("/")) concepts.push(path);
  }
  return concepts.sort();
}

/**
 * Registry rows, and the gate.
 *
 * Kept separate from the folder diff so that it can be exercised on inputs it
 * would take a doctored install to produce.
 */
export function coverRegistries(
  registries: readonly { readonly registry: string; readonly folder: string }[],
  pages: readonly ReferencePage[],
  undocumented: Readonly<Record<string, string>>
): readonly RegistryCoverageRow[] {
  const known = new Set(registries.map((entry) => entry.registry));

  const pagesByRegistry = new Map<string, ReferencePage>();
  for (const page of pages) {
    const isReference = isReferencePage(page.id);
    if (isReference && page.registries === undefined) {
      throw new Error(
        `The reference page "${page.id}" declares no "registries" frontmatter. Every page under ` +
          `reference/ states which registries it documents, and an index page states an empty ` +
          `list — that is what makes the coverage gate derivable rather than guessed.`
      );
    }
    // The frontmatter key is on the whole docs collection, because the schema
    // cannot see a page's route. The invariant it serves is narrower: a
    // registry is owned by a reference page. A guide claiming one would satisfy
    // the gate and put a /guides/ link in the reference table, so it is an
    // error rather than something to quietly ignore — the guide almost
    // certainly meant to cross-link, which is prose, not frontmatter.
    if (!isReference && page.registries !== undefined) {
      throw new Error(
        `The page "${page.id}" declares "registries" frontmatter, but only pages under reference/ ` +
          `document a registry. Delete the key: to point at a registry from a guide, link to its ` +
          `reference page.`
      );
    }
    for (const registry of page.registries ?? []) {
      if (!known.has(registry)) {
        throw new Error(
          `The page "${page.id}" says it documents a registry named "${registry}", which the SDK ` +
            `does not expose. Registry names are the ones in CONTENT_REGISTRIES.`
        );
      }
      const claimed = pagesByRegistry.get(registry);
      if (claimed !== undefined) {
        throw new Error(
          `Both "${claimed.id}" and "${page.id}" document the ${registry} registry. One page owns ` +
            `a registry, so that the reference has one place to link to.`
        );
      }
      pagesByRegistry.set(registry, page);
    }
  }

  for (const registry of Object.keys(undocumented)) {
    if (!known.has(registry)) {
      throw new Error(
        `UNDOCUMENTED_REGISTRIES lists "${registry}", which the SDK does not expose. Delete the ` +
          `line: the registry it excused is gone.`
      );
    }
    if (pagesByRegistry.has(registry)) {
      throw new Error(
        `UNDOCUMENTED_REGISTRIES still excuses "${registry}", but "${
          pagesByRegistry.get(registry)?.id
        }" documents it. Delete the line.`
      );
    }
  }

  const missing = registries
    .map((entry) => entry.registry)
    .filter((registry) => !pagesByRegistry.has(registry) && undocumented[registry] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `No reference page documents ${missing.join(", ")}, and UNDOCUMENTED_REGISTRIES does not ` +
        `excuse ${missing.length === 1 ? "it" : "them"}. Write the page, or add a line saying ` +
        `which ticket will.`
    );
  }

  return registries.map((entry) => {
    const page = pagesByRegistry.get(entry.registry);
    return {
      registry: entry.registry,
      method: methodFor(entry.registry),
      folder: entry.folder,
      ...(page === undefined
        ? { undocumented: undocumented[entry.registry] }
        : { page: { href: page.href, title: page.title } }),
    };
  });
}

/**
 * The whole coverage answer, and the gate that guards it.
 *
 * Throws on any gap the site is supposed to have closed, which fails the docs
 * build — the gate has teeth only because this runs during `astro build`.
 */
export function buildCoverage(pages: readonly ReferencePage[]): Coverage {
  const rows = CONTENT_REGISTRIES.map((descriptor) => ({
    registry: descriptor.type as string,
    folder: descriptor.outputDir as string,
  }));

  const claimed = new Set<string>([
    ...rows.map((row) => row.folder),
    ...CHANNELS.flatMap((channel) => channel.folders),
  ]);

  // A registry writing to a folder the install does not have is not a docs
  // problem, but this is where the two lists meet, so it is where it shows.
  const installFolders = foldersHoldingFiles(VANILLA_PATHS);
  const stray = [...claimed].filter((folder) => !installFolders.has(folder)).sort();
  if (stray.length > 0) {
    throw new Error(
      `Stellaris ${VANILLA_PATH_GAME_VERSION} has no ${stray.join(", ")}, but the SDK writes ` +
        `${stray.length === 1 ? "there" : "to them"}. The game moved a folder, or the SDK never ` +
        `had it right.`
    );
  }

  return {
    gameVersion: VANILLA_PATH_GAME_VERSION,
    registries: coverRegistries(rows, pages, UNDOCUMENTED_REGISTRIES),
    channels: CHANNELS,
    unsupported: scriptConcepts(VANILLA_PATHS, claimed).filter((folder) => !claimed.has(folder)),
  };
}

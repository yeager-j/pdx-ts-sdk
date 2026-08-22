/**
 * Emitted TypeScript, and the one gate every identifier passes to get there.
 *
 * {@link assertVanillaIdentifier} is the licensing chokepoint. The package is
 * allowed to carry the *names* Paradox's files define and nothing else — no
 * script bodies, no localized text, no descriptions, no asset data — and the
 * only way to keep that true as the generator grows is to make it impossible to
 * write a string into an emitted file without passing it here first. Every
 * quoted literal in every emitter goes through {@link Chokepoint.literal},
 * which asserts and then quotes.
 *
 * The rejections are shaped after what a leak would actually look like: a
 * localisation sentence, a line of script, a fragment of a body. A name has no
 * braces, no `=`, no `$`, no quotes, no newlines, at most a couple of spaces,
 * and is short.
 *
 * {@link assertVanillaPath} is the same gate for the one emitted string that
 * is a path rather than a name — the install's path inventory. Two doors, one
 * counter: {@link Chokepoint} is still the only way a string reaches emitted
 * text, and the report's "identifiers checked" counts what went through both.
 */

import type { RuleScopes } from "@pdx-ts/codegen-cwt/lower/scope-facts";
import {
  camelCase,
  pascalCase,
  kebabCase as registryStem,
  safeIdentifier,
} from "@pdx-ts/codegen-cwt/naming";
import { compareUtf8 } from "@pdx-ts/sdk";

import type { ScriptedDefinition } from "./read-scripted.ts";
import type { TrieNode } from "./trie.ts";

/**
 * Longest a real identifier gets; anything longer reads as prose.
 *
 * Measured, not guessed: across the whole 4.4.6 install the longest identifier
 * any of these registries defines is 84 characters
 * (`GFX_species_selected_background_trait_machine_pc_shattered_ring_habitable_preference`),
 * so a bound of 80 rejects real vanilla names. This is a backstop for "a whole
 * body slipped through" rather than the load-bearing rule — the forbidden
 * characters and the space limit are what actually separate a name from a
 * sentence — so it sits above the observed maximum with room for a patch to add
 * a longer one.
 */
const MAX_LENGTH = 120;

/** Characters no identifier contains, each of which script and prose do. */
const FORBIDDEN = ["\n", "\r", "\t", "{", "}", "=", '"', "$", "#"];

/** `has_country_flag = x`, `count < 3` — an assignment or comparison, not a name. */
const SCRIPT_SHAPE = /\w+\s*(=|<|>)/;

/**
 * Passes an identifier through, or throws naming what it was and where it came
 * from. Never returns a "safe" substitute: a silently repaired name would be a
 * wrong id emitted as a right-looking one.
 */
export function assertVanillaIdentifier(candidate: string, context: string): string {
  const reject = (reason: string): never => {
    throw new Error(
      `${context}: refusing to emit ${JSON.stringify(candidate.slice(0, 120))} — ${reason}. ` +
        "The vanilla package carries identifiers only; this looks like game content."
    );
  };
  if (candidate === "") {
    reject("empty");
  }
  if (candidate.length > MAX_LENGTH) {
    reject(`${candidate.length} characters, over the ${MAX_LENGTH} an identifier takes`);
  }
  for (const character of FORBIDDEN) {
    if (candidate.includes(character)) {
      reject(`contains ${JSON.stringify(character)}`);
    }
  }
  if ((candidate.match(/ /g) ?? []).length > 2) {
    reject("more spaces than a name has");
  }
  if (SCRIPT_SHAPE.test(candidate)) {
    reject("reads as a script assignment or comparison");
  }
  return candidate;
}

/**
 * Characters no path contains, spelled out rather than borrowed.
 *
 * Nearly the identifier list, and the one difference is the reason this is its
 * own array: `$` is legal in a path. Vanilla ships inline-script template
 * filenames that use it —
 * `common/inline_scripts/trait/icon_element/council_no_$CLASS$.txt` is the
 * only one in 4.4.6, and a patch may add more — so forbidding it would refuse
 * a real file rather than catch a leak. Braces, `=`, quotes, and the newline
 * characters are what actually separate a path from prose or a line of script,
 * and they all stay.
 */
const FORBIDDEN_IN_PATH = ["\n", "\r", "\t", "{", "}", "=", '"', "#", "\\"];

/** The longest a single path component gets on any filesystem the game runs on. */
const MAX_COMPONENT_BYTES = 255;

/** A leading drive letter — `C:/gfx` is a machine's path, not the game's. */
const DRIVE_SHAPE = /^[A-Za-z]:/;

const UTF8 = new TextEncoder();

/**
 * Passes a path through, or throws naming what it was and where it came from.
 *
 * The same gate as {@link assertVanillaIdentifier} and a different shape,
 * because a path is not an identifier: it has `/` separators, it can be long,
 * it may carry a `$` ({@link FORBIDDEN_IN_PATH}), and vanilla is full of names
 * like `flags/backgrounds/00 solid.dds` that spend more spaces than any id
 * would. What stays is the part that separates a name from content — no
 * braces, no `=`, no quotes, no newlines — plus what separates a *relative*
 * path inside the game from anything else: no absolute root, no drive letter,
 * no `.` or `..` to resolve, no empty component. Backslashes are refused
 * rather than rewritten to `/`, for the reason the identifier gate never
 * repairs either: a silently corrected path is a wrong path emitted as a
 * right-looking one.
 */
export function assertVanillaPath(candidate: string, context: string): string {
  const reject = (reason: string): never => {
    throw new Error(
      `${context}: refusing to emit ${JSON.stringify(candidate.slice(0, 120))} — ${reason}. ` +
        "The vanilla package carries path names only; this looks like game content."
    );
  };
  if (candidate === "") {
    reject("empty");
  }
  for (const character of FORBIDDEN_IN_PATH) {
    if (candidate.includes(character)) {
      reject(`contains ${JSON.stringify(character)}`);
    }
  }
  if (candidate.startsWith("/") || DRIVE_SHAPE.test(candidate)) {
    reject("is absolute; the inventory carries install-relative paths");
  }
  for (const component of candidate.split("/")) {
    if (component === "") {
      reject('has an empty component (a leading, trailing, or doubled "/")');
    }
    if (component === "." || component === "..") {
      reject(`contains a ${JSON.stringify(component)} component`);
    }
    const bytes = UTF8.encode(component).length;
    if (bytes > MAX_COMPONENT_BYTES) {
      reject(`has a ${bytes}-byte component, over the ${MAX_COMPONENT_BYTES} a filename takes`);
    }
  }
  return candidate;
}

/**
 * Byte order, not locale order. Emission has to be reproducible on every
 * machine, and `localeCompare` is not: it treats `_` and case differently
 * depending on the environment's collation.
 */
export function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Counts what the gate has seen, so the report can show it ran. */
export interface Chokepoint {
  /** Asserts, then quotes. The only way a string reaches emitted text. */
  literal(candidate: string, context: string): string;
  /** The same, for the one kind of string that is a path rather than a name. */
  pathLiteral(candidate: string, context: string): string;
  readonly checked: () => number;
}

export function createChokepoint(): Chokepoint {
  // One counter for both doors. The report's number answers "how many strings
  // did the gate inspect", and a path inspected by the other assertion is
  // still a string the gate inspected.
  let seen = 0;
  return {
    literal(candidate, context) {
      seen += 1;
      return JSON.stringify(assertVanillaIdentifier(candidate, context));
    },
    pathLiteral(candidate, context) {
      seen += 1;
      return JSON.stringify(assertVanillaPath(candidate, context));
    },
    checked: () => seen,
  };
}

export function header(gameVersion: string): string {
  return `// Generated by @pdx-ts/codegen-vanilla from Stellaris ${gameVersion}. Do not edit.\n\n`;
}

/**
 * A vanilla file or directory name as a TypeScript file stem.
 *
 * Underscores only, deliberately: bucket keys are the install's own file and
 * directory names, and `registries/pdxmesh/Magnetic_Aurora.ts` is meant to be
 * recognisable as the file it came from. Registry names go through
 * {@link registryStem} instead, which also splits camel humps.
 */
export function kebabCase(name: string): string {
  return name.replaceAll("_", "-");
}

export function idTypeName(registry: string): string {
  return `Vanilla${pascalCase(registry)}Id`;
}

export function enumTypeName(name: string): string {
  return `Vanilla${pascalCase(name)}Member`;
}

export function trieTypeName(registry: string): string {
  return `Vanilla${pascalCase(registry)}Trie`;
}

export function scriptedTypeName(registry: string): string {
  return `Vanilla${pascalCase(registry)}Params`;
}

/**
 * `sprite` -> `SpriteRef`, the SDK's branded reference for a CWT reference name.
 *
 * Takes the reference name rather than the registry, because the two differ
 * wherever the manifest renames or narrows: `spriteType`'s ids wear `SpriteRef`,
 * `pdxmesh`'s wear `ModelMeshRef`. Mirrors `codegen-cwt`'s `refTypeName`.
 */
export function refTypeName(referenceName: string): string {
  return `${pascalCase(referenceName)}Ref`;
}

export function registryFile(registry: string): string {
  return `registries/${registryStem(registry)}.ts`;
}

export function enumFile(name: string): string {
  return `enums/${kebabCase(name)}.ts`;
}

export function trieIndexFile(registry: string): string {
  return `registries/${registryStem(registry)}/index.ts`;
}

/**
 * The plural file the scripted parameter table lands in — `scripted_trigger`
 * defines many scripted triggers, and the interface is the whole table.
 */
export function scriptedFile(registry: string): string {
  return `${kebabCase(registry)}s.ts`;
}

export function emitIdUnion(
  registry: string,
  ids: readonly string[],
  gate: Chokepoint,
  gameVersion: string
): string {
  const context = `${registry} id`;
  const union = ids.length === 0 ? "never" : ids.map((id) => gate.literal(id, context)).join(" | ");
  return `${header(gameVersion)}export type ${idTypeName(registry)} = ${union};\n`;
}

export function emitEnumUnion(
  name: string,
  members: readonly string[],
  gate: Chokepoint,
  gameVersion: string
): string {
  const union =
    members.length === 0
      ? "never"
      : members.map((member) => gate.literal(member, `${name} member`)).join(" | ");
  return `${header(gameVersion)}export type ${enumTypeName(name)} = ${union};\n`;
}

export interface TrieEmission {
  /** Emitted path -> file text, the bucket files and the registry's index. */
  readonly files: ReadonlyMap<string, string>;
  /** Every exported type name, so the barrel can re-export them. */
  readonly exports: readonly { readonly name: string; readonly file: string }[];
}

/**
 * The trie as files: one per top-level bucket, plus the registry's index.
 *
 * The emitted layout follows the buckets, which follow vanilla's own files —
 * `registries/sprite-type/eventpictures.ts` holds what `interface/eventpictures.gfx`
 * defines, `registries/sound/toxoids.ts` holds the whole `sound/toxoids/`
 * subtree. A bucket's subtree is written inline inside its file however deep it
 * goes: splitting it further would name files after something other than the
 * game's own layout, which is the one thing making a regeneration diff readable.
 *
 * Ids from a file that names no bucket at all are leaves at the root, so they
 * are written into the index directly rather than becoming hundreds of one-line
 * files.
 */
export function emitTrie(
  registry: string,
  referenceName: string,
  buckets: ReadonlyMap<string, TrieNode>,
  gate: Chokepoint,
  gameVersion: string
): TrieEmission {
  const context = `${registry} trie key`;
  const reference = refTypeName(referenceName);
  const root = trieTypeName(registry);
  const takenNames = new Set<string>([root]);
  // `index` is the registry's own index file, and two keys can mangle onto one
  // stem on a case-insensitive filesystem (`GFX_ship` and `gfx-ship`).
  const takenStems = new Set<string>(["index"]);

  /**
   * One node as a type.
   *
   * A node is a leaf, a branch, or both — an id spelled like the file or
   * directory its neighbours live in. The intersection is what makes the third
   * case navigable *and* usable: `.id` reads the id, and the remaining keys
   * keep descending.
   */
  const render = (node: TrieNode): string => {
    const members: string[] = [];
    if (node.id !== null) {
      members.push(`readonly id: ${gate.literal(node.id, `${context} leaf`)};`);
    }
    for (const [key, child] of node.children) {
      members.push(`readonly ${gate.literal(key, context)}: ${render(child)};`);
    }
    const body = `{\n${members.join("\n")}\n}`;
    return node.id === null ? body : `${reference} & ${body}`;
  };

  const dir = `registries/${registryStem(registry)}`;
  const files = new Map<string, string>();
  const imports: string[] = [];
  const rootMembers: string[] = [];
  let rootLeaves = false;
  for (const [key, node] of buckets) {
    const quoted = gate.literal(key, context);
    if (node.children.size === 0) {
      rootLeaves = true;
      rootMembers.push(`readonly ${quoted}: ${render(node)};`);
      continue;
    }
    const name = unique(`${root}${pascalCase(key)}`, takenNames);
    const stem = unique(kebabCase(key), takenStems);
    files.set(
      `${dir}/${stem}.ts`,
      `${header(gameVersion)}import type { ${reference} } from "@pdx-ts/sdk";\n\n` +
        `export type ${name} = ${render(node)};\n`
    );
    imports.push(`import type { ${name} } from "./${stem}.ts";\n`);
    rootMembers.push(`readonly ${quoted}: ${name};`);
  }

  files.set(
    trieIndexFile(registry),
    header(gameVersion) +
      (rootLeaves ? `import type { ${reference} } from "@pdx-ts/sdk";\n` : "") +
      imports.join("") +
      `\nexport interface ${root} {\n${rootMembers.join("\n")}\n}\n`
  );
  // Only the root is public API. The per-bucket types are structural
  // intermediates the root already reaches; re-exporting a hundred of them
  // from the barrel would make the package's surface the trie's shape.
  return { files, exports: [{ name: root, file: trieIndexFile(registry) }] };
}

export function emitScriptedParams(
  registry: string,
  definitions: readonly ScriptedDefinition[],
  gate: Chokepoint,
  gameVersion: string
): string {
  const members = definitions.map((definition) => {
    const name = gate.literal(definition.name, `${registry} name`);
    const params = definition.params.map((param) => {
      const key = gate.literal(param.name, `${registry} ${definition.name} parameter`);
      return `readonly ${key}${param.optional ? "?" : ""}: string | number;`;
    });
    const shape = params.length === 0 ? "{}" : `{\n${params.join("\n")}\n}`;
    return `readonly ${name}: ${shape};`;
  });
  return (
    `${header(gameVersion)}export interface ${scriptedTypeName(registry)} {\n` +
    `${members.join("\n")}\n}\n`
  );
}

/**
 * The subpath a registry's bindings ship under: `scripted_trigger` becomes
 * `./triggers`, `scripted_effect` becomes `./effects`. The params table already
 * owns `scripted-triggers.ts`, and these are a different thing — the callable
 * bindings rather than the interface behind them.
 */
export function bindingsFile(registry: string): string {
  return `${registry.replace(/^scripted_/, "")}s.ts`;
}

export interface BindingsEmission {
  readonly code: string;
  /** Definitions whose camelCased name collided and took a numbered suffix. */
  readonly renamed: readonly string[];
  /** Scope-set size -> how many bindings landed on it; 0 is unconstrained. */
  readonly bySize: ReadonlyMap<number, number>;
}

/**
 * One callable binding per definition, with the scope the inference derived.
 *
 * Emitted as a call rather than a spelled-out signature so the diff reads as
 * the two facts a reviewer needs — the script name and the scope claimed for it
 * — and the parameter types come from the merged params table rather than being
 * restated. `@pdx-ts/sdk`'s `scriptedTrigger` resolves the rest.
 *
 * `/*#__PURE__*\/` because a mod imports a handful of these out of ~1,600 and
 * a bundler must be free to drop the rest.
 */
export function emitScriptedBindings(
  registry: string,
  definitions: readonly ScriptedDefinition[],
  scopes: ReadonlyMap<string, RuleScopes>,
  gate: Chokepoint,
  gameVersion: string
): BindingsEmission {
  const factory = registry === "scripted_trigger" ? "scriptedTrigger" : "scriptedEffect";
  const taken = new Set<string>([factory]);
  const renamed: string[] = [];
  const bySize = new Map<number, number>();
  const lines: string[] = [];

  for (const definition of definitions) {
    const scope = scopes.get(definition.name.toLowerCase()) ?? "universal";
    const size = scope === "universal" ? 0 : scope.length;
    bySize.set(size, (bySize.get(size) ?? 0) + 1);

    // Lowercased first, because a handful of vanilla names shout a whole
    // segment (`can_destroy_planet_with_PLANET_KILLER_CRACKER`) or the lot
    // (`STORM_FEVER_ENABLE_CHALLENGE_2`), and camelCasing those as written
    // yields `sTORMFEVERENABLECHALLENGE2`. Only the identifier changes; the
    // emitted string stays the name the game reads.
    const candidate = safeIdentifier(camelCase(definition.name.toLowerCase()));
    const identifier = unique(candidate, taken);
    if (identifier !== candidate) {
      renamed.push(`${definition.name} -> ${identifier} (${candidate} was taken)`);
    }

    // Scope names come from cwtools' `scopes.cwt`, not from a game file, so
    // they are not what the gate was written to catch — but they are literals
    // reaching emitted text, and the one rule here is that all of those are
    // inspected. The context string keeps them legible in an audit.
    const claim =
      scope === "universal"
        ? gate.literal("any", "inferred scope")
        : scope.length === 1
          ? gate.literal(scope[0]!, "inferred scope")
          : `[${scope.map((one) => gate.literal(one, "inferred scope")).join(", ")}]`;

    lines.push(
      `export const ${identifier} = /*#__PURE__*/ ${factory}(` +
        `${gate.literal(definition.name, `${registry} name`)}, ${claim});`
    );
  }

  return {
    code:
      header(gameVersion) +
      `import { ${factory} } from "@pdx-ts/sdk";\n\n` +
      `${lines.join("\n")}\n`,
    renamed,
    bySize,
  };
}

/**
 * The install's path inventory as one frozen array.
 *
 * Data rather than a type, and that is the point: the SDK asks "does vanilla
 * occupy this path" at build time, which is a lookup over tens of thousands of
 * strings, not a union a compiler should be asked to hold. It ships behind its
 * own `./paths` subpath so that nothing but a caller that wants the inventory
 * ever loads it.
 *
 * Only names cross. The scan that produced these read directory entries and
 * zip central directories — never a file's contents, its size, or its hash —
 * and every string here passes {@link assertVanillaPath} on the way in.
 */
export function emitVanillaPaths(
  paths: readonly string[],
  gate: Chokepoint,
  gameVersion: string
): string {
  // `compareUtf8`, not `compareIdentifiers`: the inventory's contract is the
  // canonical byte order the scanner and the SDK's ledger already use, and
  // JavaScript's `<` is UTF-16 code-unit order, which disagrees for
  // supplementary-plane characters. Identical for the ASCII vanilla ships
  // today, and the point is that it stays right when that changes.
  const unique = [...new Set(paths)].sort(compareUtf8);
  const lines = unique.map((one) => `  ${gate.pathLiteral(one, "vanilla path")},\n`).join("");
  return (
    header(gameVersion) +
    `export const VANILLA_PATH_GAME_VERSION = ${gate.literal(gameVersion, "game version")};\n\n` +
    "export const VANILLA_PATHS: readonly string[] = /*#__PURE__*/ Object.freeze([\n" +
    `${lines}]);\n`
  );
}

/**
 * The ids of the mint-shaped registries, as runtime sets rather than as types.
 *
 * Same content as those registries' emitted id unions, in the one other form
 * the SDK needs it: `buildMod` refuses a minted name that a vanilla definition
 * already carries, and that is a lookup at build time rather than a question
 * for a compiler. Nothing new crosses the licensing boundary — every string
 * here is an id this package already ships as a type, through the same gate —
 * but it is real runtime payload, so it lives behind its own `./gfx-ids`
 * subpath and is not re-exported from the root, exactly as `./paths` is.
 *
 * One record rather than one constant per registry: the SDK reads it as a table
 * keyed by registry name, so a registry added upstream needs no SDK change to
 * be checked.
 */
export function emitVanillaGfxIds(
  sets: readonly { readonly registry: string; readonly ids: readonly string[] }[],
  gate: Chokepoint,
  gameVersion: string
): string {
  const members = sets
    .map(({ registry, ids }) => {
      const context = `${registry} id`;
      const lines = [...ids]
        .sort(compareUtf8)
        .map((id) => `    ${gate.literal(id, context)},\n`)
        .join("");
      return (
        `  ${gate.literal(registry, "registry name")}: /*#__PURE__*/ Object.freeze([\n` +
        `${lines}  ]),\n`
      );
    })
    .join("");
  return (
    header(gameVersion) +
    `export const VANILLA_GFX_ID_GAME_VERSION = ${gate.literal(gameVersion, "game version")};\n\n` +
    "export const VANILLA_GFX_IDS: Readonly<Record<string, readonly string[]>> = " +
    "/*#__PURE__*/ Object.freeze({\n" +
    `${members}});\n`
  );
}

export interface TablesPlan {
  /** Registry name -> its id union type and the file it lives in. */
  readonly ids: readonly { readonly registry: string; readonly file: string }[];
  /** Registry name -> its trie root type and file, for oversized registries. */
  readonly tries: readonly { readonly registry: string; readonly file: string }[];
  readonly enums: readonly { readonly name: string; readonly file: string }[];
  /** SDK table name -> the emitted params interface, e.g. scripted triggers. */
  readonly scripted: readonly {
    readonly target: string;
    readonly registry: string;
    readonly file: string;
  }[];
}

/** Every table the SDK reads, in the order they are emitted. */
export const TABLE_NAMES = [
  "VanillaIds",
  "VanillaEnums",
  "VanillaScriptedTriggers",
  "VanillaScriptedEffects",
  "VanillaTries",
] as const;

/**
 * The lookup tables the SDK resolves every vanilla reference through.
 *
 * Ordinary exported interfaces rather than a `declare module "@pdx-ts/sdk"`
 * augmentation: the SDK imports this package (ADR-0006), so the types travel
 * along the import rather than being merged into empty placeholders from the
 * outside. Every table is emitted even when it has no members, because the SDK
 * imports all five by name and a table that appears only when non-empty makes
 * an empty install a compile error in the SDK rather than an empty union here.
 */
export function emitTables(plan: TablesPlan, gate: Chokepoint, gameVersion: string): string {
  const imports = [
    ...plan.ids.map(({ registry, file }) => ({ name: idTypeName(registry), file })),
    ...plan.tries.map(({ registry, file }) => ({ name: trieTypeName(registry), file })),
    ...plan.enums.map(({ name, file }) => ({ name: enumTypeName(name), file })),
    ...plan.scripted.map(({ registry, file }) => ({ name: scriptedTypeName(registry), file })),
  ]
    .map(({ name, file }) => `import type { ${name} } from "./${file}";\n`)
    .join("");

  const idMembers = plan.ids
    .map(
      ({ registry }) =>
        `readonly ${gate.literal(registry, "registry name")}: ${idTypeName(registry)};`
    )
    .join("\n");
  const trieMembers = plan.tries
    .map(
      ({ registry }) =>
        `readonly ${gate.literal(registry, "registry name")}: ${trieTypeName(registry)};`
    )
    .join("\n");
  const enumMembers = plan.enums
    .map(({ name }) => `readonly ${gate.literal(name, "enum name")}: ${enumTypeName(name)};`)
    .join("\n");
  const scripted = new Map(
    plan.scripted.map((row) => [row.target, scriptedTypeName(row.registry)])
  );

  const table = (name: string, members: string): string => {
    const base = scripted.get(name);
    if (base !== undefined) {
      return `export interface ${name} extends ${base} {}\n`;
    }
    return `export interface ${name} {\n${members}\n}\n`;
  };

  return (
    header(gameVersion) +
    imports +
    "\n" +
    table("VanillaIds", idMembers) +
    table("VanillaEnums", enumMembers) +
    table("VanillaScriptedTriggers", "") +
    table("VanillaScriptedEffects", "") +
    table("VanillaTries", trieMembers)
  );
}

/**
 * The barrel. Every export is type-only, so the emitted JavaScript is an empty
 * module — the package is types and a version number. The tables come first
 * because they are what `@pdx-ts/sdk` imports; the per-registry unions are
 * re-exported for authors who want to name one directly.
 */
export function emitIndex(
  exports: readonly { readonly name: string; readonly file: string }[],
  gameVersion: string
): string {
  const tables = `export type { ${TABLE_NAMES.join(", ")} } from "./tables.ts";\n`;
  const lines = [...exports]
    .sort((left, right) => compareIdentifiers(left.name, right.name))
    .map(({ name, file }) => `export type { ${name} } from "./${file}";\n`)
    .join("");
  return `${header(gameVersion)}${tables}\n${lines}`;
}

/**
 * Two bucket keys can mangle onto one type name or one file stem — `GFX_ship`
 * and `gfx-ship` share both. Buckets are walked in sorted order, so the
 * numbering is deterministic rather than machine-dependent.
 */
function unique(candidate: string, taken: Set<string>): string {
  let name = candidate;
  let suffix = 2;
  while (taken.has(name)) {
    name = `${candidate}${suffix}`;
    suffix += 1;
  }
  taken.add(name);
  return name;
}

/**
 * Emits the scope-aware modifier key interfaces.
 *
 * The join is two vendored tables: the game's own modifier dump names every
 * modifier the engine knows (including the generated economic-category and
 * per-ship-size products no curated list can carry), and
 * `modifier_categories.cwt` maps each category onto the scopes it applies in.
 * Names are partitioned by their exact scope set, so each name is declared on
 * exactly one interface and the per-scope blocks compose by `extends`.
 */

import type { RuleSet } from "../cwt/rules.ts";
import type { ModifierDocs } from "../logs/modifier-docs.ts";
import { docComment, pascalCase } from "../naming.ts";
import { UNIVERSAL_SCOPES } from "../overlay.ts";

/** Resolves a raw scope token to its canonical name, or `null` if unknown. */
export type CanonicalScope = (token: string) => string | null;

export interface ModifierJoin {
  /** Names in an `any`-scoped category (`All`, `Economic Units`): valid everywhere. */
  readonly universal: readonly string[];
  /** Sorted-scope-set key (`"colony country"`) -> the names valid exactly there. */
  readonly groups: ReadonlyMap<string, readonly string[]>;
  /** Names that reached no scope at all — a category table gap, gated as drift. */
  readonly unscoped: readonly string[];
  /** Categories the dump or `modifiers.cwt` name that the category table lacks. */
  readonly unknownCategories: readonly string[];
}

export function joinModifierScopes(
  rules: RuleSet,
  docs: ModifierDocs,
  canonical: CanonicalScope
): ModifierJoin {
  const categoryScopes = new Map<string, "any" | ReadonlySet<string>>();
  for (const [category, tokens] of rules.modifierCategories) {
    if (tokens.some((token) => UNIVERSAL_SCOPES.has(token))) {
      categoryScopes.set(category, "any");
      continue;
    }
    const scopes = new Set<string>();
    for (const token of tokens) {
      const scope = canonical(token);
      if (scope !== null) {
        scopes.add(scope);
      }
    }
    categoryScopes.set(category, scopes);
  }

  const unknownCategories = new Set<string>();
  const noteCategories = (categories: readonly string[]): void => {
    for (const category of categories) {
      if (!categoryScopes.has(category)) {
        unknownCategories.add(category);
      }
    }
  };
  for (const categories of rules.modifierDecls.values()) {
    noteCategories(categories);
  }

  const universal: string[] = [];
  const unscoped: string[] = [];
  const groups = new Map<string, string[]>();
  for (const [name, categories] of docs.modifiers) {
    noteCategories(categories);
    const scopes = new Set<string>();
    let any = false;
    for (const category of categories) {
      const resolved = categoryScopes.get(category);
      if (resolved === "any") {
        any = true;
      } else if (resolved !== undefined) {
        for (const scope of resolved) {
          scopes.add(scope);
        }
      }
    }
    if (any) {
      universal.push(name);
      continue;
    }
    if (scopes.size === 0) {
      unscoped.push(name);
      continue;
    }
    const key = [...scopes].sort().join(" ");
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }

  return {
    universal: universal.sort(),
    groups,
    unscoped: unscoped.sort(),
    unknownCategories: [...unknownCategories].sort(),
  };
}

export interface ModifierEmission {
  readonly code: string;
  readonly names: number;
  readonly universal: number;
  readonly groups: number;
  readonly scopes: number;
  /** Unique path-node interfaces after the trie DAG dedup. */
  readonly trieTypes: number;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function property(name: string): string {
  const key = IDENTIFIER.test(name) ? name : JSON.stringify(name);
  return `  readonly ${key}?: number;\n`;
}

function memberBlock(names: readonly string[]): string {
  return `{\n${[...names].sort().map(property).join("")}}\n`;
}

/**
 * The path trie behind the recorder surface: `m.country.unity.produces.mult(x)`.
 *
 * A flat interface with every valid name makes the editor build one enormous
 * completion menu — the 45k-entry list took seconds to open in practice. The
 * same names as a trie of path segments cap any single menu at the root's
 * fan-out (a few hundred), and identical subtrees (thousands of names end in
 * the same `produces`/`add`/`mult` tails) collapse into one interface each, so
 * the emitted types are ~50x fewer than the trie's nodes.
 */
interface TrieNode {
  terminal: boolean;
  readonly children: Map<string, TrieNode>;
}

function trieOf(names: Iterable<string>): TrieNode {
  const root: TrieNode = { terminal: false, children: new Map() };
  for (const name of names) {
    let node = root;
    for (const token of name.split("_").filter((part) => part !== "")) {
      let child = node.children.get(token);
      if (child === undefined) {
        child = { terminal: false, children: new Map() };
        node.children.set(token, child);
      }
      node = child;
    }
    node.terminal = true;
  }
  return root;
}

/** A terminal with no children is every plain leaf; it shares one setter type. */
const LEAF_SHAPE = "$|";

class TrieEmitter {
  private readonly shapeIds = new Map<string, number>();
  private readonly nodeIds = new WeakMap<TrieNode, number>();
  private readonly nodeShapes = new WeakMap<TrieNode, string>();
  private readonly emittedIds = new Set<number>();
  readonly lines: string[] = [];

  /** Assigns bottom-up structural ids so identical subtrees share one type. */
  private shapeOf(node: TrieNode): string {
    const cached = this.nodeShapes.get(node);
    if (cached !== undefined) {
      return cached;
    }
    const children = [...node.children.keys()].sort();
    const shape =
      (node.terminal ? "$|" : "") +
      children.map((token) => `${token}:${this.idOf(node.children.get(token)!)}`).join(",");
    this.nodeShapes.set(node, shape);
    return shape;
  }

  private idOf(node: TrieNode): number {
    const cached = this.nodeIds.get(node);
    if (cached !== undefined) {
      return cached;
    }
    const shape = this.shapeOf(node);
    let id = this.shapeIds.get(shape);
    if (id === undefined) {
      id = this.shapeIds.size;
      this.shapeIds.set(shape, id);
    }
    this.nodeIds.set(node, id);
    return id;
  }

  get uniqueTypes(): number {
    return this.shapeIds.size;
  }

  /** Emits the node's interface (and its children's, depth-first); returns its name. */
  emit(node: TrieNode): string {
    const shape = this.shapeOf(node);
    if (shape === LEAF_SHAPE) {
      return "ModifierSetter";
    }
    const id = this.idOf(node);
    const name = `ModifierPath${id}`;
    if (this.emittedIds.has(id)) {
      return name;
    }
    this.emittedIds.add(id);
    const props: string[] = [];
    if (node.terminal) {
      props.push("  (value: number): void;");
    }
    for (const token of [...node.children.keys()].sort()) {
      const child = this.emit(node.children.get(token)!);
      const key = IDENTIFIER.test(token) ? token : JSON.stringify(token);
      props.push(`  readonly ${key}: ${child};`);
    }
    this.lines.push(`interface ${name} {\n${props.join("\n")}\n}`);
    return name;
  }
}

export function emitModifiers(join: ModifierJoin): ModifierEmission {
  const groupNames = new Map<string, string>();
  for (const key of [...join.groups.keys()].sort()) {
    groupNames.set(key, `Modifiers_${key.split(" ").map(pascalCase).join("_")}`);
  }

  let code =
    docComment([
      "Modifiers valid in every scope: the `All` and `Economic Units` categories,",
      "which carry the generated economic modifiers like `country_unity_produces_mult`.",
    ]) + `export interface UniversalModifiers ${memberBlock(join.universal)}\n`;

  for (const [key, groupName] of groupNames) {
    code +=
      docComment([`Modifiers whose supported scopes are exactly: ${key.replaceAll(" ", ", ")}.`]) +
      `interface ${groupName} ${memberBlock(join.groups.get(key)!)}\n`;
  }

  const scopes = [...new Set([...join.groups.keys()].flatMap((key) => key.split(" ")))].sort();
  for (const scope of scopes) {
    const parents = [
      "UniversalModifiers",
      "CustomModifiers",
      ...[...groupNames].filter(([key]) => key.split(" ").includes(scope)).map(([, name]) => name),
    ];
    code +=
      docComment([`Every modifier name valid in \`${scope}\` scope.`]) +
      `export interface ${pascalCase(scope)}ModifierBlock extends ${parents.join(", ")} {}\n\n`;
  }

  code +=
    docComment(["The scopes the modifier tables cover, each with its full key set."]) +
    "export interface ModifierBlockByScope {\n" +
    scopes.map((scope) => `  readonly ${scope}: ${pascalCase(scope)}ModifierBlock;\n`).join("") +
    "}\n\n";

  code +=
    docComment([
      "Every modifier name the tables know, for positions the rules leave",
      "unscoped — a `static_modifier` body, a situation's `target_modifier`.",
    ]) +
    "export interface AnyScopeModifierBlock extends UniversalModifiers, CustomModifiers, " +
    `${[...groupNames.values()].join(", ")} {}\n\n`;

  code +=
    docComment([
      "The modifier keys valid in scope `S`.",
      "",
      "These flat interfaces exist for `raw()`'s name union and never type an",
      "object-literal position: one interface with every valid name makes the",
      "editor build a 45k-entry completion menu, which is why authoring goes",
      "through the recorder paths below instead.",
      "",
      "An unconstrained `S` means the rules pin no scope, not that the value must",
      "satisfy all of them at once — distributing there would intersect the",
      "per-scope key sets down to nothing, so it resolves to every known name.",
    ]) +
    "export type ScopedModifierBlock<S extends ScopeName> = [ScopeName] extends [S]\n" +
    "  ? AnyScopeModifierBlock\n" +
    "  : S extends keyof ModifierBlockByScope\n" +
    "    ? ModifierBlockByScope[S]\n" +
    "    : Readonly<Record<string, number>>;\n\n";

  code +=
    docComment(["Records one modifier assignment; the traversed path spells the flat name."]) +
    "export interface ModifierSetter {\n  (value: number): void;\n}\n\n";

  const trie = new TrieEmitter();
  const rootNames = new Map<string, string>();
  for (const scope of scopes) {
    const names = [
      ...join.universal,
      ...[...join.groups]
        .filter(([key]) => key.split(" ").includes(scope))
        .flatMap(([, names]) => names),
    ];
    rootNames.set(scope, trie.emit(trieOf(names)));
  }
  // The unscoped root: every name at once. Its subtrees are overwhelmingly the
  // ones the per-scope roots already emitted, so the DAG dedup absorbs almost
  // all of it.
  const anyScopeRoot = trie.emit(trieOf([...join.universal, ...[...join.groups.values()].flat()]));
  code += trie.lines.join("\n") + "\n\n";

  for (const scope of scopes) {
    code +=
      docComment([
        `Records modifiers valid in \`${scope}\` scope: each path segment completes`,
        "from a small menu, and the joined path is the game's flat modifier name.",
      ]) +
      `export interface ${pascalCase(scope)}ModifierRecorder extends ${rootNames.get(scope)} {\n` +
      "  /** Sets a modifier by its flat name, checked against every known name. */\n" +
      `  raw(name: keyof ${pascalCase(scope)}ModifierBlock & string, value: number): void;\n` +
      "  /** Sets a modifier by an arbitrary, unchecked name. */\n" +
      "  unchecked(name: string, value: number): void;\n" +
      "}\n\n";
  }

  code +=
    "export interface ModifierRecorderByScope {\n" +
    scopes.map((scope) => `  readonly ${scope}: ${pascalCase(scope)}ModifierRecorder;\n`).join("") +
    "}\n\n";

  code +=
    docComment([
      "The recorder for scopes the modifier tables do not cover: no path data,",
      "so only the by-name escape hatches.",
    ]) +
    "export interface UnscopedModifierRecorder {\n" +
    "  /** Sets a modifier by its flat name. */\n" +
    "  raw(name: string, value: number): void;\n" +
    "  /** Sets a modifier by an arbitrary, unchecked name. */\n" +
    "  unchecked(name: string, value: number): void;\n" +
    "}\n\n";

  code +=
    docComment([
      "Records any known modifier, for positions the rules leave unscoped.",
      "",
      "The paths of every scope at once — `m.country.unity.produces.mult(0.15)`",
      "and `m.planet.jobs.alloys.produces.mult(0.1)` both resolve here.",
    ]) +
    `export interface AnyScopeModifierRecorder extends ${anyScopeRoot} {\n` +
    "  /** Sets a modifier by its flat name, checked against every known name. */\n" +
    "  raw(name: keyof AnyScopeModifierBlock & string, value: number): void;\n" +
    "  /** Sets a modifier by an arbitrary, unchecked name. */\n" +
    "  unchecked(name: string, value: number): void;\n" +
    "}\n\n";

  code +=
    docComment([
      "The modifier recorder for scope `S`.",
      "",
      "An unconstrained `S` is checked first and without distributing: it means",
      "the rules pin no scope, so every path is legal. Distributing it instead",
      "would produce a union of every per-scope recorder with no member in",
      "common — not even `raw`, whose name parameter would intersect to `never`.",
    ]) +
    "export type ScopedModifierRecorder<S extends ScopeName> = [ScopeName] extends [S]\n" +
    "  ? AnyScopeModifierRecorder\n" +
    "  : S extends keyof ModifierRecorderByScope\n" +
    "    ? ModifierRecorderByScope[S]\n" +
    "    : UnscopedModifierRecorder;\n";

  return {
    code,
    names: join.universal.length + [...join.groups.values()].reduce((n, g) => n + g.length, 0),
    universal: join.universal.length,
    groups: join.groups.size,
    scopes: scopes.length,
    trieTypes: trie.uniqueTypes,
  };
}

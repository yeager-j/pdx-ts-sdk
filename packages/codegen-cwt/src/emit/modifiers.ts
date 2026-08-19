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
import {
  MODIFIER_FAMILY_OVERLAYS,
  SCRIPTED_MODIFIER_CATEGORY_MAP,
  UNIVERSAL_SCOPES,
} from "../overlay.ts";

/** Resolves a raw scope token to its canonical name, or `null` if unknown. */
export type CanonicalScope = (token: string) => string | null;

export interface DynamicModifierFamily {
  readonly family: string;
  readonly reference: string;
  readonly target: string;
  readonly placeholder: string;
  readonly scopeOperations: ReadonlyMap<string, readonly string[][]>;
  readonly operationTemplates: ReadonlyMap<string, string>;
}

interface DynamicModifierOperation {
  readonly path: string;
  readonly segments: readonly string[];
  readonly template: string;
  readonly categories: readonly string[];
}

export interface ModifierJoin {
  /** Names in an `any`-scoped category (`All`, `Economic Units`): valid everywhere. */
  readonly universal: readonly string[];
  /** Sorted-scope-set key (`"colony country"`) -> the names valid exactly there. */
  readonly groups: ReadonlyMap<string, readonly string[]>;
  /** Names that reached no scope at all — a category table gap, gated as drift. */
  readonly unscoped: readonly string[];
  /** Categories the dump or `modifiers.cwt` name that the category table lacks. */
  readonly unknownCategories: readonly string[];
  readonly dynamicFamilies: readonly DynamicModifierFamily[];
  /** Sound scope evidence for modifier categories, used by owned selectors. */
  readonly categoryScopes: ReadonlyMap<string, "any" | readonly string[]>;
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
  for (const template of rules.modifierTemplates) {
    noteCategories(template.categories);
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
    dynamicFamilies: MODIFIER_FAMILY_OVERLAYS.flatMap((family) => {
      const placeholder = `<${family.family}>`;
      const operations: DynamicModifierOperation[] = [];
      const seenPaths = new Set<string>();
      for (const template of rules.modifierTemplates) {
        const placeholderIndex = template.name.indexOf(placeholder);
        if (placeholderIndex < 0) {
          continue;
        }
        if (template.name.indexOf(placeholder, placeholderIndex + placeholder.length) >= 0) {
          throw new Error(
            `Dynamic modifier template has multiple placeholders: "${template.name}"`
          );
        }
        const suffix = template.name.slice(placeholderIndex + placeholder.length);
        if (!suffix.startsWith("_")) {
          throw new Error(`Dynamic modifier template suffix must start with _: "${template.name}"`);
        }
        const operationSuffix = suffix.slice(1);
        const segments = operationSuffix.split("_");
        if (operationSuffix.length === 0 || segments.some((token) => token.length === 0)) {
          throw new Error(`Unsupported dynamic modifier template shape "${template.name}"`);
        }
        const path = segments.join(".");
        if (seenPaths.has(path)) {
          throw new Error(`Duplicate dynamic modifier operation path "${path}"`);
        }
        seenPaths.add(path);
        operations.push({
          path,
          segments,
          template: template.name,
          categories: template.categories,
        });
      }
      if (operations.length === 0) {
        return [];
      }
      const scopeOperations = new Map<string, string[][]>();
      const operationTemplates = new Map<string, string>();
      for (const operation of operations) {
        operationTemplates.set(operation.path, operation.template);
        for (const category of operation.categories) {
          const scopes = categoryScopes.get(category);
          if (scopes === undefined || scopes === "any") {
            continue;
          }
          for (const scope of scopes) {
            const existing = scopeOperations.get(scope) ?? [];
            existing.push([...operation.segments]);
            scopeOperations.set(scope, existing);
          }
        }
      }
      scopeOperations.set(
        "any",
        operations.map((operation) => [...operation.segments])
      );
      return [
        {
          family: family.family,
          reference: family.reference,
          target: family.target,
          placeholder,
          scopeOperations,
          operationTemplates,
        },
      ];
    }),
    unknownCategories: [...unknownCategories].sort(),
    categoryScopes: new Map(
      [...categoryScopes].map(([category, scopes]) => [
        category,
        scopes === "any" ? "any" : [...scopes].sort(),
      ])
    ),
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

interface OperationTree {
  terminal: boolean;
  readonly children: Map<string, OperationTree>;
}

function operationMembers(operations: readonly string[][]): string {
  const tree: OperationTree = { terminal: false, children: new Map() };
  for (const operation of operations) {
    let current = tree;
    for (const token of operation) {
      let child = current.children.get(token);
      if (child === undefined) {
        child = { terminal: false, children: new Map() };
        current.children.set(token, child);
      }
      current = child;
    }
    current.terminal = true;
  }
  const render = (node: OperationTree): string => {
    if (node.children.size === 0) {
      return "ModifierSetter";
    }
    const members = `{ ${[...node.children]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `readonly ${key}: ${render(child)};`)
      .join(" ")} }`;
    return node.terminal ? `ModifierSetter & ${members}` : members;
  };
  return [...tree.children]
    .map(([key, child]) => `  readonly ${key}: ${render(child)};\n`)
    .join("");
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
  const rootNodes = new Map<string, TrieNode>();
  for (const scope of scopes) {
    const names = [
      ...join.universal,
      ...[...join.groups]
        .filter(([key]) => key.split(" ").includes(scope))
        .flatMap(([, names]) => names),
    ];
    const root = trieOf(names);
    rootNodes.set(scope, root);
    rootNames.set(scope, trie.emit(root));
  }
  // The unscoped root: every name at once. Its subtrees are overwhelmingly the
  // ones the per-scope roots already emitted, so the DAG dedup absorbs almost
  // all of it.
  const anyRoot = trieOf([...join.universal, ...[...join.groups.values()].flat()]);
  const anyScopeRoot = trie.emit(anyRoot);
  rootNodes.set("any", anyRoot);
  code += trie.lines.join("\n") + "\n\n";
  const categoryScopeEntries = [...join.categoryScopes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, scopes]) => {
      const value = scopes === "any" ? '"any"' : JSON.stringify(scopes);
      return `  readonly ${JSON.stringify(category)}: ${value};`;
    });
  code +=
    "export interface ModifierCategoryScopes {\n" + categoryScopeEntries.join("\n") + "\n}\n\n";
  const scriptedCategoryMap = Object.entries(SCRIPTED_MODIFIER_CATEGORY_MAP)
    .map(
      ([category, targets]) =>
        `C extends ${JSON.stringify(category)} ? ${targets.map((target) => JSON.stringify(target)).join(" | ")}`
    )
    .join(" : ");
  code +=
    `export type ScriptedCategoryMap<C extends string> = ${scriptedCategoryMap} : C;\n` +
    'export type ModifierCategoryScopesFor<C extends string> = C extends keyof ModifierCategoryScopes ? ModifierCategoryScopes[C] extends readonly string[] ? ModifierCategoryScopes[C][number] : "any" : never;\n\n' +
    "export type ModifierCategoryAllowed<S extends ScopeName, C extends string> = " +
    '[ScopeName] extends [S] ? true : "any" extends ModifierCategoryScopesFor<ScriptedCategoryMap<C>> ? true : S extends ModifierCategoryScopesFor<ScriptedCategoryMap<C>> ? true : false;\n\n';
  code +=
    "export type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never;\n" +
    'export type ScriptedModifierSelector<S extends ScopeName> = <const T extends import("../generated/content-definers.ts").ScriptedModifierItem>(' +
    'item: T & (IsUnion<T["def"]["category"]> extends true ? never : ModifierCategoryAllowed<S, T["def"]["category"]> extends true ? {} : never)) => { readonly set: ModifierSetter };\n\n';
  code +=
    'export type EconomicCategorySelector<S extends ScopeName> = <const T extends import("../generated/content-definers.ts").EconomicCategoryItem>(' +
    "item: T & (IsUnion<EconomicWitnessOf<T>> extends true ? never : EconomicCategoryAllowed<S, EconomicWitnessOf<T>> extends true ? {} : never)) => EconomicCategoryRecorder<EconomicWitnessOf<T>>;\n" +
    'export type EconomicWitnessOf<T extends import("../generated/content-definers.ts").EconomicCategoryItem> = T extends { readonly def: infer D } ? { readonly modifierCategory: D extends { readonly modifierCategory: infer M } ? M : undefined; readonly generateAddModifiers: D extends { readonly generateAddModifiers: infer A } ? A : undefined; readonly generateMultModifiers: D extends { readonly generateMultModifiers: infer U } ? U : undefined } : never;\n' +
    'export type EconomicCategoryAllowed<S extends ScopeName, W extends import("../content/types.ts").EconomicCategoryWitness> = ModifierCategoryAllowed<S, W["modifierCategory"] extends string ? W["modifierCategory"] : "economic_unit">;\n' +
    'export type EconomicCategoryRecorder<W extends import("../content/types.ts").EconomicCategoryWitness> = { readonly resource: (resource: import("../generated/refs.ts").ResourceRef | string) => EconomicResourceRecorder<W> } & { [K in W["generateMultModifiers"] extends readonly (infer M)[] ? M & string : never]: { readonly mult: ModifierSetter } };\n' +
    'export type EconomicResourceRecorder<W extends import("../content/types.ts").EconomicCategoryWitness> = { [K in W["generateAddModifiers"] extends readonly (infer A)[] ? A & string : never]: { readonly add: ModifierSetter } } & { [K in W["generateMultModifiers"] extends readonly (infer M)[] ? M & string : never]: { readonly mult: ModifierSetter } };\n\n';

  code += `export const MODIFIER_REFERENCE_FAMILIES = ${JSON.stringify(
    Object.fromEntries(
      join.dynamicFamilies.map((family) => [
        family.family,
        {
          target: family.target,
          placeholder: family.placeholder,
          operations: Object.fromEntries(family.operationTemplates),
        },
      ])
    )
  )} as const;\n\n`;

  for (const family of join.dynamicFamilies) {
    for (const [name, operations] of family.scopeOperations) {
      const typeName = `${pascalCase(family.family)}ModifierPath_${pascalCase(name)}`;
      const operationsType = `${pascalCase(family.family)}ModifierOperations_${pascalCase(name)}`;
      const root = rootNodes.get(name);
      const staticJob = root?.children.get(family.family);
      code += `export type ${operationsType} = {\n`;
      code += operationMembers(operations);
      code += "};\n\n";
      const selector = `(value: import("./refs.ts").${family.reference}) => ${operationsType}`;
      const pathType =
        staticJob === undefined ? selector : `${trie.emit(staticJob)} & (${selector})`;
      code += `export type ${typeName} = ${pathType};\n\n`;
    }
  }

  for (const scope of scopes) {
    code +=
      docComment([
        `Records modifiers valid in \`${scope}\` scope: each path segment completes`,
        "from a small menu, and the joined path is the game's flat modifier name.",
      ]) +
      `export interface ${pascalCase(scope)}ModifierRecorder extends ${rootNames.get(scope)} {\n` +
      `  readonly scripted: ScriptedModifierSelector<${JSON.stringify(scope)}>;\n` +
      `  readonly economic: EconomicCategorySelector<${JSON.stringify(scope)}>;\n` +
      join.dynamicFamilies
        .map((family) => {
          const type = family.scopeOperations.has(scope)
            ? `${pascalCase(family.family)}ModifierPath_${pascalCase(scope)}`
            : undefined;
          return type === undefined ? "" : `  readonly ${family.family}: ${type};\n`;
        })
        .join("") +
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
    "  readonly scripted: ScriptedModifierSelector<ScopeName>;\n" +
    "  readonly economic: EconomicCategorySelector<ScopeName>;\n" +
    join.dynamicFamilies
      .map(
        (family) => `  readonly ${family.family}: ${pascalCase(family.family)}ModifierPath_Any;\n`
      )
      .join("") +
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

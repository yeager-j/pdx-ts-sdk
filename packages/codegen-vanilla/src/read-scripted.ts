/**
 * Scripted trigger and effect names, with their `$PARAM$` lists.
 *
 * This is the licensing boundary at its narrowest: a scripted trigger's body is
 * game script and stays in the game. What leaves is the definition's name and
 * the names of the parameters it substitutes — the interface SDK-13 needs to
 * check a call offline, and nothing more. Default values are body content and
 * are never captured, only the fact that one exists.
 *
 * A parameter is *required* when some occurrence of it will definitely be
 * substituted and supplies no default — one outside every `[[FLAG] ... ]`
 * region, spelled without a `|`. Everything else is omissible: `$AGE|10$`
 * supplies a default, an occurrence inside a region is only substituted when
 * the region is active, and `FLAG` itself, the region's own condition, is the
 * archetype of an optional parameter.
 *
 * That is one rule over all of a name's occurrences rather than a property of
 * any one of them, and it has to be. A name written `$X|10$` in one place and
 * `$X$` in another is required: the second substitution has no default to fall
 * back on, and reading the first as permission to omit it produced a signature
 * that let a caller leave a hole in the emitted script.
 *
 * Optional is not the same as independent, which is the other thing recorded
 * here. `[[FLAG] ... $NAME$ ... ]` makes both names omissible, and it also ties
 * them together: supplying `FLAG` activates the region, and then `$NAME$` is a
 * substitution site with nothing to substitute. So a region that forces a
 * parameter is kept as a {@link ScriptedRegion} rather than flattened into two
 * unrelated optional names.
 *
 * The parsed body, parameters, and provenance form one definition identity for
 * `infer-scopes.ts` to measure. Ambiguous duplicate identities stop the build;
 * combining one declaration's body with another declaration's parameter list
 * would describe neither. The body is in-memory only and no emitter may read
 * it: what leaves this generator is a name, a parameter list, and — since
 * SDK-13 — a scope name from `scopes.cwt`. The licensing chokepoint in
 * `emit.ts` is what actually enforces that, and it inspects every literal
 * regardless of where the emitter thinks it came from.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse, regionItems, type PdxItem } from "@pdx-ts/pdxscript";

import { compareIdentifiers } from "./emit.ts";

/** One `$PARAM$` a definition substitutes, and whether it may be left out. */
export interface ScriptedParam {
  readonly name: string;
  readonly optional: boolean;
}

/**
 * A `[[NAME] ... ]` region whose activation forces other parameters.
 *
 * Only regions that force something are recorded. A region whose parameters are
 * all required anyway, or that substitutes nothing but its own name, adds no
 * constraint a caller could violate, and listing it would only multiply the
 * call shapes the emitted type has to spell.
 */
export interface ScriptedRegion {
  /** The parameter whose presence activates the region. */
  readonly condition: string;
  /**
   * Parameters that must be supplied when it is: the ones this region
   * substitutes that nothing outside it does, and that carry no default.
   */
  readonly requires: readonly string[];
}

/** One scripted trigger or effect: its name, its parameters, and its body. */
export interface ScriptedDefinition {
  readonly name: string;
  readonly params: readonly ScriptedParam[];
  /** Regions whose activation forces parameters. Usually empty. */
  readonly regions: readonly ScriptedRegion[];
  /** The parsed body. Read by the scope inference; never emitted. */
  readonly body: readonly PdxItem[];
  /** Slash-normalized path relative to the scripted registry directory. */
  readonly source: string;
  /** Top-level declaration index within {@link source}. */
  readonly ordinal: number;
}

export interface ScriptedRegistry {
  readonly registry: string;
  readonly definitions: readonly ScriptedDefinition[];
  readonly files: number;
  readonly diagnostics: number;
  readonly missing: boolean;
}

/**
 * `$NAME$` and `$NAME|default$`. The default itself is matched only so the
 * token ends where it should — the capture is the name alone.
 */
const PARAM_TOKEN = /\$([A-Za-z0-9_]+)(?:\|[^$]*)?\$/g;

interface Occurrence {
  /** The occurrence supplied a default, so the parameter may be omitted. */
  readonly defaulted: boolean;
  /**
   * The `[[NAME] ... ]` regions enclosing it, outermost first.
   *
   * The whole stack rather than one flag, because which region governs an
   * occurrence is the fact a caller has to satisfy. Empty means the
   * substitution always happens.
   */
  readonly regions: readonly string[];
  /**
   * This occurrence *is* a region's condition rather than a substitution site.
   *
   * Kept apart from the rest because the two say opposite things. A
   * substitution outside every region makes a parameter required; a region
   * header naming that same parameter is exactly what makes it omissible, and
   * counting the header as a substitution would make every region's condition
   * mandatory — which is to say, would make every region always active.
   */
  readonly condition: boolean;
}

function scan(text: string, regions: readonly string[], into: Map<string, Occurrence[]>): void {
  for (const match of text.matchAll(PARAM_TOKEN)) {
    const name = match[1]!;
    into.set(name, [
      ...(into.get(name) ?? []),
      { defaulted: match[0].includes("|"), regions, condition: false },
    ]);
  }
}

function recordCondition(
  name: string,
  regions: readonly string[],
  into: Map<string, Occurrence[]>
): void {
  into.set(name, [...(into.get(name) ?? []), { defaulted: false, regions, condition: true }]);
}

function walkItems(
  items: readonly PdxItem[],
  regions: readonly string[],
  into: Map<string, Occurrence[]>
): void {
  for (const item of items) {
    switch (item.kind) {
      case "entry":
        scan(item.key, regions, into);
        walkItems([item.value], regions, into);
        break;
      case "container":
        if (item.header !== undefined) {
          scan(item.header, regions, into);
        }
        walkItems(item.items, regions, into);
        break;
      case "param":
        // The block's own condition is a parameter, and one whose whole purpose
        // is to be omissible.
        recordCondition(item.name, regions, into);
        walkItems(item.items, [...regions, item.name], into);
        break;
      case "param-text":
        // The same construct without a tree. Its body is read through the
        // lexer rather than scanned as raw text, so trivia stays trivia: a
        // commented-out `# $OLD$` must not enter the parameter contract this
        // package publishes, and a region nested inside comes back as a
        // region — its name is a parameter too.
        recordCondition(item.name, regions, into);
        walkItems(regionItems(item), [...regions, item.name], into);
        break;
      case "str":
        scan(item.value, regions, into);
        break;
      case "var":
        scan(item.name, regions, into);
        break;
      case "math":
        scan(item.source, regions, into);
        break;
      default:
        break;
    }
  }
}

/** A substitution that definitely happens and supplies nothing to fall back on. */
function isRequired(seen: readonly Occurrence[]): boolean {
  return seen.some((one) => !one.condition && !one.defaulted && one.regions.length === 0);
}

/**
 * The regions every substitution of a name sits inside.
 *
 * A name confined to exactly one region is the interesting case: it can only
 * ever be substituted when that region is active, so the region's activation is
 * the whole story about when it is needed. A name substituted both inside and
 * outside a region is not confined and is governed by its unconditional
 * occurrence instead.
 */
function confinedTo(seen: readonly Occurrence[]): ReadonlySet<string> {
  const substitutions = seen.filter((one) => !one.condition);
  const first = substitutions[0];
  if (first === undefined) {
    return new Set();
  }
  let shared = new Set<string>(first.regions);
  for (const one of substitutions.slice(1)) {
    shared = new Set([...shared].filter((region) => one.regions.includes(region)));
  }
  return shared;
}

/**
 * The regions that force something, and what each forces.
 *
 * A region qualifies when activating it turns an otherwise-omissible parameter
 * into a required one: its own condition is not already required (or the region
 * is always active and constrains nothing), and it confines at least one
 * undefaulted parameter of its own.
 *
 * The confinement has to be to *this* region alone. A parameter confined to two
 * nested regions would be forced by each of them independently, and the two
 * claims contradict each other in the call shape where only the outer one is
 * active. Vanilla 4.4.6 nests no regions at all, so this excludes nothing
 * today; it is here so that a game patch which starts nesting them produces a
 * weaker type rather than a wrong one.
 */
function regionsOf(occurrences: ReadonlyMap<string, Occurrence[]>): ScriptedRegion[] {
  const names = new Set(
    [...occurrences].flatMap(([, seen]) =>
      seen.flatMap((one) => (one.condition ? [] : one.regions))
    )
  );
  for (const [name, seen] of occurrences) {
    for (const one of seen) {
      if (one.condition) {
        names.add(name);
      }
    }
  }

  const regions: ScriptedRegion[] = [];
  for (const condition of [...names].sort(compareIdentifiers)) {
    if (isRequired(occurrences.get(condition) ?? [])) {
      continue;
    }
    const requires = [...occurrences]
      .filter(([name, seen]) => {
        if (name === condition || isRequired(seen)) {
          return false;
        }
        const confined = confinedTo(seen);
        return (
          confined.size === 1 &&
          confined.has(condition) &&
          seen.some((one) => !one.condition && !one.defaulted)
        );
      })
      .map(([name]) => name)
      .sort(compareIdentifiers);
    if (requires.length > 0) {
      regions.push({ condition, requires });
    }
  }
  return regions;
}

function readParams(items: readonly PdxItem[]): {
  params: ScriptedParam[];
  regions: ScriptedRegion[];
} {
  const occurrences = new Map<string, Occurrence[]>();
  walkItems(items, [], occurrences);
  return {
    params: [...occurrences]
      .map(([name, seen]) => ({ name, optional: !isRequired(seen) }))
      .sort((left, right) => compareIdentifiers(left.name, right.name)),
    regions: regionsOf(occurrences),
  };
}

function walkFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort(compareIdentifiers);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...walkFiles(full));
      continue;
    }
    if (name.endsWith(".txt")) {
      found.push(full);
    }
  }
  return found;
}

export function readScriptedDefinitions(
  root: string,
  registry: string,
  dir: string
): ScriptedRegistry {
  const absolute = path.join(root, dir);
  const files = walkFiles(absolute);
  const byName = new Map<string, ScriptedDefinition>();
  let diagnostics = 0;
  for (const file of files) {
    const source = path.relative(absolute, file).split(path.sep).join("/");
    const parsed = parse(readFileSync(file, "utf8"), source);
    diagnostics += parsed.diagnostics.length;
    for (const [ordinal, item] of parsed.items.entries()) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      const definition: ScriptedDefinition = {
        name: item.key,
        ...readParams(item.value.items),
        body: item.value.items,
        source,
        ordinal,
      };
      const identity = item.key.toLowerCase();
      const previous = byName.get(identity);
      if (previous !== undefined) {
        throw new Error(
          `${registry}: ambiguous duplicate definition ${JSON.stringify(item.key)} in ` +
            `${previous.source}#${previous.ordinal} and ${source}#${ordinal}`
        );
      }
      byName.set(identity, definition);
    }
  }
  let missing = false;
  try {
    missing = !statSync(absolute).isDirectory();
  } catch {
    missing = true;
  }
  return {
    registry,
    definitions: [...byName.values()].sort((left, right) =>
      compareIdentifiers(left.name, right.name)
    ),
    files: files.length,
    diagnostics,
    missing,
  };
}

/**
 * Scripted trigger and effect names, with their `$PARAM$` lists.
 *
 * This is the licensing boundary at its narrowest: a scripted trigger's body is
 * game script and stays in the game. What leaves is the definition's name and
 * the names of the parameters it substitutes — the interface SDK-13 needs to
 * check a call offline, and nothing more. Default values are body content and
 * are never captured, only the fact that one exists.
 *
 * Optionality is not read off any single occurrence. It is derived from what
 * the caller's choices do to the body, because that is the only reading that
 * survives the shapes vanilla actually writes.
 *
 * The caller chooses which `[[FLAG] ... ]` regions to activate, by supplying or
 * omitting each flag. That choice decides which substitution sites are reached:
 * a site inside a region is reached only when every region enclosing it is
 * active, and a region is active when its flag is supplied — or, for `[[!FLAG]
 * ... ]`, when its flag is *absent*. A parameter must be supplied for a given
 * choice when some site it reaches would substitute it with no default to fall
 * back on.
 *
 * Reading the negation is what makes the difference. `add_random_trait_evopred`
 * writes `[[SPECIES] ... $TAG$ ... ]` and `[[!SPECIES] ... $TAG$ ... ]`, so
 * exactly one of the two always runs and `TAG` is required no matter what the
 * caller does with `SPECIES`. Treating every region as presence-activated makes
 * that look like a dependency between the two names, and publishes a signature
 * that refuses `{ TAG: "organic" }` — a correct and ordinary call.
 *
 * So this enumerates the caller's consistent choices and records the resulting
 * {@link ScriptedCallShape}s. Almost always they agree about every parameter
 * and collapse to one flat object, which is what all 3,275 of vanilla 4.4.6's
 * definitions do. When they disagree — `[[FLAG] ... $NAME$ ... ]` with no
 * negated twin, so `NAME` is reachable only when `FLAG` is supplied — the
 * shapes are kept apart, because that is a choice rather than two independent
 * optional names.
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

/** One `$PARAM$` a definition substitutes, and whether any call may omit it. */
export interface ScriptedParam {
  readonly name: string;
  readonly optional: boolean;
}

/** What one call shape says about one parameter. */
export type ScriptedParamPresence =
  /** Some site this call reaches substitutes it with no default. */
  | "required"
  /** A site reaches it, and every one of those supplies a default. */
  | "optional"
  /** No site this call reaches would substitute it, so passing it does nothing. */
  | "forbidden";

/**
 * One consistent set of caller choices, and what it demands.
 *
 * A definition with a single shape is the ordinary flat parameter object. More
 * than one means the choices genuinely disagree, and the emitted type is their
 * union.
 */
export interface ScriptedCallShape {
  /** Every parameter of the definition, byte-ordered by name. */
  readonly params: readonly { readonly name: string; readonly presence: ScriptedParamPresence }[];
}

/** One scripted trigger or effect: its name, its parameters, and its body. */
export interface ScriptedDefinition {
  readonly name: string;
  readonly params: readonly ScriptedParam[];
  /** The call shapes the definition admits. Almost always exactly one. */
  readonly shapes: readonly ScriptedCallShape[];
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

/** How many distinct region flags one definition may have. */
const MAX_REGION_FLAGS = 8;

/** One `[[NAME] ... ]` or `[[!NAME] ... ]` region enclosing an occurrence. */
interface RegionRef {
  readonly name: string;
  /** `[[!NAME] ... ]`: active when the flag is *absent*. */
  readonly negated: boolean;
}

interface Occurrence {
  /** The occurrence supplied a default, so the parameter may be omitted. */
  readonly defaulted: boolean;
  /**
   * The regions enclosing it, outermost first.
   *
   * The whole stack rather than one flag, because a site is reached only when
   * every region around it is active. Empty means the site is always reached.
   */
  readonly regions: readonly RegionRef[];
  /**
   * This occurrence *is* a region's header rather than a substitution site.
   *
   * Kept apart from the rest because the two say opposite things. A
   * substitution demands a value; a header naming that same parameter is the
   * caller's switch for the region, and counting it as a substitution would
   * make every flag mandatory — which is to say, every region always active.
   */
  readonly condition: boolean;
}

function scan(text: string, regions: readonly RegionRef[], into: Map<string, Occurrence[]>): void {
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
  regions: readonly RegionRef[],
  into: Map<string, Occurrence[]>
): void {
  into.set(name, [...(into.get(name) ?? []), { defaulted: false, regions, condition: true }]);
}

function walkItems(
  items: readonly PdxItem[],
  regions: readonly RegionRef[],
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
        // The region's own condition is a parameter, and one whose whole
        // purpose is to be the caller's switch.
        recordCondition(item.name, regions, into);
        walkItems(item.items, [...regions, { name: item.name, negated: item.negated }], into);
        break;
      case "param-text":
        // The same construct without a tree. Its body is read through the
        // lexer rather than scanned as raw text, so trivia stays trivia: a
        // commented-out `# $OLD$` must not enter the parameter contract this
        // package publishes, and a region nested inside comes back as a
        // region — its name is a parameter too.
        recordCondition(item.name, regions, into);
        walkItems(
          regionItems(item),
          [...regions, { name: item.name, negated: item.negated }],
          into
        );
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

/** Whether a region is active given the flags the caller supplied. */
function isActive(region: RegionRef, supplied: ReadonlySet<string>): boolean {
  return region.negated ? !supplied.has(region.name) : supplied.has(region.name);
}

/** Whether this call reaches the site at all. */
function isReached(occurrence: Occurrence, supplied: ReadonlySet<string>): boolean {
  return occurrence.regions.every((region) => isActive(region, supplied));
}

function presenceOf(
  seen: readonly Occurrence[],
  supplied: ReadonlySet<string>
): ScriptedParamPresence {
  const reached = seen.filter((one) => !one.condition && isReached(one, supplied));
  if (reached.some((one) => !one.defaulted)) {
    return "required";
  }
  return reached.length > 0 ? "optional" : "forbidden";
}

/**
 * Every set of flags the caller could supply that does not contradict itself.
 *
 * A choice is inconsistent when it leaves out a flag that the very body it
 * selects then substitutes with no default: `$FLAG$` written outside every
 * region means the caller has to pass `FLAG`, and a choice that omits it
 * describes a call nobody can make. Dropping those is what keeps a region whose
 * flag is mandatory from being offered as optional, and what resolves a flag
 * that another region's body requires.
 */
function consistentChoices(
  flags: readonly string[],
  occurrences: ReadonlyMap<string, Occurrence[]>
): ReadonlySet<string>[] {
  const choices: ReadonlySet<string>[] = [];
  for (let mask = 0; mask < 1 << flags.length; mask += 1) {
    const supplied = new Set(flags.filter((_, index) => (mask & (1 << index)) !== 0));
    const contradicts = flags.some(
      (flag) =>
        !supplied.has(flag) && presenceOf(occurrences.get(flag) ?? [], supplied) === "required"
    );
    if (!contradicts) {
      choices.push(supplied);
    }
  }
  return choices;
}

function readParams(items: readonly PdxItem[]): {
  params: ScriptedParam[];
  shapes: ScriptedCallShape[];
} {
  const occurrences = new Map<string, Occurrence[]>();
  walkItems(items, [], occurrences);
  const names = [...occurrences.keys()].sort(compareIdentifiers);
  const flags = names.filter((name) => (occurrences.get(name) ?? []).some((one) => one.condition));
  if (flags.length > MAX_REGION_FLAGS) {
    throw new Error(
      `a definition has ${flags.length} region flags, over the ${MAX_REGION_FLAGS} whose call ` +
        "shapes this enumerates. Its exact contract needs a different shape than a union of " +
        "combinations."
    );
  }

  const choices = consistentChoices(flags, occurrences);
  const shapes = choices.map((supplied) => ({
    params: names.map((name) => ({
      name,
      // A flag is not read off the body: supplying it *is* the choice.
      presence: flags.includes(name)
        ? ((supplied.has(name) ? "required" : "forbidden") satisfies ScriptedParamPresence)
        : presenceOf(occurrences.get(name) ?? [], supplied),
    })),
  }));

  // Whether the choices actually disagree. When they do not — every vanilla
  // definition, because a `[[X]]` region is nearly always paired with its
  // `[[!X]]` twin — the flags are ordinary optional parameters and one flat
  // shape says everything.
  const nonFlagShape = (shape: ScriptedCallShape): string =>
    JSON.stringify(shape.params.filter((one) => !flags.includes(one.name)));
  const agree = shapes.every((shape) => nonFlagShape(shape) === nonFlagShape(shapes[0]!));

  return {
    params: names.map((name) => ({
      name,
      optional: !shapes.every((shape) =>
        shape.params.some((one) => one.name === name && one.presence === "required")
      ),
    })),
    shapes: agree ? [flatShape(names, flags, shapes)] : shapes,
  };
}

/**
 * The single shape a definition takes when no choice changes what it demands.
 *
 * Every flag becomes an ordinary parameter — required when no consistent choice
 * omits it, optional otherwise — and every other parameter keeps the presence
 * all the choices agreed on.
 */
function flatShape(
  names: readonly string[],
  flags: readonly string[],
  shapes: readonly ScriptedCallShape[]
): ScriptedCallShape {
  const first = shapes[0]!;
  return {
    params: names.map((name) => {
      if (!flags.includes(name)) {
        return first.params.find((one) => one.name === name)!;
      }
      const always = shapes.every((shape) =>
        shape.params.some((one) => one.name === name && one.presence === "required")
      );
      return { name, presence: (always ? "required" : "optional") satisfies ScriptedParamPresence };
    }),
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

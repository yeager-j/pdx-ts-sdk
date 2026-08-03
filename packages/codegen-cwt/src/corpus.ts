/**
 * What the shipped game and installed mods actually write, per registry.
 *
 * The curated field allowlists asked a reviewer to vouch for fields the
 * evidence already settles: `component_template.size` is `enum[weapon_slot_size]`,
 * a closed set in the rules, present on all 1388 vanilla component templates.
 * There is nothing there for a human to add, and doubt about whether the SDK
 * lowers it correctly is a testing gap rather than something curation fixes.
 *
 * The parser already proves itself against a full-vanilla fixpoint. This gives
 * the content emitter the same standard: parse every real definition and
 * measure the emitted interface against it.
 *
 * The corpus is a LOWER bound. A field vanilla never writes may still be legal,
 * so absence is reported, never failed. What it does prove is the converse — a
 * field the SDK emits that nothing in the corpus writes is a misreading.
 *
 * Two questions, not one. {@link conformance} asks whether a field is *present*
 * in the emitted interface; {@link shapeConformance} asks whether its lowered
 * type can hold what real definitions put there. Only the second sees a
 * block-typed field against 254 scalar writes, or a required condition no
 * author can satisfy.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse, type PdxContainer, type PdxValue } from "@pdx-ts/pdxscript";

import type { EmittedField } from "./emit/fields.ts";

/**
 * What the corpus writes under one key, counted once per definition.
 *
 * Presence alone — the single number this used to be — is what let a
 * block-typed `stages.end` sit at full coverage against 254 scalar writes.
 * Every other member here exists so a lowered type can be measured rather than
 * merely located: block versus scalar, repeated versus single, which scalars,
 * which inner keys.
 */
export interface FieldObservation {
  /** Definitions writing the key at least once. */
  readonly definitions: number;
  /** Definitions writing it more than once at the sibling level. */
  readonly repeated: number;
  /** Definitions writing a scalar value at least once. */
  readonly scalars: number;
  /** Definitions writing a block value at least once. */
  readonly blocks: number;
  /** Definitions whose block value holds bare values rather than entries. */
  readonly bareBlocks: number;
  /** Every scalar written, as the game spells it, capped at {@link VALUE_SAMPLE}. */
  readonly values: ReadonlySet<string>;
  /** Every key written directly inside a block value. */
  readonly keys: ReadonlySet<string>;
  /**
   * The same keys, still grouped by the definition that wrote them and
   * deduplicated across definitions writing the same set.
   *
   * {@link keys} merges every definition together, which cannot answer "could
   * one scope have been declared for *this* definition" — a field where one
   * definition writes a planet-only rule and another a ship-only rule looks
   * identical to one definition writing both. Only the second is a defect, and
   * only this can tell them apart.
   */
  readonly keysByDefinition: readonly ReadonlySet<string>[];
}

/**
 * How many distinct scalars to remember per field. Enough to catch a value
 * outside a closed union, few enough that an open `<technology>` field does not
 * carry a thousand ids around.
 */
const VALUE_SAMPLE = 64;

export interface RegistryCorpus {
  /** Definitions found, across every file at the registry's path. */
  readonly definitions: number;
  readonly files: number;
  /**
   * Field key -> what definitions write there. A nested field inside a
   * repeated-struct field (see {@link RepeatedStructField}) is reported under
   * a dotted path (`stages.icon`, `approach.on_select`) alongside the owning
   * field's own top-level occurrence, so coverage inside the struct is visible
   * and attributable instead of collapsing into the single top-level key.
   */
  readonly occurrences: ReadonlyMap<string, FieldObservation>;
}

/**
 * Identifies one of a registry's repeated-struct fields (see
 * `docs/roadmap.md`'s "Repeated-struct field shape") so the corpus reader can
 * descend into it. Mirrors `REPEATED_STRUCT_DEFINITIONS`' `keying` /
 * `identityKey` exactly — the two are meant to be built from the same overlay
 * entries, not redefine the split.
 */
export interface RepeatedStructField {
  /** The top-level field key, e.g. "stages" or "approach". */
  readonly field: string;
  readonly keying: "container" | "siblings";
  /** Required for "siblings" — the body field carrying the id, skipped when descending. */
  readonly identityKey?: string;
}

/**
 * Adds one occurrence of every nested field found inside a repeated-struct
 * field to `seen`, deduplicated exactly like the top level: a definition
 * writing `icon` in two different stages, or the same field in two `approach`
 * blocks, still counts once.
 *
 * "container" (`stages = { stage_1 = { icon = ... } }`): the outer container's
 * items are themselves id-keyed blocks, so descend once more into each and
 * report their fields under `<field>.<name>`.
 *
 * "siblings" (`approach = { name = approach_a icon = ... }`): the container
 * passed in already holds the entry's own fields directly — the caller is
 * invoked once per occurrence, since duplicate keys at the top level (several
 * `approach = { ... }` blocks) already arrive as separate items. The identity
 * field itself is skipped, the same reason the top level drops `nameField`.
 */
function descendRepeatedStruct(
  value: PdxContainer,
  struct: RepeatedStructField,
  seen: Map<string, PdxValue[]>
): void {
  const record = (key: string, written: PdxValue): void => {
    seen.set(`${struct.field}.${key}`, [...(seen.get(`${struct.field}.${key}`) ?? []), written]);
  };
  if (struct.keying === "container") {
    for (const sub of value.items) {
      if (sub.kind !== "entry" || sub.value.kind !== "container") {
        continue;
      }
      for (const leaf of sub.value.items) {
        if (leaf.kind !== "entry") {
          continue;
        }
        record(leaf.key, leaf.value);
      }
    }
    return;
  }
  for (const leaf of value.items) {
    if (leaf.kind !== "entry" || leaf.key === struct.identityKey) {
      continue;
    }
    record(leaf.key, leaf.value);
  }
}

/**
 * One structural alias splice the reader descends into, e.g. `planet`.
 *
 * `members` is a thunk because these are mutually recursive: a `planet` holds
 * `planet` and `moon`, and a `moon` holds `moon`.
 */
export interface SpliceMember {
  readonly key: string;
  readonly members: () => readonly SpliceMember[];
}

/**
 * Records everything written inside a spliced block, at any depth, under that
 * block's own key.
 *
 * The flattening is the point rather than a shortcut. The emitter produces one
 * field table per alias category and reuses it at every level — a third-level
 * moon's `size` is described by the same lowering as a first-level one — so the
 * corpus has to aggregate the same way for the two sides to line up. Recursion
 * terminates on the data, since real files nest three deep, not on a cap.
 */
function descendSplice(
  value: PdxContainer,
  member: SpliceMember,
  seen: Map<string, PdxValue[]>,
  spliceArity: Map<string, boolean>
): void {
  const nested = new Map(member.members().map((inner) => [inner.key, inner]));
  // Per block, not per definition. A system with eight planets that each write
  // `size` once must not read as `planet.size` repeating — arity is a property
  // of one block, and the accumulated `seen` map cannot express that because
  // every planet at every depth pours into the same path. Counting here, where
  // the block boundary still exists, is the only place it can be seen.
  const withinThisBlock = new Set<string>();
  for (const leaf of value.items) {
    if (leaf.kind !== "entry") {
      continue;
    }
    const path = `${member.key}.${leaf.key}`;
    // Presence marks the path as splice-owned even when it never repeats, so
    // `observe` knows to take its arity from here rather than from the
    // flattened value list.
    spliceArity.set(path, (spliceArity.get(path) ?? false) || withinThisBlock.has(path));
    withinThisBlock.add(path);
    seen.set(path, [...(seen.get(path) ?? []), leaf.value]);
    const inner = nested.get(leaf.key);
    if (inner !== undefined && leaf.value.kind === "container") {
      descendSplice(leaf.value, inner, seen, spliceArity);
    }
  }
}

/**
 * Builds the splice tree for a set of categories, tying the recursive knot.
 *
 * Takes a resolver rather than the emitter itself, so the corpus reader stays a
 * reader: the emitter is the authority on which categories are structural and
 * what key each is written under, and this only needs the answer.
 */
export function spliceMembersOf(
  categories: readonly string[],
  resolve: (
    category: string
  ) => { readonly memberKey: string; readonly spliceCategories: readonly string[] } | null
): SpliceMember[] {
  return categories.flatMap((category) => {
    const resolved = resolve(category);
    return resolved === null
      ? []
      : [
          {
            key: resolved.memberKey,
            // Lazily, and re-entering `spliceMembersOf` rather than caching a
            // node per category: `planet_initializer` reaches itself, so
            // building the children eagerly would not terminate.
            members: () => spliceMembersOf(resolved.spliceCategories, resolve),
          },
        ];
  });
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/** One scalar as the game spells it, so a `bool` reads back as `yes`/`no`. */
function scalarText(value: PdxValue): string | null {
  switch (value.kind) {
    case "str":
      return value.value;
    case "num":
      return String(value.value);
    case "bool":
      return value.value ? "yes" : "no";
    // A `@variable` or an inline `@[a + b]` stands for a value the file never
    // writes literally, so it says nothing about which scalars are legal.
    default:
      return null;
  }
}

/**
 * Folds one definition's writes into the running observations.
 *
 * Everything counts once per definition, at every level: a definition
 * repeating `modifier` twice is still one definition that uses `modifier`, and
 * weighting by repetition would let one verbose entry dominate coverage. The
 * repetition itself is not lost — it is what `repeated` records.
 */
function observe(
  into: Map<string, FieldObservation>,
  written: ReadonlyMap<string, PdxValue[]>,
  /**
   * Splice-owned paths, each mapped to whether it repeated inside a single
   * block — counted at a boundary the accumulated `written` map has already
   * flattened away, see {@link descendSplice}. For these, `values.length` is
   * the count across every block in the definition and says nothing about
   * arity, so this decides it instead. Repeated-struct paths are dotted too but
   * are absent here, and keep the ordinary rule.
   */
  spliceArity: ReadonlyMap<string, boolean> = new Map()
) {
  for (const [key, values] of written) {
    const previous = into.get(key);
    const repeats = spliceArity.get(key) ?? values.length > 1;
    const observation = {
      definitions: (previous?.definitions ?? 0) + 1,
      repeated: (previous?.repeated ?? 0) + (repeats ? 1 : 0),
      scalars: previous?.scalars ?? 0,
      blocks: previous?.blocks ?? 0,
      bareBlocks: previous?.bareBlocks ?? 0,
      values: new Set(previous?.values ?? []),
      keys: new Set(previous?.keys ?? []),
    };
    const written = new Set<string>();
    let scalar = false;
    let block = false;
    let bare = false;
    for (const value of values) {
      if (value.kind !== "container") {
        scalar = true;
        const text = scalarText(value);
        if (text !== null && observation.values.size < VALUE_SAMPLE) {
          observation.values.add(text);
        }
        continue;
      }
      block = true;
      for (const item of value.items) {
        if (item.kind === "entry") {
          observation.keys.add(item.key);
          written.add(item.key);
          continue;
        }
        if (item.kind === "param") {
          continue;
        }
        // A bare item is a value too — it is where a `valueList`'s scalars
        // live, and the only place a closed union can be checked for one.
        bare = true;
        const text = scalarText(item);
        if (text !== null && observation.values.size < VALUE_SAMPLE) {
          observation.values.add(text);
        }
      }
    }
    const seen = previous?.keysByDefinition ?? [];
    into.set(key, {
      ...observation,
      scalars: observation.scalars + (scalar ? 1 : 0),
      blocks: observation.blocks + (block ? 1 : 0),
      bareBlocks: observation.bareBlocks + (bare ? 1 : 0),
      // Deduplicated: most definitions of a registry write the same handful of
      // keys, so the distinct sets stay far smaller than the definition count.
      keysByDefinition: seen.some((keys) => sameKeys(keys, written)) ? seen : [...seen, written],
    });
  }
}

export interface ConformanceReport {
  readonly registry: string;
  readonly corpus: RegistryCorpus;
  /** Emitted fields no definition in the corpus writes: likely a misreading. */
  readonly invented: readonly string[];
  /** Observed fields the emitted interface cannot express, most frequent first. */
  readonly unexpressed: readonly { readonly field: string; readonly count: number }[];
  /** Share of observed field occurrences the emitted interface covers, 0-1. */
  readonly coverage: number;
}

/**
 * Reads every definition a registry's directory contains.
 *
 * `keyword` distinguishes the two layouts. Normally each top-level entry is one
 * definition keyed by its id. Where the rules set `name_field`, the top-level
 * key is a repeated keyword instead and the id sits in a body field — so only
 * entries under that keyword count, and the name field is not a field.
 *
 * `repeatedStructFields` names this registry's repeated-struct fields (if
 * any), so their contents are visible too instead of collapsing into one
 * opaque top-level key — see {@link descendRepeatedStruct}.
 */
export function readRegistryCorpus(
  root: string,
  registryPath: string,
  keyword: string | null,
  nameField: string | null,
  repeatedStructFields: readonly RepeatedStructField[] = [],
  spliceMembers: readonly SpliceMember[] = [],
  /**
   * A top-level key belonging to a sibling type that shares this directory,
   * from a negated `## type_key_filter <> key` — `random_list` under
   * `common/solar_system_initializers`. Counting one as a definition would
   * measure another type's body against this registry's fields.
   */
  excludedKey: string | null = null
): RegistryCorpus {
  const dir = path.join(root, registryPath);
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".txt"));
  } catch {
    return { definitions: 0, files: 0, occurrences: new Map() };
  }
  const structByField = new Map(repeatedStructFields.map((field) => [field.field, field]));
  const spliceByKey = new Map(spliceMembers.map((member) => [member.key, member]));
  const occurrences = new Map<string, FieldObservation>();
  let definitions = 0;
  for (const name of names) {
    const parsed = parse(readFileSync(path.join(dir, name), "utf8"));
    for (const item of parsed.items) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      if (keyword !== null && item.key !== keyword) {
        continue;
      }
      if (item.key === excludedKey) {
        continue;
      }
      definitions += 1;
      const written = new Map<string, PdxValue[]>();
      const spliceArity = new Map<string, boolean>();
      for (const field of item.value.items) {
        if (field.kind !== "entry" || field.key === nameField) {
          continue;
        }
        written.set(field.key, [...(written.get(field.key) ?? []), field.value]);
        const struct = structByField.get(field.key);
        if (struct !== undefined && field.value.kind === "container") {
          descendRepeatedStruct(field.value, struct, written);
        }
        const splice = spliceByKey.get(field.key);
        if (splice !== undefined && field.value.kind === "container") {
          descendSplice(field.value, splice, written, spliceArity);
        }
      }
      observe(occurrences, written, spliceArity);
    }
  }
  return { definitions, files: names.length, occurrences };
}

/**
 * Measures the emitted interface against the corpus.
 *
 * `spliced` names keys the interface admits without enumerating them: an alias
 * category spliced unkeyed into the definition body (`static_modifier`'s
 * modifier names) is one authoring member covering thousands of legal keys. They
 * count as covered, but never as `invented` — the emitter did not claim each
 * one individually, so "the corpus never writes it" says nothing about whether
 * the shape was read correctly.
 */
export function conformance(
  registry: string,
  corpus: RegistryCorpus,
  emitted: readonly string[],
  spliced: ReadonlySet<string> = new Set()
): ConformanceReport {
  const emittedSet = new Set(emitted);
  const expressible = (field: string): boolean => emittedSet.has(field) || spliced.has(field);
  const invented = emitted.filter((field) => !corpus.occurrences.has(field)).sort();
  const unexpressed = [...corpus.occurrences]
    .filter(([field]) => !expressible(field))
    .map(([field, observation]) => ({ field, count: observation.definitions }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
  let total = 0;
  let covered = 0;
  for (const [field, observation] of corpus.occurrences) {
    total += observation.definitions;
    if (expressible(field)) {
      covered += observation.definitions;
    }
  }
  return {
    registry,
    corpus,
    invented,
    unexpressed,
    coverage: total === 0 ? 1 : covered / total,
  };
}

/** The scopes one rule is legal in, or `"universal"` for a rule legal in all. */
export type RuleScopes = readonly string[] | "universal";

/**
 * The four ways a lowered type can disagree with the values behind it.
 *
 * `form` and `scope` are hard: the corpus writes something no value of the
 * emitted type can express, so the field is unfillable however legal it is.
 * `arity` and `literal` are softer — a list where the game happens never to
 * repeat is legal, and a value outside a closed union may be an upstream
 * spelling quirk.
 */
export type ShapeMismatchKind = "form" | "arity" | "literal" | "scope";

export interface ShapeMismatch {
  readonly field: string;
  readonly kind: ShapeMismatchKind;
  readonly detail: string;
}

/**
 * What the writer puts on the right of each runtime shape's key. `both` is a
 * field lowered to a union of a scalar and a block, dispatched at write time by
 * what the author passed.
 *
 * A shape missing here gets no form verdict rather than a guessed one.
 */
const WRITTEN_FORM = new Map<string, "scalar" | "block" | "both">([
  ["value", "scalar"],
  ["dual", "both"],
  ["valueList", "block"],
  ["trigger", "block"],
  ["effect", "block"],
  ["economicResources", "block"],
  ["economicResourcesNoProduce", "block"],
  ["triggeredModifierBlock", "block"],
  ["modifierBlock", "block"],
  ["weightBlock", "block"],
  ["weightBlockWithLoc", "block"],
  ["weightedEvents", "block"],
  ["struct", "block"],
  ["aliasStruct", "block"],
  ["structMap", "block"],
  ["scalarMap", "block"],
  ["repeatedStruct", "block"],
]);

/**
 * Whether a rule legal in `rule` can be written into a field typed for `field`.
 *
 * `Trigger<S>` is contravariant in its scope, so the field admits exactly the
 * rules legal in *every* scope it names. The `"any"` case is the one worth
 * spelling out: an unpinned `Trigger<ScopeName>` names every scope there is, so
 * only a universal rule satisfies it — "valid anywhere" as a field type means
 * "accepts almost nothing", which is why an unannotated field can be emitted,
 * required, and unfillable all at once.
 */
function fieldAdmits(field: readonly string[] | "any", rule: RuleScopes): boolean {
  if (rule === "universal") {
    return true;
  }
  if (field === "any") {
    return false;
  }
  return field.every((scope) => rule.includes(scope));
}

/**
 * The declared scopes under which one definition's writes are all expressible.
 *
 * A parameterised field's scope is chosen once per *definition*, so this is the
 * question the gate has to ask per definition rather than per key: asking
 * whether each key is legal under *some* declared scope would pass a definition
 * that writes a planet-only rule beside a ship-only one, which no single choice
 * of S can express. Keys nothing knows are skipped, as everywhere else.
 */
function workableScopes(
  declared: readonly string[],
  keys: ReadonlySet<string>,
  scopesOf: (key: string) => RuleScopes | null
): readonly string[] {
  const scoped = [...keys].flatMap((key) => {
    const rule = scopesOf(key);
    return rule === null ? [] : [rule];
  });
  return declared.filter((scope) => scoped.every((rule) => fieldAdmits([scope], rule)));
}

/**
 * Measures each lowered type against the values the corpus writes under it.
 *
 * The other half of {@link conformance}, which only asks whether a field is
 * present. Fields the corpus never writes are silent here: the corpus is a
 * lower bound, so absence proves nothing about shape either.
 *
 * `scopesOf` resolves one trigger or effect key to the scopes it is legal in,
 * or `null` when nothing knows it — a vanilla scripted trigger, a scope link, a
 * rule the emitter skipped. Unknown keys are skipped rather than counted
 * against the field, since they are a coverage gap in the rules rather than
 * evidence about this field's scope.
 */
export function shapeConformance(
  corpus: RegistryCorpus,
  emitted: readonly EmittedField[],
  scopesOf: (clause: "trigger" | "effect", key: string) => RuleScopes | null
): readonly ShapeMismatch[] {
  const mismatches: ShapeMismatch[] = [];
  for (const field of emitted) {
    const observation = corpus.occurrences.get(field.field);
    if (observation === undefined) {
      continue;
    }
    const report = (kind: ShapeMismatchKind, detail: string): void => {
      mismatches.push({ field: field.field, kind, detail });
    };
    const form = WRITTEN_FORM.get(field.shape);
    const seen = `${observation.definitions} defs`;
    if (form === "block" && observation.scalars > 0) {
      report(
        "form",
        `lowered as ${field.shape}, but ${observation.scalars}/${seen} write a scalar ` +
          `(${[...observation.values].slice(0, 4).join(" ")})`
      );
    }
    if (form === "scalar" && observation.blocks > 0) {
      report(
        "form",
        `lowered as a scalar, but ${observation.blocks}/${seen} write a block ` +
          `(${[...observation.keys].slice(0, 4).join(" ") || "bare values"})`
      );
    }
    // A block whose interior form is wrong is the same defect one level in: a
    // list type against `{ trigger = { … } }`, or a struct against `{ a b c }`.
    // A dual is exempt: admitting two interiors is the whole point of it, and
    // the arms were each checked against the rules that produced them.
    if (observation.blocks > 0 && form === "block") {
      const bare = field.shape === "valueList";
      if (bare && observation.bareBlocks === 0) {
        report(
          "form",
          `lowered as a value list, but all ${observation.blocks} blocks are keyed ` +
            `(${[...observation.keys].slice(0, 4).join(" ")})`
        );
      }
      if (!bare && observation.keys.size === 0) {
        report("form", `lowered as ${field.shape}, but all ${observation.blocks} blocks are bare`);
      }
    }
    if (field.repeated && observation.repeated === 0) {
      report("arity", `lowered as a list, but no definition writes it twice (${seen})`);
    }
    if (field.literals !== undefined) {
      const closed = new Set(field.literals);
      const stray = [...observation.values].filter((value) => !closed.has(value));
      if (stray.length > 0) {
        report("literal", `outside the emitted union: ${stray.slice(0, 6).join(" ")}`);
      }
    }
    if (field.clause !== undefined && field.scope !== undefined) {
      const clause = field.clause;
      const rules = (key: string): RuleScopes | null => scopesOf(clause, key);
      if (typeof field.scope === "object" && "parameter" in field.scope) {
        // Per definition, not per key: the author picks one scope for the whole
        // definition, so a definition whose writes have no scope in common is
        // unfillable even though each rule alone is fine under some choice.
        const declared = field.scope.parameter;
        const stranded = observation.keysByDefinition.filter(
          (keys) => workableScopes(declared, keys, rules).length === 0
        );
        if (stranded.length > 0) {
          const worst = stranded[0]!;
          report(
            "scope",
            `no single scope of ${declared.join("/")} expresses one definition's ` +
              `own conditions here (${[...worst].slice(0, 6).join(" ")})`
          );
        }
      } else {
        const scope = field.scope;
        const rejected = [...observation.keys].filter((key) => {
          const scopes = rules(key);
          return scopes !== null && !fieldAdmits(scope, scopes);
        });
        if (rejected.length > 0) {
          report(
            "scope",
            `typed for scope ${scope === "any" ? "ScopeName" : scope.join("/")}, which rejects ` +
              rejected.slice(0, 6).join(" ") +
              (rejected.length > 6 ? ` +${rejected.length - 6}` : "")
          );
        }
      }
    }
  }
  return mismatches;
}

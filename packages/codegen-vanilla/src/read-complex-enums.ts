/**
 * The members a complex enum's declaration derives from installed files.
 *
 * A complex enum is exact membership — the emitted union *is* the set of legal
 * values — so a file this cannot read is recorded as an {@link ExtractionGap}
 * rather than skipped. Skipping it would publish a union short of members the
 * game accepts, and the SDK would then reject them.
 *
 * The exception is a file proved unable to hold a member whatever it contains,
 * which is what {@link mayHoldMember} decides. The install ships prose under
 * `.txt` in directories these enums search, and a gap over a file that cannot
 * bear on the answer is a false one.
 *
 * Parser repairs are the other thing entirely and stay a count: a shipped file
 * the parser fixed the way the game does was still read whole.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ComplexEnum } from "@pdx-ts/codegen-cwt/cwt/rules";
import { parse, type PdxItem } from "@pdx-ts/pdxscript";

import { compareIdentifiers } from "./emit.ts";
import type { ExtractionGap } from "./extraction-gap.ts";

type ContainerEntry = Extract<PdxItem, { kind: "entry" }> & {
  readonly value: Extract<Extract<PdxItem, { kind: "entry" }>["value"], { kind: "container" }>;
};

/** One complex enum's members, and what reading them saw. */
export interface ComplexEnumMembers {
  readonly name: string;
  readonly members: readonly string[];
  readonly files: number;
  /** Parsed files whose structure reached this enum's selector path. */
  readonly selectorFiles: number;
  /** Parser repairs across the files that were read. Reported, never fatal. */
  readonly diagnostics: number;
  /** The enum's directory holds no matching file in this install. */
  readonly missing: boolean;
  /**
   * Files that could not be read, so {@link members} is short by an unknown
   * amount. Emission refuses while this is non-empty.
   */
  readonly gaps: readonly ExtractionGap[];
}

function walk(dir: string, extension: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory()
      ? walk(file, extension)
      : name.endsWith(extension)
        ? [file]
        : [];
  });
}

function entriesAt(
  items: readonly PdxItem[],
  pathToItems: readonly string[]
): { readonly items: readonly PdxItem[]; readonly reached: boolean } {
  let current: readonly (readonly PdxItem[])[] = [items];
  for (const key of pathToItems) {
    current = current.flatMap((siblings) =>
      siblings.flatMap((item) =>
        item.kind === "entry" && item.key === key && item.value.kind === "container"
          ? [item.value.items]
          : []
      )
    );
    if (current.length === 0) {
      return { items: [], reached: false };
    }
  }
  return { items: current.flat(), reached: true };
}

function collect(
  items: readonly PdxItem[],
  spec: ComplexEnum,
  add: (name: string) => void
): boolean {
  const roots = spec.startFromRoot
    ? [items]
    : items
        .filter(
          (item): item is ContainerEntry => item.kind === "entry" && item.value.kind === "container"
        )
        .map((item) => item.value.items);
  let reached = false;
  for (const root of roots) {
    const selected = entriesAt(root, spec.selector.path);
    reached ||= selected.reached;
    if (spec.selector.kind === "key") {
      for (const item of selected.items) {
        if (item.kind === "entry") {
          add(item.key);
        }
        if (item.kind === "str") {
          add(item.value);
        }
        if (item.kind === "num") {
          add(item.lexeme);
        }
      }
      continue;
    }
    for (const item of selected.items) {
      if (item.kind === "entry" && item.key === spec.selector.key && item.value.kind === "str") {
        add(item.value.value);
      }
      if (item.kind === "entry" && item.key === spec.selector.key && item.value.kind === "num") {
        add(item.value.lexeme);
      }
    }
  }
  return reached;
}

/**
 * Reads the members one complex enum declares, from the install.
 *
 * @param root - The install root.
 * @param spec - The CWT `complex_enum` declaration: which directory, which
 * extension, and where in each file the names sit.
 * @returns The members found, and the files that could not be read. A gap is
 * returned rather than thrown so one run reports every unreadable file instead
 * of only the first; {@link assertExtractionComplete} is what stops it being
 * published.
 */
/**
 * The keys a member cannot exist without, for this enum's selector.
 *
 * Every one of these must appear somewhere in a file before that file can hold
 * a member: the block the selector descends into, and — where the name is a
 * field's value rather than a key — the field itself. Only the first path
 * segment is needed; the deeper ones only narrow further.
 *
 * Empty when the selector names no key at all, which is what
 * `complex_enum[job_tag]` looks like: every key in the file is a member, so
 * nothing about a file rules it out.
 */
function requiredKeys(spec: ComplexEnum): readonly string[] {
  return [
    ...(spec.selector.path.length > 0 ? [spec.selector.path[0]!] : []),
    ...(spec.selector.kind === "scalar" && spec.selector.key !== undefined
      ? [spec.selector.key]
      : []),
  ];
}

/**
 * Whether an unparseable file could have held a member of this enum.
 *
 * The install ships files that are not script under extensions that usually
 * are: `interface/credits.txt` is the game's credits, prose down to the
 * exclamation mark on line 10878, and `complex_enum[scrollbar_type]` searches
 * `interface/` for `.txt`. Refusing to generate over that would be refusing
 * over a file whose contents cannot bear on the answer.
 *
 * So this is a proof rather than a waiver, and it needs no maintained list of
 * blessed files: a member of this enum can only come from inside a block named
 * by {@link requiredKeys}, so a file where one of those identifiers does not
 * occur *at all* cannot contribute one under any parse. Substring, not syntax,
 * because syntax is exactly what is unavailable — and an accidental match only
 * costs a gap that was not real, never hides one that was.
 */
function mayHoldMember(text: string, spec: ComplexEnum): boolean {
  const required = requiredKeys(spec);
  return required.length === 0 || required.every((key) => text.includes(key));
}

/**
 * Reads the members one complex enum declares, from the install.
 *
 * @param root - The install root.
 * @param spec - The CWT `complex_enum` declaration: which directory, which
 * extension, and where in each file the names sit.
 * @returns The members found, and the files that could not be read and could
 * have mattered. A gap is returned rather than thrown so one run reports every
 * such file instead of only the first; `assertExtractionComplete` is what stops
 * it being published.
 */
export function readComplexEnumMembers(root: string, spec: ComplexEnum): ComplexEnumMembers {
  const dir = path.join(root, spec.path.replace(/^game\//, ""));
  const files = walk(dir, spec.extension);
  const members = new Set<string>();
  const gaps: ExtractionGap[] = [];
  let diagnostics = 0;
  let selectorFiles = 0;
  for (const file of files) {
    const source = path.relative(root, file).split(path.sep).join("/");
    const gap = (error: unknown): void => {
      // Not `diagnostics += 1`, which is what this used to do: a file nothing
      // read is not a repair, and counting it as one put a silent hole in an
      // exact union behind a number that reads as "the parser tidied something".
      gaps.push({
        inventory: spec.name,
        source,
        detail: error instanceof Error ? error.message : String(error),
      });
    };

    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      // Nothing to prove anything with: a file that would not open could have
      // held anything.
      gap(error);
      continue;
    }

    let parsed: ReturnType<typeof parse>;
    try {
      parsed = parse(text, path.basename(file));
    } catch (error) {
      if (mayHoldMember(text, spec)) {
        gap(error);
      }
      continue;
    }
    diagnostics += parsed.diagnostics.length;
    if (collect(parsed.items, spec, (member) => members.add(member))) {
      selectorFiles += 1;
    }
  }
  return {
    name: spec.name,
    members: [...members].sort(compareIdentifiers),
    files: files.length,
    selectorFiles,
    diagnostics,
    missing: files.length === 0,
    gaps,
  };
}

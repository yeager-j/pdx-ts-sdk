/**
 * The sync gate for `build.ts`'s `SWAP_IDENTITIES` table.
 *
 * The table hand-copies three facts about the vendored rules per row: which
 * registries declare a nested "swap" type via `base_type`, which member of the
 * definition holds that swap block, and where inside it the ids are spelled.
 * Its comment used to claim a vendor bump "is a diff on this list" — true of
 * the facts, false as a mechanism, since nothing checked them. This is that
 * mechanism: the vendored config is in-repo, so all three can be re-derived on
 * every test run rather than trusted.
 *
 * All three matter, and only the first is safe from a rename. A vendor bump
 * that moves `technology_swap`, or turns a record-keyed swap block into a
 * repeated one, leaves `base_type = technology` untouched — so a registry-only
 * comparison stays green while `readSwapPath` quietly returns nothing and the
 * dangling-reference guard starts rejecting references to perfectly valid swap
 * definitions. The path and keying are therefore derived too: from CWT for
 * where the rules put the block (`## type_key_filter` names the keyword,
 * `skip_root_key` names what encloses it), and from the generated field
 * metadata for how codegen lowered it.
 *
 * Hermetic — no game install, no network. Two stages, because neither alone
 * is both complete and honest: a raw token scan over every vendored `.cwt`
 * file finds the files that could declare one (cheap, and it cannot miss a
 * file), then those files alone are parsed with the same parser codegen uses,
 * which is what tells a declaration from the `##`/`###` comments and the
 * `starbase_type` substring a raw scan also hits. Parsing every file instead
 * is not an option: one vendored file (`common/leader_classes.cwt`) does not
 * parse at all, and it holds no `base_type` — a fact the prefilter establishes
 * rather than assumes.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCwt, type CwtNode } from "@pdx-ts/codegen-cwt/cwt/parser";
import { describe, expect, it } from "vitest";

import { SWAP_IDENTITIES, type SwapIdentity } from "../src/build.ts";
import type { ContentField } from "../src/content.ts";
import { CONTENT_REGISTRIES } from "../src/generated/content-registry.ts";

// Repo-root-relative: vitest runs from the workspace root, the same way
// `tests/codegen/content-snapshot.test.ts` reads this tree.
const CONFIG_ROOT = "vendor/cwtools-stellaris-config/config";

/**
 * `base_type` targets deliberately absent from `SWAP_IDENTITIES`, each with
 * the reason. Spelled one per entry rather than as a blanket allowlist: the
 * assertion below re-proves each reason instead of taking it on trust, so an
 * exclusion that stops being true fails here rather than quietly widening.
 */
const DOCUMENTED_EXCLUSIONS: Readonly<Record<string, string>> = {
  authority:
    "not an SDK registry — CONTENT_MANIFEST never registers it, so there is no " +
    "defineAuthority and no builtIds set for its swap ids to join",
};

interface BaseTypeDeclaration {
  /** The declaring `type[...]` name, e.g. `swapped_tradition`. */
  readonly typeName: string;
  /** The declared value, e.g. `tradition` or `civic_or_origin.civic`. */
  readonly baseType: string;
  /**
   * The CWT key path from the base definition's root down to the swap block,
   * e.g. `["tradition_swap"]` or `["swappable_data", "swap_type"]`.
   *
   * Derived, not read off one line: `## type_key_filter` names the keyword the
   * swap block is written under, and `skip_root_key` names what encloses it —
   * `any` is the base definition's own id, and any further segment is a
   * wrapper the rules put between the two (`job`'s `swappable_data`).
   */
  readonly keyPath: readonly string[];
  readonly file: string;
  readonly line: number;
}

function cwtFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return cwtFilesUnder(full);
    }
    return entry.isFile() && entry.name.endsWith(".cwt") ? [full] : [];
  });
}

/** `type[swapped_tradition]` -> `swapped_tradition`; anything else -> null. */
function typeDeclarationName(key: string): string | null {
  return /^type\[(.+)\]$/.exec(key)?.[1] ?? null;
}

/**
 * Files carrying a `base_type` token outside a comment. The left word boundary
 * is what keeps `starbase_type` — a real type name, an enum, and a trigger
 * alias — out; comments are cut because one `###` doc comment mentions it.
 * Deliberately over-inclusive: this only decides what to parse.
 */
function filesMentioningBaseType(): string[] {
  return cwtFilesUnder(CONFIG_ROOT).filter((file) => {
    const source = readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.split("#", 1)[0]!)
      .join("\n");
    return /(?<![A-Za-z0-9_])base_type\s*=/.test(source);
  });
}

/**
 * Every `base_type` in one file, found structurally: a `types` block, a
 * `type[...]` inside it, a `base_type` assignment inside that.
 */
function baseTypeDeclarations(file: string): BaseTypeDeclaration[] {
  const found: BaseTypeDeclaration[] = [];
  const inTypesBlock = (nodes: readonly CwtNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "assignment" || node.value.kind !== "block") {
        continue;
      }
      const typeName = typeDeclarationName(node.key.text);
      if (typeName === null) {
        continue;
      }
      let baseType: string | undefined;
      let baseTypeLine = node.line;
      // `skip_root_key = any` or `skip_root_key = { any swappable_data }`.
      let enclosing: string[] = [];
      for (const field of node.value.nodes) {
        if (field.kind !== "assignment") {
          continue;
        }
        if (field.key.text === "base_type" && field.value.kind === "scalar") {
          baseType = field.value.text;
          baseTypeLine = field.line;
        }
        if (field.key.text === "skip_root_key") {
          enclosing =
            field.value.kind === "scalar"
              ? [field.value.text]
              : field.value.nodes.flatMap((item) =>
                  item.kind === "value" && item.value.kind === "scalar" ? [item.value.text] : []
                );
        }
      }
      if (baseType === undefined) {
        continue;
      }
      const keyFilter = node.options.find((option) => option.name === "type_key_filter");
      const keyword = keyFilter?.value?.kind === "scalar" ? keyFilter.value.text : undefined;
      found.push({
        typeName,
        baseType,
        // `any` stands for the base definition's own id, which is the walk's
        // starting point rather than a member of it.
        keyPath: [
          ...enclosing.filter((segment) => segment !== "any"),
          ...(keyword === undefined ? [] : [keyword]),
        ],
        file,
        line: baseTypeLine,
      });
    }
  };
  const { nodes } = parseCwt(readFileSync(file, "utf8"), file);
  for (const node of nodes) {
    if (node.kind === "assignment" && node.key.text === "types" && node.value.kind === "block") {
      inTypesBlock(node.value.nodes);
    }
  }
  return found;
}

/**
 * The registry a `base_type` names. A dotted value names a *subtype* of its
 * base type (`civic_or_origin.civic`), and the registry declaring the swap
 * field is the bare type — the same qualified-to-bare reading the reference
 * guard's own `resolveTargetRegistries` does.
 */
function registryOf(baseType: string): string {
  const qualifier = baseType.indexOf(".");
  return qualifier === -1 ? baseType : baseType.slice(0, qualifier);
}

/** What the generated field metadata says a row's member path actually lowers. */
interface ResolvedField {
  /** The CWT keys the walked members carry, in order. */
  readonly keyPath: readonly string[];
  /** Where ids are spelled in the authored value, from the lowered shape. */
  readonly keying: SwapIdentity["keying"] | undefined;
}

/**
 * Walks a row's member path through the *generated* field metadata — the
 * codegen output regenerated from these same rules — and reports what it finds
 * there. This is the second half of the correspondence: CWT says where the
 * swap block lives and under which keyword, codegen says which member the SDK
 * authored for it and what shape that member takes, and the row hand-copies
 * both. Reading the shape here rather than re-deriving codegen's lowering
 * rules keeps this a comparison rather than a second implementation.
 */
function resolveField(
  registryType: string,
  memberPath: readonly string[]
): ResolvedField | { readonly missing: string } {
  const descriptor = CONTENT_REGISTRIES.find((entry) => entry.type === registryType);
  if (descriptor === undefined) {
    return { missing: `no registry "${registryType}" exists` };
  }
  let fields: readonly ContentField[] = descriptor.fields;
  const keyPath: string[] = [];
  let field: ContentField | undefined;
  for (const member of memberPath) {
    field = fields.find((candidate) => candidate.member === member);
    if (field === undefined) {
      return {
        missing: `"${registryType}" declares no field with member "${member}"${
          keyPath.length > 0 ? ` under ${keyPath.join(".")}` : ""
        }`,
      };
    }
    if (!("key" in field)) {
      // `inlineModifiers` splices its members into the parent block and owns
      // no key of its own; nothing a swap path can legally walk through.
      return {
        missing: `"${registryType}" field "${member}" is a top-level splice with no key of its own`,
      };
    }
    keyPath.push(field.key);
    fields = "fields" in field ? field.fields : [];
  }
  if (field === undefined) {
    return { missing: `the member path is empty` };
  }
  // A record of `key` blocks each carrying its own `name` (CWT shape 2) versus
  // a repeated anonymous struct lowered to an array (shape 3). Anything else
  // is neither, and says so rather than guessing one.
  const keying =
    field.shape === "repeatedStruct" && field.keying === "siblings"
      ? ("record-keys" as const)
      : field.shape === "struct" && field.repeated === true
        ? ("array-names" as const)
        : undefined;
  return { keyPath, keying };
}

/**
 * Everything wrong with one row, as messages naming it. A function over a row
 * rather than assertions inline, so the negative control below can feed it
 * perturbed rows and check it actually reports them.
 */
function rowProblems(row: SwapIdentity, declaredKeyPath: readonly string[]): string[] {
  const resolved = resolveField(row.registryType, row.path);
  const member = `${row.registryType}.${row.path.join(".")}`;
  if ("missing" in resolved) {
    return [
      `${member}: ${resolved.missing} — the swap field was renamed or moved, and this row now ` +
        `reads nothing, so no swap id of this registry counts as built`,
    ];
  }
  const problems: string[] = [];
  if (resolved.keyPath.join(".") !== declaredKeyPath.join(".")) {
    problems.push(
      `${member}: lowers the CWT field "${resolved.keyPath.join(".")}", but the rules declare ` +
        `this registry's swap block at "${declaredKeyPath.join(".")}" — the row points at the ` +
        `wrong field, so its ids are somebody else's`
    );
  }
  if (resolved.keying === undefined) {
    problems.push(
      `${member}: the generated field is neither a sibling-keyed repeatedStruct nor a repeated ` +
        `struct, so neither keying can read ids out of it`
    );
  } else if (resolved.keying !== row.keying) {
    problems.push(
      `${member}: the row says keying "${row.keying}" but the generated field spells its ids as ` +
        `"${resolved.keying}" — the extraction returns nothing, and every reference to one of ` +
        `this registry's swap definitions is rejected as dangling`
    );
  }
  return problems;
}

describe("SWAP_IDENTITIES against the vendored rules", () => {
  const candidateFiles = filesMentioningBaseType();
  const declarations = candidateFiles.flatMap((file) => baseTypeDeclarations(file));

  it("finds the vendored base_type declarations at all", () => {
    // Guards the gate itself: a scan that silently matched nothing — a moved
    // vendor path, a renamed config directory — makes every assertion below
    // vacuous, and it would pass.
    expect(candidateFiles.length).toBeGreaterThan(0);
    expect(declarations.length).toBeGreaterThan(0);
  });

  it("reads a declaration out of every file that mentions one", () => {
    // The two stages agreeing is what makes the structural walk trustworthy:
    // a `base_type` written somewhere the walk does not reach (not under
    // `types`, or under a `type[...]` spelled differently) would otherwise be
    // silently invisible to this gate rather than reported by it.
    const silent = candidateFiles.filter(
      (file) => !declarations.some((declaration) => declaration.file === file)
    );
    expect(
      silent,
      "these vendored files carry a base_type token that the structural scan did not find as " +
        "a declaration under `types = { type[...] = { ... } }` — the rules moved, and this " +
        "gate is no longer reading them correctly"
    ).toEqual([]);
  });

  it("accounts for every declared base_type as a row or a documented exclusion", () => {
    const unaccounted = declarations.filter(
      (declaration) =>
        !SWAP_IDENTITIES.some((row) => row.registryType === registryOf(declaration.baseType)) &&
        DOCUMENTED_EXCLUSIONS[registryOf(declaration.baseType)] === undefined
    );
    expect(
      unaccounted.map((declaration) => `${declaration.baseType} (${declaration.typeName})`),
      "the vendored rules declare a base_type this build does not account for. Its swap ids " +
        "will not join the declaring registry's built-id set, so the reference guard rejects " +
        "every reference to one. Add a row to SWAP_IDENTITIES in build.ts, or — if the " +
        "registry is not one the SDK defines — a DOCUMENTED_EXCLUSIONS entry here.\n" +
        unaccounted.map((d) => `  ${d.file}:${d.line}  base_type = ${d.baseType}`).join("\n")
    ).toEqual([]);
  });

  it("declares no row the vendored rules do not back", () => {
    const declaredRegistries = new Set(declarations.map((d) => registryOf(d.baseType)));
    const unbacked = SWAP_IDENTITIES.map((row) => row.registryType).filter(
      (registryType) => !declaredRegistries.has(registryType)
    );
    expect(
      unbacked,
      "SWAP_IDENTITIES folds swap ids into a registry the vendored rules no longer declare a " +
        "base_type for — the row is either stale or misspelled"
    ).toEqual([]);
  });

  it("backs every row's field path and keying with the rules and the generated metadata", () => {
    // `registryType` alone was the whole comparison, and it is the one part of
    // a row a vendor rename cannot break: `technology_swap` moving, or turning
    // from a record-keyed block into a repeated one, keeps `base_type =
    // technology` exactly as it was while `readSwapPath` starts returning
    // nothing — a silently empty built-id set, and the reference guard
    // rejecting every reference to a valid swap definition.
    const problems = SWAP_IDENTITIES.flatMap((row) => {
      const declared = declarations.filter(
        (declaration) => registryOf(declaration.baseType) === row.registryType
      );
      if (declared.length !== 1) {
        return [
          `${row.registryType}: expected exactly one base_type declaration, found ` +
            `${declared.length}`,
        ];
      }
      return rowProblems(row, declared[0]!.keyPath);
    });
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("reports a moved path or a flipped keying", () => {
    // The negative control for the assertion above: it passes today, and this
    // is what says it would not pass on the drift it claims to catch. Rows are
    // perturbed in memory — the real table and the vendored rules are
    // untouched — one perturbation per failure mode the reviewer named.
    const tradition = SWAP_IDENTITIES.find((row) => row.registryType === "tradition")!;
    const declared = declarations.find(
      (declaration) => registryOf(declaration.baseType) === "tradition"
    )!.keyPath;

    const renamed = rowProblems({ ...tradition, path: ["traditionSwaps"] }, declared);
    expect(renamed.join("\n")).toContain('declares no field with member "traditionSwaps"');

    // A member that exists but is a different field: the "moved" case, which
    // a mere existence check would pass.
    const moved = rowProblems({ ...tradition, path: ["aiWeight"] }, declared);
    expect(moved.join("\n")).toContain("tradition_swap");

    const flipped = rowProblems({ ...tradition, keying: "array-names" }, declared);
    expect(flipped.join("\n")).toContain('spells its ids as "record-keys"');
  });

  it("keeps each documented exclusion true", () => {
    // The `authority` exclusion is a claim about `CONTENT_MANIFEST`, not about
    // the rules: it holds only while the SDK has no such registry. Adding one
    // (a `defineAuthority`) makes the exclusion wrong and this fail, which is
    // the point of spelling exclusions out one by one.
    for (const [registryType, reason] of Object.entries(DOCUMENTED_EXCLUSIONS)) {
      expect(
        CONTENT_REGISTRIES.some((descriptor) => descriptor.type === registryType),
        `"${registryType}" is excluded from SWAP_IDENTITIES because it is ${reason}, but the ` +
          `SDK now defines it as a registry — it needs a row rather than an exclusion`
      ).toBe(false);
    }
  });
});

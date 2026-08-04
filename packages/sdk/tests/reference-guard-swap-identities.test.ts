/**
 * The sync gate for `build.ts`'s `SWAP_IDENTITIES` table.
 *
 * The table hand-copies a fact about the vendored rules: which registries
 * declare a nested "swap" type via `base_type`, whose ids the reference guard
 * must count as built. Its comment used to claim a vendor bump "is a diff on
 * this list" — true of the fact, false as a mechanism, since nothing checked
 * it. This is that mechanism: the vendored config is in-repo, so the claim can
 * be re-derived on every test run rather than trusted.
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

import { SWAP_IDENTITIES } from "../src/build.ts";
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
      for (const field of node.value.nodes) {
        if (
          field.kind === "assignment" &&
          field.key.text === "base_type" &&
          field.value.kind === "scalar"
        ) {
          found.push({ typeName, baseType: field.value.text, file, line: field.line });
        }
      }
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

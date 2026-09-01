/**
 * Renders `content-public.ts`, the generated barrel the SDK's root index
 * re-exports its whole content-type surface through.
 *
 * Each module contributes the names its own emission declared public, plus
 * the nested types `PUBLIC_NESTED_TYPES` adds to it. Every published name is
 * checked against the module that is supposed to declare it, so neither half
 * can name a type the generator stopped emitting.
 */

import { compareStrings, docComment } from "../../naming.ts";
import { PUBLIC_NESTED_TYPES } from "../../policy/public-surface.ts";

/** One generated content module offered to the public barrel. */
export interface PublicBarrelModule {
  /** Generated module file name, e.g. `technology.ts`. */
  readonly file: string;
  /**
   * Every name the module's emission declared as an export, recorded where it
   * was rendered. Every published name is checked against these.
   */
  readonly exportedNames: readonly string[];
  /** Type names the module's own emission declares public. */
  readonly publicTypes: readonly string[];
}

/** The emission-derived and curated names each module publishes, keyed by file. */
function publishedNames(modules: readonly PublicBarrelModule[]): Map<string, Set<string>> {
  const published = new Map(
    modules.map((module) => [module.file, new Set(module.publicTypes)] as const)
  );
  for (const row of PUBLIC_NESTED_TYPES) {
    const names = published.get(row.module);
    if (names === undefined) {
      throw new Error(
        `PUBLIC_NESTED_TYPES names module "${row.module}", which codegen does not emit`
      );
    }
    for (const name of row.names) {
      names.add(name);
    }
  }
  return published;
}

/**
 * One module's re-export statement, empty for a module that publishes nothing.
 * A name the module does not export throws rather than reaching the barrel.
 */
function exportStatement(module: PublicBarrelModule, names: ReadonlySet<string>): string {
  if (names.size === 0) {
    return "";
  }
  const exported = new Set(module.exportedNames);
  const missing = [...names].filter((name) => !exported.has(name)).sort(compareStrings);
  if (missing.length > 0) {
    throw new Error(
      `The public barrel would export ${missing.join(", ")} from "./${module.file}", which ` +
        "declares no such export"
    );
  }
  const sorted = [...names].sort(compareStrings);
  return `export type { ${sorted.join(", ")} } from "./${module.file}";\n`;
}

/**
 * Emits the public content-type barrel from the modules the generator just produced.
 * Modules and names are sorted, so the same emissions always render the same text.
 */
export function contentPublicBarrel(modules: readonly PublicBarrelModule[]): string {
  const published = publishedNames(modules);
  return (
    docComment([
      "The content types an SDK author can name.",
      "",
      "Every name is derived from the tables that generate the content modules;",
      "`packages/codegen-cwt/src/policy/public-surface.ts` is the only place a",
      "further generated type becomes public.",
    ]) +
    [...modules]
      .sort((left, right) => compareStrings(left.file, right.file))
      .map((module) => exportStatement(module, published.get(module.file)!))
      .join("")
  );
}

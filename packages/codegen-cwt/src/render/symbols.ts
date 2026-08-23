/**
 * The SDK symbols the generated modules spell, and the imports that carry them.
 *
 * Every generated module under `packages/sdk/src/generated/` reaches for a fixed
 * vocabulary of hand-written SDK symbols — `Trigger`, `ContentField`, `kv`,
 * `refId`. Which module a name lives in, and whether it is a type or a value, is
 * one fact per name, so it is recorded once here. The emitters then declare a
 * *use* of a name at the point they write it into the output
 * (`Emitter.use`/`Emitter.useFrom`), and {@link renderImports} turns the
 * recorded uses into the import block. Nothing reads the emitted text back to
 * work out what it needs.
 *
 * A name in this table has exactly one source module: {@link KNOWN_SYMBOLS}
 * throws on a duplicate rather than letting two rows disagree. Names the
 * generator computes rather than spells — `ParsedTechnology`, `TechnologyRef`,
 * an enum alias — are not in the table; they go through `Emitter.useFrom`, which
 * takes the module explicitly.
 *
 * Module specifiers are written as the generated file sees them, which is why
 * they are plain relative paths: every module this table serves is written into
 * `packages/sdk/src/generated/`, so one spelling per name is enough.
 */

/** Whether a generated module uses an imported name as a TypeScript type or runtime value. */
export type SymbolKind = "type" | "value";

/** The authoritative module and import kind for one hand-written SDK symbol. */
export interface KnownSymbol {
  /** The module specifier as written from the generated output directory. */
  readonly module: string;
  /** Whether generated files must retain the import at runtime. */
  readonly kind: SymbolKind;
}

interface ModuleSymbols {
  readonly module: string;
  readonly types?: readonly string[];
  readonly values?: readonly string[];
}

const SYMBOL_MODULES: readonly ModuleSymbols[] = [
  {
    module: "@pdx-ts/pdxscript",
    types: ["PdxEntry", "PdxItem", "PdxOp"],
    values: ["block", "cmp", "container", "kv", "scalar"],
  },
  { module: "../authoring/assets.ts", types: ["AssetFileItem"] },
  { module: "../content/authoring.ts", types: ["DefinedContent"] },
  {
    module: "../content/schema.ts",
    types: ["ContentField", "ContentLocalisation"],
    values: ["registerAliasStructFields"],
  },
  {
    module: "../content/types.ts",
    types: [
      "EconomicResourceBlock",
      "EconomicResourceBlockNoProduce",
      "EconomicResourceOperation",
      "EffectBlock",
      "ModifierClosure",
      "TriggeredModifier",
      "WeightBlock",
      "WeightBlockWithLoc",
      "WithFrom",
    ],
  },
  { module: "../references.ts", types: ["ContentRefUse"] },
  {
    module: "../script/effects/types.ts",
    types: ["EffectPath", "Modifier", "ScopeValue", "StructuralEffects"],
  },
  {
    module: "../script/scalar.ts",
    values: ["isComparisonList", "isStructuredValue", "mapEntries", "refId"],
  },
  {
    module: "../script/trigger-core.ts",
    types: ["ScriptValue", "Trigger"],
    values: ["scriptValueScalar", "trigger"],
  },
  {
    module: "../stellaris/vanilla/patch.ts",
    types: ["ContentPatchItem", "PatchInput", "PatchedContent"],
  },
  { module: "../stellaris/vanilla/parsed-definitions.ts", types: ["AnyOf"] },
  { module: "./scopes.ts", types: ["ScopeName"] },
];

function addKnownSymbols(
  table: Map<string, KnownSymbol>,
  module: string,
  names: readonly string[] | undefined,
  kind: SymbolKind
): void {
  for (const name of names ?? []) {
    const existing = table.get(name);
    if (existing !== undefined) {
      throw new Error(
        `Symbol "${name}" is declared by both ${existing.module} and ${module}; ` +
          "a name has one source module or the import table has no authority"
      );
    }
    table.set(name, { module, kind });
  }
}

function buildKnownSymbols(): ReadonlyMap<string, KnownSymbol> {
  const table = new Map<string, KnownSymbol>();
  for (const entry of SYMBOL_MODULES) {
    addKnownSymbols(table, entry.module, entry.types, "type");
    addKnownSymbols(table, entry.module, entry.values, "value");
  }
  return table;
}

/** The authoritative module and import kind for every fixed SDK symbol available to emitters. */
export const KNOWN_SYMBOLS = buildKnownSymbols();

/**
 * Returns the authoritative import metadata for a fixed SDK symbol.
 * Throws with the caller's remediation hint when the name is not registered.
 */
export function knownSymbol(name: string, hint: string): KnownSymbol {
  const symbol = KNOWN_SYMBOLS.get(name);
  if (symbol === undefined) {
    throw new Error(
      `"${name}" is not a known SDK symbol (KNOWN_SYMBOLS in render/symbols.ts). ${hint}`
    );
  }
  return symbol;
}

/**
 * Collects named and side-effect imports while one generated file is emitted.
 * Repeated named imports are idempotent, while conflicting type/value uses fail immediately.
 */
export class ImportRecorder {
  private readonly named = new Map<string, Map<string, SymbolKind>>();
  private readonly sideEffect = new Set<string>();

  /**
   * Records one named import, combining repeated uses of the same symbol.
   * A symbol cannot be recorded as both a type and a value from the same module.
   */
  add(module: string, name: string, kind: SymbolKind): void {
    const moduleImports = this.named.get(module) ?? new Map<string, SymbolKind>();
    const existing = moduleImports.get(name);
    if (existing !== undefined && existing !== kind) {
      throw new Error(
        `Import "${name}" from ${module} is recorded as both a ${existing} and a ${kind}`
      );
    }
    moduleImports.set(name, kind);
    this.named.set(module, moduleImports);
  }

  /** Records a bare import needed for module initialization or registration. */
  addSideEffect(module: string): void {
    this.sideEffect.add(module);
  }

  /** Returns a detached snapshot that later recordings cannot mutate. */
  snapshot(): FileImports {
    const named = new Map<string, Map<string, SymbolKind>>();
    for (const [module, imports] of this.named) {
      named.set(module, new Map(imports));
    }
    return {
      named,
      sideEffect: new Set(this.sideEffect),
    };
  }
}

/** The named and side-effect imports required by one generated file. */
export interface FileImports {
  /** Named imports grouped by module specifier and symbol name. */
  readonly named: ReadonlyMap<string, ReadonlyMap<string, SymbolKind>>;
  /** Modules that must also be imported for their initialization effects. */
  readonly sideEffect: ReadonlySet<string>;
}

/**
 * Renders a deterministic import block for one generated file.
 * Modules and names are sorted, type/value imports stay distinct, and side-effect imports come
 * last so Prettier does not split the named-import block at a reordering barrier.
 */
export function renderImports(imports: FileImports): string {
  const statements: string[] = [];
  const namedImports = [...imports.named.entries()];
  namedImports.sort(([leftModule], [rightModule]) => {
    if (leftModule < rightModule) {
      return -1;
    }
    if (leftModule > rightModule) {
      return 1;
    }
    return 0;
  });
  for (const [module, names] of namedImports) {
    const namesOfKind = (kind: SymbolKind): string[] =>
      [...names]
        .filter(([, entry]) => entry === kind)
        .map(([name]) => name)
        .sort();
    const types = namesOfKind("type");
    const values = namesOfKind("value");
    if (types.length > 0) {
      statements.push(`import type { ${types.join(", ")} } from ${JSON.stringify(module)};\n`);
    }
    if (values.length > 0) {
      statements.push(`import { ${values.join(", ")} } from ${JSON.stringify(module)};\n`);
    }
  }
  for (const module of [...imports.sideEffect].sort()) {
    statements.push(`import ${JSON.stringify(module)};\n`);
  }
  return statements.join("");
}

/**
 * Renders a type-only import for a fixed list of names.
 * Names are deduplicated and sorted; an empty list produces no statement.
 */
export function importList(from: string, names: readonly string[]): string {
  if (names.length === 0) {
    return "";
  }
  return `import type { ${[...new Set(names)].sort().join(", ")} } from ${JSON.stringify(from)};\n`;
}

/**
 * Throws when a recorded named import is absent from the generated module body.
 * This check catches extra records only; TypeScript reports missing records as unresolved names.
 * The supplied identifier matcher defines what counts as a reference, including documentation.
 */
export function assertRecordedImportsAreUsed(
  outputFile: string,
  body: string,
  imports: FileImports,
  references: (code: string, identifier: string) => boolean
): void {
  const unused: string[] = [];
  for (const [module, names] of imports.named) {
    for (const name of names.keys()) {
      if (!references(body, name)) {
        unused.push(`${name} (${module})`);
      }
    }
  }
  if (unused.length > 0) {
    throw new Error(
      `${outputFile} records imports its body never references: ${unused.sort().join(", ")}. ` +
        "The recording is on a path whose text did not reach the output — move it to the " +
        "site that writes the name."
    );
  }
}

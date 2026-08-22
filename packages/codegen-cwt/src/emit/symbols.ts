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

export type SymbolKind = "type" | "value";

export interface KnownSymbol {
  readonly module: string;
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
  { module: "../script/scalar.ts", values: ["isStructuredValue", "refId"] },
  {
    module: "../script/trigger-core.ts",
    types: ["ScriptValue", "Trigger"],
    values: ["scriptValueScalar", "trigger"],
  },
  {
    module: "../stellaris/vanilla/patch.ts",
    types: ["ContentPatchItem", "PatchInput", "PatchedContent"],
  },
  { module: "../stellaris/vanilla/view.ts", types: ["AnyOf"] },
  { module: "./scopes.ts", types: ["ScopeName"] },
];

function buildKnownSymbols(): ReadonlyMap<string, KnownSymbol> {
  const table = new Map<string, KnownSymbol>();
  for (const entry of SYMBOL_MODULES) {
    const rows: readonly (readonly [readonly string[] | undefined, SymbolKind])[] = [
      [entry.types, "type"],
      [entry.values, "value"],
    ];
    for (const [names, kind] of rows) {
      for (const name of names ?? []) {
        const existing = table.get(name);
        if (existing !== undefined) {
          throw new Error(
            `Symbol "${name}" is declared by both ${existing.module} and ${entry.module}; ` +
              "a name has one source module or the import table has no authority"
          );
        }
        table.set(name, { module: entry.module, kind });
      }
    }
  }
  return table;
}

/** Every hand-written SDK symbol an emitter may write into generated output. */
export const KNOWN_SYMBOLS = buildKnownSymbols();

/**
 * Resolves one name against {@link KNOWN_SYMBOLS}, or throws.
 *
 * The single lookup every caller goes through, so "which module is this name
 * in" has one answer and "this name is not one we know" has one message.
 * `hint` says what to do about it, which differs by caller: an emitter spelling
 * a symbol is a different mistake from an overlay row naming one.
 */
export function knownSymbol(name: string, hint: string): KnownSymbol {
  const symbol = KNOWN_SYMBOLS.get(name);
  if (symbol === undefined) {
    throw new Error(
      `"${name}" is not a known SDK symbol (KNOWN_SYMBOLS in emit/symbols.ts). ${hint}`
    );
  }
  return symbol;
}

/**
 * One generated file's recorded imports.
 *
 * Named imports are keyed by module and then by name, so recording the same
 * symbol from two emitters is idempotent. `sideEffect` holds the modules that
 * additionally need a bare `import "./x.ts";` — the alias-category registration
 * ordering, which a type-only import would erase.
 */
export class ImportRecorder {
  private readonly named = new Map<string, Map<string, SymbolKind>>();
  private readonly sideEffect = new Set<string>();

  add(module: string, name: string, kind: SymbolKind): void {
    const names = this.named.get(module) ?? new Map<string, SymbolKind>();
    const existing = names.get(name);
    if (existing !== undefined && existing !== kind) {
      throw new Error(
        `Import "${name}" from ${module} is recorded as both a ${existing} and a ${kind}`
      );
    }
    names.set(name, kind);
    this.named.set(module, names);
  }

  addSideEffect(module: string): void {
    this.sideEffect.add(module);
  }

  snapshot(): FileImports {
    return {
      named: new Map([...this.named].map(([module, names]) => [module, new Map(names)] as const)),
      sideEffect: new Set(this.sideEffect),
    };
  }
}

export interface FileImports {
  readonly named: ReadonlyMap<string, ReadonlyMap<string, SymbolKind>>;
  readonly sideEffect: ReadonlySet<string>;
}

/**
 * The import block for one generated file.
 *
 * A pure function of the recorded set: modules sorted by specifier, names sorted
 * within a statement, type-only and value imports written as separate statements
 * — which is the repo's own source style, and which the Prettier import plugin
 * then merges into the single per-module statement the committed output carries.
 *
 * The bare side-effect imports come last, and deliberately so: the plugin treats
 * a side-effect import as a reordering barrier (it cannot know the import is
 * safe to move past), so one written in the middle would split the sorted block
 * in two.
 */
export function renderImports(imports: FileImports): string {
  const statements: string[] = [];
  for (const module of [...imports.named.keys()].sort()) {
    const names = imports.named.get(module)!;
    const of = (kind: SymbolKind): string[] =>
      [...names]
        .filter(([, entry]) => entry === kind)
        .map(([name]) => name)
        .sort();
    const types = of("type");
    const values = of("value");
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
 * A static `import type { ... } from "module"` statement for a fixed list of
 * names, deduplicated and sorted — the counterpart to {@link renderImports}
 * for a caller that already knows exactly which names it needs rather than
 * recording uses as it emits.
 */
export function importList(from: string, names: readonly string[]): string {
  if (names.length === 0) {
    return "";
  }
  return `import type { ${[...new Set(names)].sort().join(", ")} } from ${JSON.stringify(from)};\n`;
}

/**
 * Fails codegen when a file imports a symbol its body never mentions.
 *
 * One-way on purpose. The recorded set is the authority for what gets imported,
 * so this cannot be the check that a *missing* record is caught — that shows up
 * as a generated file referencing an undeclared name, which `npm run typecheck`
 * reports. What it does catch is the opposite mistake: a recording made on a
 * path whose text never reached the output, which would emit a dead import and
 * quietly grow the generated diff. `body` is matched on word boundaries, so a
 * name mentioned only in a doc comment counts — this is a floor, not a proof of
 * use.
 */
export function assertRecordedImportsAreUsed(
  file: string,
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
      `${file} records imports its body never references: ${unused.sort().join(", ")}. ` +
        "The recording is on a path whose text did not reach the output — move it to the " +
        "site that writes the name."
    );
  }
}

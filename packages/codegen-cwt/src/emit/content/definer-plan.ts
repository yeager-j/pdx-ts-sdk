/**
 * Plans one registry's share of both definer-emission outputs.
 *
 * `content-definers.ts` and `content-capability.ts` need the same per-registry
 * facts — the definer chunk, the capability members and bindings, the mint
 * rows, the witness tables. {@link planRegistryDefiner} computes them once per
 * registry; `definers.ts` folds the plans into the definer module and
 * `capability.ts` folds them into the capability module.
 */

import {
  camelCase,
  constantCase,
  docComment,
  indefiniteArticle,
  pascalCase,
  spokenName,
} from "../../naming.ts";
import { assertContentWitnessMembersKnown } from "../../overlay/audit.ts";
import {
  CONTENT_CONTRIBUTION_SINKS,
  CONTENT_PATCH_REGISTRIES,
  CONTENT_SUBTYPE_REFERENCE_REFINEMENTS,
  CONTENT_WITNESSES,
  EXACT_NAME_MINTS,
  HAND_WRITTEN_CONTENT_DEFINERS,
  MINT_SHAPE_OVERLAYS,
  SHAPE_MINT_REGISTRY,
  SPRITE_SHAPE_MINTS,
  type ContentPatchRegistry,
  type ContentSubtypeReferenceRefinement,
  type ContentWitness,
  type ContributionSink,
  type ExactNameMint,
  type HandWrittenDefiner,
  type MintShape,
  type SpriteShapeMint,
} from "../../overlay/index.ts";
import type { ContentManifestEntry } from "../../policy/manifest.ts";
import type { ContentEmission } from "./content-type.ts";

/** One content registry as the definer emitters receive it. */
export interface DefinerContent {
  /** Manifest row that authorizes the registry and supplies its id policy. */
  manifest: ContentManifestEntry;
  /** Registry name exposed through the SDK capability. */
  registry: string;
  /** CWT reference brand definitions from this registry satisfy. */
  referenceName: string;
  /** Content-type emission the definers place and reference. */
  emission: ContentEmission;
}

/** One row of the capability module's generated `EXACT_NAME_MINTS` table. */
export interface ExactNameMintRow {
  /** Capability method that uses the exact-name mint policy. */
  readonly method: string;
  /** Runtime pattern for an ordinary logical name. */
  readonly namePattern: string;
  /** Runtime pattern for a complete name supplied with `prefix: false`. */
  readonly exactNamePattern: string;
}

/** One registry's share of both definer-emission outputs. */
export interface RegistryDefinerPlan {
  /** The input row the plan was computed from. */
  readonly content: DefinerContent;
  /** The registry's `content-definers.ts` text: item union, then definers. */
  readonly chunk: string;
  /** Runtime item types beyond `ContentItem` this registry's union names. */
  readonly itemTypes: readonly string[];
  /** Method declarations contributed to `ContentCapabilityMethods`. */
  readonly capabilityMembers: readonly string[];
  /** Runtime method bindings contributed by the registry. */
  readonly capabilityBindings: readonly string[];
  /** Definer names the capability bindings call into `content-definers.ts`. */
  readonly runtimeDefiners: readonly string[];
  /** Optional `IdProfile` member for a registry with segmented ids. */
  readonly profileMember: string | null;
  /** Default value for {@link RegistryDefinerPlan.profileMember}. */
  readonly defaultProfileMember: string | null;
  /** Method and fixed head for a registry whose id has no profile segment. */
  readonly mintShapeRow: {
    /** Capability method whose mint uses the fixed head. */
    readonly method: string;
    /** Literal prefix placed before the capability prefix and logical name. */
    readonly head: string;
  } | null;
  /** Exact-name runtime policy contributed by this registry. */
  readonly exactNameRow: ExactNameMintRow | null;
  /** Generated name aliases contributed by sprite shape mints. */
  readonly shapeMintTypes: readonly string[];
  /** The names those aliases bind, which an author names to type a minted definition. */
  readonly shapeMintTypeNames: readonly string[];
  /** Reference types required by the generated shape-mint signatures. */
  readonly shapeMintRefTypes: readonly string[];
  /** The emitted nested-definition member table, for the capability module. */
  readonly nestedDefinitionTable: string | null;
  /**
   * The `CONTENT_WITNESSES` row this registry used, carried here so the
   * import blocks can ask which witness type names need importing without
   * rescanning the overlay by registry name.
   */
  readonly witness: ContentWitness | null;
  /** Hand-written definer graft replacing mechanical generation for this registry. */
  readonly graft: HandWrittenDefiner | null;
  /** Whether the registry contributes a whole-object vanilla patch surface. */
  readonly patchable: boolean;
  /** Whether the registry contributes to an id-less additive sink. */
  readonly contributes: boolean;
  /** The report line for a grafted definer. */
  readonly grafted: string | null;
}

/**
 * The derived facts every section of one registry's plan reads: the emitted
 * names, the overlay rows that apply, and the witness spellings the item
 * union, the capability surface, and the definer functions share.
 */
interface RegistryDefinerFacts {
  readonly registry: string;
  readonly emission: ContentEmission;
  readonly manifest: ContentManifestEntry;
  /** The emitted type name (`AscensionPerk`). */
  readonly name: string;
  /** The registry name as an emitted string literal. */
  readonly key: string;
  readonly spoken: string;
  readonly article: string;
  /** The capability method name (`ascensionPerk`). */
  readonly method: string;
  /** The minted-id type the capability signatures name for this registry. */
  readonly minted: string;
  readonly mintShape: MintShape | undefined;
  readonly exactName: ExactNameMint | undefined;
  readonly graft: HandWrittenDefiner | undefined;
  readonly patchable: ContentPatchRegistry | undefined;
  readonly contribution: ContributionSink | undefined;
  readonly referenceRefinement: ContentSubtypeReferenceRefinement | undefined;
  readonly contentWitness: ContentWitness | undefined;
  /** The `Omit` member union an `intersects` witness carves out, `""` otherwise. */
  readonly economicWitnessOmit: string;
  readonly nestedDefinitionMembers: readonly string[];
  readonly nestedDefinitionTable: string;
}

function registryDefinerFacts(content: DefinerContent): RegistryDefinerFacts {
  const { registry, emission } = content;
  const name = emission.typeName;
  const key = JSON.stringify(registry);
  const spoken = spokenName(registry);
  const article = indefiniteArticle(spoken);
  const graft = HAND_WRITTEN_CONTENT_DEFINERS.get(registry);
  const patchable = CONTENT_PATCH_REGISTRIES.get(registry);
  const contribution = CONTENT_CONTRIBUTION_SINKS.get(registry);
  const referenceRefinement = CONTENT_SUBTYPE_REFERENCE_REFINEMENTS.get(registry);
  const method = camelCase(registry);
  const mintShape = MINT_SHAPE_OVERLAYS.get(registry);
  const exactName = EXACT_NAME_MINTS.get(registry);
  // An exact name is the complete id, so the mint must be bare: a fixed head
  // would still be prepended and the name would not be exact. The generic
  // member/binding emission below is the only shape the opt-out is written
  // for, so a grafted or scope-parameterised registry cannot carry a row.
  if (exactName !== undefined) {
    if (mintShape === undefined || mintShape.head !== undefined) {
      throw new Error(
        `EXACT_NAME_MINTS row "${registry}" requires a bare MINT_SHAPE_OVERLAYS row (no head)`
      );
    }
    if (graft !== undefined || emission.scopeParameter !== null) {
      throw new Error(
        `EXACT_NAME_MINTS row "${registry}" targets a grafted or scope-parameterised registry, ` +
          "which the emitted overloads do not carry"
      );
    }
  }
  // A shaped registry has no `IdProfile` member to index, so its minted type
  // is the segmentless one. `MintedIdOf` resolves both, and spelling the
  // narrower `MintedContentId` where it applies keeps the emitted signature
  // saying which of the two a registry uses.
  const minted =
    mintShape === undefined
      ? `MintedContentId<P, I, ${JSON.stringify(method)}, Name>`
      : `MintedIdOf<P, I, ${JSON.stringify(method)}, Name>`;
  const nestedDefinitionMembers = emission.emittedFields
    .filter((field) => field.shape === "repeatedStruct")
    .map((field) => camelCase(field.field))
    .sort();
  const nestedDefinitionTable = `${constantCase(emission.typeName)}_NESTED_DEFINITION_MEMBERS`;
  // CONTENT_WITNESSES (packages/codegen-cwt/src/overlay/index.ts) replaces
  // per-registry branches here: a registry either has no row (ordinary def,
  // no `W`) or has exactly one of the two modes the schema carries evidence
  // for (SDK-260).
  const contentWitness = CONTENT_WITNESSES.get(registry);
  if (contentWitness !== undefined) {
    assertContentWitnessMembersKnown(registry, contentWitness, emittedMemberNames(emission));
  }
  const economicWitnessOmit =
    contentWitness?.mode === "intersects"
      ? contentWitness.omit.map((entry) => JSON.stringify(entry.member)).join(" | ")
      : "";
  return {
    registry,
    emission,
    manifest: content.manifest,
    name,
    key,
    spoken,
    article,
    method,
    minted,
    mintShape,
    exactName,
    graft,
    patchable,
    contribution,
    referenceRefinement,
    contentWitness,
    economicWitnessOmit,
    nestedDefinitionMembers,
    nestedDefinitionTable,
  };
}

/** The registry's exported `XItem` union, with its doc comment. */
function itemUnionType(facts: RegistryDefinerFacts): string {
  const {
    name,
    key,
    spoken,
    article,
    emission,
    graft,
    patchable,
    contribution,
    contentWitness,
    economicWitnessOmit,
  } = facts;
  // A scope-parameterised registry erases S to `never`, not to its default:
  // `Trigger<S>` is contravariant, so `Def<Id, never>` is the supertype every
  // scoped variant satisfies, while `Def<Id, "planet">` would both exclude a
  // ship definition from this union and misreport its clauses as planet ones.
  const erased = emission.scopeParameter === null ? "" : "<string, never>";
  // The declared witness is not erased with it. It rides beside the def
  // precisely because it is not part of it, and an item type that dropped it
  // would be a supertype an author reaches by annotating — at which point the
  // effect consuming the definition has nothing left to check (SDK-181). The
  // parameter defaults to every declaration the registry admits, so a list of
  // items still holds declared and undeclared definitions together, and a
  // value widened to that union is ambiguous at the call site rather than
  // unchecked.
  const witness = declaredWitness(facts, graft);
  const erasedDef = storedDefType(`${name}Def${erased}`, emission);
  const modifierWitness = contentWitness?.type ?? null;
  const itemArms = [
    contentWitness === undefined
      ? `ContentItem<${key}, ${erasedDef}>` +
        (witness === null ? "" : ` & { readonly ${witness.member}: W }`)
      : contentWitness.mode === "wraps"
        ? `ContentItem<${key}, ${name}Def${erased}> & { readonly def: ${name}Def${erased} & { readonly ${contentWitness.member}: W } }`
        : `ContentItem<${key}, Omit<${name}Def${erased}, ${economicWitnessOmit}> & W>`,
  ];
  if (patchable !== undefined) {
    itemArms.push(`${name}PatchItem`);
  }
  if (contribution !== undefined) {
    itemArms.push("ContributionItem");
  }
  return (
    docComment([
      `What ${article} ${spoken} feature can contain.`,
      ...(witness === null
        ? []
        : [
            `Parameterised by the declared \`${witness.member}\`, which the item carries`,
            "and the effect consuming it is checked against: naming this type without",
            "the parameter widens the declaration to every scope the registry admits,",
            "which is checkable as none of them.",
          ]),
    ]) +
    `export type ${name}Item${
      modifierWitness !== null
        ? `<W extends ${modifierWitness} = ${modifierWitness}>`
        : witness === null
          ? ""
          : `<W extends ${witness.type} = ${witness.type}>`
    } = ${itemArms.join(" | ")};\n\n`
  );
}

/** The capability's `defineX` surface: one member, its binding, its mint row. */
function capabilityDefineMember(facts: RegistryDefinerFacts): {
  readonly member: string;
  readonly binding: string;
  readonly exactNameRow: ExactNameMintRow | null;
} {
  const {
    registry,
    emission,
    name,
    key,
    spoken,
    article,
    method,
    minted,
    exactName,
    referenceRefinement,
    contentWitness,
    economicWitnessOmit,
    nestedDefinitionMembers,
    nestedDefinitionTable,
  } = facts;
  const scoped = emission.scopeParameter;
  // A declared FROM stays a live parameter where S is erased: it is the
  // contract the starting effect's call sites are checked against, so it
  // rides on the item beside the erased def rather than inside it.
  const declaredFrom = scoped?.declaredFrom;
  const declaredContract = declaredWitness(facts, facts.graft);
  const declaredFromParameter =
    declaredFrom === undefined
      ? ""
      : `\n    L extends ${declaredFrom.typeName} | undefined = undefined,`;
  const declaration =
    declaredContract?.parameter === undefined
      ? ""
      : ` & { readonly ${declaredContract.member}: ${declaredContract.parameter} }`;
  const parameters =
    scoped === null
      ? contentWitness === undefined
        ? "<const Name extends string>"
        : contentWitness.mode === "wraps"
          ? `<const Name extends string, W extends ${contentWitness.type}>`
          : `<const Name extends string, const W extends ${contentWitness.type}>`
      : `<\n    const Name extends string,\n    ${scoped.parameterName} extends ` +
        `${scoped.parameterType} = ${scoped.parameterDefault},` +
        `${declaredFromParameter}\n  >`;
  const def =
    `${name}Def<${minted}${scoped === null ? "" : `, ${scoped.parameterName}`}` +
    `${declaredFrom === undefined ? "" : ", L"}>`;
  const economicInputBase =
    contentWitness?.mode === "intersects"
      ? `Omit<${def}, "id" | ${economicWitnessOmit}>`
      : `Omit<${def}, "id">`;
  const economicResultBase =
    contentWitness?.mode === "intersects"
      ? `Omit<${name}Def<${minted}>, ${economicWitnessOmit}>`
      : `${name}Def<${minted}>`;
  const input =
    scoped?.selector === undefined
      ? contentWitness === undefined
        ? `Omit<${def}, "id">`
        : contentWitness.mode === "wraps"
          ? `Omit<${def}, "id"> & { readonly ${contentWitness.member}: W }`
          : `${economicInputBase} & W & ${contentWitness.exactType}<W>`
      : `${name}Fields<${scoped.parameterName}${declaredFrom === undefined ? "" : ", L"}>`;
  const result =
    contentWitness === undefined
      ? storedDefType(`${name}Def<${minted}${scoped === null ? "" : ", never"}>`, emission)
      : contentWitness.mode === "wraps"
        ? `${name}Def<${minted}> & { readonly ${contentWitness.member}: W }`
        : `${economicResultBase} & W`;
  const signatures =
    scoped?.selector === undefined
      ? (referenceRefinement === undefined
          ? ""
          : `  ${method}<const Name extends string>(\n` +
            `    name: Name,\n` +
            `    def: Omit<${def}, "id"> & { readonly ${referenceRefinement.member}: true }\n` +
            `  ): ContentItem<${key}, ${result} & { readonly ${referenceRefinement.member}: true }> & ` +
            `${pascalCase(referenceRefinement.reference)}Ref;\n`) +
        `  ${method}${parameters}(\n` +
        `    name: Name,\n` +
        `    def: ${input}\n` +
        `  ): ContentItem<${key}, ${result}>${declaration};`
      : `  ${method}<\n    const Name extends string,${declaredFromParameter}\n  >(\n` +
        `    name: Name,\n` +
        `    def: ` +
        Object.keys(scoped.selector.scopes)
          .map(
            (eventScope) =>
              `${name}Fields<${JSON.stringify(eventScope)}` +
              `${declaredFrom === undefined ? "" : ", L"}>`
          )
          .join(" | ") +
        `\n  ): ContentItem<${key}, ${name}Def<${minted}, never>>${declaration};`;
  if (exactName === undefined) {
    return {
      member:
        docComment(
          [
            `Defines ${article} ${spoken} from its logical name.`,
            "The capability mints and owns the full id; the returned branded reference",
            "flows into matching content-reference fields.",
            ...(nestedDefinitionMembers.length === 0
              ? []
              : [
                  "Nested-definition record keys are full ids and must belong to this capability's",
                  "prefix, because other fields may reference them directly.",
                ]),
          ],
          "  "
        ) + signatures,
      binding: capabilityBinding(
        method,
        parameters,
        input,
        `define${name}`,
        def,
        nestedDefinitionMembers,
        nestedDefinitionTable
      ),
      exactNameRow: null,
    };
  }
  // The exact-name pair (SDK-183): the ordinary prefixed mint with the
  // registry's widened charset, and the `prefix: false` overload under
  // which the author spells the complete name. One runtime binding
  // serves both — `mint` reads the option and the generated
  // `EXACT_NAME_MINTS` table, so the branch lives in data, not here.
  if (nestedDefinitionMembers.length > 0) {
    throw new Error(
      `EXACT_NAME_MINTS row "${registry}" has nested definition members, which the ` +
        "emitted overloads do not carry"
    );
  }
  return {
    member:
      docComment(
        [
          `Defines ${article} ${spoken} from its logical name.`,
          "The capability mints and owns the full id; the returned branded reference",
          "flows into matching content-reference fields.",
          `A ${spoken} name is a raw engine label, so the logical name accepts`,
          "interior uppercase after its leading lowercase letter ([a-z][A-Za-z0-9_]*).",
        ],
        "  "
      ) +
      `  ${method}<const Name extends string>(\n` +
      `    name: Name,\n` +
      `    def: ${input},\n` +
      `    options?: { readonly prefix?: true }\n` +
      `  ): ContentItem<${key}, ${result}>;\n` +
      docComment(
        [
          `Defines ${article} ${spoken} from its complete name.`,
          "`prefix: false` means only that the capability does not prepend the mod",
          "prefix — the prefix is still required inside `name` as a `_`-delimited",
          "segment (head, interior, or tail). The `Name` constraint enforces that at",
          "compile time and the mint re-checks it at runtime, so the name stays",
          "ownable and clear of other mods by construction. The minting capability",
          "is recorded and placement verifies the record, so a name carrying a",
          "second mod's prefix as another segment still places only with its minter.",
        ],
        "  "
      ) +
      `  ${method}<const Name extends ExactMintName<P>>(\n` +
      `    name: Name,\n` +
      `    def: Omit<${name}Def<Name>, "id">,\n` +
      `    options: { readonly prefix: false }\n` +
      `  ): ContentItem<${key}, ${name}Def<Name>>;`,
    binding:
      `    ${method}: ${parameters}(name: Name, def: ${input}, options?: MintNameOptions) => {\n` +
      `      const item = define${name}({ ...def, id: mint(${JSON.stringify(method)}, name, options) } as ${def});\n` +
      `      return options?.prefix === false ? recordExactNameMint(item, mintOwner) : item;\n` +
      "    },",
    exactNameRow: {
      method,
      namePattern: exactName.namePattern,
      exactNamePattern: exactName.exactNamePattern,
    },
  };
}

/** The registry's definer functions, and the report line for a grafted one. */
function definerFunctions(facts: RegistryDefinerFacts): {
  readonly definitions: readonly string[];
  readonly grafted: string | null;
} {
  const {
    registry,
    emission,
    name,
    key,
    spoken,
    article,
    graft,
    patchable,
    contribution,
    contentWitness,
    economicWitnessOmit,
  } = facts;
  let grafted: string | null = null;
  const definitions: string[] = [];
  if (graft === undefined) {
    // A registry whose scopes are a property of the definition takes a second
    // type parameter and one extra authoring member. The member is stripped
    // before the def is stored: it is not a game key, and the returned item
    // erases S so a `"ship"` definition still belongs to this registry's item
    // union — `Trigger<S>` is contravariant, so a leaked S would make it not.
    const scoped = emission.scopeParameter;
    // A declared contract is stripped like `scope` and, unlike an ordinary
    // scope parameter, kept beside the erased def so its consumers can check it.
    const declaredFrom = scoped?.declaredFrom;
    const declaredContract = declaredWitness(facts, graft);
    const declaredFromParameter =
      declaredFrom === undefined
        ? ""
        : `  L extends ${declaredFrom.typeName} | undefined = undefined,\n`;
    const declaration =
      declaredContract?.parameter === undefined
        ? ""
        : ` & { readonly ${declaredContract.member}: ${declaredContract.parameter} }`;
    const carried =
      declaredContract?.parameter === undefined
        ? ""
        : `, ${declaredContract.member}: ${declaredContract.member} as ${declaredContract.parameter}`;
    const parameters =
      scoped === null
        ? "<const Id extends string>"
        : `<\n  const Id extends string,\n  ${scoped.parameterName} extends ` +
          `${scoped.parameterType} = ${scoped.parameterDefault},\n` +
          `${declaredFromParameter}>`;
    const definerParameters =
      contentWitness?.mode === "intersects"
        ? `<const Id extends string, const W extends ${contentWitness.type}>`
        : parameters;
    const definerInput =
      contentWitness?.mode === "intersects"
        ? `Omit<${name}Def<Id>, ${economicWitnessOmit}> & W & ${contentWitness.exactType}<W>`
        : `${name}Def<Id${scoped === null ? "" : `, ${scoped.parameterName}`}` +
          `${declaredFrom === undefined ? "" : ", L"}>`;
    const definerResult =
      contentWitness?.mode === "intersects"
        ? `ContentItem<${key}, Omit<${name}Def<Id>, ${economicWitnessOmit}> & W>`
        : `ContentItem<${key}, ${storedDefType(
            `${name}Def<Id${scoped === null ? "" : ", never"}>`,
            emission
          )}>`;
    const stripped = [
      ...(scoped?.authoringMember === null || scoped?.authoringMember === undefined
        ? []
        : [scoped.authoringMember.member]),
      ...(declaredFrom === undefined ? [] : [declaredFrom.member]),
    ];
    const body =
      scoped === null
        ? contentWitness?.mode === "intersects"
          ? `  return { itemKind: "content", type: ${key}, id: def.id, def } as ${definerResult};\n`
          : `  return { itemKind: "content", type: ${key}, id: def.id, def };\n`
        : stripped.length === 0
          ? `  return { itemKind: "content", type: ${key}, id: def.id, ` +
            `def: def as unknown as ${storedDefType(`${name}Def<Id, never>`, emission)} };\n`
          : `  const { ${stripped.join(", ")}, ...rest } = def;\n` +
            `  return { itemKind: "content", type: ${key}, id: def.id, ` +
            `def: rest as unknown as ${storedDefType(`${name}Def<Id, never>`, emission)}${carried} };\n`;
    definitions.push(
      docComment([
        `Internal lowering primitive for ${article} ${spoken}. Public authors call`,
        `\`mod.${camelCase(registry)}(name, def)\`, then place the returned item with`,
        "`mod.feature(...)` before compiling the same capability.",
        ...(scoped === null
          ? []
          : [
              "",
              ...(scoped.authoringMember !== null
                ? [
                    scoped.authoringMember.member === "scope"
                      ? "`scope` names which scope this definition's clauses run in and emits"
                      : `\`${scoped.authoringMember.member}\` names this definition's scope and emits`,
                    scoped.fallback === null
                      ? "nothing; every definition must declare it."
                      : `nothing; it defaults to \`${scoped.fallback}\`.`,
                  ]
                : scoped.selector === undefined
                  ? []
                  : [
                      `\`${scoped.selector.member}\` selects which scope this definition's callbacks run in.`,
                    ]),
              ...(declaredFrom === undefined
                ? []
                : [
                    `\`${declaredFrom.member}\` declares the location scope \`${declaredFrom.effect}\``,
                    "hands the callbacks as FROM; it emits nothing and rides on the item,",
                    "where the effect's own call sites are checked against it.",
                  ]),
            ]),
      ]) +
        `export function define${name}${definerParameters}(\n` +
        `  def: ${definerInput}\n` +
        `): ${definerResult}` +
        `${declaration} {\n` +
        body +
        "}\n"
    );
  } else {
    grafted = `${registry}.define${name} — ${graft.reason}`;
    definitions.push(
      `// define${name} is hand-written; re-exported here so every definer this\n` +
        "// SDK has comes from one module.\n" +
        `export { ${graft.definer} } from ${JSON.stringify(graft.module)};\n`
    );
  }
  if (patchable !== undefined) {
    definitions.push(
      docComment([
        `Internal lowering primitive for patching ${article} vanilla ${spoken}. The transform`,
        "runs here (pure); public authors call the capability method, while the duplicate-key",
        "and one-view checks stay in",
        "the internal fold, which sees every patch together, and the emitted filename",
        "is always resolver-computed — a patch item never carries a file of its own.",
        "",
        "`prefix` is the mod prefix the capability closure binds: a patch that mints a",
        "localisation key of its own derives it from `<prefix>_<vanilla id>`, so the key",
        "cannot collide with vanilla's by construction.",
      ]) +
        `export function patch${name}<Source extends Parsed${name}>(\n` +
        `  ${camelCase(registry)}: Source,\n` +
        `  patch: (${camelCase(registry)}: Source) => ${name}Patch,\n` +
        `  prefix: string\n` +
        `): ${name}PatchItem {\n` +
        `  return {\n` +
        `    itemKind: "patch",\n` +
        `    patched: patchContent(\n` +
        `      ${camelCase(registry)},\n` +
        `      patch,\n` +
        `      ${key},\n` +
        `      ${emission.fieldsConstant},\n` +
        `      ${emission.localisationConstant},\n` +
        `      prefix\n` +
        `    ),\n` +
        "  };\n" +
        "}\n"
    );
  }
  if (contribution !== undefined) {
    definitions.push(
      docComment([
        `Internal lowering primitive for the shared additive \`default = { ${contribution.sink} = ... }\``,
        "sink. Public authors call the capability method; ids this mod names but does not own",
        "have no author-named file.",
        "A ref listed twice is emitted once.",
      ]) +
        `export function ${contribution.method}(\n` +
        `  ${camelCase(contribution.sink)}: readonly (TypedRef<${JSON.stringify(contribution.refRegistry)}> | string)[]\n` +
        "): ContributionItem {\n" +
        "  return {\n" +
        '    itemKind: "contribution",\n' +
        `    registry: ${JSON.stringify(contribution.sink)},\n` +
        `    refRegistry: ${JSON.stringify(contribution.refRegistry)},\n` +
        `    ids: ${camelCase(contribution.sink)}.map((entry) => String(refId(entry))),\n` +
        "  };\n" +
        "}\n"
    );
  }
  return { definitions, grafted };
}

/** Computes one registry's {@link RegistryDefinerPlan}. */
export function planRegistryDefiner(
  content: DefinerContent,
  contents: readonly DefinerContent[]
): RegistryDefinerPlan {
  const facts = registryDefinerFacts(content);
  const {
    registry,
    emission,
    name,
    spoken,
    article,
    method,
    mintShape,
    graft,
    patchable,
    contribution,
    nestedDefinitionMembers,
  } = facts;

  const capabilityMembers: string[] = [];
  const capabilityBindings: string[] = [];
  const runtimeDefiners: string[] = [];
  const shapeMintTypes: string[] = [];
  const shapeMintTypeNames: string[] = [];
  const shapeMintRefTypes: string[] = [];
  let exactNameRow: ExactNameMintRow | null = null;

  let profileMember: string | null = null;
  let defaultProfileMember: string | null = null;
  let mintShapeRow: { readonly method: string; readonly head: string } | null = null;
  if (mintShape === undefined) {
    profileMember =
      docComment(
        [
          `The segment inserted between the mod prefix and ${article} ${spoken}'s logical name.`,
          "Override it when this registry needs a different id convention.",
        ],
        "  "
      ) + `  readonly ${method}: string;`;
    defaultProfileMember = `  ${method}: ${JSON.stringify(facts.manifest.idSegment ?? registry)},`;
  } else {
    mintShapeRow = { method, head: mintShape.head ?? "" };
  }

  if (graft === undefined) {
    const defined = capabilityDefineMember(facts);
    capabilityMembers.push(defined.member);
    capabilityBindings.push(defined.binding);
    exactNameRow = defined.exactNameRow;
    runtimeDefiners.push(`define${name}`);
    for (const shape of shapesFor(registry)) {
      if (emission.scopeParameter !== null) {
        throw new Error(
          `Shape mint ${shape.method} targets scope-parameterised registry "${registry}", ` +
            "whose definitions take a scope argument the emitted signature does not carry"
        );
      }
      const emitted = shapeMintMethod(shape, name, contents);
      shapeMintTypes.push(emitted.type);
      shapeMintTypeNames.push(emitted.typeName);
      capabilityMembers.push(emitted.member);
      capabilityBindings.push(emitted.binding);
      shapeMintRefTypes.push(...emitted.refTypes);
    }
  }
  if (patchable !== undefined) {
    capabilityMembers.push(
      docComment(
        [
          `Patches a vanilla ${spoken} as a whole-object override.`,
          "Unlike a capability definition method, it mints no id and owns no new content —",
          "but it does mint localisation keys for text it adds, from this capability's",
          "prefix, which is why the method is bound to the capability rather than free.",
          ...(patchable.example ?? []),
        ],
        "  "
      ) +
        `  patch${name}<Source extends Parsed${name}>(\n` +
        `    ${camelCase(registry)}: Source,\n` +
        `    patch: (${camelCase(registry)}: Source) => ${name}Patch\n` +
        `  ): ${name}PatchItem;`
    );
    capabilityBindings.push(
      `    patch${name}: <Source extends Parsed${name}>(\n` +
        `      ${camelCase(registry)}: Source,\n` +
        `      patch: (${camelCase(registry)}: Source) => ${name}Patch\n` +
        `    ) => patch${name}(${camelCase(registry)}, patch, prefix),`
    );
    runtimeDefiners.push(`patch${name}`);
  }
  if (contribution !== undefined) {
    capabilityMembers.push(
      docComment(
        [
          `Adds ids to the shared ${contribution.sink} sink.`,
          "This is an id-less additive contribution, not a capability-owned definition.",
        ],
        "  "
      ) + `  readonly ${contribution.method}: typeof ${contribution.method};`
    );
    capabilityBindings.push(`    ${contribution.method},`);
    runtimeDefiners.push(contribution.method);
  }

  const { definitions, grafted } = definerFunctions(facts);
  return {
    content,
    chunk: itemUnionType(facts) + definitions.join("\n"),
    itemTypes: [
      ...(patchable !== undefined ? [`${name}PatchItem`] : []),
      ...(contribution !== undefined ? ["ContributionItem"] : []),
    ],
    capabilityMembers,
    capabilityBindings,
    runtimeDefiners,
    profileMember,
    defaultProfileMember,
    mintShapeRow,
    exactNameRow,
    shapeMintTypes,
    shapeMintTypeNames,
    shapeMintRefTypes,
    nestedDefinitionTable:
      nestedDefinitionMembers.length > 0 && graft === undefined
        ? `const ${facts.nestedDefinitionTable} = ${JSON.stringify(nestedDefinitionMembers)} as const;\n`
        : null,
    witness: facts.contentWitness ?? null,
    graft: graft ?? null,
    patchable: patchable !== undefined,
    contributes: contribution !== undefined,
    grafted,
  };
}

/** The audited shape mints one registry owns. */
function shapesFor(registry: string): readonly SpriteShapeMint[] {
  return registry === SHAPE_MINT_REGISTRY ? SPRITE_SHAPE_MINTS : [];
}

/**
 * One {@link SPRITE_SHAPE_MINTS} row as a capability method.
 *
 * Nothing here is per-row hand code: the name type, the signature, the runtime
 * mint and the provenance all come out of the row's head, hole and variants.
 * Adding a row adds a method; there is no second place to edit.
 *
 * The name type is emitted as its own alias so the signature stays readable and
 * so an author can spell the minted name themselves. Variants append their
 * literal in declaration order, on both sides — the type appends it behind a
 * conditional on the option's own boolean parameter, the runtime behind the
 * same option's value — so the two cannot disagree about what a variant is
 * called.
 */
function shapeMintMethod(
  shape: SpriteShapeMint,
  typeName: string,
  contents: readonly { readonly registry: string; readonly referenceName: string }[]
): {
  readonly type: string;
  readonly typeName: string;
  readonly member: string;
  readonly binding: string;
  readonly refTypes: readonly string[];
} {
  const alias = `${pascalCase(shape.method)}Name`;
  const variants = shape.variants ?? [];
  const variantParameters = variants.map(
    (variant) => `${pascalCase(variant.option)} extends boolean = false`
  );
  const variantArguments = variants.map((variant) => pascalCase(variant.option));
  const variantTypeTail = variants
    .map(
      (variant) =>
        `\${${pascalCase(variant.option)} extends true ? ${JSON.stringify(variant.suffix)} : ""}`
    )
    .join("");
  const variantRuntimeTail = variants
    .map(
      (variant) =>
        `\${options?.${variant.option} === true ? ${JSON.stringify(variant.suffix)} : ""}`
    )
    .join("");
  const optionsParameter =
    variants.length === 0
      ? ""
      : `,\n    options?: { ${variants
          .map((variant) => `readonly ${variant.option}?: ${pascalCase(variant.option)}`)
          .join("; ")} }`;

  const named = shape.hole === "name";
  const target = named ? undefined : (shape.hole as { readonly targetRegistry: string });
  const targetContent =
    target === undefined
      ? undefined
      : contents.find((content) => content.registry === target.targetRegistry);
  if (target !== undefined && targetContent === undefined) {
    throw new Error(
      `Shape mint ${shape.method} targets registry "${target.targetRegistry}", which the content ` +
        "manifest does not expose"
    );
  }
  const refType =
    targetContent === undefined ? undefined : `${pascalCase(targetContent.referenceName)}Ref`;
  const parameterName = target === undefined ? "name" : camelCase(target.targetRegistry);

  const aliasParameters = named
    ? ["P extends string", "Name extends string", ...variantParameters]
    : ["Target extends string", ...variantParameters];
  const aliasBody = named
    ? `\`${shape.head}\${P}_\${Name}${variantTypeTail}\``
    : `\`${shape.head}\${Target}${variantTypeTail}\``;
  const nameType = named
    ? `${alias}<P, Name${variantArguments.map((one) => `, ${one}`).join("")}>`
    : `${alias}<Target${variantArguments.map((one) => `, ${one}`).join("")}>`;
  const def = `${typeName}Def<${nameType}>`;
  const methodParameters = [
    named ? "const Name extends string" : "const Target extends string",
    ...variantParameters.map((one) => `const ${one}`),
  ].join(",\n    ");
  const argument = named
    ? "name: Name"
    : `${parameterName}: Target | (${refType} & { readonly id: Target })`;
  const runtimeHole = named ? `\${prefix}_\${name}` : `\${shapeMintTarget(${parameterName})}`;

  return {
    type:
      docComment([`The name a \`${shape.method}\` mints.`, "", `Seed: ${shape.seed}.`]) +
      `export type ${alias}<\n  ${aliasParameters.join(",\n  ")},\n> = ${aliasBody};\n`,
    typeName: alias,
    member:
      docComment(
        [
          `Defines the \`${shape.head}\`-led sprite the game generates${
            named ? " from a name" : ` from a ${spokenName(target!.targetRegistry)}`
          }.`,
          named
            ? "The capability mints and owns the full name, exactly as an ordinary definition does."
            : "The minted name carries the target's id rather than the mod prefix, so ownership " +
              "rides on the item as mint provenance instead of on the string.",
          `In every other respect this is an ordinary ${spokenName(SHAPE_MINT_REGISTRY)} definition.`,
          "",
          `Seed: ${shape.seed}`,
        ],
        "  "
      ) +
      `  ${shape.method}<\n    ${methodParameters},\n  >(\n` +
      `    ${argument},\n` +
      `    def: Omit<${def}, "id">${optionsParameter}\n` +
      `  ): ContentItem<${JSON.stringify(SHAPE_MINT_REGISTRY)}, ${def}>;`,
    binding:
      `    ${shape.method}: <\n      ${methodParameters},\n    >(\n` +
      `      ${argument},\n` +
      `      def: Omit<${def}, "id">${optionsParameter.replace("\n    ", "\n      ")}\n` +
      `    ) => {\n` +
      (named ? `      assertName(name);\n` : "") +
      `      return shapeMinted(\n` +
      `        define${typeName}({\n` +
      `          ...def,\n` +
      `          id: \`${shape.head}${runtimeHole}${variantRuntimeTail}\` as ${nameType},\n` +
      `        } as ${def}),\n` +
      `        mintOwner,\n` +
      `        ${JSON.stringify(shape.method)}\n` +
      `      );\n` +
      `    },`,
    refTypes: refType === undefined ? [] : [refType],
  };
}

/**
 * The declared contract a registry's item carries beside its def, from
 * whichever side owns the definer.
 *
 * Generated definers learn it from a carried scope member or `declaredFrom`;
 * a hand-written one has to say so itself, since nothing in the rules mentions
 * the property it returns. Either way the item type has to match what the
 * definer actually returns, which is what this keeps in one place.
 */
function declaredWitness(
  content: { readonly emission: ContentEmission },
  graft: HandWrittenDefiner | undefined
): { readonly member: string; readonly type: string; readonly parameter?: string } | null {
  if (graft?.witness !== undefined) {
    return graft.witness;
  }
  const scoped = content.emission.scopeParameter;
  if (scoped === null) {
    return null;
  }
  const scopeMember = scoped.authoringMember;
  if (scopeMember?.carriesWitness === true) {
    return {
      member: scopeMember.member,
      type: scoped.typeName,
      parameter: scoped.parameterName,
    };
  }
  const declaredFrom = scoped.declaredFrom;
  return declaredFrom === undefined
    ? null
    : { member: declaredFrom.member, type: `${declaredFrom.typeName} | undefined`, parameter: "L" };
}

/** Removes a carried synthetic scope declaration from the stored definition type. */
function storedDefType(def: string, emission: ContentEmission): string {
  const scopeMember = emission.scopeParameter?.authoringMember;
  return scopeMember?.carriesWitness === true
    ? `Omit<${def}, ${JSON.stringify(scopeMember.member)}>`
    : def;
}

/**
 * The top-level `Def` member names a registry's emission actually produced —
 * the universe `assertContentWitnessMembersKnown`
 * (`packages/codegen-cwt/src/overlay/audit.ts`) checks
 * a `CONTENT_WITNESSES` row's member strings against.
 *
 * `authoredPath`'s first segment is the real authored member `emitContentType`
 * pushed for that field, which is not always `camelCase(field.field)`:
 * `renamedOffLocalisation` moves a field off a colliding localisation slot
 * (`building.desc` -> `conditionalDesc`), and every top-level `emittedFields`
 * push already records that rename in `authoredPath`. Falling back to
 * `camelCase(field.field)` only covers a field with no recorded path, which
 * none of today's top-level pushes leave unset. Localisation members are
 * deliberately excluded — a witness wraps or omits a live `Def` property, and
 * only `emittedFields` enumerates those.
 */
function emittedMemberNames(emission: ContentEmission): ReadonlySet<string> {
  return new Set(
    emission.emittedFields.map((field) => field.authoredPath?.[0] ?? camelCase(field.field))
  );
}

function capabilityBinding(
  method: string,
  parameters: string,
  definitionArgument: string,
  definer: string,
  definitionType: string,
  nestedDefinitionMembers: readonly string[],
  nestedDefinitionTable: string
): string {
  const withId = `{ ...def, id: mint(${JSON.stringify(method)}, name) }`;
  if (nestedDefinitionMembers.length === 0) {
    return (
      `    ${method}: ${parameters}(name: Name, def: ${definitionArgument}) =>\n` +
      `      ${definer}(${withId} as ${definitionType}),`
    );
  }
  return (
    `    ${method}: ${parameters}(name: Name, def: ${definitionArgument}) => {\n` +
    `      assertNestedDefinitionIds(def, assertNestedId, ${nestedDefinitionTable});\n` +
    `      return ${definer}(${withId} as ${definitionType});\n` +
    "    },"
  );
}

/**
 * The definer-emission family: one raw `defineX`/`patchX` per content
 * registry, plus the capability surface (`IdProfile`, mint shapes,
 * `ContentCapabilityMethods`) every mod capability binds. `contentDefiners`
 * is the whole exported surface — `main()` calls it once, over every emitted
 * `ContentEmission`, and writes its two halves to `content-definers.ts` and
 * `content-capability.ts`. It is an emitter like any other under `emit/`; it
 * only reads a lot of overlay tables because the capability surface is where
 * most of them cash out as public API.
 */

import type { ContentManifestEntry } from "../content-manifest.ts";
import {
  camelCase,
  constantCase,
  docComment,
  indefiniteArticle,
  kebabCase,
  pascalCase,
  spokenName,
} from "../naming.ts";
import { assertContentWitnessMembersKnown } from "../overlay-audit.ts";
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
  type ContentWitness,
  type HandWrittenDefiner,
  type SpriteShapeMint,
} from "../overlay.ts";
import type { ContentEmission } from "./content-type.ts";
import { importList, ImportRecorder, knownSymbol, renderImports } from "./symbols.ts";

/**
 * One raw definer per registry: package-internal lowering for the capability
 * surface. A definition remains a pure value, but public authors create it
 * through a capability method and place it with `mod.feature(...)`.
 *
 * The definers are literal-preserving (`<const Id extends string>`), so a
 * definition's id survives as its literal type all the way into the item the
 * definer returns — the property the deleted class methods, generic only in
 * the mod prefix, widened away.
 *
 * Three kinds of registry-specific member, each an overlay row rather than a
 * conditional in this emitter: `CONTENT_PATCH_REGISTRIES` adds a free `patchX`,
 * `CONTENT_CONTRIBUTION_SINKS` a free `addX` for the id-less sink, and
 * `HAND_WRITTEN_CONTENT_DEFINERS` replaces the mechanical `defineX` with a
 * re-export from `src/content/situations.ts`, so the internal lowering surface remains
 * centralized in this module.
 *
 * The `XItem` union types are emitted here too. They remain public as type-only
 * exports even though their raw constructors are internal.
 */
export function contentDefiners(
  contents: readonly {
    manifest: ContentManifestEntry;
    registry: string;
    referenceName: string;
    emission: ContentEmission;
  }[]
): {
  code: string;
  capabilityCode: string;
  definers: number;
  grafted: string[];
} {
  const grafted: string[] = [];
  const runtimeItemTypes = new Set<string>(["ContentItem"]);
  const chunks: string[] = [];
  const capabilityMembers: string[] = [];
  const capabilityBindings: string[] = [];
  const profileMembers: string[] = [];
  const defaultProfileMembers: string[] = [];
  const mintShapeRows: { method: string; head: string }[] = [];
  const exactNameRows: { method: string; namePattern: string; exactNamePattern: string }[] = [];
  const shapeMintTypes: string[] = [];
  const shapeMintRefTypes: string[] = [];
  const capabilityRuntimeDefiners = new Set<string>();
  const nestedDefinitionTables: string[] = [];
  const capabilityPatchTypes: { registry: string; emission: ContentEmission }[] = [];
  // CONTENT_WITNESSES rows this pass actually used, gathered here so the
  // import blocks built after the loop (below) can ask "which witness type
  // names need importing" without rescanning `contents` by registry name.
  const contentWitnesses: ContentWitness[] = [];

  for (const content of contents) {
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
    if (nestedDefinitionMembers.length > 0 && graft === undefined) {
      nestedDefinitionTables.push(
        `const ${nestedDefinitionTable} = ${JSON.stringify(nestedDefinitionMembers)} as const;\n`
      );
    }

    if (mintShape === undefined) {
      profileMembers.push(
        docComment(
          [
            `The segment inserted between the mod prefix and ${article} ${spoken}'s logical name.`,
            "Override it when this registry needs a different id convention.",
          ],
          "  "
        ) + `  readonly ${method}: string;`
      );
      defaultProfileMembers.push(
        `  ${method}: ${JSON.stringify(content.manifest.idSegment ?? registry)},`
      );
    } else {
      mintShapeRows.push({ method, head: mintShape.head ?? "" });
    }

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
    const witness = declaredWitness(content, graft);
    // CONTENT_WITNESSES (overlay.ts) replaces this loop's former
    // `registry === "scripted_modifier"`/`"economic_category"` branches: a
    // registry either has no row (ordinary def, no `W`) or has exactly one of
    // the two modes the schema carries evidence for (SDK-260).
    const contentWitness = CONTENT_WITNESSES.get(registry);
    if (contentWitness !== undefined) {
      assertContentWitnessMembersKnown(registry, contentWitness, emittedMemberNames(emission));
      contentWitnesses.push(contentWitness);
    }
    const modifierWitness = contentWitness?.type ?? null;
    const economicWitnessOmit =
      contentWitness?.mode === "intersects"
        ? contentWitness.omit.map((entry) => JSON.stringify(entry.member)).join(" | ")
        : "";
    const itemArms = [
      contentWitness === undefined
        ? `ContentItem<${key}, ${name}Def${erased}>` +
          (witness === null ? "" : ` & { readonly ${witness.member}: W }`)
        : contentWitness.mode === "wraps"
          ? `ContentItem<${key}, ${name}Def${erased}> & { readonly def: ${name}Def${erased} & { readonly ${contentWitness.member}: W } }`
          : `ContentItem<${key}, Omit<${name}Def${erased}, ${economicWitnessOmit}> & W>`,
    ];
    if (patchable !== undefined) {
      itemArms.push(`${name}PatchItem`);
      runtimeItemTypes.add(`${name}PatchItem`);
    }
    if (contribution !== undefined) {
      itemArms.push("ContributionItem");
      runtimeItemTypes.add("ContributionItem");
    }

    if (graft === undefined) {
      const scoped = emission.scopeParameter;
      // A declared FROM stays a live parameter where S is erased: it is the
      // contract the starting effect's call sites are checked against, so it
      // rides on the item beside the erased def rather than inside it.
      const declaredFrom = scoped?.declaredFrom;
      const declaredFromParameter =
        declaredFrom === undefined
          ? ""
          : `\n    L extends ${declaredFrom.typeName} | undefined = undefined,`;
      const declaration =
        declaredFrom === undefined ? "" : ` & { readonly ${declaredFrom.member}: L }`;
      const parameters =
        scoped === null
          ? contentWitness === undefined
            ? "<const Name extends string>"
            : contentWitness.mode === "wraps"
              ? `<const Name extends string, W extends ${contentWitness.type}>`
              : `<const Name extends string, const W extends ${contentWitness.type}>`
          : `<\n    const Name extends string,\n    ${scoped.parameterName} extends ` +
            `${scoped.parameterType} = ${JSON.stringify(scoped.parameterFallback)},` +
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
          ? `${name}Def<${minted}${scoped === null ? "" : ", never"}>`
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
        capabilityMembers.push(
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
          ) + signatures
        );
        capabilityBindings.push(
          capabilityBinding(
            method,
            parameters,
            input,
            `define${name}`,
            def,
            nestedDefinitionMembers,
            nestedDefinitionTable
          )
        );
      } else {
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
        exactNameRows.push({
          method,
          namePattern: exactName.namePattern,
          exactNamePattern: exactName.exactNamePattern,
        });
        capabilityMembers.push(
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
            `  ): ContentItem<${key}, ${name}Def<Name>>;`
        );
        capabilityBindings.push(
          `    ${method}: ${parameters}(name: Name, def: ${input}, options?: MintNameOptions) => {\n` +
            `      const item = define${name}({ ...def, id: mint(${JSON.stringify(method)}, name, options) } as ${def});\n` +
            `      return options?.prefix === false ? recordExactNameMint(item, mintOwner) : item;\n` +
            "    },"
        );
      }
      capabilityRuntimeDefiners.add(`define${name}`);
      for (const shape of shapesFor(registry)) {
        if (emission.scopeParameter !== null) {
          throw new Error(
            `Shape mint ${shape.method} targets scope-parameterised registry "${registry}", ` +
              "whose definitions take a scope argument the emitted signature does not carry"
          );
        }
        const emitted = shapeMintMethod(shape, name, contents);
        shapeMintTypes.push(emitted.type);
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
      capabilityRuntimeDefiners.add(`patch${name}`);
      capabilityPatchTypes.push(content);
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
      capabilityRuntimeDefiners.add(contribution.method);
    }

    const definitions: string[] = [];
    if (graft === undefined) {
      // A registry whose scopes are a property of the definition takes a second
      // type parameter and one extra authoring member. The member is stripped
      // before the def is stored: it is not a game key, and the returned item
      // erases S so a `"ship"` definition still belongs to this registry's item
      // union — `Trigger<S>` is contravariant, so a leaked S would make it not.
      const scoped = emission.scopeParameter;
      // A declared FROM is stripped like `scope` and, unlike it, kept: the
      // starting effect's call sites are checked against the declaration, so
      // the item carries it beside the def whose own parameter is erased.
      const declaredFrom = scoped?.declaredFrom;
      const declaredFromParameter =
        declaredFrom === undefined
          ? ""
          : `  L extends ${declaredFrom.typeName} | undefined = undefined,\n`;
      const declaration =
        declaredFrom === undefined ? "" : ` & { readonly ${declaredFrom.member}: L }`;
      const carried =
        declaredFrom === undefined ? "" : `, ${declaredFrom.member}: ${declaredFrom.member} as L`;
      const parameters =
        scoped === null
          ? "<const Id extends string>"
          : `<\n  const Id extends string,\n  ${scoped.parameterName} extends ` +
            `${scoped.parameterType} = ${JSON.stringify(scoped.parameterFallback)},\n` +
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
          : `ContentItem<${key}, ${name}Def<Id${scoped === null ? "" : ", never"}>>`;
      const stripped = [
        ...(scoped !== null && scoped.selector === undefined ? ["scope"] : []),
        ...(declaredFrom === undefined ? [] : [declaredFrom.member]),
      ];
      const body =
        scoped === null
          ? contentWitness?.mode === "intersects"
            ? `  return { itemKind: "content", type: ${key}, id: def.id, def } as ${definerResult};\n`
            : `  return { itemKind: "content", type: ${key}, id: def.id, def };\n`
          : stripped.length === 0
            ? `  return { itemKind: "content", type: ${key}, id: def.id, ` +
              `def: def as unknown as ${name}Def<Id, never> };\n`
            : `  const { ${stripped.join(", ")}, ...rest } = def;\n` +
              `  return { itemKind: "content", type: ${key}, id: def.id, ` +
              `def: rest as unknown as ${name}Def<Id, never>${carried} };\n`;
      definitions.push(
        docComment([
          `Internal lowering primitive for ${article} ${spoken}. Public authors call`,
          `\`mod.${camelCase(registry)}(name, def)\`, then place the returned item with`,
          "`mod.feature(...)` before compiling the same capability.",
          ...(scoped === null
            ? []
            : [
                "",
                ...(scoped.selector === undefined
                  ? [
                      "`scope` names which scope this definition's clauses run in and emits",
                      `nothing; it defaults to \`${scoped.fallback}\`.`,
                    ]
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
      grafted.push(`${registry}.define${name} — ${graft.reason}`);
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

    chunks.push(
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
        } = ${itemArms.join(" | ")};\n\n` +
        definitions.join("\n")
    );
  }

  const wrapsWitnesses = contentWitnesses.filter(
    (contentWitness): contentWitness is Extract<ContentWitness, { mode: "wraps" }> =>
      contentWitness.mode === "wraps"
  );
  const intersectsWitnesses = contentWitnesses.filter(
    (contentWitness): contentWitness is Extract<ContentWitness, { mode: "intersects" }> =>
      contentWitness.mode === "intersects"
  );

  const patchContents = contents.filter((content) =>
    CONTENT_PATCH_REGISTRIES.has(content.registry)
  );
  const refImports = contents.some((content) => CONTENT_CONTRIBUTION_SINKS.has(content.registry));
  const contentItemTypes = [...runtimeItemTypes].filter((name) => !name.endsWith("PatchItem"));
  for (const intersectsWitness of intersectsWitnesses) {
    contentItemTypes.push(intersectsWitness.type, intersectsWitness.exactType);
  }
  // A hand-written definer's declared witness type is overlay text this module
  // only splices, so the row states which SDK symbols it spells rather than
  // this reading them back out of it.
  const witnessImports = new ImportRecorder();
  for (const content of contents) {
    for (const symbol of HAND_WRITTEN_CONTENT_DEFINERS.get(content.registry)?.witness?.symbols ??
      []) {
      const known = knownSymbol(
        symbol,
        `Named by the HAND_WRITTEN_CONTENT_DEFINERS row "${content.registry}".`
      );
      witnessImports.add(known.module, symbol, known.kind);
    }
  }
  const imports =
    importList("../content/types.ts", contentItemTypes) +
    renderImports(witnessImports.snapshot()) +
    (refImports ? 'import { refId, type TypedRef } from "../script/scalar.ts";\n' : "") +
    // One generic transform, called with the registry's own field descriptors:
    // the patch surface is descriptor-derived the whole way down, so nothing
    // per-registry is imported from a hand-written module.
    (patchContents.length === 0
      ? ""
      : 'import { patchContent } from "../stellaris/vanilla/patch.ts";\n') +
    patchContents
      .map(
        (content) =>
          `import type { Parsed${content.emission.typeName} } ` +
          'from "../stellaris/vanilla/view.ts";\n'
      )
      .join("") +
    contents
      .map((content) => {
        const from = `./${kebabCase(content.registry)}.ts`;
        const types = [
          `${content.emission.typeName}Def`,
          // A scope-parameterised definer constrains S by the registry's own
          // scope union, so that type has to travel with the Def.
          ...(content.emission.scopeParameter === null
            ? []
            : [content.emission.scopeParameter.typeName]),
          ...(content.emission.scopeParameter?.declaredFrom === undefined
            ? []
            : [content.emission.scopeParameter.declaredFrom.typeName]),
        ];
        if (!CONTENT_PATCH_REGISTRIES.has(content.registry)) {
          return importList(from, types);
        }
        const names = [
          content.emission.fieldsConstant,
          content.emission.localisationConstant,
          ...[
            ...types,
            `${content.emission.typeName}Patch`,
            `${content.emission.typeName}PatchItem`,
          ]
            .sort()
            .map((name) => `type ${name}`),
        ];
        return `import { ${names.join(", ")} } from ${JSON.stringify(from)};\n`;
      })
      .join("") +
    importList("./enums.ts", [
      ...wrapsWitnesses.map((wrapsWitness) => wrapsWitness.type),
      ...new Set(
        contents.flatMap((content) =>
          content.emission.scopeParameter?.selector === undefined
            ? []
            : [content.emission.scopeParameter.parameterType]
        )
      ),
    ]);
  const capabilityImports =
    'import type { ContentItem, EconomicCategoryWitness, ExactEconomicCategoryWitness } from "../content/types.ts";\n' +
    wrapsWitnesses
      .map(
        (wrapsWitness) =>
          `import type { ${wrapsWitness.type} } from ${JSON.stringify(wrapsWitness.module)};\n`
      )
      .join("") +
    importList(
      "./refs.ts",
      [...CONTENT_SUBTYPE_REFERENCE_REFINEMENTS.values()].map(
        (refinement) => `${pascalCase(refinement.reference)}Ref`
      )
    ) +
    (shapeMintTypes.length === 0 && exactNameRows.length === 0
      ? ""
      : "import {\n" +
        (exactNameRows.length === 0 ? "" : "  recordExactNameMint,\n") +
        (shapeMintTypes.length === 0 ? "" : "  recordShapeMint,\n") +
        "  type MintCapabilityOwner,\n} " +
        'from "../content/mint-provenance.ts";\n') +
    (shapeMintTypes.length === 0
      ? ""
      : 'import { refId, type TypedRef } from "../script/scalar.ts";\n' +
        importList("./refs.ts", shapeMintRefTypes)) +
    (capabilityRuntimeDefiners.size === 0
      ? ""
      : `import { ${[...capabilityRuntimeDefiners].sort().join(", ")} } from "./content-definers.ts";\n`) +
    // The parsed side of every patchable registry: a capability's `patchX` is a
    // closure over the prefix rather than a re-export, so its signature is
    // spelled here and needs the same types the free function's does.
    capabilityPatchTypes
      .map(
        (content) =>
          `import type { Parsed${content.emission.typeName} } ` +
          'from "../stellaris/vanilla/view.ts";\n'
      )
      .join("") +
    contents
      .map((content) =>
        importList(`./${kebabCase(content.registry)}.ts`, [
          `${content.emission.typeName}Def`,
          ...(content.emission.scopeParameter?.selector === undefined
            ? []
            : [`${content.emission.typeName}Fields`]),
          ...(content.emission.scopeParameter === null
            ? []
            : [content.emission.scopeParameter.typeName]),
          ...(content.emission.scopeParameter?.declaredFrom === undefined
            ? []
            : [content.emission.scopeParameter.declaredFrom.typeName]),
          ...(CONTENT_PATCH_REGISTRIES.has(content.registry)
            ? [`${content.emission.typeName}Patch`, `${content.emission.typeName}PatchItem`]
            : []),
        ])
      )
      .join("") +
    importList("./enums.ts", [
      ...new Set(
        contents.flatMap((content) =>
          content.emission.scopeParameter?.selector === undefined
            ? []
            : [content.emission.scopeParameter.parameterType]
        )
      ),
    ]);
  const capability =
    nestedDefinitionTables.join("\n") +
    "type NestedDefinitionIdAsserter = (id: string) => void;\n\n" +
    (nestedDefinitionTables.length === 0
      ? ""
      : "function assertNestedDefinitionIds(\n" +
        "  def: object,\n" +
        "  assert: NestedDefinitionIdAsserter,\n" +
        "  members: readonly string[]\n" +
        "): void {\n" +
        "  for (const member of members) {\n" +
        "    const nested = (def as Readonly<Record<string, unknown>>)[member];\n" +
        "    if (nested === undefined) {\n" +
        "      continue;\n" +
        "    }\n" +
        "    Object.keys(nested as Readonly<Record<string, unknown>>).forEach(assert);\n" +
        "  }\n" +
        "}\n\n") +
    (shapeMintTypes.length === 0
      ? ""
      : "type LogicalNameAsserter = (name: string) => void;\n\n" +
        docComment([
          "The id a shape mint fills its hole with.",
          "",
          "A typed item or reference lowers to its id; an intentional raw string — a",
          "target this build does not contain — passes through. Neither may be empty or",
          "carry whitespace: the minted name is the single bare word the game looks the",
          "sprite up by, so a hole that swallowed a space would emit a definition nothing",
          "can reference.",
        ]) +
        "function shapeMintTarget(target: TypedRef<string> | string): string {\n" +
        '  const id = typeof target === "string" ? target : refId(target);\n' +
        '  if (typeof id !== "string" || id === "" || /\\s/.test(id)) {\n' +
        "    throw new Error(\n" +
        "      `A shape-minted sprite's target must be one bare word; received ${JSON.stringify(id)}`\n" +
        "    );\n" +
        "  }\n" +
        "  return id;\n" +
        "}\n\n" +
        docComment([
          "Records which capability minted a shape-minted definition, and under which",
          "shape.",
          "",
          "A shape mint may carry no mod prefix at all — the name is built from another",
          "definition's id — so a string-prefix test cannot decide whether the item",
          "belongs to the capability placing it. `recordShapeMint` puts the answer in a",
          "module-private `WeakMap` no caller can write to, which is what the placement",
          "check reads. The `minted` property beside it is informational only: it is a",
          "public object an author could attach to anything, so it proves nothing and is",
          "never consulted.",
        ]) +
        'function shapeMinted<T extends { readonly itemKind: "content" }>(\n' +
        "  item: T,\n" +
        "  owner: MintCapabilityOwner,\n" +
        "  shape: string\n" +
        "): T {\n" +
        "  return recordShapeMint(\n" +
        "    { ...item, minted: { prefix: owner.prefix, shape } } as T,\n" +
        "    owner,\n" +
        "    shape\n" +
        "  );\n" +
        "}\n\n") +
    docComment([
      "Registry-specific id segments used when a mod capability mints content ids.",
      "Each member may override the conventional segment for its registry.",
    ]) +
    "export interface IdProfile {\n" +
    profileMembers.join("\n") +
    "\n}\n\n" +
    docComment(["The conventional id segments used when no profile override is supplied."]) +
    "export const DEFAULT_ID_PROFILE = Object.freeze({\n" +
    defaultProfileMembers.join("\n") +
    "\n}) satisfies IdProfile;\n\n" +
    docComment([
      "The literal each segmentless registry's minted name carries before the mod prefix.",
      "",
      "A registry appears here exactly when it has no `IdProfile` segment: its name is",
      "`${head}${prefix}_${name}`, the head is fixed by the game rather than chosen by",
      "the author, and there is nothing for a profile to override. The empty string is a",
      "head — it says the mint is bare, not that the registry is absent.",
    ]) +
    "export const MINT_SHAPES = Object.freeze({\n" +
    mintShapeRows.map((row) => `  ${row.method}: ${JSON.stringify(row.head)},`).join("\n") +
    "\n} as const);\n\n" +
    docComment(["A registry whose name is minted without an id segment."]) +
    "export type MintShapedRegistry = keyof typeof MINT_SHAPES;\n\n" +
    docComment([
      "The registries whose names are raw engine labels (SDK-183). Each row widens",
      "the logical-name charset for the ordinary prefixed mint (`name`) and states",
      "the charset a complete `prefix: false` name must satisfy (`exact`). The",
      "runtime mint reads this table; the registries are the overlay's",
      "`EXACT_NAME_MINTS` rows, so the typed overloads and the runtime checks come",
      "from the same data.",
    ]) +
    "export const EXACT_NAME_MINTS = Object.freeze({\n" +
    exactNameRows
      .map(
        (row) =>
          `  ${row.method}: Object.freeze({ name: /${row.namePattern}/, ` +
          `exact: /${row.exactNamePattern}/ }),`
      )
      .join("\n") +
    "\n} as const);\n\n" +
    docComment(["A registry whose mint offers the exact-name opt-out."]) +
    "export type ExactNameRegistry = keyof typeof EXACT_NAME_MINTS;\n\n" +
    docComment([
      "A complete definition name an author may spell with `prefix: false`: the mod",
      "prefix must appear as a `_`-delimited segment — head, tail, or interior. The",
      "bare prefix alone matches no arm, so a name that is nothing but the prefix is",
      "a compile error, like a name missing the segment entirely.",
    ]) +
    "export type ExactMintName<P extends string> =\n" +
    "  | `${P}_${string}`\n" +
    "  | `${string}_${P}`\n" +
    "  | `${string}_${P}_${string}`;\n\n" +
    docComment([
      "Options an exact-name registry's capability method forwards to the mint.",
      "`prefix: false` means the name is the complete definition id; the default",
      "mints `${prefix}_${name}` as every other registry does.",
    ]) +
    "export type MintNameOptions = { readonly prefix?: boolean };\n\n" +
    docComment([
      "The literal id a capability mints for one logical content name, for a registry",
      "carrying an `IdProfile` segment.",
    ]) +
    "export type MintedContentId<\n" +
    "  P extends string,\n" +
    "  I extends IdProfile,\n" +
    "  K extends keyof I,\n" +
    "  Name extends string,\n" +
    "> = `${P}_${I[K] & string}_${Name}`;\n\n" +
    docComment([
      "The literal id a capability mints for one logical content name, for any registry.",
      "",
      "One arm per `MINT_SHAPES` member, then the segmented default. The arms are",
      "generated from the same table the runtime reads, so a registry cannot mint one",
      "shape and be typed as another.",
    ]) +
    "export type MintedIdOf<\n" +
    "  P extends string,\n" +
    "  I extends IdProfile,\n" +
    "  K extends keyof I | MintShapedRegistry,\n" +
    "  Name extends string,\n" +
    "> = " +
    mintShapeRows
      .map(
        (row) => `K extends ${JSON.stringify(row.method)}\n  ? \`${row.head}\${P}_\${Name}\`\n  : `
      )
      .join("") +
    "MintedContentId<P, I, K & keyof I, Name>;\n\n" +
    docComment([
      "The internal function that turns a registry key and logical name into an owned id.",
    ]) +
    "export type ContentIdMinter<P extends string, I extends IdProfile> = <\n" +
    "  const K extends keyof I | MintShapedRegistry,\n" +
    "  const Name extends string,\n" +
    ">(registry: K, name: Name, options?: MintNameOptions) => MintedIdOf<P, I, K, Name>;\n\n" +
    shapeMintTypes.join("\n") +
    (shapeMintTypes.length === 0 ? "" : "\n") +
    docComment(["Content authoring methods bound to one mod capability's prefix and id profile."]) +
    "export interface ContentCapabilityMethods<P extends string, I extends IdProfile> {\n" +
    capabilityMembers.join("\n") +
    "\n}\n\n" +
    docComment(["Builds the internal content-method table for a mod capability."]) +
    "export function contentCapabilityMethods<P extends string, I extends IdProfile>(\n" +
    "  mint: ContentIdMinter<P, I>,\n" +
    "  assertNestedId: NestedDefinitionIdAsserter,\n" +
    "  prefix: P" +
    // `assertName` only serves shape mints: it holds a name-derived mint to the
    // same logical-name rule every mint follows. `mintOwner` is the identity a
    // shape mint or an exact-name mint is recorded against. Emitting either
    // where no row needs it would leave the generated function with parameters
    // it never reads.
    (shapeMintTypes.length === 0 && exactNameRows.length === 0
      ? "\n"
      : shapeMintTypes.length === 0
        ? ",\n  mintOwner: MintCapabilityOwner\n"
        : ",\n  assertName: LogicalNameAsserter,\n  mintOwner: MintCapabilityOwner\n") +
    "): ContentCapabilityMethods<P, I> {\n" +
    "  return Object.freeze({\n" +
    capabilityBindings.join("\n") +
    "\n  }) as ContentCapabilityMethods<P, I>;\n" +
    "}\n";

  return {
    code: imports + "\n" + chunks.join("\n"),
    capabilityCode: capabilityImports + "\n" + capability,
    definers: contents.length,
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
 * Generated definers learn it from the overlay's `declaredFrom` row; a
 * hand-written one has to say so itself, since nothing in the rules mentions
 * the property it returns. Either way the item type has to match what the
 * definer actually returns, which is what this keeps in one place.
 */
function declaredWitness(
  content: { readonly emission: ContentEmission },
  graft: HandWrittenDefiner | undefined
): { readonly member: string; readonly type: string } | null {
  if (graft?.witness !== undefined) {
    return graft.witness;
  }
  const declaredFrom = content.emission.scopeParameter?.declaredFrom;
  return declaredFrom === undefined
    ? null
    : { member: declaredFrom.member, type: `${declaredFrom.typeName} | undefined` };
}

/**
 * The top-level `Def` member names a registry's emission actually produced —
 * the universe `assertContentWitnessMembersKnown` (`overlay-audit.ts`) checks
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

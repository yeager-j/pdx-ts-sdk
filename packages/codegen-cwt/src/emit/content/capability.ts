/**
 * Renders the generated `content-capability.ts` module: the capability
 * surface (`IdProfile`, mint shapes, `ContentCapabilityMethods`) every mod
 * capability binds, folded from the per-registry definer plans. It reads a
 * lot of overlay tables because the capability surface is where most of them
 * cash out as public API.
 */

import { docComment, kebabCase, pascalCase } from "../../naming.ts";
import { CONTENT_SUBTYPE_REFERENCE_REFINEMENTS } from "../../overlay/index.ts";
import { importList } from "../../render/symbols.ts";
import type { RegistryDefinerPlan } from "./definer-plan.ts";

/** The complete `content-capability.ts` text: imports, then the surface. */
export function contentCapabilityModule(plans: readonly RegistryDefinerPlan[]): string {
  const wrapsWitnesses = plans.flatMap((plan) =>
    plan.witness !== null && plan.witness.mode === "wraps" ? [plan.witness] : []
  );
  const profileMembers = plans.flatMap((plan) => plan.profileMember ?? []);
  const defaultProfileMembers = plans.flatMap((plan) => plan.defaultProfileMember ?? []);
  const mintShapeRows = plans.flatMap((plan) => plan.mintShapeRow ?? []);
  const exactNameRows = plans.flatMap((plan) => plan.exactNameRow ?? []);
  const shapeMintTypes = plans.flatMap((plan) => plan.shapeMintTypes);
  const shapeMintRefTypes = plans.flatMap((plan) => plan.shapeMintRefTypes);
  const capabilityMembers = plans.flatMap((plan) => plan.capabilityMembers);
  const capabilityBindings = plans.flatMap((plan) => plan.capabilityBindings);
  const capabilityRuntimeDefiners = new Set(plans.flatMap((plan) => plan.runtimeDefiners));
  const nestedDefinitionTables = plans.flatMap((plan) => plan.nestedDefinitionTable ?? []);
  const capabilityPatchTypes = plans.filter((plan) => plan.patchable).map((plan) => plan.content);

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
    plans
      .map(({ content, patchable }) =>
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
          ...(patchable
            ? [`${content.emission.typeName}Patch`, `${content.emission.typeName}PatchItem`]
            : []),
        ])
      )
      .join("") +
    importList("./enums.ts", [
      ...new Set(
        plans.flatMap(({ content }) =>
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

  return capabilityImports + "\n" + capability;
}

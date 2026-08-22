/**
 * The definer-emission family: one raw `defineX`/`patchX` per content
 * registry, plus the capability surface (`IdProfile`, mint shapes,
 * `ContentCapabilityMethods`) every mod capability binds. `contentDefiners`
 * is the whole exported surface — `main()` calls it once, over every emitted
 * `ContentEmission`, and writes its two halves to `content-definers.ts` and
 * `content-capability.ts`. Each registry's share of both halves is computed
 * once as a `RegistryDefinerPlan` (`definer-plan.ts`); this module folds the
 * plans into the definer module, and `capability.ts` folds them into the
 * capability module.
 */

import { kebabCase } from "../../naming.ts";
import { importList, ImportRecorder, knownSymbol, renderImports } from "../../render/symbols.ts";
import { contentCapabilityModule } from "./capability.ts";
import {
  planRegistryDefiner,
  type DefinerContent,
  type RegistryDefinerPlan,
} from "./definer-plan.ts";

/**
 * Emits the internal content definers and the capability surface from the same registry plans.
 * Generated definers preserve literal ids; audited overlay rows select patch, contribution, and
 * hand-written graft behavior without registry-specific branches in this emitter.
 */
export function contentDefiners(contents: readonly DefinerContent[]): {
  /** Complete generated `content-definers.ts` module text. */
  code: string;
  /** Complete generated `content-capability.ts` module text. */
  capabilityCode: string;
  /** Capability type names an author can name: one minted-name alias per shape mint. */
  capabilityPublicTypes: string[];
  /** Number of manifest registries represented by the modules. */
  definers: number;
  /** Report rows for registries served by hand-written definer grafts. */
  grafted: string[];
} {
  const plans = contents.map((content) => planRegistryDefiner(content, contents));
  return {
    code: contentDefinersModule(plans),
    capabilityCode: contentCapabilityModule(plans),
    capabilityPublicTypes: plans.flatMap((plan) => plan.shapeMintTypeNames),
    definers: contents.length,
    grafted: plans.flatMap((plan) => (plan.grafted === null ? [] : [plan.grafted])),
  };
}

/** The generated `content-definers.ts` text: imports, then one chunk per registry. */
function contentDefinersModule(plans: readonly RegistryDefinerPlan[]): string {
  const runtimeItemTypes = new Set<string>(["ContentItem"]);
  for (const plan of plans) {
    for (const itemType of plan.itemTypes) {
      runtimeItemTypes.add(itemType);
    }
  }
  const intersectsWitnesses = plans.flatMap((plan) =>
    plan.witness !== null && plan.witness.mode === "intersects" ? [plan.witness] : []
  );
  const wrapsWitnesses = plans.flatMap((plan) =>
    plan.witness !== null && plan.witness.mode === "wraps" ? [plan.witness] : []
  );
  const patchPlans = plans.filter((plan) => plan.patchable);
  const refImports = plans.some((plan) => plan.contributes);
  const contentItemTypes = [...runtimeItemTypes].filter((name) => !name.endsWith("PatchItem"));
  for (const intersectsWitness of intersectsWitnesses) {
    contentItemTypes.push(intersectsWitness.type, intersectsWitness.exactType);
  }
  // A hand-written definer's declared witness type is overlay text this module
  // only splices, so the row states which SDK symbols it spells rather than
  // this reading them back out of it.
  const witnessImports = new ImportRecorder();
  for (const plan of plans) {
    for (const symbol of plan.graft?.witness?.symbols ?? []) {
      const known = knownSymbol(
        symbol,
        `Named by the HAND_WRITTEN_CONTENT_DEFINERS row "${plan.content.registry}".`
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
    (patchPlans.length === 0
      ? ""
      : 'import { patchContent } from "../stellaris/vanilla/patch.ts";\n') +
    patchPlans
      .map(
        ({ content }) =>
          `import type { Parsed${content.emission.typeName} } ` +
          'from "../stellaris/vanilla/parsed-definitions.ts";\n'
      )
      .join("") +
    plans
      .map(({ content, patchable }) => {
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
        if (!patchable) {
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
        plans.flatMap(({ content }) =>
          content.emission.scopeParameter?.selector === undefined
            ? []
            : [content.emission.scopeParameter.parameterType]
        )
      ),
    ]);
  return imports + "\n" + plans.map((plan) => plan.chunk).join("\n");
}

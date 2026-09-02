/**
 * The capability surface's method namespace (SDK-361).
 *
 * Every registry contributes `x` and `xHandle`, so the namespace is doubled and
 * a registry whose method name is another's plus `Handle` would overwrite it in
 * the frozen binding table. Each plan carries its method names beside the
 * declarations it renders, which is what the guard reads.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentCapabilityModule } from "@pdx-ts/codegen-cwt/emit/content/capability";
import { emitContentType } from "@pdx-ts/codegen-cwt/emit/content/content-type";
import {
  planRegistryDefiner,
  type DefinerContent,
  type RegistryDefinerPlan,
} from "@pdx-ts/codegen-cwt/emit/content/definer-plan";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/typescript";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import {
  referenceNameOf,
  subtypeReferenceRefinements,
  typesReferencedBySubtype,
} from "@pdx-ts/codegen-cwt/lower/content-reference";
import {
  CONTENT_MANIFEST,
  registryNameOf,
  type ContentManifestEntry,
} from "@pdx-ts/codegen-cwt/policy/manifest";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));
const emitter = new Emitter(rules);
const subtypeReferencedTypes = typesReferencedBySubtype(rules);
const refinements = subtypeReferenceRefinements(rules);

/** One manifest registry, emitted as the definer planner receives it. */
function definerContent(manifestEntry: ContentManifestEntry): DefinerContent {
  const type = rules.contentTypes.get(manifestEntry.type);
  const body = rules.bodies.get(manifestEntry.type);
  if (type === undefined || body === undefined) {
    throw new Error(`Missing fixture rules for ${manifestEntry.type}`);
  }
  const registry = registryNameOf(manifestEntry);
  emitter.beginFile();
  const emission = emitContentType(emitter, type, body, registry, manifestEntry.as);
  emitter.endFile();
  return {
    manifest: manifestEntry,
    registry,
    referenceName: referenceNameOf(type, manifestEntry.as, subtypeReferencedTypes),
    referenceRefinement:
      manifestEntry.as === undefined ? (refinements.get(manifestEntry.type) ?? null) : null,
    emission,
  };
}

const contents = [definerContent(CONTENT_MANIFEST[0]!), definerContent(CONTENT_MANIFEST[1]!)];
const plans = contents.map((content) => planRegistryDefiner(content, contents));

describe("the generated capability surface", () => {
  it("names a method for every declaration it renders", () => {
    for (const plan of plans) {
      for (const { method, declaration } of plan.capabilityMembers) {
        expect(declaration).toContain(`  ${method}`);
      }
    }
  });

  it("rejects a registry whose method shadows another's handle", () => {
    const [shadowed, shadowing] = plans;
    const handle = shadowed!.capabilityMembers.find((member) =>
      member.method.endsWith("Handle")
    )!.method;
    const collision: RegistryDefinerPlan = {
      ...shadowing!,
      capabilityMembers: [{ method: handle, declaration: `  ${handle}(): void;` }],
    };

    expect(() => contentCapabilityModule([shadowed!, collision])).toThrow(
      `content capability method collision at ${handle}`
    );
    expect(() => contentCapabilityModule(plans)).not.toThrow();
  });
});

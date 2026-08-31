import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  localisationMembers,
  localisationMetadata,
  planLocalisation,
} from "@pdx-ts/codegen-cwt/emit/content/localisation";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { REQUIRED_LOCALISATION } from "@pdx-ts/codegen-cwt/overlay";
import { Emitter } from "@pdx-ts/codegen-cwt/render/emitter";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));

describe("localisation planning", () => {
  it("uses one resolved requiredness for the authoring member and metadata", () => {
    const type = rules.contentTypes.get("technology")!;
    const source = type.localisation.find((entry) => entry.key === "name")!;
    const emitter = new Emitter(rules);
    const plan = planLocalisation(emitter, type);
    const entry = plan.entries.find((candidate) => candidate.key === "name")!;
    const members = localisationMembers(emitter, type, plan);
    const metadata = localisationMetadata(emitter, type, plan);
    const memberIsOptional = members.includes("  name?: LocalizedText;");
    const metadataIsRequired = metadata.includes(
      '{ member: "name", pattern: "$", required: true }'
    );

    expect(REQUIRED_LOCALISATION.has("technology.name")).toBe(true);
    expect(source.required).toBe(false);
    expect(entry.authoringRequired).toBe(true);
    expect(memberIsOptional).toBe(!entry.authoringRequired);
    expect(metadataIsRequired).toBe(entry.authoringRequired);
  });

  // The negative control: without it the assertion above passes for a plan that
  // simply reported every slot required, which is the disagreement it exists to
  // catch running the other way.
  it("leaves a slot the overlay does not name optional in both projections", () => {
    const type = rules.contentTypes.get("technology")!;
    const emitter = new Emitter(rules);
    const plan = planLocalisation(emitter, type);
    const optional = plan.entries.filter(
      (candidate) => !REQUIRED_LOCALISATION.has(`${type.name}.${candidate.key}`)
    );
    const members = localisationMembers(emitter, type, plan);
    const metadata = localisationMetadata(emitter, type, plan);

    expect(optional.length).toBeGreaterThan(0);
    for (const candidate of optional) {
      expect(candidate.authoringRequired).toBe(false);
      expect(members).toContain(`  ${candidate.key}?: LocalizedText;`);
      expect(metadata).toContain(
        `{ member: ${JSON.stringify(candidate.key)}, pattern: ${JSON.stringify(candidate.pattern)}, required: false }`
      );
    }
  });
});

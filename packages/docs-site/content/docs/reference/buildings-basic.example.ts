import { createMod } from "@pdx-ts/sdk";
import { vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Frontier Laboratories",
  prefix: "frontier_labs",
  supportedVersion: "v4.4.*",
});

const fieldLaboratory = mod.building("field_laboratory", {
  name: "Field Laboratory",
  desc: "A compact research center for young colonies.",
  baseBuildtime: 240,
  category: "research",
  buildingSets: ["research"],
  canBuild: true,
  planetLimit: 1,
  resources: [
    {
      category: "planet_buildings",
      cost: { amounts: { minerals: 300 } },
      upkeep: { amounts: { energy: 2 } },
      produces: { amounts: { physics_research: 2 } },
    },
  ],
  prerequisites: [vanilla.technology("tech_basic_science_lab_1")],
});

export const feature = mod.feature("field_laboratory", [fieldLaboratory]);

export default mod.compile([feature]);

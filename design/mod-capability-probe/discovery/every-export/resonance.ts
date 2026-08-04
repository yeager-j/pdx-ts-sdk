import { discoveryMod as mod } from "../../discovery-mod.ts";

export const theory = mod.technology("theory", {
  name: "Theory",
  area: "physics",
  tier: 1,
  category: "particles",
});

export const lab = mod.building("lab", {
  name: "Lab",
  baseBuildtime: 10,
  category: "research",
  icon: "building_research_lab_1",
  buildingSets: ["research"],
  canBuild: true,
  prerequisites: [theory],
});

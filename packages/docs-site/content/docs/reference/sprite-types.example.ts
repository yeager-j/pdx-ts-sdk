import { always, createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Starfall Interface",
  prefix: "starfall",
  supportedVersion: "v4.4.*",
});

const chartIcon = mod.spriteType("rift_chart_icon", {
  textureFile: "gfx/interface/starfall/rift_chart.dds",
});

const chartTextIcon = mod.spriteTextIcon("rift_chart", {
  textureFile: "gfx/interface/starfall/rift_chart_text.dds",
});

const riftSuppression = mod.bombardmentStance("rift_suppression", {
  name: "Rift Suppression",
  trigger: always(),
  default: false,
  aiWeight: { base: 1 },
});

const selectedSupportButton = mod.spriteFleetOrderButtonGroundSupport(
  riftSuppression,
  {
    textureFile: "gfx/interface/starfall/rift_suppression_selected.dds",
    noOfFrames: 3,
  },
  { selected: true }
);

export const feature = mod.feature("interface", [
  chartIcon,
  chartTextIcon,
  riftSuppression,
  selectedSupportButton,
]);

export default mod.compile([feature]);

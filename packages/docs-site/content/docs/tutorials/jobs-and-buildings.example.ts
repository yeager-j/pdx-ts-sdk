import { createMod } from "@pdx-ts/sdk";
import { always, isCapital, owner, vanilla } from "@pdx-ts/sdk/stellaris";
import { isRegularEmpire } from "@pdx-ts/stellaris-ids/triggers";

const mod = createMod({
  name: "Subspace Archives",
  prefix: "subspace_archives",
  supportedVersion: "v4.4.*",
});

const signalCuratorEconomy = mod.economicCategory("signal_curators", {
  parent: vanilla.economicCategory("planet_jobs_specialist"),
  modifierCategory: "colony",
  generateMultModifiers: ["produces", "upkeep"],
});

const signalCurator = mod.job("signal_curator", {
  name: "Signal Curator",
  plural: "Signal Curators",
  desc: "Interprets faint transmissions preserved in the subspace archives.",
  effect: "Signal Curators produce Physics Research and Unity.",
  category: "specialist",
  isCappedByModifier: true,
  possiblePreTriggers: {
    hasOwner: true,
    isBeingPurged: false,
    isBeingAssimilated: false,
    isSapient: true,
  },
  possiblePrecalc: "can_fill_specialist_job",
  possible: always(),
  resources: [
    {
      category: signalCuratorEconomy,
      produces: { amounts: { physics_research: 4, unity: 1 } },
      upkeep: { amounts: { consumer_goods: 1.5 } },
    },
    {
      category: signalCuratorEconomy,
      produces: {
        amounts: { physics_research: 1 },
        when: isCapital(),
      },
    },
  ],
  weight: { base: 1 },
});

const subspaceArchive = mod.building("subspace_archive", {
  name: "Subspace Archive",
  desc: "A shielded repository where specialists recover signals from subspace noise.",
  icon: "building_research_lab_1",
  category: "research",
  buildingSets: ["research", "physics"],
  canBuild: true,
  baseBuildtime: 360,
  planetLimit: 1,
  potential: owner(isRegularEmpire()),
  resources: [
    {
      category: "planet_buildings",
      cost: { amounts: { minerals: 500, rare_crystals: 25 } },
      upkeep: { amounts: { energy: 4, rare_crystals: 1 } },
    },
  ],
  planetModifier: (modifier) => {
    modifier.job(signalCurator).add(200);
    modifier.economic(signalCuratorEconomy).resource("physics_research").produces.mult(0.15);
    modifier.economic(signalCuratorEconomy).resource("consumer_goods").upkeep.mult(-0.1);
  },
  triggeredPlanetModifier: [
    {
      when: isCapital(),
      modifiers: (modifier) => modifier.job(signalCurator).add(100),
    },
  ],
});

export const feature = mod.feature("subspace_archives", [
  signalCuratorEconomy,
  signalCurator,
  subspaceArchive,
]);

export default mod.compile([feature]);

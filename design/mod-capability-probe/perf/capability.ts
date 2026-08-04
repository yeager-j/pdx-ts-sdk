import { createMod, stellarisIds, type ModCapability, type ProbeIdProfile } from "../capability.ts";
import { names } from "./names.ts";

type ExtraContentMethod =
  | "agreementPreset"
  | "ambientObject"
  | "archaeologicalSiteType"
  | "ascensionPerk"
  | "bombardmentStance"
  | "casusBelli"
  | "civicOrOrigin"
  | "componentSet"
  | "councilor"
  | "countryShipOfSizeLimit"
  | "decision"
  | "economicCategory"
  | "globalShipDesign"
  | "graphicalCulture"
  | "job"
  | "opinionModifier"
  | "scriptedLoc"
  | "scriptedModifier"
  | "sectionTemplate"
  | "shipSize"
  | "situationType"
  | "solarSystemInitializer"
  | "speciesClass"
  | "starbaseLevel"
  | "staticModifier"
  | "strikeCraftComponentTemplate"
  | "utilityComponentTemplate"
  | "warGoal"
  | "weaponComponentTemplate";

type MechanicalMethod<P extends string> = <const N extends string>(
  name: N,
  def: object
) => { readonly id: `${P}_${N}` };

type RepresentativeCapability<P extends string, I extends ProbeIdProfile> = ModCapability<P, I> & {
  readonly [K in ExtraContentMethod]: MechanicalMethod<P>;
};

const capability = createMod(
  {
    name: "Perf Probe",
    prefix: "perf_probe",
    supportedVersion: "4.4.*",
  },
  { ids: stellarisIds }
) as RepresentativeCapability<"perf_probe", typeof stellarisIds>;

type CompletionSurface = keyof typeof capability;
const completionSurface: CompletionSurface[] = [
  "technology",
  "building",
  "tradition",
  "traditionCategory",
  "ascensionPerk",
  "agenda",
  "edict",
  "decision",
  "job",
  "globalShipDesign",
  "utilityComponentTemplate",
  "weaponComponentTemplate",
  "strikeCraftComponentTemplate",
  "shipSize",
  "opinionModifier",
  "staticModifier",
  "scriptedModifier",
  "casusBelli",
  "warGoal",
  "agreementPreset",
  "bombardmentStance",
  "archaeologicalSiteType",
  "situationType",
  "scriptedLoc",
  "councilor",
  "economicCategory",
  "civicOrOrigin",
  "componentSet",
  "sectionTemplate",
  "ambientObject",
  "graphicalCulture",
  "starbaseLevel",
  "speciesClass",
  "countryShipOfSizeLimit",
  "solarSystemInitializer",
];
void completionSurface;

export const technologies = names.map((name) =>
  capability.technology(name, {
    name,
    area: "physics",
    tier: 1,
    category: "particles",
  })
);

type ExpectedId = `perf_probe_tech_${(typeof names)[number]}`;
const ids: ExpectedId[] = technologies.map((technology) => technology.id);
void ids;

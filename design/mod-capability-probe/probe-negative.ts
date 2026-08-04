import { collection } from "../../packages/sdk/src/items.ts";
import { createMod, stellarisIds, type MintedContentId } from "./capability.ts";

const mod = createMod(
  {
    name: "Type Probe",
    prefix: "type_probe",
    supportedVersion: "4.4.*",
  },
  { ids: stellarisIds }
);

const theory = mod.technology("theory", {
  name: "Theory",
  area: "physics",
  tier: 1,
  category: "particles",
});

const lab = mod.building("lab", {
  name: "Lab",
  baseBuildtime: 10,
  category: "research",
  icon: "building_research_lab_1",
  buildingSets: ["research"],
  canBuild: true,
});

const exactTechnologyId: "type_probe_tech_theory" = theory.id;
const derivedTechnologyId: MintedContentId<
  "type_probe",
  typeof stellarisIds,
  "technology",
  "theory"
> = theory.id;
void exactTechnologyId;
void derivedTechnologyId;

mod.technology("forged", {
  // @ts-expect-error — the capability is the only id authority
  id: "someone_else_tech_forged",
  name: "Forged",
  area: "physics",
  tier: 1,
  category: "particles",
});

mod.technology("application", {
  name: "Application",
  area: "physics",
  tier: 2,
  category: "particles",
  prerequisites: [theory],
});

mod.technology("wrong_reference", {
  name: "Wrong",
  area: "physics",
  tier: 2,
  category: "particles",
  // @ts-expect-error — a building item is not a technology reference
  prerequisites: [lab],
});

const events = mod.namespace("resonance");
const country = events.countryHandle(1);
const planetFromCountry = events.planetHandle(2, { from: "country" });
const exactNamespace: "type_probe_resonance" = events.namespace;
const exactEventId: "type_probe_resonance.2" = planetFromCountry.id;
void exactNamespace;
void exactEventId;

planetFromCountry.define({
  isTriggeredOnly: true,
  immediate: (_planet, ctx) => {
    ctx.from.effects((fromCountry) => fromCountry.countryEvent({ id: country }));
  },
});

events.country(3, {
  isTriggeredOnly: true,
  immediate: (scope, ctx) => {
    scope.everyOwnedPlanet({}, (planet) => {
      planet.planetEvent({
        id: planetFromCountry,
        from: ctx.self,
      });
      // @ts-expect-error — the target event requires a country FROM witness
      planet.planetEvent({ id: planetFromCountry });
    });
  },
});

// @ts-expect-error — the capability's config snapshot is read-only
mod.config.prefix = "mutated";
// @ts-expect-error — the snapshotted tag list is read-only too
mod.config.tags?.push("mutated");

const alpha = createMod(
  { name: "Alpha", prefix: "alpha_owner", supportedVersion: "4.4.*" },
  { ids: stellarisIds }
);
const beta = createMod(
  { name: "Beta", prefix: "beta_owner", supportedVersion: "4.4.*" },
  { ids: stellarisIds }
);
const betaFeature = beta.feature("empty", []);

// @ts-expect-error — a feature is owned by the capability that placed it
alpha.compile([betaFeature]);
// @ts-expect-error — legacy collections cannot enter the capability fold directly
alpha.compile([collection("legacy", [])]);

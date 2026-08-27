import { createMod } from "@pdx-ts/sdk";
import { eventTarget, exists, hasOwner, isAi, onActions, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Crystal Survey",
  prefix: "crystal_survey",
  supportedVersion: "v4.4.*",
});

const events = mod.namespace("project");
const signalWorld = eventTarget<"planet">("crystal_survey_signal_world");

const signalCompleted = events.ship(2, {
  scopes: { from: "planet" },
  title: "The Crystal Pattern",
  desc: "The transmission resolves into a complete map of the crystal's internal structure.",
  location: (ctx) => ctx.from,
  isTriggeredOnly: true,
  options: [
    {
      name: { english: "Record the pattern.", key: "record_pattern" },
      effects: (ship) => {
        ship.owner.effects((country) => {
          country.addResource({ resource: "physics_research", amount: 500 });
        });
      },
    },
  ],
});

const analyzeSignal = mod.specialProject("analyze_signal", {
  name: "Analyze the Crystal Signal",
  desc: "Send a science ship to decode the transmission at its source.",
  cost: 0,
  daysToResearch: 90,
  timelimit: 360,
  eventScope: "ship_event",
  locationScope: "planet",
  location: true,
  removeWhenCompleted: true,
  picture: vanilla.spriteType("GFX_evt_archaeological_dig"),
  icon: "gfx/interface/icons/situation_log/situation_log_quest.dds",
  requirements: {
    shipclassScienceShip: 1,
    leader: "scientist",
  },
  onStart: (ship, ctx) => {
    ship.setShipFlag("crystal_survey_started");
    ctx.from.effects((planet) => planet.setPlanetFlag("crystal_survey_in_progress"));
  },
  onProgress50: (ship) => ship.setShipFlag("crystal_survey_halfway"),
  onSuccess: (ship, ctx) => {
    ship.shipEvent({ id: signalCompleted, scopes: { from: ctx.from } });
  },
  onFail: (country) => country.setCountryFlag("crystal_survey_failed"),
  onCancel: (country) => country.setCountryFlag("crystal_survey_cancelled"),
});

const signalDetected = events.country(1, {
  title: "A Signal in the Crust",
  desc: "Sensors have found a structured transmission beneath one of our worlds.",
  isTriggeredOnly: true,
  trigger: isAi(false),
  options: [
    {
      name: { english: "Prepare an expedition.", key: "prepare_expedition" },
      effects: (country, ctx) => {
        country.randomOwnedPlanet({ limit: hasOwner() }, (planet) => {
          planet.saveEventTargetAs(signalWorld);
        });
        country.if(exists(signalWorld), () => {
          country.enableSpecialProject({
            name: analyzeSignal,
            owner: ctx.self,
            location: signalWorld,
          });
        });
      },
    },
  ],
});

const startSignal = mod.on(onActions.onGameStartCountry, [signalDetected]);

export const feature = mod.feature("crystal_project", [
  analyzeSignal,
  signalDetected,
  signalCompleted,
  startSignal,
]);

export default mod.compile([feature]);

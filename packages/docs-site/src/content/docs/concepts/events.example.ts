import { createMod, eventTarget, hasOwner } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Crystal Resonance",
  prefix: "crystal_resonance",
  supportedVersion: "v4.4.*",
});

const events = mod.namespace("signal");
const signalWorld = eventTarget<"planet">("crystal_resonance_signal_world");

const aftershock = events.planet(2, {
  from: "country",
  title: "A World Answers",
  desc: "The signal has found an echo beneath the planet's surface.",
  location: (ctx) => ctx.self,
  isTriggeredOnly: true,
  immediate: (_planet, ctx) => {
    ctx.from.effects((country) => {
      country.addResource({ resource: "influence", amount: 50 });
    });
  },
  options: [{ name: "Record the harmonic.", key: "record_harmonic" }],
});

const signalDetected = events.country(1, {
  title: "A Signal in the Noise",
  desc: "A repeating harmonic reaches us from one of our worlds.",
  isTriggeredOnly: true,
  options: [
    {
      name: "Trace it to the source.",
      key: "trace_source",
      effects: (country, ctx) => {
        country.randomOwnedPlanet({ limit: hasOwner() }, (planet) => {
          planet.saveEventTargetAs(signalWorld);
          signalWorld.effects((savedPlanet) => {
            savedPlanet.planetEvent({ id: aftershock, from: ctx.self, days: 30 });
          });
        });
      },
    },
  ],
});

export const feature = mod.feature("signal", [signalDetected, aftershock]);

export default mod.compile([feature]);

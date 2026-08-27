import { createMod } from "@pdx-ts/sdk";
import { eventTarget, hasOwner, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Crystal Resonance",
  prefix: "crystal_resonance",
  supportedVersion: "v4.4.*",
});

const events = mod.namespace("signal");
const signalWorld = eventTarget<"planet">("crystal_resonance_signal_world");

const aftershock = events.planet(2, {
  scopes: { from: "country" },
  title: "A World Answers",
  desc: "The signal has found an echo beneath the planet's surface.",
  picture: vanilla.spriteType.eventpictures.GFX_evt_mysterious_signal,
  showSound: vanilla.soundEffect.gui.gui_sound_effects.event_alien_signal,
  location: (ctx) => ctx.self,
  isTriggeredOnly: true,
  immediate: (_planet, ctx) => {
    ctx.from.effects((country) => {
      country.addResource({ resource: "influence", amount: 50 });
    });
  },
  options: [{ name: { english: "Record the harmonic.", key: "record_harmonic" } }],
});

const signalDetected = events.country(1, {
  title: "A Signal in the Noise",
  desc: "A repeating harmonic reaches us from one of our worlds.",
  picture: vanilla.spriteType.eventpictures.GFX_evt_mysterious_signal,
  showSound: vanilla.soundEffect.gui.gui_sound_effects.event_alien_signal,
  isTriggeredOnly: true,
  options: [
    {
      name: { english: "Trace it to the source.", key: "trace_source" },
      effects: (country, ctx) => {
        country.randomOwnedPlanet({ limit: hasOwner() }, (planet) => {
          planet.saveEventTargetAs(signalWorld);
          signalWorld.effects((savedPlanet) => {
            savedPlanet.planetEvent({ id: aftershock, scopes: { from: ctx.root }, days: 30 });
          });
        });
      },
    },
  ],
});

export const feature = mod.feature("signal", [signalDetected, aftershock]);

export default mod.compile([feature]);

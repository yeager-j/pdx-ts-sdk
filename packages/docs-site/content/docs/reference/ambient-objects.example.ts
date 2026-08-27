import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Ancient Relay",
  prefix: "ancient_relay",
  supportedVersion: "v4.4.*",
});

const relayDescription = mod.localization(
  "relay_description",
  "A silent relay from an unknown civilization."
);
const relayTooltip = mod.localization("relay_tooltip", "Inspect the ancient relay.");

const relay = mod.ambientObject("relay", {
  name: "Ancient Relay",
  entity: "ancient_relay_entity",
  selectable: true,
  showName: true,
  description: relayDescription,
  tooltip: relayTooltip,
});

const relaySystem = mod.solarSystemInitializer("relay_system", {
  class: "sc_g",
  planet: [{ class: "star", orbitDistance: 0, size: 20 }],
  initEffect: (system, ctx) => {
    system.createAmbientObject({
      type: relay,
      location: ctx.self,
      effect: (ambient) => ambient.setAmbientObjectFlag("ancient_relay_spawned"),
    });
  },
});

export const feature = mod.feature("relay", [relayDescription, relayTooltip, relay, relaySystem]);

export default mod.compile([feature]);

import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Starfall Relay",
  prefix: "starfall",
  supportedVersion: "v4.4.*",
});

const relayPulse = mod.pdxparticle("relay_pulse", {
  type: "starfall_relay_pulse_file",
  scale: 1,
});

export const feature = mod.feature("relay", [relayPulse]);

export default mod.compile([feature]);

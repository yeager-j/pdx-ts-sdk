import { createMod, stellarisIds } from "./capability.ts";

export const discoveryMod = createMod(
  {
    name: "Discovery Probe",
    prefix: "discovery_probe",
    supportedVersion: "4.4.*",
  },
  { ids: stellarisIds }
);

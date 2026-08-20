import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Starfall Relay",
  prefix: "starfall",
  supportedVersion: "v4.4.*",
});

const relayMesh = mod.pdxmesh("relay_mesh", {
  file: "gfx/models/starfall/relay.mesh",
  scale: 1,
  meshsettings: [
    {
      name: "relayShape",
      index: 0,
      shader: "PdxMeshShip",
      textureDiffuse: "relay_diffuse.dds",
      textureNormal: "relay_normal.dds",
      textureSpecular: "relay_specular.dds",
    },
  ],
  animation: [
    {
      id: "idle",
      type: "starfall_relay_idle_animation",
    },
  ],
});

export const feature = mod.feature("relay", [relayMesh]);

export default mod.compile([feature]);

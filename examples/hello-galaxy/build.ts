import { defineHelloGalaxy } from "./mod.ts";

const mod = defineHelloGalaxy();
const outDir = new URL("./out/", import.meta.url);
await mod.synth(outDir);

for (const relPath of mod.render().keys()) {
  console.log(`wrote ${relPath}`);
}

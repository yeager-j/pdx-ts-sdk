import { render, write } from "../../packages/sdk/src/index.ts";
import { defineHelloGalaxy } from "./mod.ts";

const mod = await defineHelloGalaxy();
const files = render(mod);
await write(new URL("./out/", import.meta.url), files);

for (const relPath of files.keys()) {
  console.log(`wrote ${relPath}`);
}

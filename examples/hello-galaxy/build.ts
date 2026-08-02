import { render, write } from "../../src/index.ts";
import { defineHelloGalaxy } from "./mod.ts";

const mod = defineHelloGalaxy();
const files = render(mod);
await write(new URL("./out/", import.meta.url), files);

for (const relPath of files.keys()) {
  console.log(`wrote ${relPath}`);
}

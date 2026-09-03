import { render, write } from "@pdx-ts/sdk";

import { defineHelloGalaxy } from "./index.ts";

const files = render(defineHelloGalaxy());
await write(new URL("./out/", import.meta.url), files);

for (const relPath of files.keys()) {
  console.log(`wrote ${relPath}`);
}

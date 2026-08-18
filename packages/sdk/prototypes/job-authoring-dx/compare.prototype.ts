/** PROTOTYPE ONLY: render both authoring forms and expose any output difference. */
import { render } from "@pdx-ts/sdk";

import proposed from "./physicist.proposed.prototype.ts";
import raw from "./physicist.raw.prototype.ts";

function renderedText(mod: Parameters<typeof render>[0]): ReadonlyMap<string, string> {
  return new Map(
    [...render(mod)].map(([path, file]) => [path, file.text?.replace(/^﻿/, "") ?? "<bytes>"])
  );
}

const rawFiles = renderedText(raw);
const proposedFiles = renderedText(proposed);
const paths = [...new Set([...rawFiles.keys(), ...proposedFiles.keys()])].sort();
const different = paths.filter((path) => rawFiles.get(path) !== proposedFiles.get(path));

console.log(`Equivalent rendered output: ${different.length === 0 ? "yes" : "no"}`);
console.log(`Rendered files: ${paths.length}`);
for (const path of paths) {
  console.log(`- ${path}${different.includes(path) ? " (different)" : ""}`);
}

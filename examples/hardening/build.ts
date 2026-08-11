import { basename, dirname, resolve } from "node:path";
import { install, render, stellaris } from "@pdx-ts/sdk";

import { defineHardening } from "./mod.ts";

const vanilla = stellaris.load();
const hardening = defineHardening(vanilla);

// Defaults to a local `./out/` so the build is inspectable in place; pass a
// path to install somewhere else, or the launcher's own mod directory to skip
// the move. `install` places content at <dir> and the launcher descriptor at
// <dir>.mod, which is the layout this example has always produced.
const outDir = resolve(process.argv[2] ?? new URL("./out/", import.meta.url).pathname);
const rendered = render(hardening.mod);
const { contentDir, descriptorPath } = await install(rendered, {
  modDir: dirname(outDir),
  dirName: basename(outDir),
});

console.log(`Built PDX SDK Hardening for Stellaris ${vanilla.gameVersion ?? "unknown"}`);
console.log(`Content directory: ${contentDir}`);
console.log(`Launcher descriptor: ${descriptorPath}`);
for (const relPath of rendered.keys()) {
  console.log(`  wrote ${relPath}`);
}
console.log("");
console.log("Move both paths into the launcher mod directory if they were built elsewhere, enable");
console.log("the mod, then follow examples/hardening/calibration/README.md.");

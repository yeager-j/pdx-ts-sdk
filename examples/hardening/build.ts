import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stellaris } from "../../src/index.ts";
import { defineHardening } from "./mod.ts";

const vanilla = stellaris.load();
const hardening = defineHardening(vanilla);
const outDir = resolve(process.argv[2] ?? new URL("./out/", import.meta.url).pathname);

await hardening.mod.synth(outDir);
const launcherDescriptor = `${outDir}.mod`;
await writeFile(
  launcherDescriptor,
  [
    'name="PDX SDK Hardening"',
    'version="1.0.0"',
    'supported_version="v4.4.*"',
    `path="${outDir}"`,
    "",
  ].join("\n"),
  "utf8"
);

console.log(`Built PDX SDK Hardening for Stellaris ${vanilla.gameVersion ?? "unknown"}`);
console.log(`Content directory: ${outDir}`);
console.log(`Launcher descriptor: ${launcherDescriptor}`);
for (const relPath of hardening.mod.render().keys()) {
  console.log(`  wrote ${relPath}`);
}
console.log("");
console.log("Move both paths into the launcher mod directory if they were built elsewhere, enable");
console.log("the mod, then follow examples/hardening/calibration/README.md.");

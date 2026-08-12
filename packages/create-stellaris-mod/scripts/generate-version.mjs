import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
const output = [
  "/** This file is generated from package.json by scripts/generate-version.mjs. */",
  `export const VERSION = ${JSON.stringify(manifest.version)};`,
  "",
].join("\n");

const generatedPath = path.join(packageDir, "src/generated/package-version.ts");
if (process.argv.includes("--check")) {
  const actual = await readFile(generatedPath, "utf8");
  if (actual !== output) {
    throw new Error(
      `${path.relative(process.cwd(), generatedPath)} is stale. Run npm run generate:version ` +
        "in packages/create-stellaris-mod and commit the result."
    );
  }
} else {
  await writeFile(generatedPath, output);
}

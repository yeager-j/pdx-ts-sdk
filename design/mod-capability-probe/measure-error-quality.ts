import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";

const fixture = path.join(import.meta.dirname, "perf/error-quality.ts.fixture");
const generated = path.join(import.meta.dirname, "perf/error-quality.generated.ts");
const tsc = path.join(import.meta.dirname, "../../node_modules/.bin/tsc");

copyFileSync(fixture, generated);
try {
  const result = spawnSync(
    tsc,
    [
      "--ignoreConfig",
      "--noEmit",
      "--pretty",
      "false",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2024",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--allowImportingTsExtensions",
      "--customConditions",
      "pdx-source",
      "--types",
      "node",
      generated,
    ],
    { encoding: "utf8" }
  );
  if (result.status === 0) {
    throw new Error("The negative fixture compiled successfully");
  }
  const output = (result.stdout + result.stderr)
    .replaceAll(generated, fixture)
    .replaceAll(path.relative(process.cwd(), generated), path.relative(process.cwd(), fixture));
  if (
    !output.includes("'id' does not exist") ||
    !output.includes("not assignable to type 'TechnologyRef")
  ) {
    throw new Error(`The errors lost their actionable boundary:\n${output}`);
  }
  console.log(output.trim());
} finally {
  if (existsSync(generated)) {
    unlinkSync(generated);
  }
}

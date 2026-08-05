/**
 * Measures completion latency against the simulated 560-method scope
 * interface using the TypeScript LanguageService — the same machinery
 * tsserver runs for IDE autocomplete. Run with:
 *
 *   node design/effects-probe/measure-latency.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const simPath = fileURLToPath(new URL("./latency-sim.ts", import.meta.url));
const triggerCorePath = fileURLToPath(
  new URL("../../packages/sdk/src/script/trigger-core.ts", import.meta.url)
);
const astPath = fileURLToPath(new URL("../../packages/sdk/src/ast.ts", import.meta.url));
const scopesPath = fileURLToPath(
  new URL("../../packages/sdk/src/generated/scopes.ts", import.meta.url)
);
const probePath = fileURLToPath(new URL("./__completion-probe.ts", import.meta.url));

const probeText = `import type { BigCountryScope } from "./latency-sim.ts";
declare const scope: BigCountryScope;
scope.`;

const files = new Map<string, string>([
  [simPath, readFileSync(simPath, "utf8")],
  [triggerCorePath, readFileSync(triggerCorePath, "utf8")],
  [astPath, readFileSync(astPath, "utf8")],
  [scopesPath, readFileSync(scopesPath, "utf8")],
  [probePath, probeText],
]);

const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
};

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: () => "1",
  getScriptSnapshot: (fileName) => {
    const known = files.get(fileName);
    if (known !== undefined) {
      return ts.ScriptSnapshot.fromString(known);
    }
    if (!ts.sys.fileExists(fileName)) {
      return undefined;
    }
    return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? "");
  },
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => options,
  getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
};

const service = ts.createLanguageService(host, ts.createDocumentRegistry());
const position = probeText.length;

const timings: number[] = [];
for (let run = 0; run < 6; run++) {
  const start = performance.now();
  const completions = service.getCompletionsAtPosition(probePath, position, {});
  const elapsed = performance.now() - start;
  timings.push(elapsed);
  if (run === 0) {
    console.log(`completions returned: ${completions?.entries.length ?? 0}`);
  }
}

const [cold, ...warm] = timings;
const warmAvg = warm.reduce((sum, t) => sum + t, 0) / warm.length;
console.log(`cold completion: ${cold?.toFixed(1)}ms`);
console.log(`warm completion (avg of ${warm.length}): ${warmAvg.toFixed(1)}ms`);

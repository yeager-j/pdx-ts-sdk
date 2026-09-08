import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { revision, type Context } from "./contract.ts";
import { preparedScripts as scripts } from "./prepare.ts";
import { deadlines, runCase, type CaseResult } from "./supervisor.ts";

const [moduleArg, configArg, outputArg, timeoutArg] = process.argv.slice(2);
if (!moduleArg || !configArg || !outputArg)
  throw new Error(
    "Usage: node cli.ts <adapter.ts> <config.json> <new-output-directory> [operation-ms]"
  );
const modulePath = resolve(moduleArg);
const configuration: unknown = JSON.parse(readFileSync(resolve(configArg), "utf8"));
const directory = resolve(outputArg);
mkdirSync(dirname(directory), { recursive: true });
mkdirSync(directory, { recursive: false });
if (timeoutArg !== undefined) {
  const timeout = Number(timeoutArg);
  if (!Number.isSafeInteger(timeout) || timeout <= 0)
    throw new Error("operation-ms must be a positive integer");
  deadlines.operation = timeout;
}
const sourceNames = [
  "contract.ts",
  "scenario.ts",
  "checks.ts",
  "supervisor.ts",
  "worker.ts",
  "cli.ts",
  "prepare.ts",
];
const hashes = Object.fromEntries(
  sourceNames.map((name) => [
    name,
    createHash("sha256")
      .update(readFileSync(fileURLToPath(new URL(name, import.meta.url))))
      .digest("hex"),
  ])
);
const sharedSha256 = createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
const scriptHashes = Object.fromEntries(
  Object.entries(scripts).map(([id, script]) => [
    id,
    createHash("sha256").update(JSON.stringify(script)).digest("hex"),
  ])
);
writeFileSync(
  join(directory, "inputs.json"),
  JSON.stringify(
    {
      revision,
      sharedSha256,
      hashes,
      deadlines,
      scripts,
      scriptHashes,
      modulePath,
      adapterModuleSha256: createHash("sha256").update(readFileSync(modulePath)).digest("hex"),
      nodeVersion: process.version,
      configuration,
    },
    null,
    2
  ) + "\n"
);
writeFileSync(
  join(directory, "sdk446-events.txt"),
  "namespace = sdk446\n\n" +
    Object.values(scripts)
      .map((script) => script.definition)
      .join("\n")
);
const cases: CaseResult[] = [];
for (const name of ["baseline", "fresh-world", "failed-condition", "worker-loss"]) {
  const runDirectory = join(directory, name);
  mkdirSync(runDirectory);
  const context: Context = {
    runId: randomUUID(),
    directory: runDirectory,
    configuration,
    scripts,
    scriptHashes,
  };
  const result = await runCase(
    modulePath,
    context,
    name,
    name === "fresh-world" ? cases[0]?.player : undefined
  );
  cases.push(result);
  const failedCondition =
    name === "failed-condition" &&
    result.behavior === "failed" &&
    result.execution === "complete" &&
    result.failures.length === 1 &&
    result.failures[0]?.includes("condition expected true, captured false");
  const workerLoss =
    name === "worker-loss" &&
    result.behavior === "not-assessed" &&
    result.execution === "incomplete" &&
    result.failures.length === 1 &&
    /worker-lost|closed|disconnected/i.test(result.failures[0]!);
  const normal =
    (name === "baseline" || name === "fresh-world") &&
    result.behavior === "passed" &&
    result.failures.length === 0 &&
    (name !== "fresh-world" || result.controls.includes("foreign-world-binding"));
  const disposed =
    result.cleanup?.processExit === "confirmed" &&
    result.cleanup.evidenceRetained &&
    ["removed", "retained"].includes(result.cleanup.profile);
  const inputIdentityStable = isDeepStrictEqual(result.metadata, cases[0]?.metadata);
  const controlSatisfied = Boolean(
    (failedCondition || workerLoss || normal) && disposed && inputIdentityStable
  );
  writeFileSync(
    join(runDirectory, "control.json"),
    JSON.stringify({ name, controlSatisfied, inputIdentityStable, observed: result }, null, 2)
  );
  console.log(
    `${name}: ${controlSatisfied ? "control satisfied" : "CONTROL FAILED"}; behavior=${result.behavior}; execution=${result.execution}`
  );
  if (!controlSatisfied) break;
}
const controlsSatisfied =
  cases.length === 4 &&
  cases.every(
    (result) =>
      JSON.parse(readFileSync(join(directory, result.name, "control.json"), "utf8"))
        .controlSatisfied
  );
const nativeEvidence =
  cases.length === 4 && cases.every((result) => result.metadata?.mode === "native");
const report = {
  schemaVersion: 1,
  revision,
  sharedSha256,
  controlsSatisfied,
  nativeCompatibilityEstablished: controlsSatisfied && nativeEvidence,
  evidenceMode: nativeEvidence ? "native" : "mock-or-unestablished",
  cases,
};
writeFileSync(join(directory, "result.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`Result: ${join(directory, "result.json")}`);
if (!controlsSatisfied) process.exitCode = 1;

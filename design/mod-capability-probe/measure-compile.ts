import { spawnSync } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";

const runs = 5;
const tsc = path.join(import.meta.dirname, "../../node_modules/.bin/tsc");
const configs = {
  free: path.join(import.meta.dirname, "perf/tsconfig.free.json"),
  capability: path.join(import.meta.dirname, "perf/tsconfig.capability.json"),
} as const;

function measure(config: string): number {
  const started = performance.now();
  const result = spawnSync(tsc, ["--noEmit", "--pretty", "false", "-p", config], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stdout + result.stderr);
  }
  return performance.now() - started;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

const samples = { free: [] as number[], capability: [] as number[] };
for (let index = 0; index < runs; index += 1) {
  const order =
    index % 2 === 0 ? (["free", "capability"] as const) : (["capability", "free"] as const);
  for (const key of order) {
    samples[key].push(measure(configs[key]));
  }
}

const freeMedian = median(samples.free);
const capabilityMedian = median(samples.capability);
const deltaPercent = ((capabilityMedian - freeMedian) / freeMedian) * 100;

console.log(
  JSON.stringify(
    {
      unit: "milliseconds",
      process: "fresh tsc --noEmit",
      runs,
      samples,
      median: {
        free: freeMedian,
        capability: capabilityMedian,
      },
      deltaPercent,
      escapeBudgetPercent: 20,
      passes: deltaPercent <= 20,
    },
    null,
    2
  )
);

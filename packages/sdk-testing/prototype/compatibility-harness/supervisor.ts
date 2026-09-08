import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bindingValue,
  check,
  checkCondition,
  checkOutcome,
  checkRejected,
  checkSnapshot,
  subjectValue,
} from "./checks.ts";
import type {
  Binding,
  Cleanup,
  Command,
  Context,
  Invocation,
  Metadata,
  Outcome,
  Snapshot,
} from "./contract.ts";
import { days, locators } from "./scenario.ts";

/** Independent host bounds. These are experiment controls, not performance targets. */
export const deadlines = { launch: 180_000, operation: 60_000, cleanup: 10_000, workerExit: 5_000 };
/** One scenario keeps observed behavior separate from execution and disposal. */
export type CaseResult = {
  name: string;
  behavior: "not-assessed" | "passed" | "failed";
  execution: "complete" | "incomplete";
  failures: string[];
  metadata?: Metadata;
  cleanup?: Cleanup;
  controls: string[];
  player?: Binding;
};

function journal(directory: string, record: unknown): void {
  const path = join(directory, "journal.jsonl");
  appendFileSync(path, JSON.stringify({ receivedAt: new Date().toISOString(), record }) + "\n");
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function startWorker(directory: string, label: string): ChildProcess {
  const output = openSync(join(directory, `${label}.log`), "a");
  try {
    return fork(fileURLToPath(new URL("worker.ts", import.meta.url)), [], {
      stdio: ["ignore", output, output, "ipc"],
    });
  } finally {
    closeSync(output);
  }
}

function call<T>(
  worker: ChildProcess,
  directory: string,
  request: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  const id = randomUUID();
  let storageError: Error | undefined;
  try {
    journal(directory, { kind: "dispatch", id, request, timeoutMs });
  } catch (error) {
    if (request.operation !== "cleanup") throw error;
    // Evidence failure must not prevent the independent disposal attempt.
    storageError = error as Error;
  }
  return new Promise((resolveCall, reject) => {
    const finish = (error?: Error, value?: T) => {
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("exit", onExit);
      worker.off("error", onError);
      if (error) reject(error);
      else resolveCall(value as T);
    };
    const onError = (error: Error) => finish(error);
    const onExit = () => finish(new Error("worker-lost"));
    const onMessage = (message: { id: string; value: T; error?: string }) => {
      try {
        journal(directory, { kind: "response", message });
        if (message.id !== id) return finish(new Error("unexpected-response-identity"));
        finish(message.error ? new Error(message.error) : storageError, message.value);
      } catch (error) {
        finish(error as Error);
      }
    };
    const timer = setTimeout(() => finish(new Error("deadline-exceeded")), timeoutMs);
    worker.on("message", onMessage).once("exit", onExit).once("error", onError);
    worker.send({ ...request, id, timeoutMs }, (error) => {
      if (error) finish(error);
    });
  });
}

async function stopWorker(worker: ChildProcess): Promise<void> {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  await new Promise<void>((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error("worker-exit-unconfirmed")),
      deadlines.workerExit
    );
    worker.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
    worker.kill("SIGKILL");
  });
}

function checkRaw(directory: string, paths: readonly string[]): void {
  check(paths.length > 0, "raw evidence retained");
  for (const path of paths) {
    const within = relative(directory, resolve(directory, path));
    check(
      within !== "" && !within.startsWith("..") && !within.startsWith("/"),
      "evidence stays in run directory"
    );
    check(existsSync(resolve(directory, path)), `raw evidence exists: ${path}`);
  }
}

function checkMetadata(metadata: Metadata): void {
  check(metadata.mode === "mock" || metadata.mode === "native", "declared evidence mode");
  check(metadata.fixture.semanticRevision === "sdk446-fixture/v1", "equivalent fixture contract");
  for (const hash of [
    metadata.environment.executableSha256,
    metadata.environment.bridgeSha256,
    metadata.fixture.saveSha256,
    ...metadata.fixture.dependencies.map((dependency) => dependency.sha256),
  ]) {
    check(/^[a-f0-9]{64}$/.test(hash), "exact input SHA-256");
  }
  for (const value of [
    metadata.adapterRevision,
    metadata.fixture.sourceBuild,
    ...Object.values(metadata.environment),
  ])
    check(typeof value === "string" && value.length > 0, "input metadata present");
}

/** Run unchanged behavioral checks through an injected adapter module in a separate process. */
export async function runCase(
  modulePath: string,
  context: Context,
  name: string,
  foreign?: Binding
): Promise<CaseResult> {
  const result: CaseResult = {
    name,
    behavior: "not-assessed",
    execution: "incomplete",
    failures: [],
    controls: [],
  };
  const worker = startWorker(context.directory, "adapter");
  let snapshot: Snapshot;
  let phase = "validation";
  let assertionCount = 0;
  const perform = async (command: Command): Promise<Outcome> => {
    const invocation: Invocation = {
      run: context.runId,
      world: snapshot.world,
      phase,
      id: randomUUID(),
    };
    const outcome = await call<Outcome>(
      worker,
      context.directory,
      { operation: "perform", command, invocation },
      deadlines.operation
    );
    journal(context.directory, { kind: "outcome", invocation, command, outcome });
    if (outcome.kind === "incomplete")
      throw new Error(`incomplete-operation: ${outcome.causes.join(", ")}`);
    const evidence = checkOutcome(outcome, command, invocation, snapshot, context.scriptHashes);
    checkRaw(context.directory, evidence.raw);
    snapshot = evidence.after;
    assertionCount++;
    return outcome;
  };
  const acquire = async (locator: (typeof locators)[keyof typeof locators]) =>
    bindingValue(await perform({ kind: "resolve", locator }), locator.scope, snapshot.world);
  const invoke = (binding: Binding, script: string) => perform({ kind: "invoke", binding, script });
  const validate = (binding: Binding) => perform({ kind: "validate", binding });
  try {
    const launched = await call<{ metadata: Metadata; ready: Snapshot; raw: string[] }>(
      worker,
      context.directory,
      { operation: "launch", context, modulePath },
      deadlines.launch
    );
    result.metadata = launched.metadata;
    checkMetadata(launched.metadata);
    checkSnapshot(launched.ready);
    checkRaw(context.directory, launched.raw);
    snapshot = launched.ready;
    if (name === "worker-loss") {
      journal(context.directory, { kind: "fault-injected", fault: "worker-loss-after-readiness" });
      await stopWorker(worker);
      await perform({ kind: "snapshot" });
      throw new Error("lost-worker-unexpectedly-returned");
    }
    const initialDay = snapshot.day;
    const player = await acquire(locators.player);
    result.player = player;
    const colony = await acquire(locators.colony);
    const planet = await acquire(locators.planet);
    const country = await acquire(locators.country);
    check(
      subjectValue(await validate(country)) !== snapshot.player,
      "disposable country is not the player"
    );
    check(
      subjectValue(await validate(planet)) !== subjectValue(await validate(colony)),
      "disposable planet is not the surviving colony"
    );
    check(
      subjectValue(await validate(player)) === snapshot.player,
      "binding identifies actual loaded player"
    );
    checkCondition(await invoke(player, "human"), true);
    checkCondition(await invoke(colony, "colony"), true);
    checkCondition(await invoke(planet, "uncolonized"), true);
    checkCondition(await invoke(player, "marked"), false);
    check(snapshot.day === initialDay, "validation does not advance time");
    phase = "scenario";
    if (name === "failed-condition") {
      checkCondition(await invoke(player, "marked"), true);
      throw new Error("failed-condition-unexpectedly-passed");
    }
    for (const [locator, reason] of [
      [locators.missing, "missing-object"],
      [locators.wrongKind, "wrong-object-kind"],
      [locators.duplicate, "ambiguous-object"],
    ] as const)
      checkRejected(await perform({ kind: "resolve", locator }), reason);
    checkRejected(
      await validate({ ...player, token: player.token + "-tampered" }),
      "invalid-binding"
    );
    checkRejected(
      await invoke({ ...player, token: player.token + "-tampered" }, "mark"),
      "invalid-binding"
    );
    if (foreign) {
      check(foreign.world !== snapshot.world, "fresh world identity");
      const rejected = await validate(foreign);
      check(
        rejected.kind === "contract-error" && rejected.reason === "foreign-binding",
        "foreign world is contract misuse, not expected game rejection"
      );
      const foreignEffect = await invoke(foreign, "mark");
      check(
        foreignEffect.kind === "contract-error" && foreignEffect.reason === "foreign-binding",
        "foreign binding cannot dispatch an effect"
      );
      result.controls.push("foreign-world-binding");
    }
    checkCondition(await invoke(player, "marked"), false);
    for (let iteration = 0; iteration < 2; iteration++) {
      check((await invoke(player, "mark")).kind === "completed", "prepared effect completes");
      checkCondition(await invoke(player, "marked"), true);
    }
    check(
      (await perform({ kind: "advance", days: days.advance })).kind === "completed",
      "explicit exact-day advancement"
    );
    const oldCountry = subjectValue(await validate(country));
    check(
      subjectValue(await validate(await acquire(locators.country))) === oldCountry,
      "repeated acquisition preserves subject identity"
    );
    const oldPlanet = subjectValue(await validate(planet));
    check(
      (await invoke(country, "removeCountry")).kind === "completed",
      "destruction request completed"
    );
    check(
      (await invoke(planet, "removePlanet")).kind === "completed",
      "planet removal request completed"
    );
    check(
      subjectValue(await validate(country)) === oldCountry &&
        subjectValue(await validate(planet)) === oldPlanet,
      "requested destruction is still live before engine removal"
    );
    let countryRemoved = false;
    let planetRemoved = false;
    for (let elapsed = 0; elapsed < days.removalLimit; elapsed += days.removal) {
      check(
        (await perform({ kind: "advance", days: days.removal })).kind === "completed",
        "explicit removal tick"
      );
      const countryState = await validate(country);
      const planetState = await validate(planet);
      if (countryState.kind === "rejected") {
        checkRejected(countryState, "invalid-binding");
        countryRemoved = true;
      } else {
        check(!countryRemoved, "country binding never revives");
        check(subjectValue(countryState) === oldCountry, "country binding never retargets");
      }
      if (planetState.kind === "rejected") {
        checkRejected(planetState, "invalid-binding");
        planetRemoved = true;
      } else {
        check(!planetRemoved, "planet binding never revives");
        check(subjectValue(planetState) === oldPlanet, "planet binding never retargets");
      }
      if (countryRemoved && planetRemoved) break;
    }
    check(countryRemoved && planetRemoved, "engine removal within explicit ten-day window");
    check(
      (await invoke(player, "replaceCountry")).kind === "completed",
      "country replacement created"
    );
    check(
      (await invoke(colony, "replacePlanet")).kind === "completed",
      "planet replacement created"
    );
    const newCountry = await acquire(locators.country);
    const newPlanet = await acquire(locators.planet);
    check(
      subjectValue(await validate(newCountry)) !== oldCountry,
      "replacement country has a new lifetime identity"
    );
    check(
      subjectValue(await validate(newPlanet)) !== oldPlanet,
      "replacement planet has a new lifetime identity"
    );
    checkRejected(await validate(country), "invalid-binding");
    checkRejected(await validate(planet), "invalid-binding");
    checkCondition(await invoke(newPlanet, "uncolonized"), true);
    result.behavior = "passed";
    result.execution = "complete";
    result.controls.push("scenario-complete");
  } catch (error) {
    const message = String(error);
    result.failures.push(message);
    if (error instanceof Error && error.name === "AssertionError") {
      result.behavior = "failed";
      result.execution = "complete";
    }
    journal(context.directory, { kind: "failure", message, behavior: result.behavior });
  } finally {
    try {
      await stopWorker(worker);
    } catch (error) {
      result.failures.push(String(error));
      result.execution = "incomplete";
    }
    const cleanupWorker = startWorker(context.directory, "cleanup");
    try {
      result.cleanup = await call<Cleanup>(
        cleanupWorker,
        context.directory,
        { operation: "cleanup", modulePath, context },
        deadlines.cleanup
      );
      check(result.cleanup.processExit === "confirmed", "owned process exit confirmed");
      check(
        result.cleanup.profile === "removed" || result.cleanup.profile === "retained",
        "profile disposition known"
      );
      check(result.cleanup.evidenceRetained === true, "evidence retained before profile disposal");
      checkRaw(context.directory, result.cleanup.raw);
    } catch (error) {
      result.failures.push(`cleanup: ${String(error)}`);
      result.execution = "incomplete";
    } finally {
      try {
        await stopWorker(cleanupWorker);
      } catch (error) {
        result.failures.push(String(error));
        result.execution = "incomplete";
      }
    }
    journal(context.directory, { kind: "case-complete", assertionCount, result });
    writeFileSync(join(context.directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}

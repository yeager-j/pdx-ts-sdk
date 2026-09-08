import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type {
  Adapter,
  Binding,
  Cleanup,
  Command,
  Context,
  Control,
  Evidence,
  Invocation,
  Outcome,
  Scope,
  Snapshot,
} from "./contract.ts";

type ObjectState = {
  scope: Scope;
  slot: string;
  generation: number;
  live: boolean;
  pending: boolean;
  colony: boolean;
};
const fixtureHash = createHash("sha256").update("sdk446 synthetic fixture v1").digest("hex");

/** Deterministic mechanics model; it cannot establish any game behavior. */
export function create(context: Context): Adapter {
  const configuration = context.configuration as { fault?: string };
  const world = randomUUID();
  let day = 0;
  let marked = false;
  const objects: Record<string, ObjectState> = {
    player: {
      scope: "country",
      slot: "7",
      generation: 0,
      live: true,
      pending: false,
      colony: false,
    },
    sdk446_colony: {
      scope: "planet",
      slot: "3",
      generation: 0,
      live: true,
      pending: false,
      colony: true,
    },
    sdk446_planet: {
      scope: "planet",
      slot: "5",
      generation: 0,
      live: true,
      pending: false,
      colony: false,
    },
    sdk446_country: {
      scope: "country",
      slot: "19",
      generation: 0,
      live: true,
      pending: false,
      colony: false,
    },
  };
  const tokens = new Map<string, ObjectState>();
  const subject = (object: ObjectState) =>
    `${world}/${object.scope}/${object.slot}/${object.generation}`;
  const snapshot = (): Snapshot => ({
    world,
    day,
    paused: true,
    player: subject(objects.player!),
    ai: "off",
  });
  const raw = (record: unknown) =>
    appendFileSync(join(context.directory, "mock-native.jsonl"), JSON.stringify(record) + "\n");
  const issue = (object: ObjectState): Binding => {
    const token = randomUUID();
    tokens.set(token, object);
    return { token, world, scope: object.scope };
  };
  return {
    async launch() {
      mkdirSync(join(context.directory, "profile"));
      writeFileSync(
        join(context.directory, "ownership-intent.json"),
        JSON.stringify({ run: context.runId })
      );
      // A real disposable process makes worker-loss cleanup observable in this mock.
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
        const fs = require('node:fs'); const path = require('node:path');
        const directory = process.argv[1];
        fs.writeFileSync(path.join(directory, 'owned.json'), JSON.stringify({pid: process.pid}));
        setInterval(() => {
          if (fs.existsSync(path.join(directory, 'STOP'))) process.exit(0);
        }, 25);
      `,
          context.directory,
        ],
        { stdio: "ignore" }
      );
      child.unref();
      while (!existsSync(join(context.directory, "owned.json"))) await delay(10);
      if (configuration.fault === "partial-launch")
        throw new Error("injected-partial-launch-after-owned-process");
      raw({ kind: "ready", snapshot: snapshot(), evidenceMode: "mock" });
      return {
        ready: snapshot(),
        raw: ["mock-native.jsonl"],
        metadata: {
          mode: "mock",
          adapterRevision: "sdk446-mock/v1",
          environment: {
            os: "synthetic",
            cpu: "synthetic",
            game: "no-game",
            executableSha256: fixtureHash,
            bridgeSha256: fixtureHash,
          },
          fixture: {
            semanticRevision: "sdk446-fixture/v1",
            saveSha256: fixtureHash,
            sourceBuild: "synthetic",
            dependencies: [],
          },
        },
      };
    },
    async perform(command: Command, invocation: Invocation): Promise<Outcome> {
      if (configuration.fault === "hang") await new Promise(() => {});
      if (configuration.fault === "block")
        while (true) {
          /* Intentional unresponsive worker control. */
        }
      const before = snapshot();
      const evidence: Evidence = {
        invocation,
        before,
        after: before,
        raw: ["mock-native.jsonl"],
        nativeCompleted: true,
      };
      const finish = (outcome: Outcome): Outcome => {
        if (outcome.kind !== "incomplete") {
          let after = snapshot();
          if (configuration.fault === "validation-ticks") {
            day++;
            after = snapshot();
          }
          outcome = { ...outcome, evidence: { ...outcome.evidence, after } };
          if (configuration.fault === "stale-invocation")
            outcome = {
              ...outcome,
              evidence: { ...outcome.evidence, invocation: { ...invocation, world: "old-world" } },
            };
        }
        raw({ command, outcome });
        return outcome;
      };
      const completed = (
        value: Extract<Outcome, { kind: "completed" }>["value"],
        proof = evidence
      ) => finish({ kind: "completed", value, evidence: proof });
      const rejected = (reason: Extract<Outcome, { kind: "rejected" }>["reason"]) =>
        finish({ kind: "rejected", reason, mutation: "none", evidence });
      if (command.kind === "snapshot") return completed(snapshot());
      if (command.kind === "advance") {
        day += command.days;
        for (const object of Object.values(objects)) if (object.pending) object.live = false;
        return completed(snapshot());
      }
      if (command.kind === "resolve") {
        const locator = command.locator;
        if (locator.kind === "unique")
          return rejected(locator.condition === "missing" ? "missing-object" : "ambiguous-object");
        const object = objects[locator.kind === "player" ? "player" : locator.name];
        if (!object || !object.live) return rejected("missing-object");
        if (object.scope !== locator.scope) return rejected("wrong-object-kind");
        return completed(issue(object));
      }
      const binding = command.binding;
      if (binding.world !== world)
        return finish({
          kind: "contract-error",
          reason: "foreign-binding",
          mutation: "none",
          evidence,
        });
      const object = tokens.get(binding.token);
      if (!object || object.scope !== binding.scope || !object.live)
        return rejected("invalid-binding");
      if (command.kind === "validate") return completed({ subject: subject(object) });
      const script = context.scripts[command.script]!;
      if (script.scope !== object.scope) return rejected("wrong-object-kind");
      let value: boolean | { subject: string } = { subject: subject(object) };
      switch (command.script) {
        case "mark":
          marked = true;
          break;
        case "marked":
          value = marked;
          break;
        case "human":
          value = object === objects.player;
          break;
        case "colony":
          value = object.colony;
          break;
        case "uncolonized":
          value = !object.colony;
          break;
        case "removeCountry":
        case "removePlanet":
          object.pending = true;
          break;
        case "replaceCountry":
        case "replacePlanet": {
          const name = command.script === "replaceCountry" ? "sdk446_country" : "sdk446_planet";
          const old = objects[name]!;
          const replacement = {
            ...old,
            generation: old.generation + 1,
            live: true,
            pending: false,
          };
          objects[name] = replacement;
          if (configuration.fault === "revive-binding") Object.assign(old, replacement);
          break;
        }
        default:
          throw new Error("unknown fixed script");
      }
      let markers =
        typeof value === "boolean" ? ["start", `result:${value}`, "end"] : ["start", "end"];
      if (configuration.fault === "missing-end") markers = markers.slice(0, -1);
      return completed(value, {
        ...evidence,
        script: {
          id: command.script,
          sha256: context.scriptHashes[command.script]!,
          markers,
          correlatedAtNativeBoundary: true,
        },
      });
    },
  };
}

/** Stop the actual mock child through its private mailbox; never kill an unverified PID. */
export async function disposeOwned(context: Context, control: Control): Promise<Cleanup> {
  writeFileSync(join(context.directory, "STOP"), "stop\n");
  if ((context.configuration as { fault?: string }).fault === "cleanup-fails")
    throw new Error("injected-cleanup-failure");
  const ownershipPath = join(context.directory, "owned.json");
  while (!existsSync(ownershipPath) && Date.now() < control.deadlineEpochMs) await delay(10);
  const owned = existsSync(ownershipPath)
    ? (JSON.parse(readFileSync(ownershipPath, "utf8")) as { pid: number })
    : undefined;
  let exited = false;
  while (owned && Date.now() < control.deadlineEpochMs) {
    try {
      process.kill(owned.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") exited = true;
    }
    if (exited) break;
    await delay(25);
  }
  if (exited) rmSync(join(context.directory, "profile"), { recursive: true, force: true });
  const cleanup: Cleanup = {
    processExit: exited ? "confirmed" : "unconfirmed",
    profile: exited ? "removed" : "retained",
    evidenceRetained: true,
    raw: ["cleanup.json"],
  };
  writeFileSync(
    join(context.directory, "cleanup.json"),
    JSON.stringify({ evidenceMode: "mock", owned, ...cleanup }, null, 2)
  );
  return cleanup;
}

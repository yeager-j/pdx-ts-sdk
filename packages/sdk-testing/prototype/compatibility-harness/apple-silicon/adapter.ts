import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type {
  Adapter,
  Binding,
  Command,
  Context,
  Control,
  Evidence,
  Invocation,
  Outcome,
  Snapshot,
} from "../contract.ts";
import { until, writeJson } from "./io.ts";
import { launch, type Configuration } from "./lifecycle.ts";

export { disposeOwned } from "./lifecycle.ts";

type NativeBinding = {
  token: string;
  world: string;
  kind: Binding["scope"];
  id: number;
  subject: string;
  suite: string;
  phaseAcquired: string;
};
type NativeState = {
  date: string;
  dateRaw: number;
  paused: boolean;
  globalAIEnabled: boolean;
  playerSubject: string;
  localCountryId: number;
  gameStateReady: boolean;
  inGameIdlerAvailable: boolean;
  advanceInProgress: boolean;
};
type NativeIdentity = {
  invocation: Invocation;
  invocationId: string;
  run: string;
  world: string;
  suite: string;
  phase: string;
  scriptId: string;
  scriptDigest: string;
};
type NativeReply = {
  id: string;
  run: string;
  worldIdentity: string;
  invocation: Invocation;
  pid: number;
  status: string;
  normalInputBoundary: boolean;
  mainThread: boolean;
  supported: boolean;
  stateBefore: NativeState;
  stateAfterAcceptance: NativeState;
  locator?: { status: string; binding: NativeBinding; targets?: unknown; deaths?: unknown };
  prepared?: {
    nativeAccepted: boolean;
    nativeReturned: boolean;
    identity: NativeIdentity;
    markers: (NativeIdentity & { token: string; sequence: number })[];
    conditionValue: boolean | null;
  };
};

function snapshot(world: string, state: NativeState): Snapshot {
  return {
    world,
    day: state.dateRaw / 24,
    paused: state.paused,
    player: state.playerSubject,
    ai: state.globalAIEnabled === false ? "off" : "on",
  };
}

function rejection(
  status: string
): "missing-object" | "wrong-object-kind" | "ambiguous-object" | "invalid-binding" | undefined {
  if (["zero-matches", "missing-target", "dead-target"].includes(status)) return "missing-object";
  if (status === "wrong-kind") return "wrong-object-kind";
  if (status === "multiple-matches") return "ambiguous-object";
  if (
    [
      "unknown-binding",
      "altered-binding",
      "destroyed-binding",
      "dead-binding",
      "replaced-binding",
    ].includes(status)
  )
    return "invalid-binding";
  return undefined;
}

/** Adapt the unchanged common commands to the pinned native mailbox and parsed scripts. */
export function create(context: Context): Adapter {
  let pid = 0;
  let world = "";
  let state: NativeState;
  const bindings = new Map<string, { wire: Binding; native: NativeBinding }>();
  const configuration = context.configuration as Configuration;

  async function raw(
    action: string,
    invocation: Invocation,
    control: Control,
    fields: Record<string, unknown> = {}
  ): Promise<NativeReply> {
    const request = {
      action,
      id: invocation.id,
      run: context.runId,
      worldIdentity: world,
      expectedPid: pid,
      suite: context.runId,
      phase: invocation.phase,
      invocation,
      expectedDate: state?.date,
      ...fields,
    };
    writeJson(join(context.directory, `request-${invocation.id}.json`), request);
    writeJson(join(context.directory, "request.json"), request);
    const response = await until(() => {
      const path = join(context.directory, `response-${invocation.id}.json`);
      return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as NativeReply) : undefined;
    }, control);
    if (
      response.id !== invocation.id ||
      response.run !== context.runId ||
      response.pid !== pid ||
      response.worldIdentity !== world ||
      !isDeepStrictEqual(response.invocation, invocation)
    )
      throw new Error("native-response-identity-mismatch");
    if (response.stateAfterAcceptance) state = response.stateAfterAcceptance;
    return response;
  }

  const internal = (phase: string): Invocation => ({
    run: context.runId,
    world,
    phase,
    id: randomUUID(),
  });

  async function saveWitness(label: string, control: Control): Promise<void> {
    const invocation = internal("independent-witness");
    const reply = await raw("save", invocation, control, { name: label });
    if (reply.status !== "save-accepted") throw new Error(`witness-save-failed: ${reply.status}`);
    await until(
      () =>
        existsSync(join(context.directory, `profile/save games/sdk447_fixture/${label}.sav`))
          ? true
          : undefined,
      control
    );
    const observed = await raw("locator-inspect", internal("independent-witness"), control);
    writeJson(join(context.directory, `${label}-native-witness.json`), observed);
  }

  function nativeBinding(binding: Binding): NativeBinding | Record<string, unknown> {
    const issued = bindings.get(binding.token);
    if (issued && isDeepStrictEqual(issued.wire, binding)) return issued.native;
    // Send misuse to native admission too; this cannot dispatch a requested effect.
    return {
      token: binding.token,
      world: binding.world,
      kind: binding.scope,
      suite: context.runId,
      alteredWire: binding,
    };
  }

  function commandRequest(command: Command): { action: string; fields: Record<string, unknown> } {
    switch (command.kind) {
      case "snapshot":
        return { action: "inspect", fields: {} };
      case "advance":
        return { action: "fast-forward", fields: { days: command.days } };
      case "validate":
        return { action: "validate-binding", fields: { binding: nativeBinding(command.binding) } };
      case "invoke":
        return {
          action: "invoke-prepared",
          fields: {
            binding: nativeBinding(command.binding),
            scriptId: context.scripts[command.script]?.definitionId,
          },
        };
      case "resolve": {
        const locator = command.locator;
        const fields: Record<string, unknown> = {
          kind: locator.scope,
          locator: locator.kind === "unique" ? "native-unique" : locator.kind,
        };
        if (locator.kind === "target") fields.target = locator.name;
        if (locator.kind === "unique")
          fields.condition = context.scripts[locator.condition]?.definitionId;
        return { action: "bind", fields };
      }
    }
  }

  function normalize(reply: NativeReply, command: Command, invocation: Invocation): Outcome {
    const rawPaths = [`request-${invocation.id}.json`, `response-${invocation.id}.json`];
    if (!reply.supported || !reply.mainThread || !reply.normalInputBoundary)
      return { kind: "incomplete", causes: [reply.status], raw: rawPaths };
    const evidence: Evidence = {
      invocation: reply.invocation,
      before: snapshot(world, reply.stateBefore),
      after: snapshot(world, reply.stateAfterAcceptance),
      raw: rawPaths,
      nativeCompleted: true,
    };
    if (reply.status === "foreign-world-or-suite")
      return { kind: "contract-error", reason: "foreign-binding", mutation: "none", evidence };
    const reason = rejection(reply.status);
    if (reason) return { kind: "rejected", reason, mutation: "none", evidence };
    if (command.kind === "resolve" && reply.status === "bound") {
      const native = reply.locator!.binding;
      const wire: Binding = { token: native.token, world: native.world, scope: native.kind };
      bindings.set(wire.token, { wire, native });
      return { kind: "completed", value: wire, evidence };
    }
    if (command.kind === "validate" && reply.status === "live-binding")
      return { kind: "completed", value: { subject: reply.locator!.binding.subject }, evidence };
    if (
      (command.kind === "snapshot" && reply.status === "inspected") ||
      (command.kind === "advance" && reply.status === "fast-forward-completed")
    )
      return { kind: "completed", value: evidence.after, evidence };
    if (command.kind !== "invoke" || reply.status !== "script-completed" || !reply.prepared)
      return { kind: "incomplete", causes: [reply.status], raw: rawPaths };
    const prepared = reply.prepared;
    const script = context.scripts[command.script]!;
    const identity: NativeIdentity = {
      invocation,
      invocationId: invocation.id,
      run: context.runId,
      world,
      suite: context.runId,
      phase: invocation.phase,
      scriptId: script.definitionId,
      scriptDigest: context.scriptHashes[command.script]!,
    };
    if (
      !prepared.nativeAccepted ||
      !prepared.nativeReturned ||
      !isDeepStrictEqual(prepared.identity, identity)
    )
      return { kind: "incomplete", causes: ["native-script-correlation-failed"], raw: rawPaths };
    const markers = prepared.markers.map((marker, index) => {
      for (const [key, value] of Object.entries(identity))
        if (!isDeepStrictEqual(marker[key as keyof NativeIdentity], value))
          throw new Error("native-marker-identity-mismatch");
      if (marker.sequence !== index) throw new Error("native-marker-order-mismatch");
      return script.kind === "condition"
        ? marker.token
        : marker.token.replace(`SDK446:${script.definitionId}:`, "");
    });
    return {
      kind: "completed",
      value:
        script.kind === "condition"
          ? prepared.conditionValue!
          : { subject: prepared.identity.world },
      evidence: {
        ...evidence,
        raw: [...rawPaths, `accepted-${invocation.id}.json`],
        script: {
          id: command.script,
          sha256: prepared.identity.scriptDigest,
          markers,
          correlatedAtNativeBoundary: true,
        },
      },
    };
  }

  return {
    async launch(control) {
      const launched = await launch(context, control);
      pid = launched.pid;
      world = `${context.runId}:${pid}`;
      const load = await until(
        () =>
          existsSync(join(context.directory, "bridge-load.json"))
            ? (JSON.parse(readFileSync(join(context.directory, "bridge-load.json"), "utf8")) as {
                supported: boolean;
              })
            : undefined,
        control
      );
      if (!load.supported) throw new Error("native-bridge-unsupported");
      await until(() => {
        const log = join(context.directory, "profile/logs/game.log");
        return existsSync(log) && readFileSync(log, "utf8").includes("SDK447:fixture:loaded")
          ? true
          : undefined;
      }, control);
      let ready = false;
      while (!ready) {
        const reply = await raw("inspect", internal("readiness"), control);
        ready =
          reply.status === "inspected" &&
          state?.gameStateReady &&
          state.inGameIdlerAvailable &&
          state.paused &&
          !state.advanceInProgress;
      }
      const ai = await raw("set-ai", internal("readiness"), control, { desiredAIEnabled: false });
      if (
        !["ai-already-established", "ai-established"].includes(ai.status) ||
        state.globalAIEnabled !== false
      )
        throw new Error(`native-ai-not-off: ${ai.status}`);
      await saveWitness("ready", control);
      const log = readFileSync(join(context.directory, "profile/logs/game.log"), "utf8");
      for (const marker of ["human:", "colony:", "uncolonized:", "disposable-country"])
        if (!log.includes(`SDK447:fixture:${marker}`))
          throw new Error(`fixture-witness-missing: ${marker}`);
      if (log.includes("SDK447:fixture:unexpected-effect"))
        throw new Error("fixture-effect-flag-present");
      return {
        metadata: launched.metadata,
        ready: snapshot(world, state),
        raw: [
          "metadata.json",
          "private-inputs.json",
          "bridge-load.json",
          "ready-native-witness.json",
          "profile/logs/game.log",
        ],
      };
    },
    async perform(command, invocation, control) {
      try {
        if (configuration.fault === "hang") await until(() => undefined, control);
        const request = commandRequest(command);
        const reply = await raw(request.action, invocation, control, request.fields);
        const outcome = normalize(reply, command, invocation);
        if (
          outcome.kind === "completed" &&
          (command.kind === "advance" ||
            (command.kind === "invoke" && context.scripts[command.script]?.kind === "effect"))
        )
          await saveWitness(`w_${invocation.id.replaceAll("-", "")}`, control);
        return outcome;
      } catch (error) {
        writeJson(join(context.directory, `failure-${invocation.id}.json`), {
          command,
          invocation,
          error: String(error),
        });
        return {
          kind: "incomplete",
          causes: [String(error)],
          raw: [`failure-${invocation.id}.json`],
        };
      }
    },
  };
}

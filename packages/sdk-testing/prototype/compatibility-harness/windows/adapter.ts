import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { cpus, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import type {
  Adapter,
  Cleanup,
  Context,
  Control,
  Metadata,
  Outcome,
  Snapshot,
} from "../contract.ts";

const root = dirname(fileURLToPath(import.meta.url));
const executableSha256 = "bd86b8c8187bd23b793b6680cc979945e696f97c0a6aa89b5ca4199a5739535f";
type Configuration = {
  game: string;
  python: string;
  ordinaryProfile: string;
  aliasRoot: string;
  save: string;
  saveSha256: string;
  settings: string;
  bridge: string;
  bridgeSha256: string;
  fault?: "partial-launch" | "missing-end" | "stale-invocation" | "hang";
};
function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function hash(path: string): string {
  return digest(readFileSync(path));
}
function json(path: string, value: unknown): void {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}
function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
function manifest(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readdirSync(path, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
      .map((file) => [file.slice(path.length + 1).replaceAll("\\", "/"), hash(file)])
  );
}
function protectedInputs(config: Configuration): unknown {
  return {
    ordinary: manifest(config.ordinaryProfile),
    sourceSave: hash(config.save),
    executable: hash(config.game),
  };
}
async function until<T>(inspect: () => T | undefined, control: Control): Promise<T> {
  while (!control.signal.aborted && Date.now() < control.deadlineEpochMs) {
    const value = inspect();
    if (value !== undefined) return value;
    await setTimeout(100);
  }
  throw new Error("native-host-deadline-or-cancellation");
}
type ProcessRow = { ProcessId: number; ExecutablePath: string; CommandLine: string };
function processes(): ProcessRow[] {
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'stellaris.exe' -or $_.Name -eq 'python.exe' } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true }
  );
  const parsed = output.trim() ? (JSON.parse(output) as ProcessRow | ProcessRow[]) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}
function settings(source: string): string {
  return source
    .replace(/(size=\s*\{\s*x=)\d+(\s*y=)\d+/, (_, x: string, y: string) => `${x}1280${y}720`)
    .replace(/fullScreen=\w+/, "fullScreen=no")
    .replace(/borderless=\w+/, "borderless=no")
    .replace(/refreshRate=\d+/, "refreshRate=60")
    .replace(/refreshCap=\d+/, "refreshCap=30")
    .replace(/master_volume=[\d.]+/, "master_volume=0")
    .replace(/vsync=\w+/, "vsync=no");
}
type Reply = {
  error?: string;
  reply: {
    snapshot: Snapshot;
    targets?: unknown;
    deaths?: unknown;
    outcome: Outcome;
    saveRequestCode?: number;
    savePending?: boolean;
  };
};

/** Run the frozen compatibility scenario through the exact Windows native bridge.
 * Configure immutable inputs with configure.ts before passing this module to the common CLI.
 */
export function create(context: Context): Adapter {
  const config = context.configuration as Configuration;
  const native = join(context.directory, "native");
  let pid = 0;
  let world = "";
  async function call(
    action: string,
    fields: Record<string, unknown>,
    control: Control,
    id: string = randomUUID()
  ): Promise<Reply["reply"]> {
    const request = { id, action, run: context.runId, world, pid, ...fields };
    json(join(native, "request.json"), request);
    const response = await until(() => {
      const failure = join(native, "bridge-failure.json");
      if (existsSync(failure)) throw new Error(readFileSync(failure, "utf8"));
      const path = join(native, `response-${id}.json`);
      return existsSync(path) ? read<Reply>(path) : undefined;
    }, control);
    if (response.error) throw new Error(response.error);
    return response.reply;
  }
  async function witness(name: string, control: Control): Promise<void> {
    const response = await call("save", { name }, control);
    if (response.saveRequestCode !== 0)
      throw new Error(`save-request-not-accepted: ${response.saveRequestCode}`);
    while ((await call("inspect", {}, control)).savePending) await setTimeout(100);
    await until(() => {
      const saves = manifest(join(context.directory, "profile/save games"));
      const match = Object.entries(saves).find(([path]) => path.endsWith(`/${name}.sav`));
      if (!match) return undefined;
      const bytes = readFileSync(join(context.directory, "profile/save games", match[0]));
      const directoryEnd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (directoryEnd < 0 || directoryEnd < bytes.length - 65557) return undefined;
      json(join(context.directory, `${name}-save.json`), {
        path: match[0],
        sha256: match[1],
        snapshot: response.snapshot,
      });
      return true;
    }, control);
    json(join(context.directory, `${name}-native.json`), await call("inspect", {}, control));
  }
  return {
    async launch(control) {
      if (process.platform !== "win32" || process.arch !== "x64")
        throw new Error("unsupported-platform");
      for (const [path, expected] of [
        [config.game, executableSha256],
        [config.save, config.saveSha256],
        [config.bridge, config.bridgeSha256],
      ]) {
        if (!path || hash(path) !== expected) throw new Error(`input-pin-mismatch: ${path}`);
      }
      if (
        processes().some(
          (entry) => entry.ExecutablePath?.toLowerCase() === config.game.toLowerCase()
        )
      )
        throw new Error("existing-game-refused");
      mkdirSync(native, { recursive: true });
      const source = Object.fromEntries(
        ["adapter.ts", "host.py", "native/bridge.cpp", "native/pins.hpp", "fixture.txt"].map(
          (name) => {
            const destination = join(context.directory, "source", name);
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(join(root, name), destination);
            return [name, hash(destination)];
          }
        )
      );
      const sourceHash = digest(JSON.stringify(source));
      json(join(context.directory, "adapter-source.json"), source);
      json(join(context.directory, "protected-before.json"), protectedInputs(config));
      const profile = join(context.directory, "profile");
      const saveDirectory = join(profile, "save games/sdk448");
      mkdirSync(saveDirectory, { recursive: true });
      copyFileSync(config.save, join(saveDirectory, "baseline.sav"));
      writeFileSync(join(profile, "settings.txt"), settings(readFileSync(config.settings, "utf8")));
      writeFileSync(join(profile, "pdx_settings.txt"), "");
      json(join(profile, "continue_game.json"), {
        title: "save games/sdk448/baseline",
        desc: "Windows compatibility spike",
        date: "2200.01.01",
      });
      const mod = join(profile, "mod/sdk448");
      mkdirSync(join(mod, "events"), { recursive: true });
      mkdirSync(join(mod, "common/on_actions"), { recursive: true });
      writeFileSync(
        join(mod, "events/shared.txt"),
        "namespace = sdk446\n" +
          Object.values(context.scripts)
            .map((script) => script.definition)
            .join("\n")
      );
      copyFileSync(join(root, "fixture.txt"), join(mod, "events/fixture.txt"));
      writeFileSync(
        join(mod, "common/on_actions/load.txt"),
        "on_single_player_save_game_load = { events = { sdk447_fixture.1 } }\n"
      );
      writeFileSync(
        join(profile, "mod/sdk448.mod"),
        `name="SDK448 Windows spike"\npath="${mod.replaceAll("\\", "/")}"\nsupported_version="4.5.*"\n`
      );
      const dlcRoot = join(dirname(config.game), "dlc");
      const disabled = readdirSync(dlcRoot, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".dlc"))
        .map(
          (entry) =>
            `dlc/${join(entry.parentPath, entry.name)
              .slice(dlcRoot.length + 1)
              .replaceAll("\\", "/")}`
        )
        .sort();
      json(join(profile, "dlc_load.json"), {
        enabled_mods: ["mod/sdk448.mod"],
        disabled_dlcs: disabled,
      });
      const dependencies = {
        mod: manifest(mod),
        settings: hash(join(profile, "settings.txt")),
        selection: read(join(profile, "dlc_load.json")),
        dlcDefinitions: Object.fromEntries(
          disabled.map((name) => [name, hash(join(dirname(config.game), name))])
        ),
      };
      json(join(context.directory, "dependencies.json"), dependencies);
      copyFileSync(config.bridge, join(native, "bridge.dll"));
      const profileAlias = join(config.aliasRoot, context.runId.replaceAll("-", ""));
      const hostInput = {
        ...config,
        profileAlias,
        runId: context.runId,
        scripts: context.scripts,
        scriptHashes: context.scriptHashes,
      };
      json(join(context.directory, "host-input.json"), hostInput);
      json(join(context.directory, "private-inputs.json"), manifest(profile));
      const log = openSync(join(context.directory, "host.log"), "a");
      const host = spawn(config.python, [join(root, "host.py"), context.directory], {
        windowsHide: true,
        detached: true,
        stdio: ["ignore", log, log],
      });
      closeSync(log);
      host.unref();
      json(join(context.directory, "owner.json"), {
        pid: host.pid,
        command: [config.python, join(root, "host.py"), context.directory],
      });
      await until(
        () => (existsSync(join(context.directory, "process.json")) ? true : undefined),
        control
      );
      pid = read<{ pid: number }>(join(context.directory, "process.json")).pid;
      world = `${context.runId}:${pid}`;
      if (config.fault === "partial-launch") throw new Error("injected-partial-launch");
      await until(() => {
        if (existsSync(join(context.directory, "host-failure.json")))
          throw new Error(readFileSync(join(context.directory, "host-failure.json"), "utf8"));
        const path = join(native, "ready.json");
        return existsSync(path) ? true : undefined;
      }, control);
      const ready = (await call("ai-off", {}, control)).snapshot;
      await witness("ready", control);
      const metadata: Metadata = {
        mode: "native",
        adapterRevision: sourceHash,
        environment: {
          os: `Windows ${release()}`,
          cpu: `${cpus()[0]?.model} / x64`,
          game: "Cygnus 4.5.0 (9e73), Steam build 25085736",
          executableSha256,
          bridgeSha256: config.bridgeSha256,
        },
        fixture: {
          semanticRevision: "sdk446-fixture/v1",
          saveSha256: config.saveSha256,
          sourceBuild: executableSha256,
          dependencies: [
            {
              name: "ordered-mod-settings-and-disabled-dlc-definitions",
              sha256: digest(JSON.stringify(dependencies)),
            },
          ],
        },
      };
      json(join(context.directory, "metadata.json"), metadata);
      return {
        metadata,
        ready,
        raw: ["metadata.json", "ready-native.json", "ready-save.json", "injection.json"],
      };
    },
    async perform(command, invocation, control) {
      const response = await call("perform", { command, invocation }, control, invocation.id);
      if (
        command.kind === "invoke" &&
        ["replacePlanet", "replaceCountry", "removePlanet", "removeCountry"].includes(
          command.script
        )
      )
        await witness(`after${command.script}`, control);
      return response.outcome;
    },
  };
}

/** Dispose through the separate process owner, retaining all profile and native evidence.
 * This is callable from a new worker after the execution worker is lost or stalled.
 */
export async function disposeOwned(context: Context, control: Control): Promise<Cleanup> {
  const config = context.configuration as Configuration;
  writeFileSync(join(context.directory, "stop-owner"), "dispose\n");
  if (existsSync(join(context.directory, "owner.json"))) {
    await until(
      () => (existsSync(join(context.directory, "host-finished.json")) ? true : undefined),
      control
    );
  }
  const recordPath = join(context.directory, "process.json");
  const record = existsSync(recordPath) ? read<{ pid: number }>(recordPath) : undefined;
  const remaining = processes().filter(
    (entry) =>
      entry.ProcessId === record?.pid &&
      entry.CommandLine?.includes(context.runId.replaceAll("-", ""))
  );
  const after = protectedInputs(config);
  json(join(context.directory, "protected-after.json"), after);
  const beforePath = join(context.directory, "protected-before.json");
  const unchanged = existsSync(beforePath) && isDeepStrictEqual(read(beforePath), after);
  const disposal = {
    remaining,
    ordinaryAndSourceUnchanged: unchanged,
    host: existsSync(join(context.directory, "host-disposal.json"))
      ? read(join(context.directory, "host-disposal.json"))
      : null,
    profile: "retained",
  };
  json(join(context.directory, "disposal.json"), disposal);
  if (!unchanged) throw new Error("protected-input-integrity-failed");
  return {
    processExit: remaining.length ? "unconfirmed" : "confirmed",
    profile: "retained",
    evidenceRetained: true,
    raw: ["disposal.json", "protected-before.json", "protected-after.json"],
  };
}

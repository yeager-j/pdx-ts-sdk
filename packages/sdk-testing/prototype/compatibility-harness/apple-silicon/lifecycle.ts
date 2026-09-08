import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import type { Cleanup, Context, Control, Metadata } from "../contract.ts";
import { launchTool, manifest, processes, sha256, until, writeJson } from "./io.ts";

/** Exact local inputs, created once by configure.ts and retained with every run. */
export type Configuration = {
  game: string;
  ordinaryProfile: string;
  save: string;
  saveSha256: string;
  settings: string;
  bridgeSha256: string;
  guardSha256: string;
  observerSha256: string;
  fault?: "partial-launch" | "missing-end" | "stale-invocation" | "hang";
};
/** Only this adapter supports this exact native image. */
export const executableSha256 = "408a5700a202837f16041bf14b5da34ff4a9d939b98e62a8240dc68dd602ddf7";
/** Tracked adapter source root. */
export const adapterRoot = dirname(fileURLToPath(import.meta.url));

function protectedInputs(configuration: Configuration): unknown {
  const ordinary = configuration.ordinaryProfile;
  return {
    executable: sha256(configuration.game),
    save: sha256(configuration.save),
    files: Object.fromEntries(
      [
        "settings.txt",
        "pdx_settings.txt",
        "message_settings.txt",
        "alert_settings.txt",
        "continue_game.json",
        "dlc_load.json",
      ].map((name) => [name, manifest(join(ordinary, name))])
    ),
    logs: manifest(join(ordinary, "logs")),
    saves: manifest(join(ordinary, "save games")),
  };
}

function settingsText(source: string): string {
  const text = source
    .replace(/(size=\s*\{\s*x=)\d+(\s*y=)\d+/, (_, x: string, y: string) => `${x}1280${y}900`)
    .replace(/refreshRate=\d+/, "refreshRate=60")
    .replace(/refreshCap=\d+/, "refreshCap=30")
    .replace(/fullScreen=(yes|no)/, "fullScreen=no")
    .replace(/borderless=(yes|no)/, "borderless=no");
  for (const value of [
    "x=1280",
    "y=900",
    "refreshRate=60",
    "refreshCap=30",
    "fullScreen=no",
    "borderless=no",
  ])
    if (!text.includes(value)) throw new Error(`background-setting-missing: ${value}`);
  return text;
}

/** Pin the install, journal ownership, capture private inputs and launch hidden. */
export async function launch(
  context: Context,
  control: Control
): Promise<{ pid: number; metadata: Metadata }> {
  const configuration = context.configuration as Configuration;
  const native = join(adapterRoot, "native");
  const bridge = join(native, "target/release/libstellaris_lifecycle_probe.dylib");
  const guard = join(native, "visibility-bridge.dylib");
  const observer = join(native, "process-observer");
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("unsupported-platform");
  for (const [path, hash] of [
    [configuration.game, executableSha256],
    [configuration.save, configuration.saveSha256],
    [bridge, configuration.bridgeSha256],
    [guard, configuration.guardSha256],
    [observer, configuration.observerSha256],
  ])
    if (!path || sha256(path) !== hash) throw new Error(`input-hash-mismatch: ${path}`);
  if (processes().some((p) => p.command.startsWith(configuration.game)))
    throw new Error("existing-game-refused");
  const profile = join(context.directory, "profile");
  const app = resolve(configuration.game, "../../..");
  const gameRoot = dirname(app);
  writeJson(join(context.directory, "ownership.json"), {
    run: context.runId,
    profile,
    game: configuration.game,
    directory: context.directory,
    intent: "launch",
    profileDisposition: "retain for raw diagnostics and independent saves",
  });
  writeJson(join(context.directory, "protected-before.json"), protectedInputs(configuration));
  mkdirSync(join(profile, "save games/sdk447_fixture"), { recursive: true });
  copyFileSync(configuration.save, join(profile, "save games/sdk447_fixture/baseline.sav"));
  writeFileSync(
    join(profile, "settings.txt"),
    settingsText(readFileSync(configuration.settings, "utf8"))
  );
  writeFileSync(join(profile, "pdx_settings.txt"), "");
  writeJson(join(profile, "continue_game.json"), {
    title: "save games/sdk447_fixture/baseline",
    desc: "Compatibility spike",
    date: "2200.01.01",
  });
  const mod = join(profile, "mod/sdk447");
  mkdirSync(join(mod, "events"), { recursive: true });
  mkdirSync(join(mod, "common/on_actions"), { recursive: true });
  const events =
    "namespace = sdk446\n" +
    Object.values(context.scripts)
      .map((script) => script.definition)
      .join("\n");
  writeFileSync(join(mod, "events/shared.txt"), events);
  copyFileSync(join(adapterRoot, "fixture.txt"), join(mod, "events/fixture.txt"));
  writeFileSync(
    join(mod, "common/on_actions/fixture.txt"),
    "on_single_player_save_game_load = { events = { sdk447_fixture.1 } }\n"
  );
  writeFileSync(
    join(profile, "mod/sdk447.mod"),
    `name="SDK447 Compatibility Spike"\npath="${mod}"\nsupported_version="4.5.*"\n`
  );
  const dlcRoot = join(gameRoot, "dlc");
  const disabled = readdirSync(dlcRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((name) => {
      const directory = join(dlcRoot, name);
      return readdirSync(directory)
        .filter((file) => file.endsWith(".dlc"))
        .map((file) => `dlc/${name}/${file}`);
    });
  writeJson(join(profile, "dlc_load.json"), {
    enabled_mods: ["mod/sdk447.mod"],
    disabled_dlcs: disabled,
  });
  writeJson(join(context.directory, "catalogue.json"), {
    scripts: Object.entries(context.scripts).map(([name, script]) => ({
      id: script.definitionId,
      kind: script.scope,
      operation: script.kind,
      digest: context.scriptHashes[name],
      from: false,
    })),
  });
  const source = Object.fromEntries(
    Object.entries(manifest(adapterRoot)).filter(
      ([name]) =>
        !name.startsWith("inputs/") &&
        !name.startsWith("native/target/") &&
        /\.(ts|rs|toml|lock|m|swift|txt|py)$/.test(name)
    )
  );
  writeJson(join(context.directory, "adapter-source.json"), source);
  for (const name of Object.keys(source)) {
    const destination = join(context.directory, "source", name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(adapterRoot, name), destination);
  }
  copyFileSync(bridge, join(context.directory, "source/bridge.dylib"));
  const inputs = {
    mod: manifest(mod),
    selection: JSON.parse(readFileSync(join(profile, "dlc_load.json"), "utf8")),
    settings: sha256(join(profile, "settings.txt")),
    dlcDefinitions: Object.fromEntries(
      disabled.map((name) => [name, sha256(join(gameRoot, name))])
    ),
  };
  writeJson(join(context.directory, "private-inputs.json"), inputs);
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const metadata: Metadata = {
    mode: "native",
    adapterRevision: digest(source),
    environment: {
      os: execFileSync("/usr/bin/sw_vers", { encoding: "utf8" }).trim(),
      cpu:
        execFileSync("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"], {
          encoding: "utf8",
        }).trim() + " / arm64",
      game: "Stellaris Cygnus 4.5.0 beta",
      executableSha256,
      bridgeSha256: configuration.bridgeSha256,
    },
    fixture: {
      semanticRevision: "sdk446-fixture/v1",
      saveSha256: configuration.saveSha256,
      sourceBuild: executableSha256,
      dependencies: [
        { name: "ordered-private-inputs-and-disabled-dlc-definitions", sha256: digest(inputs) },
        { name: "visibility-guard", sha256: configuration.guardSha256 },
        { name: "observer", sha256: configuration.observerSha256 },
      ],
    },
  };
  writeJson(join(context.directory, "metadata.json"), metadata);
  const args = [
    "-n",
    "-g",
    "-j",
    "-W",
    "--env",
    `DYLD_INSERT_LIBRARIES=${guard}:${bridge}`,
    "--env",
    `SDK_BRIDGE_DIR=${context.directory}`,
    "--env",
    `SDK_BRIDGE_RUN=${context.runId}`,
    "--env",
    `SDK447_CATALOGUE=${join(context.directory, "catalogue.json")}`,
    "--env",
    `SDK447_FAULT=${configuration.fault ?? "none"}`,
    "--env",
    "SDL_MAC_BACKGROUND_APP=1",
    "--env",
    "SteamAppId=281990",
    "--stdout",
    join(context.directory, "process.log"),
    "--stderr",
    join(context.directory, "process.log"),
    "-a",
    app,
    "--args",
    "--continuelastsave",
    "-gdpr-compliant",
    `-userdir=${profile}/`,
  ];
  writeJson(join(context.directory, "launch-command.json"), { command: "/usr/bin/open", args });
  launchTool("/usr/bin/open", args, join(context.directory, "open.log"));
  const game = await until(
    () =>
      processes().find(
        (p) =>
          p.command.startsWith(configuration.game) && p.command.endsWith(`-userdir=${profile}/`)
      ),
    control
  );
  const privateObserver = join(context.directory, "process-observer");
  copyFileSync(observer, privateObserver);
  writeJson(join(context.directory, "observer-intent.json"), {
    command: privateObserver,
    args: [String(game.pid)],
  });
  launchTool(privateObserver, [String(game.pid)], join(context.directory, "focus.json"));
  writeJson(join(context.directory, "process-identified.json"), game);
  if (configuration.fault === "partial-launch")
    throw new Error("injected-partial-launch-after-game-creation");
  return { pid: game.pid, metadata };
}

/** Recover exclusively from durable intent and current command identities in a fresh worker. */
export async function disposeOwned(context: Context, control: Control): Promise<Cleanup> {
  const ownership = join(context.directory, "ownership.json");
  if (!existsSync(ownership)) {
    writeJson(join(context.directory, "disposal.json"), { noLaunchIntent: true });
    return {
      processExit: "confirmed",
      profile: "retained",
      evidenceRetained: true,
      raw: ["disposal.json"],
    };
  }
  const record = JSON.parse(readFileSync(ownership, "utf8")) as {
    profile: string;
    game: string;
    directory: string;
  };
  if (
    record.directory !== context.directory ||
    record.profile !== join(context.directory, "profile")
  )
    throw new Error("invalid-ownership-record");
  const matches = () =>
    processes().filter(
      (p) =>
        (p.command.startsWith(record.game) && p.command.endsWith(`-userdir=${record.profile}/`)) ||
        (p.command.startsWith("/usr/bin/open ") &&
          p.command.includes(`SDK_BRIDGE_DIR=${context.directory} `)) ||
        p.command.startsWith(join(context.directory, "process-observer") + " ")
    );
  const signals: unknown[] = [];
  // Stop launch intent first, then rescan for a game created during partial launch.
  for (const p of matches().filter((p) => p.command.startsWith("/usr/bin/open "))) {
    try {
      process.kill(p.pid, "SIGKILL");
      signals.push(p);
    } catch (error) {
      signals.push({ ...p, error: String(error) });
    }
  }
  await setTimeout(200);
  for (const p of matches().filter((p) => p.command.startsWith(record.game))) {
    try {
      process.kill(p.pid, "SIGKILL");
      signals.push(p);
    } catch (error) {
      signals.push({ ...p, error: String(error) });
    }
  }
  writeJson(join(context.directory, "cleanup-signals.json"), signals);
  await until(() => (matches().length === 0 ? true : undefined), control);
  await setTimeout(300);
  const remaining = matches();
  const beforePath = join(context.directory, "protected-before.json");
  const after = protectedInputs(context.configuration as Configuration);
  writeJson(join(context.directory, "protected-after.json"), after);
  const unchanged =
    existsSync(beforePath) &&
    isDeepStrictEqual(JSON.parse(readFileSync(beforePath, "utf8")), after);
  writeJson(join(context.directory, "disposal.json"), {
    signals,
    remaining,
    ordinaryAndSourceUnchanged: unchanged,
    profile: record.profile,
    reason:
      "Retained for unfiltered diagnostics and game-written save witnesses; remove this run directory after evidence publication.",
    observedAt: new Date().toISOString(),
  });
  if (!unchanged) throw new Error("protected-input-integrity-failed");
  return {
    processExit: remaining.length === 0 ? "confirmed" : "unconfirmed",
    profile: "retained",
    evidenceRetained: true,
    raw: ["disposal.json", "protected-before.json", "protected-after.json"],
  };
}

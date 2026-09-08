import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { sha256, writeJson } from "./io.ts";
import { adapterRoot } from "./lifecycle.ts";

const [game, source, settings, ordinaryProfile] = process.argv.slice(2);
if (!game || !source || !settings || !ordinaryProfile)
  throw new Error(
    "Usage: node configure.ts <game-executable> <game-produced-save> <settings.txt> <ordinary-profile>"
  );
const native = join(adapterRoot, "native");
execFileSync("cargo", ["build", "--release", "--locked"], { cwd: native, stdio: "inherit" });
execFileSync(
  "clang",
  [
    "-dynamiclib",
    "-fobjc-arc",
    "-framework",
    "AppKit",
    "-framework",
    "Foundation",
    "visibility_bridge.m",
    "-o",
    "visibility-bridge.dylib",
  ],
  { cwd: native, stdio: "inherit" }
);
execFileSync("swiftc", ["process_observer.swift", "-o", "process-observer"], {
  cwd: native,
  stdio: "inherit",
});
const inputs = join(adapterRoot, "inputs");
mkdirSync(inputs, { recursive: true });
copyFileSync(source, join(inputs, "source.sav"));
copyFileSync(settings, join(inputs, "settings.txt"));
writeJson(join(adapterRoot, "local-config.json"), {
  game: resolve(game),
  ordinaryProfile: resolve(ordinaryProfile),
  save: join(inputs, "source.sav"),
  saveSha256: sha256(source),
  settings: join(inputs, "settings.txt"),
  bridgeSha256: sha256(join(native, "target/release/libstellaris_lifecycle_probe.dylib")),
  guardSha256: sha256(join(native, "visibility-bridge.dylib")),
  observerSha256: sha256(join(native, "process-observer")),
});

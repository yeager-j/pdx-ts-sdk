import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const [gameArg, saveArg, settingsArg, ordinaryArg, pythonArg, aliasesArg] = process.argv.slice(2);
if (!gameArg || !saveArg || !settingsArg || !ordinaryArg || !pythonArg || !aliasesArg)
  throw new Error(
    "Usage: node configure.ts <game.exe> <Windows-save.sav> <settings.txt> <ordinary-profile> <python.exe> <hyphen-free-alias-root>"
  );
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const inputs = join(root, "inputs");
mkdirSync(inputs, { recursive: true });
copyFileSync(resolve(saveArg), join(inputs, "fixture.sav"));
copyFileSync(resolve(settingsArg), join(inputs, "settings.txt"));
const bridge = join(root, "native/build/bridge.dll");
const config = {
  game: resolve(gameArg),
  save: join(inputs, "fixture.sav"),
  saveSha256: hash(join(inputs, "fixture.sav")),
  settings: join(inputs, "settings.txt"),
  ordinaryProfile: resolve(ordinaryArg),
  python: resolve(pythonArg),
  aliasRoot: resolve(aliasesArg),
  bridge,
  bridgeSha256: hash(bridge),
};
if (config.aliasRoot.includes("-"))
  throw new Error("Windows game argument parser splits userdir on hyphens");
writeFileSync(join(root, "local-config.json"), JSON.stringify(config, null, 2) + "\n");

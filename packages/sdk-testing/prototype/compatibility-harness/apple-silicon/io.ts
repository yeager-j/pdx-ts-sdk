import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import type { Control } from "../contract.ts";

/** Hash actual bytes, including executable and immutable fixture inputs. */
export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Persist a complete recovery/evidence record before exposing it. */
export function writeJson(path: string, value: unknown): void {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n");
  const fd = openSync(path + ".tmp", "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(path + ".tmp", path);
}

/** Wait within the independent host's supplied operation bound. */
export async function until<T>(read: () => T | undefined, control: Control): Promise<T> {
  while (!control.signal.aborted && Date.now() < control.deadlineEpochMs) {
    const value = read();
    if (value !== undefined) return value;
    await setTimeout(25);
  }
  throw new Error("native-deadline-exceeded");
}

/** Hash a content tree without making timestamps part of input identity. */
export function manifest(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(directory: string, prefix: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(join(directory, entry.name), name + "/");
      else if (entry.isFile()) files[name] = sha256(join(directory, entry.name));
      else throw new Error(`unsupported-input-entry: ${name}`);
    }
  }
  if (existsSync(root) && statSync(root).isFile()) return { file: sha256(root) };
  walk(root, "");
  return files;
}

/** Current process command identities; cleanup never trusts a bare stored PID. */
export function processes(): { pid: number; command: string }[] {
  return execFileSync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line)!;
      return { pid: Number(match[1]), command: match[2]! };
    });
}

/** Start a detached owned tool, retaining all output after the worker exits. */
export function launchTool(command: string, args: string[], output: string): number {
  const fd = openSync(output, "a");
  try {
    const child = spawn(command, args, { stdio: ["ignore", fd, fd], detached: true });
    child.on("error", (error) => writeFileSync(output + ".error", String(error)));
    child.unref();
    if (!child.pid) throw new Error(`launch-failed: ${command}`);
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

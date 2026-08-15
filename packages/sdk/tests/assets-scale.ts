import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _assetCaptureTestHook } from "../src/authoring/assets.ts";
import { createMod, render, write } from "../src/index.ts";

const FILE_COUNT = 512;
const FILE_BYTES = 320 * 1024;
const CAPTURED_BYTES = FILE_COUNT * FILE_BYTES;
const RETAINED_LIMIT = Math.floor(CAPTURED_BYTES * 1.1 + 8 * 1024 * 1024);

interface Snapshot {
  readonly sha256: string;
  readonly files: readonly (readonly [path: string, byteLength: number, sha256: string])[];
  readonly writeStatus: "written" | "unchanged";
}

function forceGc(): void {
  if (typeof global.gc !== "function") {
    throw new Error("test:asset-scale must run with --expose-gc");
  }
  global.gc();
}

function makeCorpus(root: string): void {
  const payload = Buffer.allocUnsafe(FILE_BYTES);
  for (let index = 0; index < payload.length; index++) {
    payload[index] = index % 251;
  }
  for (let index = 0; index < FILE_COUNT; index++) {
    const directory = join(root, `group-${String(index % 16).padStart(2, "0")}`);
    mkdirSync(directory, { recursive: true });
    payload.writeUInt32LE(index, 0);
    writeFileSync(join(directory, `asset-${String(index).padStart(4, "0")}.bin`), payload);
  }
}

async function pipeline(source: string, out: string): Promise<Snapshot> {
  let reads = 0;
  _assetCaptureTestHook.current = { beforeRead: () => reads++ };
  const capability = createMod({
    name: "Asset scale",
    prefix: "asset_scale",
    supportedVersion: "4.4.*",
  });
  const assets = capability.assetTree({ source });
  if (reads !== FILE_COUNT) {
    throw new Error(`expected ${FILE_COUNT} source reads, received ${reads}`);
  }
  const rendered = render(capability.compile([capability.feature("assets", assets)]));
  forceGc();
  const retained = process.memoryUsage().arrayBuffers;
  if (retained > RETAINED_LIMIT) {
    throw new Error(
      `retained ArrayBuffers ${retained} exceed ${RETAINED_LIMIT} while one ${CAPTURED_BYTES}-byte snapshot lives`
    );
  }
  const result = await write(out, rendered);
  return {
    sha256: rendered.sha256,
    files: [...rendered.values()].map((file) => [file.path, file.byteLength, file.sha256]),
    writeStatus: result.status,
  };
}

const started = performance.now();
const root = mkdtempSync(join(tmpdir(), "pdx-assets-scale-"));

try {
  const source = join(root, "source");
  const out = join(root, "out");
  mkdirSync(source);
  makeCorpus(source);

  const first = await pipeline(source, out);
  forceGc();
  const second = await pipeline(source, out);
  if (
    first.sha256 !== second.sha256 ||
    JSON.stringify(first.files) !== JSON.stringify(second.files)
  ) {
    throw new Error("fresh Asset captures did not render identical hashes and bytes");
  }
  if (first.writeStatus !== "written" || second.writeStatus !== "unchanged") {
    throw new Error(
      `expected written then unchanged materialization, received ${first.writeStatus} then ${second.writeStatus}`
    );
  }
  const elapsed = performance.now() - started;
  const maxRss = process.resourceUsage().maxRSS * 1024;
  console.log(
    `Asset scale: ${FILE_COUNT} files, ${CAPTURED_BYTES} bytes, ${elapsed.toFixed(0)} ms, max RSS ${maxRss} bytes`
  );
} finally {
  _assetCaptureTestHook.current = undefined;
  rmSync(root, { recursive: true, force: true });
}

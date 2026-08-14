/**
 * Where a page's committed snapshot lives, and how to read it.
 *
 * Separate from `cli.ts` because that module writes the files as a side effect
 * of being imported — which is fine for a script and disastrous for a test
 * that only wanted a path. A gate asserting a snapshot is honest must not be
 * able to rewrite the snapshot on its way to finding out.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ReferenceBuild } from "../build.ts";
import type { ReferencePage } from "./pages.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function snapshotFileOf(page: ReferencePage): string {
  return path.join(ROOT, page.snapshotPath);
}

/** One page's committed build, exactly as the viewer imports it. */
export function readSnapshot(page: ReferencePage): ReferenceBuild {
  return JSON.parse(readFileSync(snapshotFileOf(page), "utf8")) as ReferenceBuild;
}

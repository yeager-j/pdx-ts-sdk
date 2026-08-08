/**
 * Committed goldens, and the one way to re-record them.
 *
 * A golden is review evidence rather than a cache of last week's behaviour: the
 * generated technology source and the `list`/`view` transcripts are artifacts a
 * human signed off on, and the diff is where the next human reads what changed.
 * So a mismatch names the file and the incantation, and re-recording is an
 * explicit act — never something a test run does on its own.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";

const GOLDENS = path.resolve(import.meta.dirname, "../goldens");

export function expectGolden(relPath: string, actual: string): void {
  const file = path.join(GOLDENS, relPath);
  const shown = `tests/goldens/${relPath}`;

  if (process.env["UPDATE_GOLDENS"] === "1") {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, actual);
    return;
  }

  let expected: string;
  try {
    expected = readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `${shown} does not exist yet. Record it with \`UPDATE_GOLDENS=1 npx vitest run\`, then ` +
        `read the new file before committing it.`
    );
  }

  expect(
    actual,
    `${shown} no longer matches what the code produces. Read the difference: if the new output ` +
      `is the intended one, re-record it with \`UPDATE_GOLDENS=1 npx vitest run\` and review the ` +
      `git diff as part of the change.`
  ).toBe(expected);
}

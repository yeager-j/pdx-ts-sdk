/**
 * Golden transcripts: the exact bytes an author sees, frozen.
 *
 * `list` and `view` are documentation that happens to be executable, so their
 * output is reviewed the way documentation is — by reading the committed file
 * and the diff against it. The `out|`/`err|` prefixes are what make the review
 * possible: a transcript records not just what was written but *where*, and the
 * catalog's promise is that only the result goes to stdout.
 */

import { describe, expect, it } from "vitest";

import { main } from "../src/cli.ts";
import { capture } from "./helpers/capture.ts";
import { expectGolden } from "./helpers/goldens.ts";

async function transcript(argv: readonly string[]): Promise<string> {
  const { io, out, err } = capture();
  const code = await main([...argv], io);
  return [...stream("out", out()), ...stream("err", err()), `exit ${code}`, ""].join("\n");
}

function stream(tag: string, text: string): string[] {
  if (text === "") {
    return [];
  }
  const lines = text.split("\n");
  // A trailing newline ends the last line rather than starting an empty one.
  // If one is missing that is worth seeing, so it is recorded rather than
  // rounded off.
  const complete = lines.at(-1) === "";
  if (complete) {
    lines.pop();
  }
  const recorded = lines.map((line) => (line === "" ? `${tag}|` : `${tag}| ${line}`));
  return complete ? recorded : [...recorded, `${tag}| (no trailing newline)`];
}

const TRANSCRIPTS: readonly (readonly [string, readonly string[]])[] = [
  ["list", ["list"]],
  ["view-technology", ["view", "technology"]],
  ["view-unknown", ["view", "nope"]],
  ["view-without-a-recipe", ["view"]],
];

describe("catalog discovery", () => {
  it.each(TRANSCRIPTS)("%s", async (golden, argv) => {
    expectGolden(`transcripts/${golden}.txt`, await transcript(argv));
  });

  it("writes no trailing whitespace, anywhere", async () => {
    // Aligned columns are one padEnd away from a line that ends in spaces, and
    // a terminal shows nothing while a diff shows it forever.
    for (const [, argv] of TRANSCRIPTS) {
      const { io, out, err } = capture();
      await main([...argv], io);
      for (const text of [out(), err()]) {
        expect(text.split("\n").filter((line) => /\s$/.test(line))).toEqual([]);
      }
    }
  });
});

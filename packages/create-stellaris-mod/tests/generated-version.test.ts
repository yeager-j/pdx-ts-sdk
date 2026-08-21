import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("generated scaffold provenance", () => {
  it("matches the current SDK source revision", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/generate-version.mjs", "--check"], {
        cwd: packageDir,
        stdio: "pipe",
      })
    ).not.toThrow();
  });
});

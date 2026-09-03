import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];

vi.mock("../src/identifiers/package-pin.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/identifiers/package-pin.ts")>()),
  installedVanillaPackagePin: () => ({
    state: "unreadable",
    detail: "metadata has no version field",
  }),
}));

const { createMod, runInspect } = await import("../src/index.ts");

afterEach(() => {
  process.exitCode = undefined;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runInspect with unreadable identifier metadata", () => {
  it("writes the pin detail to stderr without partial YAML", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "pdx-inspection-unreadable-"));
    temporaryDirectories.push(projectRoot);
    writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        name: "inspection-unreadable",
        version: "0.1.0",
        dependencies: {
          "@pdx-ts/sdk": "^0.6.0",
          "@pdx-ts/stellaris-ids": ">=4.4.6-0 <4.4.6",
        },
      })
    );
    const mod = createMod({
      name: "Inspection Unreadable",
      prefix: "inspection_unreadable",
      supportedVersion: "4.4.*",
    }).compile([]);
    const output = captureTerminal();
    const errors = captureTerminal();

    await runInspect(mod, {
      projectRoot,
      output: output.output,
      errorOutput: errors.output,
    });

    expect(process.exitCode).toBe(1);
    expect(output.text()).toBe("");
    expect(errors.text()).toContain("Inspection failed:");
    expect(errors.text()).toContain("metadata has no version field");
  });
});

function captureTerminal(): { readonly output: Writable; text(): string } {
  let captured = "";
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      captured += chunk.toString();
      callback();
    },
  });
  return { output, text: () => captured };
}

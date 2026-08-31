import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { createMod, MaterializationError, type ModWarning, type PureMod } from "../src/index.ts";
import { runBuild, runInstall } from "../src/terminal.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  process.exitCode = undefined;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("terminal build and install runners", () => {
  it("groups repeated warnings in compact build output", async () => {
    const outDir = temporaryDirectory("terminal-build-");
    const terminal = captureTerminal();
    const mod = withWarnings(compiledMod(), [
      warning("first"),
      warning("second"),
      warning("third"),
      warning("fourth"),
    ]);

    const report = await runBuild(mod, { outDir, output: terminal.output, verbose: false });

    expect(report?.status).toBe("written");
    expect(terminal.text()).toContain("Built Terminal Probe");
    expect(terminal.text()).toContain("4 authoring warnings");
    expect(terminal.text()).toContain("unstable-option-key ×4");
    expect(terminal.text()).toContain("Run with --verbose to show every warning.");
    expect(terminal.text()).not.toContain("first");
    expect(terminal.text()).not.toContain("\u001B[2K");
  });

  it("uses static output for a zero-width pseudo-terminal", async () => {
    const terminal = captureTerminal();
    Object.assign(terminal.output, { isTTY: true, columns: 0 });

    const report = await runBuild(compiledMod(), {
      outDir: temporaryDirectory("terminal-zero-width-"),
      output: terminal.output,
    });

    expect(report).toBeDefined();
    expect(terminal.text()).toContain("descriptor.mod");
    expect(terminal.text()).not.toContain("\u001B[2K");
  });

  it("shows emitted paths and every warning in verbose build output", async () => {
    const outDir = temporaryDirectory("terminal-verbose-");
    const terminal = captureTerminal();
    const mod = withWarnings(compiledMod(), [warning("first"), warning("second")]);

    const report = await runBuild(mod, { outDir, output: terminal.output, verbose: true });

    expect(report).toBeDefined();
    expect(terminal.text()).toContain("descriptor.mod");
    expect(terminal.text()).toContain("unstable-option-key: first");
    expect(terminal.text()).toContain("unstable-option-key: second");
  });

  it("shows emitted paths in verbose install output", async () => {
    const terminal = captureTerminal();

    const report = await runInstall(compiledMod(), {
      modDir: temporaryDirectory("terminal-verbose-install-"),
      output: terminal.output,
      verbose: true,
    });

    expect(report).toBeDefined();
    expect(terminal.text()).toContain("descriptor.mod");
  });

  it("reports informational preview diagnostics as notes", async () => {
    const terminal = captureTerminal();

    const report = await runBuild(compiledModWithPreviewInfo(), {
      outDir: temporaryDirectory("terminal-preview-build-"),
      previewsDir: temporaryDirectory("terminal-previews-"),
      output: terminal.output,
      verbose: true,
    });

    expect(report).toBeDefined();
    expect(terminal.text()).toContain("solar-system layout note");
    expect(terminal.text()).not.toContain("solar-system layout warning");
    const infoLine = terminal
      .text()
      .split("\n")
      .find((line) => line.includes("unresolved-visual"));
    expect(infoLine).toContain("●");
    expect(infoLine).not.toContain("▲");
  });

  it("reports a preview failure as its own, with the mod already written", async () => {
    // A regular file where the previews directory should be: the gallery's
    // own `mkdir` refuses it, and it refuses *after* the mod has been
    // materialized, which is the case that used to be reported as a total
    // build failure with `outDir` already holding the new mod (SDK-329).
    const outDir = temporaryDirectory("terminal-preview-failure-build-");
    const previewsDir = path.join(temporaryDirectory("terminal-preview-failure-"), "previews");
    writeFileSync(previewsDir, "not a directory", "utf8");
    const terminal = captureTerminal();

    const report = await runBuild(compiledModWithPreviewInfo(), {
      outDir,
      previewsDir,
      output: terminal.output,
      verbose: false,
    });

    // The write happened, so the report describes it rather than being denied.
    expect(report?.status).toBe("written");
    // `outDir` is reported resolved, so the identity claim is the basename.
    expect(report?.outDir).toContain(path.basename(outDir));
    expect(existsSync(path.join(outDir, "descriptor.mod"))).toBe(true);

    // What failed is named, and what did not fail is not blamed.
    expect(terminal.text()).toContain("previews failed");
    expect(terminal.text()).toContain("The mod was written; the solar-system previews were not.");
    expect(terminal.text()).not.toContain("Build failed");

    // Something the caller asked for did not happen, so the command still fails.
    expect(process.exitCode).toBe(1);
  });

  it("does not claim an unchanged mod was written when previews fail", async () => {
    // The second build into the same directory writes nothing, so the mod is
    // materialized without having been written this time round. Saying it
    // "was written" would be the inaccuracy this change exists to remove.
    const outDir = temporaryDirectory("terminal-preview-unchanged-build-");
    const previewsDir = path.join(temporaryDirectory("terminal-preview-unchanged-"), "previews");
    writeFileSync(previewsDir, "not a directory", "utf8");
    const options = { outDir, previewsDir, verbose: false };

    await runBuild(compiledModWithPreviewInfo(), { ...options, output: captureTerminal().output });
    process.exitCode = undefined;
    const terminal = captureTerminal();
    const report = await runBuild(compiledModWithPreviewInfo(), {
      ...options,
      output: terminal.output,
    });

    expect(report?.status).toBe("unchanged");
    expect(terminal.text()).toContain("The mod is materialized and up to date");
    expect(terminal.text()).not.toContain("The mod was written");
    expect(terminal.text()).toContain("previews failed");
    expect(process.exitCode).toBe(1);
  });

  it("still fails the whole build when the write itself fails", async () => {
    const terminal = captureTerminal();
    const outDir = path.join(temporaryDirectory("terminal-write-failure-"), "out");
    writeFileSync(outDir, "not a directory", "utf8");

    const report = await runBuild(compiledModWithPreviewInfo(), {
      outDir,
      previewsDir: temporaryDirectory("terminal-write-failure-previews-"),
      output: terminal.output,
      verbose: false,
    });

    expect(report).toBeUndefined();
    expect(terminal.text()).toContain("Build failed");
    expect(process.exitCode).toBe(1);
  });

  it("always shows definite preview findings in compact output", async () => {
    const terminal = captureTerminal();

    const report = await runBuild(compiledModWithDefinitePreviewIssue(), {
      outDir: temporaryDirectory("terminal-definite-build-"),
      previewsDir: temporaryDirectory("terminal-definite-previews-"),
      output: terminal.output,
      verbose: false,
    });

    expect(report).toBeDefined();
    const definiteLine = terminal
      .text()
      .split("\n")
      .find((line) => line.includes("body-overlap"));
    expect(definiteLine).toContain("▲");
    expect(definiteLine).toContain("Definite");
    expect(terminal.text()).not.toContain("unresolved-visual");
    expect(terminal.text()).toMatch(/Run with --verbose to show \d+ additional layout findings?\./);
  });

  it("renders installation drift without a second raw stack trace", async () => {
    const modDir = temporaryDirectory("terminal-install-");
    const firstTerminal = captureTerminal();
    const first = await runInstall(compiledMod(), {
      modDir,
      output: firstTerminal.output,
      verbose: false,
    });
    expect(first).toBeDefined();
    writeFileSync(first!.descriptorPath, "changed outside the SDK");

    const failedTerminal = captureTerminal();
    const failed = await runInstall(compiledMod(), {
      modDir,
      output: failedTerminal.output,
      verbose: false,
    });

    expect(failed).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(failedTerminal.text()).toContain("Installation failed");
    expect(failedTerminal.text()).toContain("Materialization refused");
    expect(failedTerminal.text()).toContain("(modified)");
    expect(failedTerminal.text()).toContain("explicit replacement operation");
    expect(failedTerminal.text()).toContain("Run with --verbose to show the stack trace.");
    expect(failedTerminal.text()).not.toContain("at runInstall");
  });

  it("formats a rejected mod promise and sets the command exit code", async () => {
    const terminal = captureTerminal();

    const report = await runBuild(Promise.reject(new Error("compile exploded")), {
      outDir: temporaryDirectory("terminal-rejected-"),
      output: terminal.output,
      verbose: false,
    });

    expect(report).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(terminal.text()).toContain("Build failed");
    expect(terminal.text()).toContain("compile exploded");
    expect(terminal.text()).not.toContain("at ");
  });

  it("includes nested error causes in verbose failure details", async () => {
    const terminal = captureTerminal();
    const cause = new Error("EACCES: permission denied during rename");
    const failure = new MaterializationError(
      "/target/mod",
      { reason: "activation", rolledBack: true },
      { cause }
    );

    const report = await runBuild(Promise.reject(failure), {
      outDir: temporaryDirectory("terminal-caused-failure-"),
      output: terminal.output,
      verbose: true,
    });

    expect(report).toBeUndefined();
    expect(terminal.text()).toContain("Technical details");
    expect(terminal.text()).toContain("Caused by:");
    expect(terminal.text()).toContain("EACCES: permission denied during rename");
  });
});

function compiledMod(): PureMod {
  const capability = createMod({
    name: "Terminal Probe",
    prefix: "terminal_probe",
    version: "0.1.0",
    supportedVersion: "v4.4.*",
  });
  return capability.compile([]);
}

function compiledModWithPreviewInfo(): PureMod {
  const capability = createMod({
    name: "Terminal Preview Probe",
    prefix: "terminal_preview_probe",
    version: "0.1.0",
    supportedVersion: "v4.4.*",
  });
  const system = capability.solarSystemInitializer("uncertain", {
    class: "sc_g",
    planet: [{ class: "random", orbitDistance: 40, orbitAngle: 0 }],
  });
  return capability.compile([capability.feature(undefined, [system])]);
}

function compiledModWithDefinitePreviewIssue(): PureMod {
  const capability = createMod({
    name: "Terminal Definite Preview Probe",
    prefix: "terminal_definite_preview_probe",
    version: "0.1.0",
    supportedVersion: "v4.4.*",
  });
  const overlap = capability.solarSystemInitializer("overlap", {
    class: "sc_g",
    planet: [
      { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
      { class: "pc_barren", size: 20, orbitDistance: 2, orbitAngle: 0 },
    ],
  });
  const uncertain = capability.solarSystemInitializer("uncertain", {
    class: "sc_g",
    planet: [{ class: "random", orbitDistance: 40, orbitAngle: 0 }],
  });
  return capability.compile([capability.feature(undefined, [overlap, uncertain])]);
}

function warning(message: string): ModWarning {
  return { code: "unstable-option-key", message };
}

function withWarnings(mod: PureMod, warnings: readonly ModWarning[]): PureMod {
  return Object.freeze({ ...mod, warnings: Object.freeze([...warnings]) });
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

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

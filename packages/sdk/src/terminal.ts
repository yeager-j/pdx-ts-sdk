/**
 * Clack-backed terminal entry points for ordinary build and install scripts.
 *
 * Importing this module is opt-in. The compiler continues to return diagnostics
 * as data and throw structured errors without printing them.
 */

import type { Writable } from "node:stream";
import { isCI, isTTY, log, note, taskLog } from "@clack/prompts";

import type { PureMod } from "./compiler/model.ts";
import type { ModWarning } from "./diagnostics.ts";
import { MaterializationError } from "./errors.ts";
import { install, type InstallOptions } from "./output/install.ts";
import { render } from "./output/render.ts";
import type { RenderedMod } from "./output/rendered.ts";
import { writeSystemPreviews, type SystemPreviewReport } from "./output/system-previews.ts";
import {
  write,
  type InstallReport,
  type MaterializationReport,
  type WriteReport,
} from "./output/write.ts";
import type { SolarSystemDiagnostic } from "./solar-system-inspect/diagnose.ts";

/** Shared presentation controls for terminal build and install commands. */
export interface TerminalRunOptions {
  /** Destination for terminal presentation. Defaults to `process.stderr`. */
  readonly output?: Writable;
  /** Show every emitted path, warning, and stack trace. Defaults on in CI and non-TTY output. */
  readonly verbose?: boolean;
}

/** Configuration for {@link runBuild}. */
export interface RunBuildOptions extends TerminalRunOptions {
  /** Directory that receives the rendered mod. */
  readonly outDir: string | URL;
  /** Directory that receives the optional solar-system preview gallery. */
  readonly previewsDir?: string | URL;
}

/** Configuration for {@link runInstall}. */
export interface RunInstallOptions extends TerminalRunOptions, InstallOptions {}

interface TerminalContext {
  readonly output: Writable;
  readonly verbose: boolean;
  readonly interactive: boolean;
}

interface TerminalTask {
  message(message: string): void;
  success(message: string): void;
  error(message: string): void;
}

/**
 * Render and write a compiled mod with compact terminal progress and diagnostics.
 *
 * A rejected mod promise or failed write is reported and sets `process.exitCode`
 * to `1`. The function resolves to `undefined` after a reported failure so Node
 * does not print the same error and stack a second time.
 *
 * @example
 * ```ts
 * await runBuild(buildTheMod(), {
 *   outDir: new URL("../out/", import.meta.url),
 *   previewsDir: new URL("../previews/", import.meta.url),
 * });
 * ```
 */
export async function runBuild(
  modInput: PureMod | PromiseLike<PureMod>,
  options: RunBuildOptions
): Promise<WriteReport | undefined> {
  const context = terminalContext(options);
  const task = startTask("Building Stellaris mod", context);

  try {
    const mod = await modInput;
    task.message(`Compiled ${mod.config.name}`);

    const rendered = render(mod);
    task.message(`Rendered ${rendered.size} files`);
    reportRenderedPaths(rendered, task, context);

    const report = await write(options.outDir, rendered);
    task.message(`${report.status === "written" ? "Wrote" : "Checked"} ${report.outDir}`);

    const previews =
      options.previewsDir === undefined
        ? undefined
        : await writeSystemPreviews(options.previewsDir, mod);
    if (previews !== undefined) {
      task.message(`Rendered ${previews.previews.length} solar-system previews`);
    }

    task.success(buildSummary(mod, rendered.size, report));
    reportModWarnings(mod.warnings, context);
    reportMaterializationDetails(report, context);
    if (previews !== undefined) {
      reportPreviewDiagnostics(previews, context);
    }
    log.info(`Output: ${report.outDir}`, { output: context.output });
    return report;
  } catch (error) {
    task.error("Build failed");
    reportFailure(error, context);
    process.exitCode = 1;
    return undefined;
  }
}

/**
 * Render and install a compiled mod with compact terminal progress and diagnostics.
 *
 * A rejected mod promise or failed install is reported and sets `process.exitCode`
 * to `1`. The function resolves to `undefined` after a reported failure so Node
 * does not print the same error and stack a second time.
 *
 * @example
 * ```ts
 * await runInstall(buildTheMod());
 * ```
 */
export async function runInstall(
  modInput: PureMod | PromiseLike<PureMod>,
  options: RunInstallOptions = {}
): Promise<InstallReport | undefined> {
  const context = terminalContext(options);
  const task = startTask("Installing Stellaris mod", context);

  try {
    const mod = await modInput;
    task.message(`Compiled ${mod.config.name}`);

    const rendered = render(mod);
    task.message(`Rendered ${rendered.size} files`);
    reportRenderedPaths(rendered, task, context);

    const installOptions: InstallOptions = {
      ...(options.modDir === undefined ? {} : { modDir: options.modDir }),
      ...(options.dirName === undefined ? {} : { dirName: options.dirName }),
    };
    const report = await install(rendered, installOptions);
    task.message(
      `${report.status === "written" ? "Installed to" : "Checked"} ${report.contentDir}`
    );

    task.success(installSummary(mod, report));
    reportModWarnings(mod.warnings, context);
    reportMaterializationDetails(report, context);
    note(
      [`content:    ${report.contentDir}`, `descriptor: ${report.descriptorPath}`].join("\n"),
      "Launcher paths",
      { output: context.output }
    );
    return report;
  } catch (error) {
    task.error("Installation failed");
    reportFailure(error, context);
    process.exitCode = 1;
    return undefined;
  }
}

function terminalContext(options: TerminalRunOptions): TerminalContext {
  const output = options.output ?? process.stderr;
  const columns = "columns" in output ? output.columns : undefined;
  const hasUsableWidth = typeof columns !== "number" || columns > 0;
  const interactive = !isCI() && isTTY(output) && hasUsableWidth;
  const verbose = options.verbose ?? (!interactive || process.argv.slice(2).includes("--verbose"));
  return { output, verbose, interactive };
}

function startTask(title: string, context: TerminalContext): TerminalTask {
  if (!context.interactive) {
    log.step(title, { output: context.output });
    return {
      message(message) {
        if (context.verbose) {
          log.message(message, { output: context.output });
        }
      },
      success: (message) => log.success(message, { output: context.output }),
      error: (message) => log.error(message, { output: context.output }),
    };
  }

  const task = taskLog({
    title,
    limit: 8,
    retainLog: context.verbose,
    output: context.output,
  });
  return {
    message: (message) => task.message(message),
    success: (message) => task.success(message, { showLog: context.verbose }),
    error: (message) => task.error(message),
  };
}

function reportRenderedPaths(
  rendered: RenderedMod,
  task: TerminalTask,
  context: TerminalContext
): void {
  if (!context.verbose) {
    return;
  }
  for (const relPath of rendered.keys()) {
    task.message(relPath);
  }
}

function buildSummary(mod: PureMod, fileCount: number, report: WriteReport): string {
  const verb = report.status === "written" ? "Built" : "Already up to date";
  return `${verb} ${mod.config.name} · ${count(fileCount, "file")} · ${assetSummary(mod)}`;
}

function installSummary(mod: PureMod, report: InstallReport): string {
  return report.status === "written"
    ? `Installed ${mod.config.name} · ${assetSummary(mod)}`
    : `${mod.config.name} is already installed and up to date · ${assetSummary(mod)}`;
}

function assetSummary(mod: PureMod): string {
  const byteCount = mod.assets.reduce((total, asset) => total + asset.byteLength, 0);
  return `${count(mod.assets.length, "asset")} · ${count(byteCount, "byte")}`;
}

function count(value: number, singular: string): string {
  return `${value.toLocaleString("en-US")} ${singular}${value === 1 ? "" : "s"}`;
}

function reportModWarnings(warnings: readonly ModWarning[], context: TerminalContext): void {
  if (warnings.length === 0) {
    return;
  }

  if (context.verbose || warnings.length <= 3) {
    for (const warning of warnings) {
      log.warn(`${warning.code}: ${warning.message}`, { output: context.output });
    }
    return;
  }

  const counts = new Map<ModWarning["code"], number>();
  for (const warning of warnings) {
    counts.set(warning.code, (counts.get(warning.code) ?? 0) + 1);
  }
  const summary = [...counts].map(([code, warningCount]) => `${code} ×${warningCount}`).join("\n");
  log.warn(count(warnings.length, "authoring warning"), { output: context.output });
  note(summary, "Warning groups", { output: context.output });
  log.info("Run with --verbose to show every warning.", { output: context.output });
}

function reportMaterializationDetails(
  report: MaterializationReport,
  context: TerminalContext
): void {
  for (const warning of report.warnings) {
    log.warn(`${warning.message} (${warning.path})`, { output: context.output });
  }
  if (report.foreignEntries.length === 0) {
    return;
  }

  log.info(`Preserved ${count(report.foreignEntries.length, "foreign entry")}.`, {
    output: context.output,
  });
  if (context.verbose) {
    note(
      report.foreignEntries.map((entry) => `${entry.path} (${entry.kind})`).join("\n"),
      "Preserved entries",
      { output: context.output }
    );
  }
}

function reportPreviewDiagnostics(report: SystemPreviewReport, context: TerminalContext): void {
  const diagnostics = report.previews.flatMap((preview) =>
    preview.diagnostics.map((diagnostic) => ({ preview: preview.id, diagnostic }))
  );
  if (diagnostics.length === 0) {
    return;
  }

  const warnings = diagnostics.filter(({ diagnostic }) => diagnostic.severity === "warning");
  const infos = diagnostics.filter(({ diagnostic }) => diagnostic.severity === "info");
  if (warnings.length > 0) {
    log.warn(count(warnings.length, "solar-system layout warning"), { output: context.output });
  }
  if (infos.length > 0) {
    log.info(count(infos.length, "solar-system layout note"), { output: context.output });
  }

  const visibleDiagnostics = context.verbose
    ? diagnostics
    : diagnostics.filter(({ diagnostic }) => diagnostic.certainty === "definite");
  for (const { preview, diagnostic } of visibleDiagnostics) {
    reportPreviewDiagnostic(preview, diagnostic, context);
  }

  const hiddenCount = diagnostics.length - visibleDiagnostics.length;
  if (hiddenCount > 0) {
    log.info(`Run with --verbose to show ${count(hiddenCount, "additional layout finding")}.`, {
      output: context.output,
    });
  }
}

function reportPreviewDiagnostic(
  preview: string,
  diagnostic: SolarSystemDiagnostic,
  context: TerminalContext
): void {
  const certainty = diagnostic.certainty === "definite" ? "Definite" : diagnostic.certainty;
  const message = `${certainty} · ${preview} · ${diagnostic.code}: ${diagnostic.message}`;
  if (diagnostic.severity === "warning") {
    log.warn(message, { output: context.output });
  } else {
    log.info(message, { output: context.output });
  }
}

function reportFailure(error: unknown, context: TerminalContext): void {
  if (error instanceof MaterializationError) {
    note(materializationFailure(error), "Materialization refused", { output: context.output });
  } else {
    const message = error instanceof Error ? error.message : String(error);
    note(message, "Error", { output: context.output });
  }

  if (context.verbose && error instanceof Error) {
    note(errorStackWithCauses(error), "Technical details", { output: context.output });
  } else if (!context.verbose) {
    log.info("Run with --verbose to show the stack trace.", { output: context.output });
  }
}

function errorStackWithCauses(error: Error): string {
  const stacks: string[] = [];
  const seen = new Set<Error>();
  let current: Error | undefined = error;

  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    stacks.push(current.stack ?? `${current.name}: ${current.message}`);
    current = current.cause instanceof Error ? current.cause : undefined;
  }

  return stacks.join("\nCaused by:\n");
}

function materializationFailure(error: MaterializationError): string {
  const lines = [error.message, "", `target: ${error.target}`];
  const failure = error.failure;

  switch (failure.reason) {
    case "unowned":
      lines.push("", "Choose an empty target or one previously written by this SDK.");
      break;
    case "drift":
      lines.push(
        "",
        ...failure.drift.map((entry) => `${entry.path} (${entry.kind})`),
        "",
        "Review the changed paths. Restore them, or use the matching receipt with the explicit replacement operation."
      );
      break;
    case "foreign-conflict":
      lines.push(
        "",
        ...failure.conflicts.map(
          (entry) => `${entry.claimPath} conflicts with ${entry.foreignPath} (${entry.kind})`
        ),
        "",
        "Move or remove the conflicting foreign entries before trying again."
      );
      break;
    case "foreign-unpreservable":
      lines.push(
        "",
        ...failure.entries.map((entry) => `${entry.path} (${entry.kind})`),
        "",
        "Move or remove these entries before trying again."
      );
      break;
    case "busy":
      if (failure.holder !== undefined) {
        lines.push("");
        lines.push(
          `held by process ${failure.holder.pid} since ${failure.holder.startedAt} (${failure.holder.phase})`
        );
      }
      lines.push("", "Wait for the other materialization to finish before trying again.");
      break;
    case "activation":
      lines.push(
        "",
        failure.rolledBack
          ? "The previous output was restored."
          : "The previous output could not be restored; inspect the target before continuing."
      );
      break;
    case "recovery-required":
      if (failure.journalPath !== undefined) {
        lines.push("");
        lines.push(`journal: ${failure.journalPath}`);
      }
      if (failure.phase !== undefined) {
        lines.push(`phase: ${failure.phase}`);
      }
      if (failure.evidence !== undefined) {
        lines.push(
          ...failure.evidence.map(
            (entry) => `${entry.path}: expected ${entry.expected}; observed ${entry.observed}`
          )
        );
      }
      lines.push("", "Run the matching SDK recovery operation before trying again.");
      break;
    case "unrepresentable":
      lines.push("", ...failure.paths, "", "Rename the listed output paths.");
      break;
  }

  return lines.join("\n");
}

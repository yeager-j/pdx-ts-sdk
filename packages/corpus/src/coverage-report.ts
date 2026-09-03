/**
 * Prints the syntax coverage report.
 *
 * Run with `npm run coverage`. Read-only and hermetic: it reads the vendored
 * rules and the committed fixtures, never an install, and it is not a gate.
 * It exits nonzero only when a fixture is missing or stale, with the remedy.
 */

import { buildCoverage, CoverageInputError } from "./coverage-inputs.ts";

try {
  console.log(buildCoverage().lines.join("\n"));
} catch (error) {
  if (!(error instanceof CoverageInputError)) {
    throw error;
  }
  console.error(error.message);
  process.exitCode = 1;
}

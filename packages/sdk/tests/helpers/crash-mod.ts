/**
 * The two generations the negative-control tests materialize.
 *
 * Built straight from `createRenderedMod` rather than through `createMod` and
 * `render`, because the child process that gets killed mid-write imports this
 * module: the smaller its import graph, the less of the SDK is between the
 * spawn and the instant under test. The generations differ in one owned file
 * *and* in the launcher descriptor, so a recovered target can be read back as
 * one generation or the other on both halves — which is the whole question a
 * half-finished install asks.
 */

import { createRenderedMod, type RenderedMod } from "../../src/output/rendered.ts";

export const CRASH_PREFIX = "crash_probe";

/** Present in generation two only, so the two trees are told apart on disk. */
export const GEN_TWO_ONLY = "common/technology/crash_probe_second.txt";

export type Generation = 1 | 2;

export function renderGeneration(generation: Generation): RenderedMod {
  const claims = [
    {
      path: "common/technology/crash_probe_first.txt",
      owner: "crash probe",
      text: `crash_probe_first = { generation = ${generation} }\n`,
    },
    ...(generation === 1
      ? []
      : [{ path: GEN_TWO_ONLY, owner: "crash probe", text: "crash_probe_second = { }\n" }]),
  ];
  const header = `name="Crash Probe"\nversion="${generation}.0.0"\nsupported_version="v4.4.*"\n`;
  return createRenderedMod(CRASH_PREFIX, header, claims);
}

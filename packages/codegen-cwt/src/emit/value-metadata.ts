/** TypeScript metadata projection for lowered scalar values. */

import type { LoweredValue } from "../lower/value.ts";

function refTypesEntry(value: LoweredValue | undefined): string | undefined {
  return value?.refTypes === undefined ? undefined : `refTypes: ${JSON.stringify(value.refTypes)}`;
}

/** Renders reference metadata for appending to an object literal. */
export function refTypesSuffix(value: LoweredValue | undefined): string {
  const entry = refTypesEntry(value);
  return entry === undefined ? "" : `, ${entry}`;
}

/** Renders reference metadata as standalone object-member entries. */
export function refTypesEntries(value: LoweredValue | undefined): readonly string[] {
  const entry = refTypesEntry(value);
  return entry === undefined ? [] : [entry];
}

/**
 * What a value *is*, phrased for someone reading an error about the thing
 * they passed: "absent", "null", "an array", "an object", "a string".
 *
 * Shared by the manifest parser and the feature-bag reader, which both report
 * a wrong-shaped value back to the author who typed it. One phrasing, so the
 * two errors read as one voice.
 */
export function describeValue(value: unknown): string {
  if (value === undefined) {
    return "absent";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  if (typeof value === "object") {
    return "an object";
  }
  return `a ${typeof value}`;
}

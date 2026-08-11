/**
 * The logical-path comparator: the ordering the game resolves overrides by.
 *
 * Vendored from the resolver spec in stellaris-docs (`docs/technical-design.md`,
 * "Installation identity"): logical relative paths use `/` separators, Unicode
 * NFC, exact case-preserving comparison, and no `.` or `..` components; sorting
 * compares the normalized UTF-8 bytes; invalid Unicode is rejected without
 * lossy conversion; and two raw entries that normalize to the same logical
 * path produce a visible collision rather than an arbitrary winner. The
 * empirical basis is the resolver-evaluation spike (Pegasus v4.4.6): files
 * enumerate in this order, and a repeat registration's winner follows from
 * position in it, never from which source contributed the file.
 *
 * Sharing the implementation with stellaris-docs is not possible (its resolver
 * is Rust inside a Tauri binary), so this file vendors the spec and pins the
 * same equivalence its property test does: UTF-8 byte order equals code-point
 * order, which JavaScript's UTF-16 `<` does not.
 */

import { LogicalPathError } from "./errors.ts";

declare const logicalPathBrand: unique symbol;

/** A normalized logical relative path; only `normalizeLogicalPath` mints one. */
export type LogicalPath = string & { readonly [logicalPathBrand]: true };

export function normalizeLogicalPath(raw: string): LogicalPath {
  if (raw === "") {
    throw new LogicalPathError(`Logical path is empty`);
  }
  if (raw.includes("\\")) {
    throw new LogicalPathError(
      `Logical path ${JSON.stringify(raw)} contains a backslash; logical paths use "/" separators`
    );
  }
  if (!raw.isWellFormed()) {
    throw new LogicalPathError(
      `Logical path ${JSON.stringify(raw)} is not valid Unicode (lone surrogate); ` +
        `invalid input is rejected, never converted lossily`
    );
  }
  if (raw.startsWith("/")) {
    throw new LogicalPathError(
      `Logical path ${JSON.stringify(raw)} is absolute; only relative paths have logical identity`
    );
  }
  const normalized = raw.normalize("NFC");
  for (const component of normalized.split("/")) {
    if (component === "") {
      throw new LogicalPathError(
        `Logical path ${JSON.stringify(raw)} has an empty component (trailing or doubled "/")`
      );
    }
    if (component === "." || component === "..") {
      throw new LogicalPathError(
        `Logical path ${JSON.stringify(raw)} contains a "${component}" component; ` +
          `dot components are rejected, not resolved`
      );
    }
    if (/[\u0000-\u001f\u007f]/.test(component)) {
      throw new LogicalPathError(
        `Logical path ${JSON.stringify(raw)} contains a control character`
      );
    }
    if (/[<>:"|?*]/.test(component)) {
      throw new LogicalPathError(
        `Logical path ${JSON.stringify(raw)} contains a character Windows cannot represent`
      );
    }
    if (component.startsWith(" ") || component.endsWith(" ") || component.endsWith(".")) {
      throw new LogicalPathError(
        `Logical path ${JSON.stringify(raw)} has a component with a leading or trailing space, ` +
          `or a trailing period`
      );
    }
    const basename = component.split(".", 1)[0]!.toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(basename)) {
      throw new LogicalPathError(
        `Logical path ${JSON.stringify(raw)} uses reserved Windows device name ${JSON.stringify(
          component
        )}`
      );
    }
    if (encoder.encode(component).byteLength > 255 || component.length > 255) {
      throw new LogicalPathError(
        `Logical path ${JSON.stringify(raw)} has a component longer than the portable 255-unit limit`
      );
    }
  }
  return normalized as LogicalPath;
}

/**
 * Sign of the UTF-8 byte comparison of two strings. The path comparator below
 * is this function at its own domain; `buildMod`'s canonical emission order
 * (SDK-23) is the same comparison over content ids and emitted relative paths,
 * which are strings rather than validated logical paths. Both want the one
 * property the header states: UTF-8 byte order, which is code-point order and
 * is *not* JavaScript's UTF-16 `<`, and never a locale-sensitive collation.
 */
export function compareUtf8(a: string, b: string): -1 | 0 | 1 {
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  const shared = Math.min(bytesA.length, bytesB.length);
  for (let i = 0; i < shared; i++) {
    const delta = bytesA[i]! - bytesB[i]!;
    if (delta !== 0) {
      return delta < 0 ? -1 : 1;
    }
  }
  return bytesA.length === bytesB.length ? 0 : bytesA.length < bytesB.length ? -1 : 1;
}

/**
 * Sign of the UTF-8 byte comparison of two normalized paths — the enumeration
 * order itself. Case-sensitive by spec; no folding of any kind.
 */
export function compareLogicalPaths(a: LogicalPath, b: LogicalPath): -1 | 0 | 1 {
  return compareUtf8(a, b);
}

/**
 * Normalizes every raw path and returns them in enumeration order. Two raw
 * paths that normalize to one logical path are a collision the caller must
 * see — an arbitrary winner here would be an arbitrary winner in-game.
 */
export function enumerationOrder(raws: readonly string[]): LogicalPath[] {
  const byLogical = new Map<LogicalPath, string>();
  for (const raw of raws) {
    const logical = normalizeLogicalPath(raw);
    const existing = byLogical.get(logical);
    if (existing !== undefined && existing !== raw) {
      throw new LogicalPathError(
        `Raw paths ${JSON.stringify(existing)} and ${JSON.stringify(raw)} normalize to the same ` +
          `logical path ${JSON.stringify(logical)}; refusing to pick an arbitrary winner`
      );
    }
    byLogical.set(logical, raw);
  }
  return [...byLogical.keys()].sort(compareLogicalPaths);
}

const encoder = new TextEncoder();

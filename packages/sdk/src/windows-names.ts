/**
 * The filenames Windows will not let anything create, in one place.
 *
 * `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9` and `LPT1`–`LPT9` are device names
 * rather than files, and Windows reserves them *with any extension and any
 * casing* — `con`, `CON.txt` and `Con.ts` all fail. A path that carries one is
 * not a path that works on some machines and not others; it is a path that
 * cannot exist on one of the platforms this repo tests on.
 *
 * Its own module because three callers need the same answer and had been
 * spelling it separately: the project layout's portable-component pattern, the
 * logical-path validator, and the vanilla generator's module-stem gate. Three
 * spellings of one fact is three chances for them to disagree about what
 * Windows does, and the third was about to be written before this existed.
 */

/**
 * The reserved basenames, spelled once.
 *
 * Source text rather than a `RegExp`, because one caller splices it into a
 * larger pattern's lookahead and a compiled expression cannot be spliced. The
 * casing is spelled with character classes rather than carried by an `i` flag
 * or an inline `(?i:)` group for the same reason: that caller's pattern is also
 * emitted as a JSON Schema `pattern`, which is read by validators that have
 * neither.
 */
export const WINDOWS_DEVICE_NAME_SOURCE =
  String.raw`(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]` +
  String.raw`|[Cc][Oo][Mm][1-9]|[Ll][Pp][Tt][1-9])`;

const WINDOWS_DEVICE_NAME = new RegExp(`^${WINDOWS_DEVICE_NAME_SOURCE}$`);

/**
 * Whether one path component names a Windows device.
 *
 * @param component - A single path component, extension included.
 * @returns `true` when the part before the first `.` is a reserved device name,
 * whatever its casing and whatever extension follows.
 */
export function isWindowsDeviceName(component: string): boolean {
  return WINDOWS_DEVICE_NAME.test(component.split(".", 1)[0] ?? "");
}

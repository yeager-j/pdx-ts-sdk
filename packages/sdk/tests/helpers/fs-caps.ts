/**
 * What the filesystem under `os.tmpdir()` can actually do.
 *
 * The alias rows in the lock probes are claims about one physical directory
 * reachable under two spellings, and whether two spellings are one directory is
 * a property of the volume, not of the code: APFS folds case and Unicode
 * composition, ext4 folds neither. Each capability is measured once, against
 * the same volume the tests write into, so a row that cannot exist here skips
 * instead of failing — and a row that can exist runs, rather than being skipped
 * by a guess made from the platform name.
 */

import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * "cafe" with an acute accent, in both Unicode compositions. The two
 * spellings are built from ASCII plus an explicit combining mark rather than
 * written out, because the difference between them is invisible in source: a
 * formatter or an editor that normalized this file would turn the pair into one
 * string and the probe below into a tautology.
 */
const COMBINING_ACUTE = String.fromCharCode(0x0301);
export const NFD_NAME = `cafe${COMBINING_ACUTE}`;
export const NFC_NAME = NFD_NAME.normalize("NFC");

function probe(measure: (dir: string) => boolean): boolean {
  const dir = mkdtempSync(join(tmpdir(), "pdx-fs-caps-"));
  try {
    return measure(dir);
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether "a" and "A" name one entry. */
export const caseInsensitiveDir: boolean = probe((dir) => {
  writeFileSync(join(dir, "casefold"), "x", "utf8");
  return existsSync(join(dir, "CASEFOLD"));
});

/** Whether a composed name and its decomposed spelling name one entry. */
export const nfcAliasingDir: boolean = probe((dir) => {
  writeFileSync(join(dir, NFC_NAME), "x", "utf8");
  return existsSync(join(dir, NFD_NAME));
});

/** Whether this process may create symlinks (Windows often says no). */
export const symlinksAvailable: boolean = probe((dir) => {
  writeFileSync(join(dir, "referent"), "x", "utf8");
  symlinkSync(join(dir, "referent"), join(dir, "link"));
  return existsSync(join(dir, "link"));
});

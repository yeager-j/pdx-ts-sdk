/**
 * Turning what the author typed into what the SDK requires. Pure, no I/O — so
 * every rule here is checkable without a filesystem or a terminal.
 *
 * The prefix rules are not this module's to invent: `LOWERCASE_SNAKE_CASE` and
 * `createMod`'s own prefix check owns them, and a property test asserts that
 * whatever `toPrefix` produces, the SDK accepts. That way a change to the SDK's
 * grammar breaks a test here rather than a stranger's scaffold.
 */

import { slugify } from "./fold.ts";

/** The SDK's rule, restated only so this module needs no runtime dependency. */
const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isValidPrefix(prefix: string): boolean {
  return PREFIX_PATTERN.test(prefix);
}

/**
 * A display name into a mod prefix: `"Hello Galaxy"` -> `hello_galaxy`.
 *
 * The fold in `fold.ts` does the character work — accents onto their base
 * letter, `Ærø Ascendancy` into `aero_ascendancy` rather than losing three of
 * its characters. What is this module's own is the never-fail part: an empty
 * fold becomes `my_mod`, and a name that begins with a digit gets a `mod_`
 * prefix, because ids and file stems must start with a letter and refusing
 * outright would be a dead end for a legitimate name like `4X Overhaul`.
 */
export function toPrefix(name: string): string {
  const slug = slugify(name);
  if (slug === "") {
    return "my_mod";
  }
  return /^[a-z]/.test(slug) ? slug : `mod_${slug}`;
}

/**
 * A directory name into a plausible display name: `my-cool-mod` -> `My Cool
 * Mod`. Only a prompt default — the author sees it and can say otherwise.
 */
export function toDisplayName(dirName: string): string {
  const words = dirName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  if (words.length === 0) {
    return "My Stellaris Mod";
  }
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * An npm-legal package name from the target directory. npm rejects capitals
 * and most punctuation, and a scaffold whose very first `npm install` fails on
 * its own name would be an unkind way to start.
 */
export function toPackageName(dirName: string): string {
  const slug = dirName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[-._]+$/g, "");
  return slug === "" ? "my-stellaris-mod" : slug;
}

/** Comma-separated launcher tags, with the empties dropped. */
export function toTags(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

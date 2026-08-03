/**
 * Turning what the author typed into what the SDK requires. Pure, no I/O — so
 * every rule here is checkable without a filesystem or a terminal.
 *
 * The prefix rules are not this module's to invent: `FILE_STEM_PATTERN` and
 * `buildMod`'s own prefix check own them, and a property test asserts that
 * whatever `toPrefix` produces, the SDK accepts. That way a change to the SDK's
 * grammar breaks a test here rather than a stranger's scaffold.
 */

/** The SDK's rule, restated only so this module needs no runtime dependency. */
const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isValidPrefix(prefix: string): boolean {
  return PREFIX_PATTERN.test(prefix);
}

/**
 * Latin letters that are not accented forms of an ASCII letter, so NFKD leaves
 * them whole and the a-z filter would delete them outright — turning
 * `Ærø Ascendancy` into `r_ascendancy`. Spelled out because a mangled default
 * is worse than a long-ish table, and Stellaris mod names are not all English.
 */
const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/æ/g, "ae"],
  [/œ/g, "oe"],
  [/ø/g, "o"],
  [/ð/g, "d"],
  [/þ/g, "th"],
  [/ß/g, "ss"],
  [/ł/g, "l"],
  [/đ/g, "d"],
  [/ħ/g, "h"],
  [/ŋ/g, "ng"],
];

/**
 * A display name into a mod prefix: `"Hello Galaxy"` -> `hello_galaxy`.
 *
 * Accents fold onto their base letter and the letters above transliterate, so
 * `Ærø Ascendancy` becomes `aero_ascendancy` rather than losing three of its
 * characters. A name that begins with a digit gets a `mod_` prefix: ids and
 * file stems must start with a letter, and refusing outright would be a dead
 * end for a legitimate name like `4X Overhaul`.
 */
export function toPrefix(name: string): string {
  let folded = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    folded = folded.replace(pattern, replacement);
  }
  const slug = folded.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
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

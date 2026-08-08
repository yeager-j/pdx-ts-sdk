/**
 * Folding what an author typed down to `[a-z0-9_]`.
 *
 * Two callers need exactly this and must agree: `derive.ts` turns a mod's
 * display name into its prefix, and `catalog/names.ts` turns a requested
 * feature name into a file stem. They differ in what they do when the fold
 * comes back empty — one falls back, the other refuses — but the folding rule
 * itself is one rule, so it lives in one module.
 */

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
 * Accents fold onto their base letter and the letters above transliterate, so
 * `Ærø Ascendancy` becomes `aero ascendancy` rather than losing three of its
 * characters. Everything outside `[a-z0-9]` survives this step and is the
 * caller's problem.
 */
export function fold(value: string): string {
  let folded = value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    folded = folded.replace(pattern, replacement);
  }
  return folded;
}

/**
 * The fold, then one `_` per run of anything else, then the leading and
 * trailing separators dropped. Returns `""` when nothing survived, which is a
 * fact for the caller to interpret rather than an error: a scaffold defaults,
 * a generated file refuses.
 */
export function slugify(value: string): string {
  return fold(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

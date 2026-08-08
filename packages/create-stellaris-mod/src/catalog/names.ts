/**
 * One validated derivation, from what an author typed to every name the
 * generated source needs.
 *
 * This is the deliberate opposite of `derive.ts`, and the difference is worth
 * stating. `derive.ts` may never fail: it fills in a prompt's default, and an
 * author who dislikes `my_mod` can simply type something else. Nothing here is
 * a default. These names become a file on disk, a content id in the game, and a
 * binding in source, so a name that cannot become all three is refused with the
 * reason — never quietly replaced by a fallback the author did not ask for and
 * would only discover in the emitted mod.
 *
 * Derivation is a pure function of the input string. Same name, same names,
 * every time, on every machine.
 */

import { slugify } from "../fold.ts";
import type { DerivedNames } from "./types.ts";

/**
 * The SDK's `FILE_STEM_PATTERN`, restated so this package needs no runtime
 * dependency on the SDK — the same trade `derive.ts` and `manifest.ts` make.
 * `adversarial-names.test.ts` imports the real pattern and asserts the two are
 * identical, so a change to the SDK's grammar breaks a test here rather than a
 * stranger's generated file.
 */
export const STEM_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Long enough for any name a person types, short enough that the emitted id
 * (`<prefix>_tech_<stem>`) and filename stay legible and stay inside every
 * filesystem's own limit with room for both affixes.
 */
const MAX_STEM_LENGTH = 64;

/**
 * What a name beginning with a digit gets in front of it. Stems and ids must
 * start with a letter, and `derive.ts` already set the precedent that this is
 * a guard rather than a refusal: `4X Overhaul` is a real name someone will
 * type. The word is `feature` because that is what the file is — one Authoring
 * Feature — the way `derive.ts`'s `mod_` names what *it* is guarding.
 */
const LEADING_DIGIT_GUARD = "feature";

/**
 * Words that cannot be a `const` binding, plus the two names every Generated
 * Feature Source already binds at module scope. `mod` is the `#mod` import and
 * `feature` is the exported Feature, so a technology called "Feature" would
 * otherwise emit a file that shadows its own export.
 */
const RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  // Bound by every generated file.
  "feature",
  "mod",
]);

export class NameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NameError";
  }
}

export function deriveNames(rawName: string): DerivedNames {
  const title = rawName.replace(/\s+/g, " ").trim();
  if (title === "") {
    throw new NameError(
      "A generated feature needs a name, and this one is empty. Pass the name the " +
        'launcher and the research screen should show, such as "Resonance Theory".'
    );
  }

  const slug = slugify(rawName);
  if (slug === "") {
    throw new NameError(
      `${JSON.stringify(title)} has no letters or digits left after folding it down to a ` +
        "filename, so there is nothing to name the file, the id, or the binding after. " +
        "Include at least one letter or digit that survives as ASCII."
    );
  }

  const stem = /^[a-z]/.test(slug) ? slug : `${LEADING_DIGIT_GUARD}_${slug}`;
  if (stem.length > MAX_STEM_LENGTH) {
    throw new NameError(
      `${JSON.stringify(title)} folds to "${stem}", which is ${stem.length} characters; the ` +
        `limit is ${MAX_STEM_LENGTH}. The name becomes a file stem and part of every id the ` +
        "feature mints, so shorten it."
    );
  }
  if (!STEM_PATTERN.test(stem)) {
    // Unreachable by construction; a loud failure beats emitting a stem the
    // SDK will reject at build time, in someone else's project.
    throw new NameError(
      `${JSON.stringify(title)} folds to "${stem}", which is not lowercase snake_case ` +
        `(${String(STEM_PATTERN)}).`
    );
  }

  return {
    logicalName: stem,
    stem,
    basename: `${stem}.ts`,
    identifier: toIdentifier(stem),
    title,
  };
}

/**
 * `resonance_theory` -> `resonanceTheory`. A trailing `_` is the escape for a
 * word TypeScript will not let us bind: `class_` rather than a renamed or
 * numbered identifier, because the author's word survives and the reason it is
 * decorated is visible in one glance.
 */
function toIdentifier(stem: string): string {
  const [first = "", ...rest] = stem.split("_").filter((segment) => segment !== "");
  const camel =
    first + rest.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join("");
  return RESERVED_IDENTIFIERS.has(camel) ? `${camel}_` : camel;
}

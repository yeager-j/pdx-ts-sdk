/** Shared validation and hashing for localization key suffixes. */

import { createHash } from "node:crypto";

export const LOCALIZATION_KEY_SUFFIX_PATTERN = /^[A-Za-z0-9_.\-']+$/;

export interface LocalizationSuffixResult {
  readonly suffix: string;
  readonly usedFallback: boolean;
}

export function assertLocalizationSuffix(value: string): void {
  if (!LOCALIZATION_KEY_SUFFIX_PATTERN.test(value)) {
    throw new Error(
      `Localization key suffix "${value}" must contain only ASCII letters, digits, ` +
        `"_", ".", "-", or "'"`
    );
  }
}

export function shortLocalizationHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** Uses an explicit safe suffix, or a short content hash when none is supplied. */
export function localizationSuffix(
  name: string,
  explicit: string | undefined
): LocalizationSuffixResult {
  if (explicit !== undefined) {
    assertLocalizationSuffix(explicit);
    return { suffix: explicit, usedFallback: false };
  }
  return { suffix: shortLocalizationHash(name), usedFallback: true };
}

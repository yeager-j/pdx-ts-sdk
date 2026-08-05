import type { ModWarning } from "../diagnostics.ts";

const LOC_FORBIDDEN = /[\r\n\0]/;

function assertLocLineSafe(key: string, text: string): void {
  const where = LOC_FORBIDDEN.test(key) ? "key" : LOC_FORBIDDEN.test(text) ? "text" : undefined;
  if (where === undefined) {
    return;
  }
  const value = where === "key" ? key : text;
  const isBreak = /[\r\n]/.test(value);
  throw new Error(
    `Localization ${where} for "${key.replace(LOC_FORBIDDEN, "␤")}" cannot contain ` +
      `${isBreak ? "a line break" : "a NUL byte"}: each entry is written as one ` +
      `\` key:0 "text"\` line, and the game reads that file line by line, so everything past ` +
      `the break would be read as a further localisation entry — silently overriding whatever ` +
      `key it appeared to name.` +
      (isBreak && where === "text"
        ? ` For a line break in displayed text, write the two-character escape \\\\n, which is ` +
          `how the game's own localisation spells one.`
        : ` Keep localisation ${where}s to a single line.`)
  );
}

export interface LocalizationAccumulator {
  readonly loc: Map<string, string>;
  register(entries: readonly (readonly [string, string])[]): void;
}

/** Creates the build-local localization registry and its canonical registrar. */
export function createLocalizationAccumulator(warnings: ModWarning[]): LocalizationAccumulator {
  const loc = new Map<string, string>();
  const locSource = new Map<string, string>();

  return {
    loc,
    register(entries) {
      const pending = new Map<string, string>();
      for (const [key, source] of entries) {
        assertLocLineSafe(key, source);
        const existing = pending.get(key) ?? locSource.get(key);
        if (existing !== undefined && existing !== source) {
          throw new Error(`Duplicate localization key "${key}"`);
        }
        pending.set(key, source);
      }
      for (const [key, source] of entries) {
        if (loc.has(key)) {
          continue;
        }
        let text = source;
        if (text.includes('"')) {
          warnings.push({
            code: "loc-quote-replaced",
            message: `Localization "${key}": Paradox yml has no quote escaping; replacing " with '`,
          });
          text = text.replaceAll('"', "'");
        }
        loc.set(key, text);
        locSource.set(key, source);
      }
    },
  };
}

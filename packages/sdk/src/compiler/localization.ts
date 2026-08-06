import type { LocalizationLanguage } from "../authoring/localization.ts";
import type { LocalisationEntry } from "../content/authoring.ts";
import type { ModWarning } from "../diagnostics.ts";
import { compareLogicalPaths, compareUtf8, normalizeLogicalPath } from "../ordering.ts";
import type { LocalizationFile } from "./model.ts";

const LOC_FORBIDDEN = /[\r\n\0]/;

type LocalizationLayer = "ordinary" | "replace";

export interface LocalizationRegistration {
  readonly layer: LocalizationLayer;
  readonly language: LocalizationLanguage;
  readonly stem: string | undefined;
  readonly entries: readonly LocalisationEntry[];
}

interface PendingEntry {
  readonly layer: LocalizationLayer;
  readonly language: LocalizationLanguage;
  readonly key: string;
  readonly source: string;
  readonly stems: Set<string | undefined>;
}

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

function localizationPath(
  prefix: string,
  layer: LocalizationLayer,
  language: LocalizationLanguage,
  stem: string | undefined
): ReturnType<typeof normalizeLogicalPath> {
  const filename = `${prefix}${stem === undefined ? "" : `_${stem}`}_l_${language}.yml`;
  const layerDir = layer === "replace" ? "replace/" : "";
  return normalizeLogicalPath(`localisation/${layerDir}${language}/${filename}`);
}

export interface LocalizationAccumulator {
  register(registration: LocalizationRegistration): void;
  finish(prefix: string): readonly LocalizationFile[];
}

/** Collects localization globally, then resolves deterministic feature-owned files. */
export function createLocalizationAccumulator(warnings: ModWarning[]): LocalizationAccumulator {
  const pending = new Map<string, PendingEntry>();

  return {
    register({ layer, language, stem, entries }) {
      for (const [key, source] of entries) {
        assertLocLineSafe(key, source);
        const identity = `${layer}\0${language}\0${key}`;
        const existing = pending.get(identity);
        if (existing !== undefined) {
          if (existing.source !== source) {
            throw new Error(`Duplicate localization key "${key}" for ${language}`);
          }
          existing.stems.add(stem);
          continue;
        }
        pending.set(identity, {
          layer,
          language,
          key,
          source,
          stems: new Set([stem]),
        });
      }
    },
    finish(prefix) {
      const placed = [...pending.values()].map((entry) => {
        const relPath = [...entry.stems]
          .map((stem) => localizationPath(prefix, entry.layer, entry.language, stem))
          .sort(compareLogicalPaths)[0]!;
        return { ...entry, relPath };
      });
      placed.sort((a, b) => compareLogicalPaths(a.relPath, b.relPath) || compareUtf8(a.key, b.key));

      const grouped = new Map<
        string,
        { language: LocalizationLanguage; entries: LocalisationEntry[] }
      >();
      for (const entry of placed) {
        let text = entry.source;
        if (text.includes('"')) {
          warnings.push({
            code: "loc-quote-replaced",
            message:
              `Localization "${entry.key}" (${entry.language}): Paradox yml has no quote ` +
              `escaping; replacing " with '`,
          });
          text = text.replaceAll('"', "'");
        }
        const file = grouped.get(entry.relPath) ?? {
          language: entry.language,
          entries: [],
        };
        file.entries.push(Object.freeze([entry.key, text]));
        grouped.set(entry.relPath, file);
      }

      return Object.freeze(
        [...grouped].map(([relPath, file]) =>
          Object.freeze({
            relPath,
            language: file.language,
            entries: Object.freeze([...file.entries]),
          })
        )
      );
    },
  };
}
